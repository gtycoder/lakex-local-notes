/**
 * 桌面同步 Controller（Step 5）：核心编排用共享 syncEngine，桌面保留特有收尾
 *（GC 差集标记 / purge 前缀删 / 进度 / 记账 / warnings 结构化 / superseded UI）。
 *
 * 语义等价性由 electron/syncEquivalence.test.ts（7 场景）与 electron/syncAdapterEquiv.test.ts（4 场景）保证。
 */
import fs from "node:fs";
import path from "node:path";
import type { Store } from "./store.js";
import { ObjectStore } from "./s3Store.js";
import type { SyncProgress, SyncResult } from "./syncTypes.js";
import { sha256Hex, validateS3Settings, type S3Settings } from "../src/core/syncUtils.js";
import { S3V3_POINTER_KEY, indexKey, lakeBodyKey } from "../src/core/s3v3/protocol/s3v3Keys.js";
import { backfillV3Assets, type AssetBackfillPort } from "../src/core/s3v3AssetBackfill.js";
import type { QuickNotePushOutcome } from "../src/core/quickNoteSyncTypes.js";
import { parseLakeIndexBytes } from "../src/core/s3v3/protocol/s3v3Index.js";
import { validatePointer, type S3v3Pointer } from "../src/core/s3v3/protocol/s3v3Types.js";
import { S3v3S3Remote } from "./s3v3/s3Remote.js";
import type { S3v3Remote } from "./s3v3/ports.js";
import { canTouchNetwork, cloudStateOf, type CloudState } from "../src/core/cloudState.js";
import type { LoggerScopes } from "../src/core/logger.js";
import { perfMessage } from "../src/core/logFormat.js";

/**
 * Step 5：桌面 Controller 化入口。
 */
let v3Gate: Promise<unknown> = Promise.resolve();
/**
 * 单条推送的**高优先门**（261110）：只与其它单条推送串行，**不等**整轮同步、不进维护队列。
 *
 * 跨进程发布互斥仍由 S3 发布锁 + pointer CAS/读回重试保证（与 6 端并发发布同一套判据）；
 * 本地 state/baseline 都是原子写（最后写者胜），与移动端「维护域 / 高优先域两个独立门」同口径。
 * 判据登记：src/core/maintenancePolicy.ts 的 PRIORITY_OPS.syncQuickNote。
 */
let quickPushGate: Promise<unknown> = Promise.resolve();
async function serializedQuickPush<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const previous = quickPushGate;
  quickPushGate = mine;
  await previous.catch(() => undefined);
  try { return await fn(); } finally { release(); }
}

/** S3 remote/client 缓存（261110）：同一份 settings 复用 AWS client（构造是快路径上的固定开销）。
 *  设置变化（含 secret 轮换）⇒ 指纹不同自动重建；推送失败主动失效（下次重建）。 */
let cachedPushRemote: { key: string; remote: S3v3S3Remote } | null = null;
function pushRemoteFor(settings: S3Settings): S3v3S3Remote {
  const key = [
    settings.endpoint, settings.region, settings.bucket, settings.prefix,
    settings.accessKeyId, settings.secretAccessKey, settings.forcePathStyle ? "1" : "0",
  ].join("\u0000");
  if (cachedPushRemote?.key === key) return cachedPushRemote.remote;
  const remote = new S3v3S3Remote({
    endpoint: settings.endpoint, region: settings.region, bucket: settings.bucket,
    accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey,
    prefix: settings.prefix, forcePathStyle: settings.forcePathStyle,
  });
  cachedPushRemote = { key, remote };
  return remote;
}
/** v3 全量同步串行化：整轮同步与“单条推送→全量 v3”不会并发写同一设备 sidecar/索引。 */
async function serializedV3<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const previous = v3Gate;
  v3Gate = mine;
  await previous.catch(() => undefined);
  try { return await fn(); } finally { release(); }
}

export async function syncNowViaEngine(
  store: Store,
  onProgress?: (p: SyncProgress) => void,
  _createRemote?: (settings: S3Settings, logScopes: LoggerScopes) => ObjectStore,
): Promise<SyncResult> {
  // 261025 转正完成：只保留 v3；legacy 回滚入口已移除。
  return serializedV3(async () => {
    const { syncWithV3 } = await import("./s3v3/desktopSync.js");
    return syncWithV3(store, onProgress);
  });
}

/**
 * 单条小记推送入口（「保存并同步」；261110 提速）：**高优先门**，不等整轮同步。
 * 内部只 upsert 一条；遇到「必须整轮」的情形（云端无 pointer/无基线/不同代，或远端墓碑未恢复）
 * 通过 `fullSync` 回退一次整轮并回传 full-sync（不静默降级；整轮本身仍走 v3Gate 串行）。
 */
