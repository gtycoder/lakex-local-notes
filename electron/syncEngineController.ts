/**
 * 桌面同步 Controller（Step 5）：核心编排用共享 syncEngine，桌面保留特有收尾
 *（GC 差集标记 / purge 前缀删 / 进度 / 记账 / warnings 结构化 / superseded UI）。
 *
 * 语义等价性由 electron/syncEquivalence.test.ts（7 场景）与 electron/syncAdapterEquiv.test.ts（4 场景）保证。
 */
import type { Store } from "./store.js";
import { ObjectStore, pruneOldManifests } from "./sync.js";
import type { S3Settings, SyncProgress, SyncResult, SyncWarning } from "./sync.js";
import { parseLakeManifest, objectKey, MAX_MANIFEST_BYTES, validateS3Settings } from "../src/core/syncUtils.js";
import { syncNow as engineSyncNow } from "../src/core/syncEngine.js";
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

  const engineReport = await engineSyncNow(cfg, s3Store, dbPort, {
    strictAssets: true,
    onProgress: (phase, message) => {
      const mapped = phaseMap[phase] ?? "download";
      report({ phase: mapped, message });
    },
    onPublished: async (next, prev) => {
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
      // 验收#3：裁剪旧 manifest（latest + 本 commit + 沿链 8 层，共 10 份）
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
  const commitId = await readLatestCommitId(remote);
  const result: SyncResult = {
    uploaded: engineReport.uploaded, downloaded: engineReport.appliedRemote, conflicts: engineReport.supersededNotes.length,
    manifestId: commitId ?? "", completedAt, supersededNotes: engineReport.supersededNotes,
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