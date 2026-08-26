/**
 * 桌面 Quick Notes 同步适配器（V5 Step 6：编排下沉到 src/core/quickNotesSyncEngine.ts）。
 *
 * - 对外 API 与行为保持不变（syncQuickNotes / parseManifest / runQuickNotesDeepCleanup，
 *   electron/quickNotesSync.test.ts 全量兜底）；
 * - 平台实现注入：ObjectStore → S3Store（createS3StoreAdapter）+ QuickNotesStore + node fs
 *   → QuickNotesSyncDbPort；连接检查（remote.test）保留桌面侧（七牛 HeadBucket 404 兼容）；
 * - 深度清理（GC）需要 ObjectStore.list/deleteMany（S3Store 端口不含），保留桌面侧实现。
 */
import fs from "node:fs";
import path from "node:path";
import { ObjectStore, type S3Settings, validateS3Settings } from "./sync.js";
import { createS3StoreAdapter } from "./syncAdapters.js";
import {
  MAX_QUICK_MANIFEST_BYTES,
  parseManifest,
  syncQuickNotesViaEngine,
  type QuickNoteSyncItem,
  type QuickNotesSyncDbPort,
  type QuickNotesSyncProgress,
  type QuickNotesSyncResult,
} from "../src/core/quickNotesSyncEngine.js";
import { QuickNotesStore } from "./quickNotes.js";
import { validateQuickNoteContent } from "../src/core/quickNoteModel.js";
import type { StoredQuickNoteContent } from "../src/core/quickNoteModel.js";

export type { QuickNotesSyncResult, QuickNotesSyncProgress } from "../src/core/quickNotesSyncEngine.js";
export { parseManifest } from "../src/core/quickNotesSyncEngine.js";

const ROOT = "quick-notes";

/** 把桌面 QuickNotesStore（node sqlite + .qnote 文件）适配成共享引擎端口。 */
function createQuickNotesSyncPort(quickNotes: QuickNotesStore): QuickNotesSyncDbPort {
  return {
    listLocalQuickNotes(): QuickNoteSyncItem[] {
      return quickNotes.listQuickNotesForSync().map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        contentHash: item.contentHash,
        syncState: item.syncState,
        isConflict: item.isConflict,
        images: item.content.images.map(({ id, filename, mimeType, width, height, size, hash }) => ({ id, filename, mimeType, width, height, size, hash })),
      }));
    },
    readContent(id: string): Uint8Array | null {
      try { return new Uint8Array(fs.readFileSync(quickNotes.quickNotePathFor(id))); } catch { return null; }
    },
    readAsset(id: string, filename: string): Uint8Array | null {
      try { return new Uint8Array(fs.readFileSync(path.join(quickNotes.quickNoteAssetsPathFor(id), filename))); } catch { return null; }
    },
    applyRemoteQuickNote(item, content, assets) {
      quickNotes.importRemoteQuickNote(
        { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, contentHash: item.contentHash, isConflict: item.isConflict },
        Buffer.from(content),
        assets.map((a) => ({ filename: a.filename, bytes: Buffer.from(a.bytes) })),
      );
    },
    applyTombstoneContent(id, content) {
      // V5 §5.5：墓碑内容原子写（写临时 + rename，防崩溃半写文件）
      const target = quickNotes.quickNotePathFor(id);
      const temporary = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, Buffer.from(content));
      fs.renameSync(temporary, target);
    },
    listDeletedQuickNoteAssets(id) {
      // 墓碑携带图片（A）：读软删保留的 .qnote 解析删除前图片元数据；文件缺失/解析失败 → []
      try {
        const content = validateQuickNoteContent(JSON.parse(fs.readFileSync(quickNotes.quickNotePathFor(id), "utf8")) as StoredQuickNoteContent);
        return content.images.map(({ id: imageId, filename, mimeType, width, height, size, hash }) => ({ id: imageId, filename, mimeType, width, height, size, hash }));
      } catch { return []; }
    },
    applyTombstoneAssets(id, assets) {
      // 墓碑携带图片（A）：删除前图片字节落盘（软删保留，恢复时图片完整）
      const dir = quickNotes.quickNoteAssetsPathFor(id);
      fs.mkdirSync(dir, { recursive: true });
      for (const a of assets) fs.writeFileSync(path.join(dir, a.metadata.filename), Buffer.from(a.bytes));
    },
    deleteLocalQuickNote(id) { quickNotes.deleteQuickNote(id); },
    archiveLocalQuickNoteToTrash(id) { quickNotes.archiveLocalToTrash(id); },
    listDeletedQuickNotes() { return quickNotes.listDeletedForSync().map((d) => ({ id: d.id, createdAt: d.createdAt, updatedAt: d.updatedAt, deletedAt: d.deletedAt })); },
    listDeferredDeletedQuickNotes() { return quickNotes.listDeferredDeletedForSync().map((d) => ({ id: d.id })); },
    rememberDeletedQuickNote(item) { quickNotes.rememberDeleted(item); },
    revokeLocalDeletion(id) { quickNotes.revokeLocalDeletion(id); },
    isRestorePending(id) { return quickNotes.isRestorePending(id); },
    baseHash(id) { return quickNotes.baseHash(id); },
    setBaseHash(id, contentHash) { quickNotes.setBaseHash(id, contentHash); },
    markSynced(id) { quickNotes.markSynced(id); },
    log(message) { quickNotes.logScopes.quick.info(message); },
  };
}

