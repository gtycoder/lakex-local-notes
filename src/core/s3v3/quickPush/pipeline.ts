/**
 * 「保存并同步」= **只推当前这一条小记**的独立管线（261110 从 S3v3SyncEngine 剥离）。
 *
 * 不变量（与 docs/SYNC-PROTOCOL.md §12.3 一一对应）：
 *  - 只 upsert 这一条：远端其他 items、tags、purged（按保留窗口）逐字段保持原样；
 *  - 只动 quick-notes 空间：lake commit 原样、不读 lake 索引、不做三方合并/plan/apply/意图账本；
 *  - 成功才写 baseline（lake 部分原样、quick 只更新本条）并只标本条 synced；失败不写基线不标同步；
 *  - 必须整轮的情况（无 pointer / 无 baseline / epoch·generation·lakeCommit 不符 / 远端 purged 无恢复标记）
 *    返回 `full-sync`，由调用方执行整轮（不静默降级）。
 *
 * 请求序列（成功、无资产；与整轮协议兼容）：
 *   1) 取发布锁：GET owner → PUT lock →（静置）→ GET owner   （2 GET + 1 PUT）
 *   2) 锁内**只读一次** pointer，用它与 baseline 做代数判定（CAS 基线）  （1 GET）
 *   3) 与 quick-notes 索引 GET **并行** PUT 本条正文（内容寻址）        （1 GET + 1 PUT）
 *   4) 需要时 GET 远端资产声明 + 上传新增资产/声明                    （有资产才有）
 *   5) PUT 新 quick 索引                                          （1 PUT）
 *   6) 写 pointer 前 GET 校验仍持锁（assert）                      （1 GET）
 *   7) PUT pointer                                               （1 PUT）
 *   8) 读回校验 pointer                                           （1 GET）
 *   9) finally 释放锁：TTL 安全余量内直接 DELETE（省掉 owner GET） （1 DELETE）
 *   合计 11 次请求（旧实现 13：入口多一次 pointer GET、释放多一次 owner GET）。
 *
 * 重复点（内容/meta/资产都没变）= 单次 pointer GET 探测（不取锁、不读索引、0 上传、0 发布）。
 */
import { runPoolSettled } from "../../s3v3Pool.js";
import { sha256Hex } from "../../syncUtils.js";
import {
  buildAssetDeclaration,
  declarationHashOf,
  indexHashOf,
  parseQuickNotesIndexBytes,
  pruneQuickPurgedIds,
  serializeDeclaration,
  serializeQuickNotesIndex,
  validateAssetDeclaration,
  type AssetDeclaration,
  type QuickNoteEntry,
  type QuickNotesIndex,
} from "../protocol/s3v3Index.js";
import { declarationKey, indexKey, quickNoteAssetKey, quickNoteBodyKey, S3V3_POINTER_KEY } from "../protocol/s3v3Keys.js";
import { LOCK_DEADLINE_MS, LOCK_KEY, LOCK_SETTLE_MS, LOCK_TTL_MS } from "../protocol/publishLock.js";
import { S3v3SyncError } from "../protocol/syncErrors.js";
import { validatePointer, type S3v3Pointer } from "../protocol/s3v3Types.js";
import type { QuickPushDeps, QuickPushDevice, QuickPushResult, QuickPushState } from "./types.js";

/** buildAssetDeclaration 的返回（declHash/declaration/serialized）。 */
type BuiltDeclaration = ReturnType<typeof buildAssetDeclaration>;

const SINGLE_PUSH_MAX_RETRIES = 3;
/** 释放锁时确定自己仍持有锁的安全余量（锁 TTL 内提前这么多就算"确定"）。 */
const LOCK_RELEASE_SAFETY_MS = 5_000;
const DEFAULT_TRANSFER_CONCURRENCY = 12;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 发布冲突（pointer 被抢先）——内部重试信号，不跨模块暴露。 */
class QuickPushRetry extends Error {}

interface UploadOp {
  key: string;
  bytes?: Uint8Array;
  fromFile?: string;
  size: number;
  gzip?: boolean;
}

