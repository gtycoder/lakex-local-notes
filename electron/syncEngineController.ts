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
import { S3V3_POINTER_KEY, indexKey, lakeBodyKey } from "../src/core/s3v3Keys.js";
import { backfillV3Assets, type AssetBackfillPort } from "../src/core/s3v3AssetBackfill.js";
import type { QuickNotePushOutcome } from "../src/core/quickNoteSyncTypes.js";
import { parseLakeIndexBytes } from "../src/core/s3v3Index.js";
import { validatePointer, type S3v3Pointer } from "../src/core/s3v3Types.js";
import { S3v3S3Remote } from "./s3v3/s3Remote.js";
import type { S3v3Remote } from "./s3v3/ports.js";
import { canTouchNetwork, cloudStateOf, type CloudState } from "../src/core/cloudState.js";
import type { LoggerScopes } from "../src/core/logger.js";
import { perfMessage } from "../src/core/logFormat.js";

/**
 * Step 5：桌面 Controller 化入口。
 */
let v3Gate: Promise<unknown> = Promise.resolve();
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
 * 单条小记推送入口（「保存并同步」）：与整轮同步共用 v3 串行门（同一设备 sidecar/指针不得并发写）。
 * 内部只 upsert 一条；遇到「必须整轮」的情形（云端无 pointer/无基线/不同代，或远端墓碑未恢复）
 * 会执行一次整轮并回传 full-sync（不静默降级）。
 */
export async function pushQuickNoteViaEngine(store: Store, id: string): Promise<QuickNotePushOutcome> {
  return serializedV3(async () => {
    const { pushQuickNoteWithV3 } = await import("./s3v3/desktopSync.js");
    return pushQuickNoteWithV3(store, id);
  });
}

/**
 * 回收站预览 / 恢复的后台补拉：只补云端声明、本地缺失/损坏的资产（**v3 原生路径**）。
 *
 * 旧实现读本地 `declared_assets` 表，而 v3 从不写该表（声明是独立的内容寻址对象）⇒ 空操作。
 * 现在：pointer → lake 索引 → 该篇 assetsHash → 声明对象 → 本地差集（同名+同 size+同 sha256 跳过）
 * → 按需 GET + size/sha256 校验后落盘。best-effort：无配置/关云同步/网络失败一律只回 warnings。
 */
export async function ensureTrashNoteAssets(
  store: Store,
  id: string,
  deps: { remote?: S3v3Remote; force?: boolean } = {},
): Promise<{ warnings: string[]; skipped?: CloudState }> {
  const warnings: string[] = [];
  const settings = store.getS3Settings();
  if (!deps.remote) {
    if (!settings) return { warnings, skipped: "unconfigured" };
    // 单一判据：没配置 或 关了云同步 ⇒ 一律不出网（用户 261006：关闭云同步 = 纯离线本地空间）。
    const state = cloudStateOf(true, store.getSyncSettings());
    if (!canTouchNetwork(state)) return { warnings, skipped: state };
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
  store.setBaseHash(noteId, entry.contentHash);
  store.markSynced(noteId);
  store.logScopes.sync.info(perfMessage("missing-body.restoreFromCloud", Date.now() - startedAt, { noteId, bytes: bytes.length }));
  return { ok: true, title: entry.title };
}