export async function pushQuickNoteViaEngine(
  store: Store,
  id: string,
  deps: { settings?: S3Settings } = {},
): Promise<QuickNotePushOutcome> {
  return serializedQuickPush(async () => {
    // IPC 侧已读过设置（含 safeStorage 解密）：直接复用，快路径不再二次读。
    const settings = deps.settings ?? store.getS3Settings();
    if (!settings) throw new Error("请先保存 S3 配置");
    const remote = pushRemoteFor(settings);
    const startedAt = Date.now();
    try {
      const { pushQuickNoteWithV3 } = await import("./s3v3/desktopSync.js");
      return await pushQuickNoteWithV3(store, id, {
        remote,
        // 回退整轮：走同步入口（含 v3Gate），避免同进程两个整轮并发写基线。
        fullSync: (onProgress) => syncNowViaEngine(store, onProgress),
      });
    } catch (error) {
      // 客户端/配置可能已失效：下次重建 remote（AWS client 没有显式 close 需求）。
      cachedPushRemote = null;
      store.logScopes.sync.warn("[v3][push-single] failed " + (error instanceof Error ? error.message : String(error)) + " ms=" + (Date.now() - startedAt));
      throw error;
    }
  });
}

/**
 * 回收站预览 / 恢复的后台补拉：只补云端声明、本地缺失/损坏的资产（**v3 原生路径**）。
 *
 * 旧实现读本地 `declared_assets` 表，而 v3 从不写该表（声明是独立的内容寻址对象）⇒ 空操作。
 * 现在：pointer → lake 索引 → 该篇 assetsHash → 声明对象 → 本地差集（同名+同 size+同 sha256 跳过）
 * → 按需 GET + size/sha256 校验后落盘。best-effort：无配置/关云同步/网络失败一律只回 warnings。
 */
/**
 * 本地资产缺口：正文引用、但 note-assets/{id}/ 里没有的文件（`.tmp` 不算）。
 *
 * 用途（261114 用户反馈）：回收站恢复后的「后台补拉」在云同步关闭/未配置时会返回 skipped，
 * 渲染层据此弹「没有去云端补拉」的提示；但很多文档根本没有资源缺口（图片/附件都在本地），
 * 这条提示就是纯噪音。所以阻塞出网时先用本地差集判一次：没有缺口 = 不报 skipped。
 */
function missingLocalNoteAssets(store: Store, noteId: string): string[] {
  try {
    const refs = store.getCurrentContentRefs(noteId);
    if (refs.size === 0) return [];
    let disk: Set<string>;
    try { disk = new Set(fs.readdirSync(store.noteAssetsPathFor(noteId)).filter((f) => !f.includes(".tmp"))); }
    catch { disk = new Set(); }
    return [...refs].filter((filename) => !disk.has(filename));
  } catch {
    // 读不到正文/目录时按「没有缺口」处理：宁可少一条提示，也不误报缺数据。
    return [];
  }
}
export async function ensureTrashNoteAssets(
  store: Store,
  id: string,
  deps: { remote?: S3v3Remote; force?: boolean } = {},
): Promise<{ warnings: string[]; skipped?: CloudState }> {
  const warnings: string[] = [];
  const settings = store.getS3Settings();
  if (!deps.remote) {
    // 261114：阻塞出网时只有**本地真有缺口**才回 skipped（渲染层据此提示「没有去云端补拉」），
    // 否则恢复后的提示是纯噪音（用户实测：云同步关闭状态下每次恢复都弹）。
    const gap = () => missingLocalNoteAssets(store, id).length > 0;
    if (!settings) return { warnings, skipped: gap() ? "unconfigured" : undefined };
    // 单一判据：没配置 或 关了云同步 ⇒ 一律不出网（用户 261006：关闭云同步 = 纯离线本地空间）。
    const state = cloudStateOf(true, store.getSyncSettings());
    if (!canTouchNetwork(state)) return { warnings, skipped: gap() ? state : undefined };
    validateS3Settings(settings);
  }
  const remote = deps.remote ?? new S3v3S3Remote({
    endpoint: settings!.endpoint, region: settings!.region, bucket: settings!.bucket,
    accessKeyId: settings!.accessKeyId, secretAccessKey: settings!.secretAccessKey,
    prefix: settings!.prefix, forcePathStyle: settings!.forcePathStyle,
  });
  const port: AssetBackfillPort = {
    listLocal: async (noteId) => {
      try { return (await fs.promises.readdir(store.noteAssetsPathFor(noteId))).filter((f) => !f.includes(".tmp")); } catch { return []; }
    },
    readLocal: async (noteId, filename) => {
      try { return new Uint8Array(await fs.promises.readFile(path.join(store.noteAssetsPathFor(noteId), filename))); } catch { return null; }
    },
    writeLocal: async (noteId, filename, bytes) => {
      const dir = store.noteAssetsPathFor(noteId);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(path.join(dir, filename), Buffer.from(bytes));
    },
  };
  const startedAt = Date.now();
  try {
    const result = await backfillV3Assets(remote, "lake", id, port, { force: deps.force });
    warnings.push(...result.warnings);
    store.logScopes.sync.info(perfMessage("v3.asset-backfill", Date.now() - startedAt, {
      noteId: id, found: result.found, downloaded: result.downloaded, skipped: result.skipped,
      missing: result.missing.length, failed: result.failed.length,
    }));
  } catch (e) {
    warnings.push(`资源下载失败（保留恢复/预览，资源下次同步补拉）: ${(e as Error).message}`);
  }
  return { warnings };
}

