import {
  buildQuickNoteImageFiles,
  normalizeQuickNoteContent,
  quickNoteBodyFromTextAndImages,
  previewQuickNote,
  serializeQuickNoteContent,
  validateQuickNoteContent,
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
} from "../core/quickNoteModel.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { sha256Sync } from "../core/sha256Sync.js";
import type { MobileDb } from "./sqliteDb";

export interface QuickNoteImageFile {
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
}

export interface QuickNoteListItem {
  id: string;
  previewText: string;
  imageCount: number;
  updatedAt: string;
  firstImage: string | null;
}

export interface QuickNoteReadResult {
  id: string;
  content: StoredQuickNoteContent;
  previewText: string;
  updatedAt: string;
}

export interface QuickNoteTrashItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  previewText: string;
}

export async function listQuickNotes(d: MobileDb): Promise<QuickNoteListItem[]> {
  const rows = await d.prepare("SELECT id, preview_text, image_count, updated_at, content FROM quick_notes WHERE deleted_at IS NULL AND restore_pending_at IS NULL ORDER BY updated_at DESC").all() as Array<{ id: string; preview_text: string; image_count: number; updated_at: string; content: string }>;
  return rows.map((r) => {
    let firstImage: string | null = null;
    try { firstImage = (JSON.parse(r.content) as StoredQuickNoteContent).images?.[0]?.filename ?? null; } catch { /* 解析失败无缩略图 */ }
    return { id: r.id, previewText: r.preview_text, imageCount: r.image_count, updatedAt: r.updated_at, firstImage };
  });
}

export async function readQuickNote(d: MobileDb, id: string): Promise<QuickNoteReadResult | null> {
  const row = await d.prepare("SELECT id, content, preview_text, updated_at FROM quick_notes WHERE id=?").get(id) as { id: string; content: string; preview_text: string; updated_at: string } | undefined;
  if (!row) return null;
  let parsed: StoredQuickNoteContent;
  try { parsed = JSON.parse(row.content) as StoredQuickNoteContent; }
  catch { return null; }
  return { id: row.id, content: parsed, previewText: row.preview_text, updatedAt: row.updated_at };
}

export async function saveQuickNote(d: MobileDb, id: string, text: string, images: StoredQuickNoteImage[] = []): Promise<string> {
  const now = new Date().toISOString();
  const content = normalizeQuickNoteContent(text, quickNoteBodyFromTextAndImages(text, images, (filename) => `http://127.0.0.1:19876/quick-notes/${id}/${filename}`, () => crypto.randomUUID()), images);
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(text, images.length);
  await d.transaction(async () => {
    await d.prepare(
      `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, ready_to_sync)
       VALUES (?,?,?,?,?,?,?,'local',0,NULL,1)
       ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1`
    ).run(id, now, now, preview, images.length, contentHash, serialized);
    await d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
  });
  return id;
}

export async function saveQuickNoteWithImages(
  d: MobileDb,
  id: string,
  text: string,
  imageFiles: QuickNoteImageFile[],
  deps: {
    assets: Map<string, Uint8Array>;
    saveAssetFile: (key: string, bytes: Uint8Array) => Promise<void>;
  },
): Promise<string> {
  const validatedImageFiles = imageFiles.map((image) => {
    const format = validateQuickNoteImageBytes(image.bytes);
    if (image.width == null || image.height == null) throw new Error("图片尺寸缺失");
    validateQuickNoteImageDimensions({ width: image.width, height: image.height });
    return { ...image, mimeType: format.mimeType };
  });
  const { images, files: imageFilesWithKey } = buildQuickNoteImageFiles(validatedImageFiles);
  const now = new Date().toISOString();
  const content = normalizeQuickNoteContent(text, quickNoteBodyFromTextAndImages(text, images, (filename) => `http://127.0.0.1:19876/quick-notes/${id}/${filename}`, () => crypto.randomUUID()), images);
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(text, images.length);

  // 先落盘图片文件（纯文件为准，完全不用 BLOB；落盘失败抛错——文件是唯一真相，不能静默降级）。
  // 不做旧文件清理：与文档资源一致（每次上传生成唯一新文件，旧文件由 GC/孤儿清理回收；冗余是设计理念）。
  for (const f of imageFilesWithKey) {
    const key = "quick-notes/" + id + "/" + f.filename;
    deps.assets.set(key, f.bytes); // 内存层（同步端口/显示优先读）
    await deps.saveAssetFile(key, f.bytes);
  }
  await d.transaction(async () => {
    await d.prepare(
      "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, ready_to_sync) " +
      "VALUES (?,?,?,?,?,?,?,'local',0,NULL,1) " +
      "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1"
    ).run(id, now, now, preview, images.length, contentHash, serialized);
  });
  return id;
}

export async function deleteQuickNote(d: MobileDb, id: string): Promise<void> {
  await d.prepare("UPDATE quick_notes SET deleted_at=?, restore_pending_at=NULL, sync_state='local', ready_to_sync=1 WHERE id=?").run(new Date().toISOString(), id);
}

export async function listQuickNoteTrash(d: MobileDb): Promise<QuickNoteTrashItem[]> {
  const rows = await d.prepare("SELECT id, created_at, updated_at, deleted_at, preview_text FROM quick_notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all() as Array<{ id: string; created_at: string; updated_at: string; deleted_at: string; preview_text: string }>;
  return rows.map((r) => ({ id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at), previewText: String(r.preview_text) }));
}

export async function restoreQuickNote(d: MobileDb, id: string): Promise<void> {
  const row = await d.prepare("SELECT 1 FROM quick_notes WHERE id=? AND deleted_at IS NOT NULL").get(id);
  if (!row) throw new Error("小记不在回收站");
  const now = new Date().toISOString();
  await d.prepare("UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=?, sync_state='local', updated_at=? WHERE id=?").run(now, now, id);
}

export async function purgeQuickNote(
  d: MobileDb,
  id: string,
  removeAssetFile: (key: string) => Promise<void>,
): Promise<void> {
  const prevRow = await d.prepare("SELECT content FROM quick_notes WHERE id=?").get(id) as { content: string } | undefined;
  await d.transaction(async () => {
    await d.prepare("INSERT OR REPLACE INTO quick_note_deleted (id, created_at, updated_at, deleted_at) SELECT id, created_at, updated_at, deleted_at FROM quick_notes WHERE id=?").run(id);
    await d.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
  });
  if (!prevRow) return;
  try {
    const parsed = validateQuickNoteContent(JSON.parse(prevRow.content) as StoredQuickNoteContent);
    for (const img of parsed.images) {
      await removeAssetFile("quick-notes/" + id + "/" + img.filename).catch(() => undefined);
    }
  } catch { /* 内容解析失败不阻断 purge */ }
}