function phaseTracker(deps: QuickPushDeps): (name: string) => void {
  let last = Date.now();
  return (name: string) => {
    const now = Date.now();
    const ms = now - last;
    last = now;
    try { deps.onPhase?.(name, ms); } catch { /* 日志回调自行负责 */ }
  };
}

async function readPointer(deps: QuickPushDeps): Promise<S3v3Pointer | null> {
  const bytes = await deps.remote.get(S3V3_POINTER_KEY);
  if (!bytes) return null;
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new S3v3SyncError("pointer-corrupt", "pointer 不是合法 JSON"); }
  const parsed = validatePointer(raw);
  if (!parsed.ok) throw new S3v3SyncError("pointer-corrupt", parsed.reason);
  return parsed.pointer;
}

async function lockOwner(deps: QuickPushDeps): Promise<string | null> {
  const raw = await deps.remote.get(LOCK_KEY);
  if (!raw) return null;
  try { return (JSON.parse(new TextDecoder().decode(raw)) as { deviceId: string }).deviceId; } catch { return null; }
}

/** 无 CAS provider 的发布锁：写锁 → 静置 → 读回确认仍是自己（与整轮 §12.1 同协议）。 */
async function acquireLock(deps: QuickPushDeps): Promise<boolean> {
  const deadline = Date.now() + (deps.lockWaitMs ?? LOCK_DEADLINE_MS);
  for (;;) {
    const owner = await lockOwner(deps);
    if (owner && owner !== deps.deviceId) {
      const raw = await deps.remote.get(LOCK_KEY);
      let fresh = false;
      if (raw) { try { const l = JSON.parse(new TextDecoder().decode(raw)) as { time: number; ttl: number }; fresh = Date.now() - l.time < (l.ttl ?? LOCK_TTL_MS); } catch { fresh = false; } }
      if (fresh) {
        if (Date.now() > deadline) return false;
        await sleep(60 + Math.floor(Math.random() * 240));
        continue;
      }
    }
    const lock = { deviceId: deps.deviceId, time: Date.now(), ttl: LOCK_TTL_MS };
    await deps.remote.put(LOCK_KEY, new TextEncoder().encode(JSON.stringify(lock)));
    await sleep(LOCK_SETTLE_MS);
    if (await lockOwner(deps) === deps.deviceId) return true;
    if (Date.now() > deadline) return false;
    await sleep(60 + Math.floor(Math.random() * 240));
  }
}

/** 写 pointer 前确认锁仍属于自己（防止静置后又被别的端抢走）。 */
async function assertLockOwned(deps: QuickPushDeps): Promise<void> {
  if (await lockOwner(deps) !== deps.deviceId) throw new QuickPushRetry();
}

/**
 * 释放锁：若距取锁成功不足 TTL-5s（我们确定自己还持有），直接 DELETE —— 省掉旧实现的 owner GET；
 * 超过安全余量（极端慢发布/时钟漂移）退回保守的「读 owner → 是自己才删」。
 */
async function releaseLock(deps: QuickPushDeps, acquiredAt: number): Promise<void> {
  if (Date.now() - acquiredAt < LOCK_TTL_MS - LOCK_RELEASE_SAFETY_MS) {
    try { await deps.remote.deleteMany([LOCK_KEY]); } catch { /* 锁过期也会自愈 */ }
    return;
  }
  const owner = await lockOwner(deps);
  if (owner === deps.deviceId) {
    try { await deps.remote.deleteMany([LOCK_KEY]); } catch { /* ignore */ }
  }
}

/** 单条同步的轻量状态：优先端口轻量读；缺失/抛错回退整份 loadState（语义不变，只是慢）。 */
async function loadLightState(deps: QuickPushDeps, id: string): Promise<QuickPushState | null> {
  if (deps.device.loadQuickPushState) {
    try {
      const light = await deps.device.loadQuickPushState(id);
      if (light) return light;
    } catch { /* 回退整份 */ }
  }
  if (!deps.device.loadState) return null;
  const state = await deps.device.loadState();
  if (!state) return null;
  return {
    quickNote: state.quickNotes.items.find((q) => q.id === id) ?? null,
    restorePending: state.restorePending ?? [],
    remotePurged: state.remotePurged ?? [],
    quickPurges: state.quickPurges ?? [],
    quickPurgeTimes: state.quickPurgeTimes ?? {},
  };
}

