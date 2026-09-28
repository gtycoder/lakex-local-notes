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
import { ObjectStore } from "./s3Store.js";
import { validateS3Settings, type S3Settings } from "../src/core/syncUtils.js";
import { gcCutoffMs, isPastWindow } from "../src/core/gcPolicy.js";
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

/** 小记独立子空间前缀（同一 bucket 下 `lake-notes/quick-notes/`）。 */
export const QUICK_NOTES_ROOT = "quick-notes";
const ROOT = QUICK_NOTES_ROOT;

/** 把桌面 QuickNotesStore（node sqlite + .qnote 文件）适配成共享引擎端口。 */
export function createQuickNotesSyncPort(quickNotes: QuickNotesStore): QuickNotesSyncDbPort {
  return {
    async listLocalQuickNotes(): Promise<QuickNoteSyncItem[]> {
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
    async readContent(id: string): Promise<Uint8Array | null> {
      try { return new Uint8Array(fs.readFileSync(quickNotes.quickNotePathFor(id))); } catch { return null; }
    },
    async readAsset(id: string, filename: string): Promise<Uint8Array | null> {
      try { return new Uint8Array(fs.readFileSync(path.join(quickNotes.quickNoteAssetsPathFor(id), filename))); } catch { return null; }
    },
    async applyRemoteQuickNote(item, content, assets) {
      quickNotes.importRemoteQuickNote(
        { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, contentHash: item.contentHash, isConflict: item.isConflict },
        Buffer.from(content),
        assets.map((a) => ({ filename: a.filename, bytes: Buffer.from(a.bytes) })),
      );
    },
    async applyTombstoneContent(id, content) {
      // V5 §5.5：墓碑内容原子写（写临时 + rename，防崩溃半写文件）
      const target = quickNotes.quickNotePathFor(id);
      const temporary = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(temporary, Buffer.from(content));
      fs.renameSync(temporary, target);
    },
    async listDeletedQuickNoteAssets(id) {
      // 墓碑携带图片（A）：读软删保留的 .qnote 解析删除前图片元数据；文件缺失/解析失败 → []
      try {
        const content = validateQuickNoteContent(JSON.parse(fs.readFileSync(quickNotes.quickNotePathFor(id), "utf8")) as StoredQuickNoteContent);
        return content.images.map(({ id: imageId, filename, mimeType, width, height, size, hash }) => ({ id: imageId, filename, mimeType, width, height, size, hash }));
      } catch { return []; }
    },
    async applyTombstoneAssets(id, assets) {
      // 墓碑携带图片（A）：删除前图片字节落盘（软删保留，恢复时图片完整）
      const dir = quickNotes.quickNoteAssetsPathFor(id);
      fs.mkdirSync(dir, { recursive: true });
      for (const a of assets) fs.writeFileSync(path.join(dir, a.metadata.filename), Buffer.from(a.bytes));
    },
    async deleteLocalQuickNote(id) { quickNotes.deleteQuickNote(id); },
    async archiveLocalQuickNoteToTrash(id) { quickNotes.archiveLocalToTrash(id); },
    async listDeletedQuickNotes() { return quickNotes.listDeletedForSync().map((d) => ({ id: d.id, createdAt: d.createdAt, updatedAt: d.updatedAt, deletedAt: d.deletedAt })); },
    async markDeletedPublished(ids) { quickNotes.markDeletedPublished(ids); },
    async listAllDeletedQuickNotes() { return quickNotes.listAllDeleted().map((d) => ({ id: d.id, createdAt: d.createdAt, updatedAt: d.updatedAt, deletedAt: d.deletedAt })); },
    async listDeferredDeletedQuickNotes() { return quickNotes.listDeferredDeletedForSync().map((d) => ({ id: d.id })); },
    async rememberDeletedQuickNote(item) { quickNotes.rememberDeleted(item); },
    async revokeLocalDeletion(id) { quickNotes.revokeLocalDeletion(id); },
    async isRestorePending(id) { return quickNotes.isRestorePending(id); },
    async baseHash(id) { return quickNotes.baseHash(id); },
    async setBaseHash(id, contentHash) { quickNotes.setBaseHash(id, contentHash); },
    async markSynced(id) { quickNotes.markSynced(id); },
    async log(message) { quickNotes.logScopes.quick.info(message); },
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
  candidateBytes: number;
  deletedCount: number;
  deletedBytes: number;
  keys: string[];
}

export interface QuickNotesKeepSet {
  /** 小记清单当前引用的全部键（含清单文件本身）。 */
  keep: Set<string>;
  /** 云端是否已有小记清单（无清单 ⇒ 不能判定引用，深度清理直接不动）。 */
  manifestFound: boolean;
  items: number;
  commitId: string | null;
}

/**
 * 小记侧权威引用集：`quick-notes/manifests/latest.json` + 其 items 引用的正文/图片对象。
 * 深度清理与 GC 诊断共用（小记无 commit 链、无本地历史引用保护，语义与 Lake 不同但同源计算）。
 * 墓碑条目也保留引用：删除前内容/图片仍需可恢复（见下方注释）。
 */
export async function buildQuickNotesKeepSet(remote: ObjectStore): Promise<QuickNotesKeepSet> {
  const manifestKey = `${ROOT}/manifests/latest.json`;
  const keep = new Set<string>([manifestKey]);
  const raw = await remote.getOptional(manifestKey, { maxBytes: MAX_QUICK_MANIFEST_BYTES });
  if (!raw) return { keep, manifestFound: false, items: 0, commitId: null };
  const manifest = parseManifest(raw);
  for (const item of manifest.items) {
    // deleted 墓碑也保留内容引用：真实 hash 时保护删除前对象（恢复可达）；占位符对象不在云端，加入无害。
    keep.add(`${ROOT}/objects/${item.contentHash}.qnote`);
    // 墓碑携带图片（A）：墓碑条目 assets 引用的删除前图片对象同样保护（恢复时图片完整），不再跳过 deleted
    for (const asset of item.assets) keep.add(`${ROOT}/assets/${item.id}/${asset.filename}`);
  }
  return { keep, manifestFound: true, items: manifest.items.length, commitId: manifest.commitId };
}

export async function runQuickNotesDeepCleanup(quickNotes: QuickNotesStore, settings: S3Settings, opts?: { dryRun?: boolean; gcRetentionDays?: number }): Promise<QuickNotesCleanupResult> {
  const deepStart = Date.now();
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, quickNotes.logScopes);
  const dryRun = opts?.dryRun ?? false;
  const gcRetentionDays = opts?.gcRetentionDays ?? 7;

  const refs = await buildQuickNotesKeepSet(remote);
  if (!refs.manifestFound) {
    quickNotes.logScopes.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (no manifest)`);
    return { dryRun, candidateCount: 0, candidateBytes: 0, deletedCount: 0, deletedBytes: 0, keys: [] };
  }
  const keep = refs.keep;

  // 与 Lake runDeepCleanup 共用同一 gcRetentionDays 与窗口判定（诊断/对账/清理三者一致），由 main.ts 统一传入。
  const cutoff = gcCutoffMs(Date.now(), gcRetentionDays);
  const objects = await remote.list(`${ROOT}/objects/`);
  const assets = await remote.list(`${ROOT}/assets/`);
  const hits = [...objects, ...assets]
    .filter((item) => !keep.has(item.key))
    .filter((item) => isPastWindow(item.lastModified, cutoff));
  const candidates = hits.map((item) => item.key);
  const candidateBytes = hits.reduce((sum, item) => sum + (Number.isFinite(item.size) ? item.size : 0), 0);

  if (dryRun || candidates.length === 0) {
    quickNotes.logScopes.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, bytes=${candidateBytes}, deleted=0)`);
    return { dryRun, candidateCount: candidates.length, candidateBytes, deletedCount: 0, deletedBytes: 0, keys: candidates };
  }
  await remote.deleteMany(candidates);
  quickNotes.logScopes.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, bytes=${candidateBytes}, deleted=${candidates.length})`);
  return { dryRun, candidateCount: candidates.length, candidateBytes, deletedCount: candidates.length, deletedBytes: candidateBytes, keys: candidates };
}
