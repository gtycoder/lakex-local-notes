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
import { parseLakeManifest, objectKey, MAX_MANIFEST_BYTES, validateS3Settings, type S3Settings } from "../src/core/syncUtils.js";
import { syncNow as engineSyncNow, downloadNoteAssets, type SyncReport } from "../src/core/syncEngine.js";
import { canTouchNetwork, cloudStateOf, type CloudState } from "../src/core/cloudState.js";
import { createS3StoreAdapter, createStoreSyncPort, syncConfigFromStore } from "./syncAdapters.js";
import type { LoggerScopes } from "../src/core/logger.js";

/**
 * Step 5：桌面 Controller 化入口。
 */
export async function syncNowViaEngine(
  store: Store,
  onProgress?: (p: SyncProgress) => void,
  createRemote: (settings: S3Settings, logScopes: LoggerScopes) => ObjectStore = (s, l) => new ObjectStore(s, l),
): Promise<SyncResult> {
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

  // warnings 结构化 + 结果组装
  const warnings: SyncWarning[] = engineReport.warnings.map((w) => {
    // 正文缺失："对象缺失（跳过+warning，B 方案）: {noteId}-{64hex}" → 去 hash 后缀取完整 UUID
    // 资产缺失："资源缺失（跳过该条目）: {noteId}" / "资源缺失（跳过）: {noteId}/{filename}"
    const m = /^(.+?)（跳过[^）]*）:\s*(\S+)/.exec(w);
    const raw = m?.[2] ?? "";
    // 完整 UUID 提取：对象缺失时 raw 带 "-{64hex}" 后缀；资源缺失时带 "/{filename}"（split("/") 去除）。
    // 修复：此前 split("-")[0] 把 UUID 截成 8 字符，UI 无法定位文档。
    const noteId = raw.split("/")[0].replace(/-[0-9a-f]{64}$/, "") || undefined;
    const kind = w.includes("资源") ? "asset_missing" : "remote_incomplete";
    return { kind, noteId };
  });
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
  store.logScopes.sync.info(`[perf] syncNowViaEngine done ${Date.now() - syncStart}ms (uploaded=${engineReport.uploaded}, applied=${engineReport.appliedRemote})`);
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
    warnings.push(...report.warnings);
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