/** 本地小记资产清点（文件名 + size/hash 原生清单优先，缺清单才读字节算 sha256）。 */
async function listLocalAssets(device: QuickPushDevice, id: string): Promise<{
  filenames: string[];
  stats: Map<string, { size: number; hash: string }> | null;
}> {
  let stats: Map<string, { size: number; hash: string }> | null = null;
  if (device.listQuickAssetStats) {
    try {
      const list = await device.listQuickAssetStats(id);
      stats = new Map(list.map((s) => [s.filename, { size: s.size, hash: s.hash }] as const));
    } catch { stats = null; }
  }
  const filenames = stats ? [...stats.keys()].sort() : await device.listQuickAssets(id);
  return { filenames, stats };
}

/** 生成本条资产声明 + 待上传任务；远端已有同名附件时复用其 size/hash（同名 = 同内容，不读本地字节）。 */
async function buildAssets(
  deps: QuickPushDeps,
  id: string,
  remoteDecl: AssetDeclaration | null,
  prepared?: { filenames: string[]; stats: Map<string, { size: number; hash: string }> | null },
): Promise<{ decl: BuiltDeclaration | null; ops: UploadOp[] }> {
  const { filenames, stats } = prepared ?? await listLocalAssets(deps.device, id);
  if (filenames.length === 0) return { decl: null, ops: [] };
  const remoteByName = new Map((remoteDecl?.assets ?? []).map((a) => [a.filename, a] as const));
  const entries: AssetDeclaration["assets"] = [];
  const ops: UploadOp[] = [];
  for (const filename of filenames) {
    const known = remoteByName.get(filename);
    if (known) { entries.push(known); continue; }
    const stat = stats?.get(filename);
    let nativePath: string | null = null;
    if (deps.device.assetNativePathFor) {
      try { nativePath = await deps.device.assetNativePathFor("quickNotes", id, filename); } catch { nativePath = null; }
    }
    let bytes: Uint8Array | null = null;
    if (!nativePath || !stat) {
      bytes = await deps.device.readQuickAsset(id, filename);
      if (!bytes) continue;
    }
    const size = stat && stat.size >= 0 ? stat.size : bytes!.length;
    const hash = stat && stat.hash ? stat.hash : sha256Hex(bytes!);
    const entry = { filename, size, hash };
    entries.push(entry);
    const key = quickNoteAssetKey(id, filename);
    if (nativePath) ops.push({ key, fromFile: nativePath, size });
    else ops.push({ key, bytes: bytes!, size });
  }
  return { decl: buildAssetDeclaration(entries), ops };
}

/** 远端声明（内容寻址不可变；单条快路径用一次就丢，不做跨轮缓存）。 */
async function getRemoteDeclaration(deps: QuickPushDeps, id: string, declHash: string): Promise<AssetDeclaration | null> {
  const bytes = await deps.remote.get(declarationKey("quickNotes", id, declHash));
  if (!bytes) return null;
  const decl = validateAssetDeclaration(JSON.parse(new TextDecoder().decode(bytes)));
  if (declarationHashOf(decl) !== declHash) throw new S3v3SyncError("declaration-hash-mismatch", "声明 hash 不符: " + id);
  return decl;
}

async function flushUploads(deps: QuickPushDeps, ops: UploadOp[]): Promise<void> {
  if (ops.length === 0) return;
  const { errors } = await runPoolSettled(ops, Math.max(1, Math.min(32, deps.transferConcurrency ?? DEFAULT_TRANSFER_CONCURRENCY)), async (op) => {
    if (op.fromFile && deps.remote.putFromFile) {
      try { if (await deps.remote.putFromFile(op.key, op.fromFile, op.gzip ? { gzip: true } : undefined)) return; } catch { /* 回退字节路径 */ }
    }
    if (!op.bytes) throw new Error("上传任务缺少字节/原生文件路径: " + op.key);
    await deps.remote.put(op.key, op.bytes, op.gzip ? { gzip: true } : undefined);
  });
  if (errors.length > 0) throw new S3v3SyncError("upload-failed", "小记上传失败: " + (errors[0].error as Error).message);
}

