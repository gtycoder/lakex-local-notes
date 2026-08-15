import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type S3Settings, ObjectStore, isSafeSegment, mimeTypeFor, sha256Hex, validateS3Settings } from "./sync.js";
import { log } from "./logger.js";
import { type QuickNoteImage, QuickNotesStore } from "./quickNotes.js";

const MANIFEST_VERSION = 1;
const ROOT = "quick-notes";

interface ManifestItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  isConflict: boolean;
  assets: Array<Pick<QuickNoteImage, "id" | "filename" | "mimeType" | "width" | "height" | "size" | "hash">>;
  deleted?: boolean;
  deletedAt?: string;
}

interface QuickNotesManifest {
  version: number;
  workspaceId: string;
  commitId: string;
  createdAt: string;
  items: ManifestItem[];
}

export interface QuickNotesSyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  manifestId: string;
  completedAt: string;
}

export interface QuickNotesSyncProgress {
  phase: "quick-notes";
  /** 主循环进度：小记条目 */
  current?: number;
  total?: number;
  /** 小记图片子进度 */
  assetCurrent?: number;
  assetTotal?: number;
  message: string;
}

const objectKey = (contentHash: string) => `${ROOT}/objects/${contentHash}.qnote`;
const assetKey = (id: string, filename: string) => `${ROOT}/assets/${id}/${filename}`;
const manifestKey = `${ROOT}/manifests/latest.json`;

/**
 * 单独的小记同步协议。它不读取或修改 Lake Manifest v2；相同 S3 配置下仅共享 bucket/prefix，
 * 所有对象均位于 quick-notes/ 子空间。
 */