/*
 * 261006 B 方案：**恢复不再等网络**（原先 restoreTrashWithAssets 会先 await 全量资产下载，
 * 慢网/大附件会让"恢复"看起来卡死）。现在 restore 立刻生效，缺失资源由渲染层拿到 id 后
 * 调 ensureTrashNoteAssets 在后台补拉，并按回执给用户「正在从 S3 拉取缺失数据…」/「未能下载」。
 * 恢复红线不变：恢复是墓碑权威的唯一显式例外，永远成功。
 */

/**
 * 资源页「缺正文」→ 从云端拉回该篇正文（261023，用户显式发起的恢复动作）。
 *
 * 语义：只在**允许出网**时执行（「关闭云同步 = 完全没配置」红线）；拉回前校验 sha256；
 * 失败一律明确回报（不静默、不写空正文），由 UI 决定下一步（历史恢复 / 删除）。
 * 资产（图片/附件）不在这里处理：正文落盘后，下一次正常同步会按清单差集补拉。
 */
export async function restoreMissingBodyFromCloud(
  store: Store,
  noteId: string,
  deps: { remote?: S3v3Remote } = {},
): Promise<{ ok: true; title: string } | { ok: false; reason: "cloud-off" | "no-cloud-config" | "not-in-cloud" | "object-missing" | "hash-mismatch" }> {
  const settings = store.getS3Settings();
  // deps.remote = 测试/诊断注入（生产永远走已配置的 S3 settings）。
  if (!settings && !deps.remote) return { ok: false, reason: "no-cloud-config" };
  if (!deps.remote && !canTouchNetwork(cloudStateOf(true, store.getSyncSettings()))) return { ok: false, reason: "cloud-off" };
  if (settings) validateS3Settings(settings);
  const startedAt = Date.now();
  // v3（261026 转正）：资源页「缺正文 → 从云端拉回」不能再读旧 manifests/latest.json（v3 永不写它，
  // 旧实现 100% 返回 not-in-cloud）。改为读 v3 pointer → lake 索引 → 内容寻址正文对象，并校验 sha256。
  const remote = deps.remote ?? new S3v3S3Remote({
    endpoint: settings!.endpoint, region: settings!.region, bucket: settings!.bucket,
    accessKeyId: settings!.accessKeyId, secretAccessKey: settings!.secretAccessKey,
    prefix: settings!.prefix, forcePathStyle: settings!.forcePathStyle,
  });
  const pointerBytes = await remote.get(S3V3_POINTER_KEY);
  if (!pointerBytes) return { ok: false, reason: "not-in-cloud" };
  let pointer: S3v3Pointer;
  try {
    const parsed = validatePointer(JSON.parse(new TextDecoder().decode(pointerBytes)));
    if (!parsed.ok) return { ok: false, reason: "not-in-cloud" };
    pointer = parsed.pointer;
  } catch { return { ok: false, reason: "not-in-cloud" }; }
  const indexBytes = await remote.get(indexKey("lake", pointer.lake.commit));
  if (!indexBytes) return { ok: false, reason: "not-in-cloud" };
  let entry: ReturnType<typeof parseLakeIndexBytes>["index"]["notes"][number] | undefined;
  try { entry = parseLakeIndexBytes(indexBytes).index.notes.find((n) => n.id === noteId); }
  catch { return { ok: false, reason: "not-in-cloud" }; }
  if (!entry) return { ok: false, reason: "not-in-cloud" };
  const bytes = await remote.get(lakeBodyKey(noteId, entry.contentHash));
  if (!bytes) return { ok: false, reason: "object-missing" };
  if (sha256Hex(bytes) !== entry.contentHash) return { ok: false, reason: "hash-mismatch" };
  store.writeRestoredBody(noteId, new TextDecoder().decode(bytes));
  // Del-6：不再回写 v2 的 sync_base（已随死账本删除）。恢复后的基线一致性由下一次成功同步写
  // sync-v3/baseline.json.gz 保证；这里只需把本地行标 synced（正文 == 云端内容，无需再上传）。
  store.markSynced(noteId);
  store.logScopes.sync.info(perfMessage("missing-body.restoreFromCloud", Date.now() - startedAt, { noteId, bytes: bytes.length }));
  return { ok: true, title: entry.title };
}