/** 该条相对 baseline 的元数据是否完全没变（决定重复点能否不取锁直接返回）。 */
function sameEntryMeta(a: QuickNoteEntry | null | undefined, b: QuickNoteEntry): boolean {
  if (!a) return false;
  return (a.updatedAt ?? "") === (b.updatedAt ?? "")
    && !!a.isConflict === !!b.isConflict
    && JSON.stringify(a.tagIds ?? []) === JSON.stringify(b.tagIds ?? [])
    && (a.tagsUpdatedAt ?? "") === (b.tagsUpdatedAt ?? "");
}

function persistMarkersIfStale(deps: QuickPushDeps, light: QuickPushState, id: string): Promise<void> | null {
  if (!deps.device.persistSyncMarkers) return null;
  const markerPurged = (light.remotePurged ?? []).filter((x) => x !== id);
  const markerRestore = (light.restorePending ?? []).filter((x) => x !== id);
  const stale = markerPurged.length !== (light.remotePurged ?? []).length
    || markerRestore.length !== (light.restorePending ?? []).length;
  if (!stale) return null;
  return deps.device.persistSyncMarkers({ remotePurged: markerPurged, restorePending: markerRestore })
    .catch(() => undefined);
}

/**
 * 执行一次「只推这一条」。
 * @throws S3v3SyncError（lock-busy / index-missing / quick-body-missing / upload-failed / pointer-corrupt …）
 */
export async function runQuickPush(deps: QuickPushDeps, id: string): Promise<QuickPushResult> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < SINGLE_PUSH_MAX_RETRIES; attempt++) {
    try {
      return await runQuickPushOnce(deps, id);
    } catch (e) {
      if (e instanceof QuickPushRetry) {
        lastErr = e;
        await sleep(80 + Math.floor(Math.random() * (attempt + 1) * 160));
        continue;
      }
      throw e;
    }
  }
  throw new S3v3SyncError("publish-conflict", "单条推送发布冲突重试超限: " + String(lastErr));
}