/**
 * 单独的小记同步入口（保持原签名）：连接检查（桌面侧）→ 共享引擎编排。
 * 它不读取或修改 Lake Manifest v2；相同 S3 配置下仅共享 bucket/prefix，
 * 所有对象均位于 quick-notes/ 子空间。
 */
export async function syncQuickNotes(
  quickNotes: QuickNotesStore,
  settings: S3Settings,
  onProgress?: (progress: QuickNotesSyncProgress) => void,
): Promise<QuickNotesSyncResult> {
  const quickStart = Date.now();
  quickNotes.logScopes.quick.info("[perf] quick-sync start");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, quickNotes.logScopes);
  const report = (progress: QuickNotesSyncProgress) => { try { onProgress?.(progress); } catch { /* renderer closed */ } };
  report({ phase: "quick-notes", message: "正在同步小记…" });
  const connectStart = Date.now();
  await remote.test();
  quickNotes.logScopes.quick.info(`[perf] quick connect ${Date.now() - connectStart}ms`);

  const cfg = {
    endpoint: settings.endpoint, region: settings.region, bucket: settings.bucket,
    accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey,
    prefix: settings.prefix ?? "lake-notes",
  };
  const s3Store = createS3StoreAdapter(remote, cfg.prefix);
  const qnPort = createQuickNotesSyncPort(quickNotes);
  const result = await syncQuickNotesViaEngine(cfg, s3Store, qnPort, { onProgress: report });
  quickNotes.logScopes.quick.info(`[perf] quick-sync done ${Date.now() - quickStart}ms (uploaded=${result.uploaded}, downloaded=${result.downloaded}, conflicts=${result.conflicts})`);
  return result;
}

// ===== 小记 GC：深度清理（与 Lake runDeepCleanup 同规则，作用于 quick-notes/ 子空间） =====
export interface QuickNotesCleanupResult {
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  keys: string[];
}

export async function runQuickNotesDeepCleanup(quickNotes: QuickNotesStore, settings: S3Settings, opts?: { dryRun?: boolean; gcRetentionDays?: number }): Promise<QuickNotesCleanupResult> {
  const deepStart = Date.now();
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, quickNotes.logScopes);
  const dryRun = opts?.dryRun ?? false;
  const gcRetentionDays = opts?.gcRetentionDays ?? 7;

  const manifestKey = `${ROOT}/manifests/latest.json`;
  const objectKey = (contentHash: string) => `${ROOT}/objects/${contentHash}.qnote`;
  const assetKey = (id: string, filename: string) => `${ROOT}/assets/${id}/${filename}`;

  const raw = await remote.getOptional(manifestKey, { maxBytes: MAX_QUICK_MANIFEST_BYTES });
  if (!raw) { quickNotes.logScopes.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (no manifest)`); return { dryRun, candidateCount: 0, deletedCount: 0, keys: [] }; }
  const manifest = parseManifest(raw);
  const keep = new Set<string>([manifestKey]);

  for (const item of manifest.items) {
    // deleted 墓碑也保留内容引用：真实 hash 时保护删除前对象（恢复可达）；占位符对象不在云端，加入无害。
    keep.add(objectKey(item.contentHash));
    // 墓碑携带图片（A）：墓碑条目 assets 引用的删除前图片对象同样保护（恢复时图片完整），不再跳过 deleted
    for (const asset of item.assets) keep.add(assetKey(item.id, asset.filename));
  }

  // 与 Lake runDeepCleanup 共用同一 gcRetentionDays（逻辑一致），由 main.ts 统一传入。
  const cutoff = Date.now() - gcRetentionDays * 24 * 3600 * 1000;
  const objects = await remote.list(`${ROOT}/objects/`);
  const assets = await remote.list(`${ROOT}/assets/`);
  const candidates = [...objects, ...assets]
    .filter((item) => !keep.has(item.key))
    .filter((item) => Date.parse(item.lastModified) < cutoff)
    .map((item) => item.key);

  if (dryRun || candidates.length === 0) {
    quickNotes.logScopes.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=0)`);
    return { dryRun, candidateCount: candidates.length, deletedCount: 0, keys: candidates };
  }
  await remote.deleteMany(candidates);
  quickNotes.logScopes.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=${candidates.length})`);
  return { dryRun, candidateCount: candidates.length, deletedCount: candidates.length, keys: candidates };
}
