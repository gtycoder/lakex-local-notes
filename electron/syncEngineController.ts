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
import { pruneOldManifests } from "./s3Maintenance.js";
import type { SyncProgress, SyncResult, SyncWarning } from "./syncTypes.js";
import { parseLakeManifest, objectKey, sha256Hex, MAX_MANIFEST_BYTES, validateS3Settings, type S3Settings } from "../src/core/syncUtils.js";
import { syncNow as engineSyncNow, downloadNoteAssets, MAX_REMOTE_NOTE_BYTES, type SyncReport } from "../src/core/syncEngine.js";
import { canTouchNetwork, cloudStateOf, type CloudState } from "../src/core/cloudState.js";
import { createS3StoreAdapter, createStoreSyncPort, syncConfigFromStore } from "./syncAdapters.js";
import type { LoggerScopes } from "../src/core/logger.js";
import { perfMessage } from "../src/core/logFormat.js";

/**
 * Step 5：桌面 Controller 化入口。
 */
export async function syncNowViaEngine(
  store: Store,
  onProgress?: (p: SyncProgress) => void,
  createRemote: (settings: S3Settings, logScopes: LoggerScopes) => ObjectStore = (s, l) => new ObjectStore(s, l),
): Promise<SyncResult> {
  if (process.env.LAKE_SYNC_PROTOCOL === "v3") {
    const { syncWithV3 } = await import("./s3v3/desktopSync.js");
    return syncWithV3(store, onProgress);
  }
  const syncStart = Date.now();
  store.logScopes.sync.info("[perf] syncNowViaEngine start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = createRemote(settings, store.logScopes);
  const report = (p: SyncProgress) => { try { onProgress?.(p); } catch { /* 渲染层已关闭 */ } };
  report({ phase: "connect", message: "正在连接 S3..." });
  const connectStart = Date.now();
  await remote.test();
  store.logScopes.sync.info(`[perf] connect ${Date.now() - connectStart}ms`);

  // adapter 装配（Step 3）
  const cfg = syncConfigFromStore(store);
  const s3Store = createS3StoreAdapter(remote, cfg.prefix);
  const dbPort = createStoreSyncPort(store);

  // 进度阶段映射：syncEngine（pull/upload/publish）→ 桌面（connect/download/upload/manifest/done）
  const phaseMap: Record<string, SyncProgress["phase"]> = {
    pull: "download", upload: "upload", publish: "manifest",
  };

  // P3-3：本次同步若发布了新 manifest，engine 的 onPublished 回调会把新 commitId 填到这里，
  // 供结果组装直接复用；未发布（仅拉取对账/零变更）时再回退 readLatestCommitId。
  let publishedCommitId: string | null = null;

  const engineReport = await engineSyncNow(cfg, s3Store, dbPort, {
    strictAssets: true,
    onProgress: (phase, message) => {
      const mapped = phaseMap[phase] ?? "download";
      report({ phase: mapped, message });
    },
    onPublished: async (next, prev) => {
      // P3-3：本次已发布 → 直接记下新 commitId，避免结束后 readLatestCommitId 再全量 GET+解析一次。
      publishedCommitId = next.commitId;
      // 4.5 GC 差集标记（对齐原 sync.ts 语义）：新 manifest 不再引用的旧正文/资源 → 待回收
      try {
        const newById = new Map(next.notes.map((n) => [n.id, n]));
        for (const p of prev?.notes ?? []) {
          if (p.deleted) continue;
          const nx = newById.get(p.id);
          if (!nx || nx.deleted) continue;
          if (nx.contentHash !== p.contentHash) store.addS3GcPending(objectKey(p.id, p.contentHash));
          const nextAssets = new Set((nx.assets ?? []).map((a) => a.filename));
          for (const asset of p.assets ?? []) {
            if (nextAssets.has(asset.filename)) continue;
            if (!store.getProtectedRefs(p.id).has(asset.filename)) store.addS3GcPending(`assets/${p.id}/${asset.filename}`);
          }
        }
        const referencedNow = new Set<string>();
        for (const note of next.notes) {
          if (note.deleted) continue;
          referencedNow.add(objectKey(note.id, note.contentHash));
          for (const asset of note.assets ?? []) referencedNow.add(`assets/${note.id}/${asset.filename}`);
        }
        store.removeS3GcPending([...referencedNow]);
      } catch (e) { store.logScopes.sync.warn(`[gc-mark] 失败（不影响同步）: ${(e as Error).message}`); }
      // 滞后裁剪旧 manifest（稳态 latest + 本 commit + 链 3 层 = 5 份；未到水位只 list 一次，见 pruneOldManifests）
      try { await pruneOldManifests(remote, next.commitId, prev, store.logScopes); } catch (e) { store.logScopes.sync.warn(`[prune] 失败（不影响同步）: ${(e as Error).message}`); }
    },
  });

  // 4.6 purge 前缀立即删（M4）：先写 manifest（engine 已发布）→ 再删 objects/assets 前缀
  const purgedNotes = store.listPurgedNotesForSync();
  for (const note of purgedNotes) {
    const purgeStart = Date.now();
    const objs = await remote.deletePrefix(`objects/${note.id}-`);
    const assets = await remote.deletePrefix(`assets/${note.id}/`);
    store.markPurgeSynced(note.id);
    store.logScopes.sync.info(`[perf] purge ${note.id} ${Date.now() - purgeStart}ms (objects=${objs}, assets=${assets})`);
  }

  // warnings 已由 core 直接产出结构化对象（kind/noteId/title/filename/message）；这里只透传，不再正则反解字符串。
  const warnings: SyncWarning[] = engineReport.warnings;
  const completedAt = new Date().toISOString();
  const commitId = publishedCommitId ?? await readLatestCommitId(remote);
  const result: SyncResult = {
    uploaded: engineReport.uploaded, downloaded: engineReport.appliedRemote, conflicts: engineReport.supersededNotes.length,
    manifestId: commitId ?? "", completedAt, supersededNotes: engineReport.supersededNotes,
    foldersUploaded: engineReport.foldersUploaded, foldersDownloaded: engineReport.foldersDownloaded,
    uploadedBytes: engineReport.uploadedBytes, downloadedBytes: engineReport.downloadedBytes,
    durationMs: Date.now() - syncStart,
    trashed: engineReport.trashedDown + engineReport.trashedUp,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
  store.markSyncComplete(completedAt);
  store.recordSyncResult(JSON.stringify(result));
  report({ phase: "done", message: "同步完成", supersededNotes: engineReport.supersededNotes });
  // 261023：一轮同步的耗时 + 数据量（后续做同步性能优化的唯一口径）。
  store.logScopes.sync.info(perfMessage("sync.round", Date.now() - syncStart, {
    uploaded: engineReport.uploaded,
    downloaded: engineReport.appliedRemote,
    foldersUp: engineReport.foldersUploaded,
    foldersDown: engineReport.foldersDownloaded,
    bytesUp: engineReport.uploadedBytes,
    bytesDown: engineReport.downloadedBytes,
    trash: engineReport.trashedDown + engineReport.trashedUp,
    conflicts: engineReport.supersededNotes.length,
    warnings: warnings.length,
    manifest: commitId ? commitId.slice(0, 8) : "none",
  }));
  return result;
}

async function readLatestCommitId(remote: ObjectStore): Promise<string | null> {
  try {
    const bytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
    if (!bytes) return null;
    return parseLakeManifest(bytes).commitId;
  } catch { return null; }
}

/**
 * 下载某笔记的 declared 资产（惰性下载补偿）。best-effort：无 S3 配置/资源缺失/网络失败
 * 一律返回 warnings、不抛错（恢复/预览都不被下载阻塞）。
 * @param onlyMissing 只下载本地缺失的资源（预览用，已有文件不重复拉）
 */
async function downloadDeclaredAssets(
  store: Store,
  id: string,
  onlyMissing: boolean,
  createRemote: (settings: S3Settings, logScopes: LoggerScopes) => ObjectStore,
): Promise<{ warnings: string[]; skipped?: CloudState }> {
  const warnings: string[] = [];
  const settings = store.getS3Settings();
  // 单一判据：没配置 或 关了云同步 ⇒ 一律不出网（用户 261006：关闭云同步 = 当作纯离线本地空间）。
  const state = cloudStateOf(!!settings, store.getSyncSettings());
  if (!settings || !canTouchNetwork(state)) return { warnings, skipped: state };
  try {
    validateS3Settings(settings);
    const remote = createRemote(settings, store.logScopes);
    await remote.test();
    const cfg = syncConfigFromStore(store);
    const s3Store = createS3StoreAdapter(remote, cfg.prefix);
    const dbPort = createStoreSyncPort(store);
    let assets = store.listDeclaredAssets(id);
    if (onlyMissing) {
      const dir = store.noteAssetsPathFor(id);
      assets = assets.filter((a) => !fs.existsSync(path.join(dir, a.filename)));
    }
    if (assets.length === 0) return { warnings };
    const report: SyncReport = {
      pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "",
      warnings: [], supersededNotes: [], foldersUploaded: 0, foldersDownloaded: 0,
      trashedDown: 0, trashedUp: 0, uploadedBytes: 0, downloadedBytes: 0,
    };
    await downloadNoteAssets(cfg, s3Store, dbPort, id, assets, report, false);
    // 回收站恢复/预览的补拉对外仍是 string[]（TrashPanel 直接展示）；结构化只用于 SyncResult。
    warnings.push(...report.warnings.map((w) => w.message));
  } catch (e) {
    warnings.push(`资源下载失败（保留恢复/预览，资源下次同步补拉）: ${(e as Error).message}`);
  }
  return { warnings };
}

/** 回收站预览 / 恢复后台补拉：按需补拉该笔记本地缺失的资源（不恢复、不移出回收站）。best-effort。
 *  离线（未配置 / 关闭云同步）时直接返回 `skipped`，一个请求都不发。 */
export async function ensureTrashNoteAssets(
  store: Store,
  id: string,
  createRemote: (settings: S3Settings, logScopes: LoggerScopes) => ObjectStore = (s, l) => new ObjectStore(s, l),
): Promise<{ warnings: string[]; skipped?: CloudState }> {
  return downloadDeclaredAssets(store, id, true, createRemote);
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
): Promise<{ ok: true; title: string } | { ok: false; reason: "cloud-off" | "no-cloud-config" | "not-in-cloud" | "object-missing" | "hash-mismatch" }> {
  const settings = store.getS3Settings();
  if (!settings) return { ok: false, reason: "no-cloud-config" };
  if (!canTouchNetwork(cloudStateOf(true, store.getSyncSettings()))) return { ok: false, reason: "cloud-off" };
  validateS3Settings(settings);
  const startedAt = Date.now();
  const remote = new ObjectStore(settings, store.logScopes);
  await remote.test();
  const cfg = syncConfigFromStore(store);
  const manifestBytes = await remote.getOptional(`${cfg.prefix}/manifests/latest.json`, { maxBytes: MAX_MANIFEST_BYTES });
  const manifest = manifestBytes ? parseLakeManifest(manifestBytes) : null;
  const entry = manifest?.notes.find((n) => n.id === noteId && !n.deleted);
  if (!entry) return { ok: false, reason: "not-in-cloud" };
  const bytes = await remote.getOptional(`${cfg.prefix}/${objectKey(noteId, entry.contentHash)}`, { maxBytes: MAX_REMOTE_NOTE_BYTES });
  if (!bytes) return { ok: false, reason: "object-missing" };
  if (sha256Hex(bytes) !== entry.contentHash) return { ok: false, reason: "hash-mismatch" };
  store.writeRestoredBody(noteId, new TextDecoder().decode(bytes));
  store.setBaseHash(noteId, entry.contentHash);
  store.markSynced(noteId);
  store.logScopes.sync.info(perfMessage("missing-body.restoreFromCloud", Date.now() - startedAt, { noteId, bytes: bytes.length }));
  return { ok: true, title: entry.title };
}
