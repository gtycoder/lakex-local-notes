import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type S3Settings, ObjectStore, isSafeSegment, mimeTypeFor, sha256Hex, validateS3Settings } from "./sync.js";
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
  current?: number;
  total?: number;
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
  validateS3Settings(settings);
  const remote = new ObjectStore(settings);
  const report = (progress: QuickNotesSyncProgress) => { try { onProgress?.(progress); } catch { /* renderer closed */ } };
  report({ phase: "quick-notes", message: "正在同步小记…" });
  await remote.test();

  const rawManifest = await remote.getOptional(manifestKey);
  const remoteManifest: QuickNotesManifest | null = rawManifest ? parseManifest(rawManifest) : null;
  let downloaded = 0;
  let conflicts = 0;

  if (remoteManifest) {
    // Includes conversion tombstones not yet released by a successful Lake sync.  They must
    // suppress remote re-import even though their delete record cannot yet be uploaded.
    const tombstoned = new Set([
      ...quickNotes.listDeletedForSync(),
      ...quickNotes.listDeferredDeletedForSync(),
    ].map((item) => item.id));
    const localItems = quickNotes.listQuickNotesForSync();
    const localById = new Map(localItems.map((item) => [item.id, item]));
    const localIds = new Set(localItems.map((item) => item.id));

    for (let index = 0; index < remoteManifest.items.length; index += 1) {
      const item = remoteManifest.items[index];
      report({ phase: "quick-notes", current: index + 1, total: remoteManifest.items.length, message: item.deleted ? "处理云端小记删除记录" : "检查云端小记" });
      validateRemoteItem(item);

      if (item.deleted) {
        if (localIds.has(item.id)) quickNotes.deleteQuickNote(item.id);
        else quickNotes.rememberDeleted({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, deletedAt: item.deletedAt ?? new Date().toISOString() });
        continue;
      }
      if (tombstoned.has(item.id)) continue;

      const local = localById.get(item.id) ?? null;
      if (local?.contentHash === item.contentHash) {
        quickNotes.setBaseHash(item.id, item.contentHash);
        quickNotes.markSynced(item.id);
        continue;
      }

      const content = await remote.getOptional(objectKey(item.contentHash));
      if (!content) throw new Error(`小记清单引用的内容对象不存在: ${item.id}`);
      if (sha256Hex(content) !== item.contentHash) throw new Error(`小记内容哈希不符: ${item.id}`);
      const assets = await downloadAssets(remote, item);
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
      }
    }
  }

  const localItems = quickNotes.listQuickNotesForSync();
  const remoteHashes = new Map<string, string>((remoteManifest?.items ?? []).filter((item) => !item.deleted).map((item) => [item.id, item.contentHash]));
  const remoteAssetHashes = new Map<string, string>();
  for (const item of remoteManifest?.items ?? []) {
    if (item.deleted) continue;
    for (const asset of item.assets) remoteAssetHashes.set(`${item.id}/${asset.filename}`, asset.hash);
  }

  let uploaded = 0;
  const manifestItems: ManifestItem[] = [];
  for (let index = 0; index < localItems.length; index += 1) {
    const item = localItems[index];
    report({ phase: "quick-notes", current: index + 1, total: localItems.length, message: "上传本地小记" });
    const contentPath = quickNotes.quickNotePathFor(item.id);
    const content = fs.readFileSync(contentPath);
    const contentHash = sha256Hex(content);
    if (contentHash !== item.contentHash) throw new Error(`本地小记索引与内容不一致: ${item.id}`);

    const assets = item.content.images.map(({ id, filename, mimeType, width, height, size, hash }) => ({ id, filename, mimeType, width, height, size, hash }));
    const assetsDir = quickNotes.quickNoteAssetsPathFor(item.id);
    for (const asset of assets) {
      const assetPath = path.join(assetsDir, asset.filename);
      const bytes = fs.readFileSync(assetPath);
      if (bytes.length !== asset.size || sha256Hex(bytes) !== asset.hash) throw new Error(`本地小记图片校验失败: ${item.id}/${asset.filename}`);
      if (remoteAssetHashes.get(`${item.id}/${asset.filename}`) !== asset.hash) {
        await remote.put(assetKey(item.id, asset.filename), bytes, asset.mimeType || mimeTypeFor(asset.filename));
      }
    }
    if (remoteHashes.get(item.id) !== contentHash) {
      await remote.put(objectKey(contentHash), content, "application/json; charset=utf-8");
      uploaded += 1;
    }
    manifestItems.push({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, contentHash, isConflict: item.isConflict, assets });
  }

  const localIds = new Set(localItems.map((item) => item.id));
  const readyDeleted = quickNotes.listDeletedForSync();
  const readyDeletedIds = new Set(readyDeleted.map((item) => item.id));
  for (const deleted of readyDeleted) {
    if (localIds.has(deleted.id)) continue;
    manifestItems.push({
      id: deleted.id,
      createdAt: deleted.createdAt,
      updatedAt: deleted.updatedAt,
      // Deleted entries have no content object.  Retain a valid digest-shaped stable marker
      // because v1 manifest keeps contentHash required for every item.
      contentHash: sha256Hex(Buffer.from(`deleted:${deleted.id}`, "utf8")),
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
  await remote.put(manifestKey, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), "application/json; charset=utf-8");

  for (const item of localItems) {
    quickNotes.setBaseHash(item.id, item.contentHash);
    quickNotes.markSynced(item.id);
  }
  return { uploaded, downloaded, conflicts, manifestId: manifest.commitId, completedAt };
}

async function downloadAssets(remote: ObjectStore, item: ManifestItem): Promise<Array<{ filename: string; bytes: Buffer }>> {
  const assets: Array<{ filename: string; bytes: Buffer }> = [];
  for (const asset of item.assets) {
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
  if (!item || typeof item !== "object" || !isSafeSegment(item.id) || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" || typeof item.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(item.contentHash) || typeof item.isConflict !== "boolean" || !Array.isArray(item.assets)) {
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