export async function syncQuickNotes(
  quickNotes: QuickNotesStore,
  settings: S3Settings,
  onProgress?: (progress: QuickNotesSyncProgress) => void,
): Promise<QuickNotesSyncResult> {
  const quickStart = Date.now();
  log.quick.info("[perf] quick-sync start");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings);
  const report = (progress: QuickNotesSyncProgress) => { try { onProgress?.(progress); } catch { /* renderer closed */ } };
  report({ phase: "quick-notes", message: "正在同步小记…" });
  const connectStart = Date.now();
  await remote.test();
  log.quick.info(`[perf] quick connect ${Date.now() - connectStart}ms`);

  const rawManifest = await remote.getOptional(manifestKey);
  const remoteManifest: QuickNotesManifest | null = rawManifest ? parseManifest(rawManifest) : null;
  let downloaded = 0;
  let conflicts = 0;

  if (remoteManifest) {
    // Includes conversion tombstones not yet released by a successful Lake sync.  They must
    // suppress remote re-import even though their delete record cannot yet be uploaded.
    // 普通删除墓碑：id -> deletedAt（LWW：远端恢复较新时撤销本地墓碑并跟随恢复）；
    // 转换墓碑（Lake 放行前）恒不复活源小记。
    const tombstoned = new Map(quickNotes.listDeletedForSync().map((item) => [item.id, item.deletedAt] as const));
    const deferredDeletedIds = new Set(quickNotes.listDeferredDeletedForSync().map((item) => item.id));
    const localItems = quickNotes.listQuickNotesForSync();
    const localById = new Map(localItems.map((item) => [item.id, item]));
    const localIds = new Set(localItems.map((item) => item.id));

    for (let index = 0; index < remoteManifest.items.length; index += 1) {
      const item = remoteManifest.items[index];
      const itemStart = Date.now();
      report({ phase: "quick-notes", current: index + 1, total: remoteManifest.items.length, message: item.deleted ? "处理云端小记删除记录" : "检查云端小记" });
      validateRemoteItem(item);

      if (item.deleted) {
        if (localIds.has(item.id)) {
          // 墓碑权威（与 Lake 一致）：远端 deleted 是权威状态，本地编辑（无论新旧）都不抵抗；
          // 唯一例外是显式恢复标记（restoreQuickNote 写入）→ local wins，上传阶段写回 active 覆盖墓碑。
          if (quickNotes.isRestorePending(item.id)) {
            log.quick.info(`[perf] download ${item.id} tombstone-skip (restore pending) ${Date.now() - itemStart}ms`);
            continue;
          }
          // 墓碑权威：先尝试下载删除前内容（墓碑 contentHash，容错：占位符/缺失则跳过）覆盖本地
          // .qnote，再软删——回收站/恢复拿到的是删除方最新版。小记不备份本地版本（云端为主）。
          try {
            const content = await remote.getOptional(objectKey(item.contentHash));
            if (content) fs.writeFileSync(quickNotes.quickNotePathFor(item.id), content);
          } catch (error) {
            log.quick.warn(`[perf] download ${item.id} tombstone content missing, skip`);
          }
          quickNotes.deleteQuickNote(item.id);
        } else {
          quickNotes.rememberDeleted({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, deletedAt: item.deletedAt ?? new Date().toISOString() });
        }
        log.quick.info(`[perf] download ${item.id} deleted ${Date.now() - itemStart}ms`);
        continue;
      }
      if (deferredDeletedIds.has(item.id)) continue;
      // 本地删除墓碑 vs 远端恢复 LWW：远端 active 且 updatedAt 晚于本地墓碑删除时间 →
      // 恢复较新，撤销本地墓碑并跟随恢复；否则本地删除优先，跳过下载（上传阶段会标记 deleted）。
      const tombAt = tombstoned.get(item.id);
      if (tombAt !== undefined) {
        if (item.updatedAt > tombAt) {
          quickNotes.revokeLocalDeletion(item.id);
          log.quick.info(`[perf] download ${item.id} remote-restored → local tombstone revoked ${Date.now() - itemStart}ms`);
        } else {
          continue;
        }
      }

      const local = localById.get(item.id) ?? null;
      if (local?.contentHash === item.contentHash) {
        quickNotes.setBaseHash(item.id, item.contentHash);
        quickNotes.markSynced(item.id);
        log.quick.info(`[perf] download ${item.id} unchanged ${Date.now() - itemStart}ms`);
        continue;
      }

      const content = await remote.getOptional(objectKey(item.contentHash));
      if (!content) throw new Error(`小记清单引用的内容对象不存在: ${item.id}`);
      if (sha256Hex(content) !== item.contentHash) throw new Error(`小记内容哈希不符: ${item.id}`);
      const assets = await downloadAssets(remote, item, (assetCurrent, assetTotal) => {
        report({ phase: "quick-notes", current: index + 1, total: remoteManifest.items.length, assetCurrent, assetTotal, message: "检查云端小记" });
      });
      const base = quickNotes.baseHash(item.id);
      const localChanged = local !== null && local.contentHash !== base;
      const remoteChanged = item.contentHash !== base;
      if (localChanged && remoteChanged) {
        const conflictId = quickNotes.importRemoteConflictCopy(item, content, assets);
        quickNotes.setBaseHash(conflictId, item.contentHash);
        conflicts += 1;
      } else if (localChanged) {
        // 只在本地变更：上传阶段将其作为权威版本，不以下载覆盖。
        continue;
      } else {
        quickNotes.importRemoteQuickNote(item, content, assets);
        quickNotes.setBaseHash(item.id, item.contentHash);
        downloaded += 1;
        log.quick.info(`[perf] download ${item.id} new-content ${Date.now() - itemStart}ms (content=${content.length}B, assets=${assets.length})`);
      }
    }
  }
  log.quick.info(`[perf] quick download phase ${Date.now() - quickStart}ms (downloaded=${downloaded}, conflicts=${conflicts})`);

  const localItems = quickNotes.listQuickNotesForSync();
  const remoteItemsById = new Map((remoteManifest?.items ?? []).map((item) => [item.id, item]));
  const remoteHashes = new Map<string, string>((remoteManifest?.items ?? []).filter((item) => !item.deleted).map((item) => [item.id, item.contentHash]));
  const remoteAssetHashes = new Map<string, string>();
  for (const item of remoteManifest?.items ?? []) {
    if (item.deleted) continue;
    for (const asset of item.assets) remoteAssetHashes.set(`${item.id}/${asset.filename}`, asset.hash);
  }

  const uploadStart = Date.now();
  let uploaded = 0;
  const manifestItems: ManifestItem[] = [];
  for (let index = 0; index < localItems.length; index += 1) {
    const item = localItems[index];
    const itemUploadStart = Date.now();
    report({ phase: "quick-notes", current: index + 1, total: localItems.length, message: "上传本地小记" });
    // 增量扫描优化（与 Lake 一致）：synced 且远端条目 hash 与本地索引一致 → 跳过 .qnote/图片读取，
    // 复用远端 assets（正文未变 ⇒ 图片引用未变）。非 synced 路径保留"索引与内容不一致则抛错"完整性校验。
    const remoteEntry = remoteItemsById.get(item.id);
    if (item.syncState === "synced" && remoteEntry && !remoteEntry.deleted && remoteEntry.contentHash === item.contentHash) {
      manifestItems.push({
        id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt,
        contentHash: item.contentHash, isConflict: item.isConflict, assets: remoteEntry.assets ?? [],
      });
      continue;
    }
    const contentPath = quickNotes.quickNotePathFor(item.id);
    const content = fs.readFileSync(contentPath);
    const contentHash = sha256Hex(content);
    if (contentHash !== item.contentHash) throw new Error(`本地小记索引与内容不一致: ${item.id}`);

    const assets = item.content.images.map(({ id, filename, mimeType, width, height, size, hash }) => ({ id, filename, mimeType, width, height, size, hash }));
    const assetsDir = quickNotes.quickNoteAssetsPathFor(item.id);
    const pendingAssets: Array<{ filename: string; bytes: Buffer; mimeType: string }> = [];
    for (const asset of assets) {
      const assetPath = path.join(assetsDir, asset.filename);
      const bytes = fs.readFileSync(assetPath);
      if (bytes.length !== asset.size || sha256Hex(bytes) !== asset.hash) throw new Error(`本地小记图片校验失败: ${item.id}/${asset.filename}`);
      if (remoteAssetHashes.get(`${item.id}/${asset.filename}`) !== asset.hash) {
        pendingAssets.push({ filename: asset.filename, bytes, mimeType: asset.mimeType || mimeTypeFor(asset.filename) });
      }
    }
    for (let ai = 0; ai < pendingAssets.length; ai += 1) {
      report({ phase: "quick-notes", current: index + 1, total: localItems.length, assetCurrent: ai + 1, assetTotal: pendingAssets.length, message: "上传本地小记" });
      const pending = pendingAssets[ai];
      await remote.put(assetKey(item.id, pending.filename), pending.bytes, pending.mimeType);
    }
    let contentUploaded = false;
    if (remoteHashes.get(item.id) !== contentHash) {
      await remote.put(objectKey(contentHash), content, "application/json; charset=utf-8");
      uploaded += 1;
      contentUploaded = true;
    }
    manifestItems.push({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, contentHash, isConflict: item.isConflict, assets });
    log.quick.info(`[perf] upload ${item.id} ${Date.now() - itemUploadStart}ms (content=${contentUploaded ? `${content.length}B` : "skip"}, assets=${pendingAssets.length})`);
  }
  log.quick.info(`[perf] quick upload phase ${Date.now() - uploadStart}ms (uploaded=${uploaded})`);

  const localIds = new Set(localItems.map((item) => item.id));
  const readyDeleted = quickNotes.listDeletedForSync();
  const readyDeletedIds = new Set(readyDeleted.map((item) => item.id));
  const remoteById = new Map((remoteManifest?.items ?? []).map((item) => [item.id, item]));
  for (const deleted of readyDeleted) {
    if (localIds.has(deleted.id)) continue;
    // 墓碑 vs 远端恢复 LWW：远端 active 且 updatedAt 晚于墓碑删除时间 → 恢复较新，墓碑让位（不回写覆盖）。
    const remoteItem = remoteById.get(deleted.id);
    if (remoteItem && !remoteItem.deleted && remoteItem.updatedAt > deleted.deletedAt) continue;
    // 墓碑携带删除前内容（与 Lake 一致）：读保留的 .qnote 算真实 hash 并上传，
    // 使其他设备先拉到"删除前最新版"再应用墓碑。读失败降级为占位符 id。
    let tombHash = deleted.id;
    try {
      const content = fs.readFileSync(quickNotes.quickNotePathFor(deleted.id));
      tombHash = sha256Hex(content);
      await remote.put(objectKey(tombHash), content, "application/json; charset=utf-8");
    } catch (error) {
      log.quick.warn(`[perf] upload ${deleted.id} tombstone content unreadable, placeholder fallback`);
    }
    manifestItems.push({
      id: deleted.id,
      createdAt: deleted.createdAt,
      updatedAt: deleted.updatedAt,
      contentHash: tombHash,
      isConflict: false,
      assets: [],
      deleted: true,
      deletedAt: deleted.deletedAt,
    });
  }

  // A converted source note remains represented by its existing remote record until the target
  // Lake document has succeeded.  Omitting it here would accidentally publish a manifest that
  // deletes the remote source before the conversion's cross-space safety condition is met.
  const deferredDeletedIds = new Set(quickNotes.listDeferredDeletedForSync().map((item) => item.id));
  for (const item of remoteManifest?.items ?? []) {
    if (!item.deleted && deferredDeletedIds.has(item.id) && !localIds.has(item.id) && !readyDeletedIds.has(item.id)) {
      manifestItems.push(item);
    }
  }

  const completedAt = new Date().toISOString();
  const manifest: QuickNotesManifest = {
    version: MANIFEST_VERSION,
    workspaceId: "default",
    commitId: crypto.randomUUID(),
    createdAt: completedAt,
    items: manifestItems,
  };
  report({ phase: "quick-notes", message: "写入小记同步清单…" });
  const manifestStart = Date.now();
  await remote.put(manifestKey, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), "application/json; charset=utf-8", { gzip: true });
  log.quick.info(`[perf] quick manifest ${manifest.commitId} ${Date.now() - manifestStart}ms (items=${manifestItems.length})`);

  for (const item of localItems) {
    quickNotes.setBaseHash(item.id, item.contentHash);
    quickNotes.markSynced(item.id);
  }
  log.quick.info(`[perf] quick-sync done ${Date.now() - quickStart}ms (uploaded=${uploaded}, downloaded=${downloaded}, conflicts=${conflicts})`);
  return { uploaded, downloaded, conflicts, manifestId: manifest.commitId, completedAt };
}