async function runQuickPushOnce(deps: QuickPushDeps, id: string): Promise<QuickPushResult> {
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const phase = phaseTracker(deps);

  // 状态读取：端口有合并读（移动端）就一次取齐 baseline + 单行 + 标记；否则保持两段读。
  const snapshot = deps.device.loadQuickPushSnapshot ? await deps.device.loadQuickPushSnapshot(id) : null;
  const baseline = snapshot ? snapshot.baseline : await deps.device.loadBaseline();
  const light = snapshot ? snapshot.light : await loadLightState(deps, id);
  const local = light?.quickNote ?? null;
  if (!local) return { status: "not-found" };
  phase("push-state");
  if (!baseline) {
    // 无基线：读一次 pointer 区分「云端空」与「云端已有数据但本机没基线」（回退消息保持旧口径）。
    const pointer = await readPointer(deps);
    return { status: "full-sync", reason: pointer ? "no-baseline" : "no-cloud" };
  }
  const restore = new Set(light?.restorePending ?? []);
  const purgedLocal = new Set(light?.remotePurged ?? []);

  // ---- 重复点快探测：本地相对 baseline 完全没变 + 云端仍停在 baseline 那一代 ⇒ 不取锁、不读索引、零上传。
  const baseEntry = baseline.quickNotes.items.find((q) => q.id === id) ?? null;
  // 只有「本地正文和 baseline 一样」时才需要清点资产来判断是否真的没变（常见文本小记 = 零资产、零读字节）。
  const localDecl = baseEntry && baseEntry.contentHash === local.contentHash
    ? (await buildAssets(deps, id, null)).decl
    : null;
  const purgedInBaseline = baseline.quickNotes.purged ?? [];
  const purgedNow = pruneQuickPurgedIds(purgedInBaseline, light?.quickPurgeTimes ?? {}, now());
  const nothingToPrune = purgedNow.length === purgedInBaseline.length;
  const likelyUnchanged = !!baseEntry
    && baseEntry.contentHash === local.contentHash
    && (baseEntry.assetsHash ?? null) === (localDecl?.declHash ?? null)
    && sameEntryMeta(baseEntry, local)
    && !restore.has(id) && !purgedLocal.has(id)
    && nothingToPrune;
  if (likelyUnchanged) {
    const pointer = await readPointer(deps);
    phase("push-pointer");
    if (!pointer) return { status: "full-sync", reason: "no-cloud" };
    if (pointer.epoch !== baseline.epoch || pointer.generation !== baseline.generation
      || pointer.lake.commit !== baseline.lakeCommit || pointer.quickNotes.commit !== baseline.quickNotesCommit) {
      // 云端已变：本机这条没变也仍需按整轮语义处理（旧实现直接 full-sync；保持不静默合并）。
      return { status: "full-sync", reason: "cloud-changed" };
    }
    // 261113（D1）：重复点 = 内容/资产/元数据与云端全未变 ⇒ 写出来的基线字节与落盘完全一致，**不重写**。
    // 旧实现每次都重写整份 baseline（移动端实测 129–207ms/次、桌面 3–5ms）+ markUnchanged 全表归位；
    // 这里本行 dirty 已由上一行按内容 hash 清掉，跳过还顺带消掉「并发整轮已推进基线被本快照覆盖」的窗口。
    if (deps.device.markQuickNoteSynced) await deps.device.markQuickNoteSynced(id, local.contentHash);
    await persistMarkersIfStale(deps, light as QuickPushState, id);
    phase("push-baseline");
    return { status: "pushed", uploadedContent: false, uploadedAssets: 0, unchanged: true, generation: pointer.generation };
  }

  // ---- 正常变更路径：进锁 → 锁内只读一次 pointer（CAS 基线）→ 索引读取与正文 PUT 并行 → 发布。
  if (!(await acquireLock(deps))) throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步，请稍后重试");
  const acquiredAt = Date.now();
  let pointer: S3v3Pointer | null = null;
  let generation = baseline.generation;
  let uploadedContent = false;
  let uploadedAssets = 0;
  let unchanged = false;
  let nextIndex: QuickNotesIndex | null = null;
  let commit = baseline.quickNotesCommit;
  try {
    pointer = await readPointer(deps);
    if (!pointer) return { status: "full-sync", reason: "no-cloud" };
    if (baseline.epoch !== pointer.epoch || baseline.generation !== pointer.generation || baseline.lakeCommit !== pointer.lake.commit) {
      return { status: "full-sync", reason: "cloud-changed" };
    }
    phase("push-pointer");

    const body = await deps.device.readQuickBody(id);
    if (!body) throw new S3v3SyncError("quick-body-missing", "本地小记正文缺失: " + id);
    const contentHash = sha256Hex(body);
    phase("push-body");

    // 与「读远端 quick 索引」并行：把本条正文 PUT 放进同一个 RTT 窗口（内容寻址，重复 PUT 幂等）。
    const likelyBodyUpload = (baseEntry?.contentHash ?? null) !== contentHash;
    const bodyPut = likelyBodyUpload
      ? deps.remote.put(quickNoteBodyKey(contentHash), body)
      : Promise.resolve();
    const indexBytes = await deps.remote.get(indexKey("quickNotes", pointer.quickNotes.commit));
    await bodyPut;
    if (!indexBytes) throw new S3v3SyncError("index-missing", "小记索引缺失: " + pointer.quickNotes.commit);
    const remoteIndex = parseQuickNotesIndexBytes(indexBytes).index;
    const remoteEntry = remoteIndex.items.find((q) => q.id === id) ?? null;
    phase("push-index");

    const remoteTombs = remoteIndex.purged ?? [];
    // 墓碑权威：远端已彻底删除且本机无显式恢复标记 → 交给整轮语义处理（不静默复活）。
    if (remoteTombs.includes(id) && !restore.has(id)) return { status: "full-sync", reason: "remote-deleted" };
    // 保守兜底：baseline 认为内容没变但远端实际不是这个 hash（别端在本地变更后抢先发布过）⇒ 补一次 PUT。
    if (remoteEntry?.contentHash !== contentHash && !likelyBodyUpload) {
      await deps.remote.put(quickNoteBodyKey(contentHash), body);
    }

    // 资产：本地 0 资产不读远端声明；远端已有同 declHash 声明不重复 PUT。本地只清点一次。
    const preparedAssets = await listLocalAssets(deps.device, id);
    const remoteDecl = preparedAssets.filenames.length > 0 && remoteEntry?.assetsHash
      ? await getRemoteDeclaration(deps, id, remoteEntry.assetsHash)
      : null;
    const { decl, ops } = await buildAssets(deps, id, remoteDecl, preparedAssets);
    const declOps: UploadOp[] = [];
    if (decl && decl.declHash !== remoteEntry?.assetsHash) {
      declOps.push({
        key: declarationKey("quickNotes", id, decl.declHash),
        bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)),
        size: 0,
        gzip: true,
      });
    }
    await flushUploads(deps, [...ops, ...declOps]);
    uploadedAssets = ops.length + declOps.length;
    phase("push-upload");
    uploadedContent = remoteEntry?.contentHash !== contentHash;

    // 261113（P2）：顺序是设备本地视图，wire 上 tagIds 只当**集合** —— 整轮发布早就排序，快路径漏了，
    // 同一集合因顺序不同会算出不同 commit ⇒ 云端索引抖动、他端把顺序写回本地。这里与整轮同口径。
    const entry: QuickNoteEntry = {
      ...local,
      contentHash,
      ...(decl ? { assetsHash: decl.declHash } : {}),
      ...(local.tagIds?.length ? { tagIds: [...local.tagIds].sort() } : {}),
    };
    if (!decl) delete (entry as { assetsHash?: string }).assetsHash;
    const items = [...remoteIndex.items.filter((q) => q.id !== id), entry].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // SD-09：单条推送也是一次发布，同样按保留窗口裁剪（否则会把旧墓碑重新带回云端）。
    const purged = pruneQuickPurgedIds(remoteTombs.filter((x) => x !== id), light?.quickPurgeTimes ?? {}, now());
    nextIndex = {
      v: 3, space: "quickNotes", items,
      ...(remoteIndex.tags !== undefined ? { tags: remoteIndex.tags } : {}),
      ...(purged.length ? { purged: [...purged].sort() } : {}),
    };
    const serialized = serializeQuickNotesIndex(nextIndex);
    commit = indexHashOf(serialized);
    unchanged = !uploadedContent && uploadedAssets === 0 && commit === pointer.quickNotes.commit && !restore.has(id);
    generation = pointer.generation;
    if (!unchanged) {
      // 写索引 → 写 pointer 前确认锁仍归自己 → 写 pointer（generation+1，lake 不动）→ 读回校验。
      await deps.remote.put(indexKey("quickNotes", commit), new TextEncoder().encode(serialized), { gzip: true });
      generation = pointer.generation + 1;
      const nextPointer: S3v3Pointer = {
        v: 3, epoch: pointer.epoch, generation,
        lake: { commit: pointer.lake.commit }, quickNotes: { commit },
        createdAt: iso(), deviceId: deps.deviceId,
      };
      await assertLockOwned(deps);
      await deps.remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(nextPointer)));
      const check = await readPointer(deps);
      if (!check || check.generation !== generation || check.quickNotes.commit !== commit || check.lake.commit !== pointer.lake.commit) {
        throw new QuickPushRetry();
      }
    }
    phase("push-publish");
  } finally {
    await releaseLock(deps, acquiredAt);
  }

  // 记账：只标这一条（I2：适配器按内容 hash 未变才标），baseline 跟到新代（lake 部分原样来自 baseline）。
  if (deps.device.markQuickNoteSynced) await deps.device.markQuickNoteSynced(id, local.contentHash);
  await deps.device.saveBaseline({
    epoch: pointer!.epoch, generation,
    lakeCommit: pointer!.lake.commit, quickNotesCommit: commit,
    lake: baseline.lake, quickNotes: nextIndex!,
  });
  phase("push-baseline");
  await persistMarkersIfStale(deps, light as QuickPushState, id);
  return { status: "pushed", uploadedContent, uploadedAssets, unchanged, generation };
}