async function downloadAssets(remote: ObjectStore, item: ManifestItem, onProgress?: (assetCurrent: number, assetTotal: number) => void): Promise<Array<{ filename: string; bytes: Buffer }>> {
  const assets: Array<{ filename: string; bytes: Buffer }> = [];
  for (let i = 0; i < item.assets.length; i += 1) {
    const asset = item.assets[i];
    onProgress?.(i + 1, item.assets.length);
    const bytes = await remote.getOptional(assetKey(item.id, asset.filename));
    if (!bytes) throw new Error(`小记清单引用的图片不存在: ${item.id}/${asset.filename}`);
    if (bytes.length !== asset.size || sha256Hex(bytes) !== asset.hash) throw new Error(`小记图片校验失败: ${item.id}/${asset.filename}`);
    assets.push({ filename: asset.filename, bytes });
  }
  return assets;
}

function parseManifest(bytes: Buffer): QuickNotesManifest {
  let manifest: unknown;
  try { manifest = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("小记同步清单不是合法 JSON"); }
  if (!manifest || typeof manifest !== "object") throw new Error("小记同步清单格式无效");
  const value = manifest as Partial<QuickNotesManifest>;
  if (value.version !== MANIFEST_VERSION || typeof value.workspaceId !== "string" || typeof value.commitId !== "string" || typeof value.createdAt !== "string" || !Array.isArray(value.items)) {
    throw new Error("小记同步清单版本或字段不兼容");
  }
  for (const item of value.items) validateRemoteItem(item as ManifestItem);
  return value as QuickNotesManifest;
}

function validateRemoteItem(item: ManifestItem): void {
  if (!item || typeof item !== "object" || !isSafeSegment(item.id) || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || typeof item.contentHash !== "string" || (item.deleted !== true && !/^[a-f0-9]{64}$/.test(item.contentHash)) || typeof item.isConflict !== "boolean" || !Array.isArray(item.assets)) {
    throw new Error("小记同步清单条目无效");
  }
  if (item.deleted !== undefined && typeof item.deleted !== "boolean") throw new Error("小记删除标记无效");
  if (item.deletedAt !== undefined && typeof item.deletedAt !== "string") throw new Error("小记删除时间无效");
  for (const asset of item.assets) {
    if (!asset || typeof asset !== "object" || !isSafeSegment(asset.id) || !isSafeSegment(asset.filename) || typeof asset.mimeType !== "string" || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0 || typeof asset.hash !== "string" || !/^[a-f0-9]{64}$/.test(asset.hash)) {
      throw new Error(`小记同步清单图片无效: ${item.id}`);
    }
    if (asset.width !== null && (!Number.isInteger(asset.width) || asset.width <= 0)) throw new Error(`小记图片宽度无效: ${item.id}/${asset.filename}`);
    if (asset.height !== null && (!Number.isInteger(asset.height) || asset.height <= 0)) throw new Error(`小记图片高度无效: ${item.id}/${asset.filename}`);
  }
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
  const remote = new ObjectStore(settings);
  const dryRun = opts?.dryRun ?? false;
  const gcRetentionDays = opts?.gcRetentionDays ?? 7;

  const raw = await remote.getOptional(manifestKey);
  if (!raw) { log.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (no manifest)`); return { dryRun, candidateCount: 0, deletedCount: 0, keys: [] }; }
  const manifest = parseManifest(raw);
  const keep = new Set<string>([manifestKey]);

  for (const item of manifest.items) {
    // deleted 墓碑也保留内容引用：真实 hash 时保护删除前对象（恢复可达）；占位符对象不在云端，加入无害。
    keep.add(objectKey(item.contentHash));
    if (item.deleted) continue;
    for (const asset of item.assets) keep.add(assetKey(item.id, asset.filename));
  }

  // 与 Lake runDeepCleanup 共用同一 gcRetentionDays（逻辑一致），由 main.ts 统一传入。
  const cutoff = Date.now() - gcRetentionDays * 24 * 3600 * 1000;
  const objects = await remote.list("quick-notes/objects/");
  const assets = await remote.list("quick-notes/assets/");
  const candidates = [...objects, ...assets]
    .filter((item) => !keep.has(item.key))
    .filter((item) => Date.parse(item.lastModified) < cutoff)
    .map((item) => item.key);

  if (dryRun || candidates.length === 0) {
    log.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=0)`);
    return { dryRun, candidateCount: candidates.length, deletedCount: 0, keys: candidates };
  }
  await remote.deleteMany(candidates);
  log.quick.info(`[perf] quick-deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=${candidates.length})`);
  return { dryRun, candidateCount: candidates.length, deletedCount: candidates.length, keys: candidates };
}
