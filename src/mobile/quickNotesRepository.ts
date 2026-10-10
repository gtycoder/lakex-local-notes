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
  /** 内核形态正文 + 资源清单：供卡片用桌面同一套只读预览渲染（列表一次取回，避免逐条再查库）。 */
  body: string;
  images: StoredQuickNoteImage[];
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
    let body = "";
    let images: StoredQuickNoteImage[] = [];
    try {
      const parsed = JSON.parse(r.content) as StoredQuickNoteContent;
      firstImage = parsed.images?.[0]?.filename ?? null;
      body = parsed.body ?? "";
      images = parsed.images ?? [];
    } catch { /* 解析失败走纯文本摘要 */ }
    return { id: r.id, previewText: r.preview_text, imageCount: r.image_count, updatedAt: r.updated_at, firstImage, body, images };
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
  // 正文（body）口径：移动端只有纯文本编辑器，合成 body 会把桌面端排版的富内容（标题/列表/引用/表格/卡片）
  // 压成纯段落。所以 —— 若**纯文本没变**（用户只是打开又保存、或只调整了图片顺序），沿用原有 body，不压平。
  const existingRow = await d.prepare("SELECT content FROM quick_notes WHERE id=?").get(id) as { content: string } | undefined;
  let preservedBody = "";
  if (existingRow) {
    try {
      const previous = JSON.parse(existingRow.content) as StoredQuickNoteContent;
      if (previous.text === text && typeof previous.body === "string" && previous.body) preservedBody = previous.body;
    } catch { /* 旧数据/坏数据：走合成路径 */ }
  }
  const body = preservedBody || quickNoteBodyFromTextAndImages(text, images, (filename) => `http://127.0.0.1:19876/quick-notes/${id}/${filename}`, () => crypto.randomUUID());
  const content = normalizeQuickNoteContent(text, body, images);
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

/**
 * 保存**由内核编辑器产出的正文**（移动端小记编辑态用，对齐桌面口径）：
 * `body` = 内核形态（`.lake` 同构），`text` = 纯文本镜像，`images` = 正文引用到的资源清单。
 * 与 `saveQuickNote` 的区别：不再用 `quickNoteBodyFromTextAndImages` 合成正文（那会把富内容压平）。
 */
export async function saveQuickNoteContent(
  d: MobileDb,
  id: string,
  payload: { text: string; body: string; images: StoredQuickNoteImage[] },
): Promise<string> {
  const now = new Date().toISOString();
  const content = normalizeQuickNoteContent(payload.text, payload.body, payload.images);
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(content.text, content.images.length);
  await d.transaction(async () => {
    await d.prepare(
      `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, ready_to_sync)
       VALUES (?,?,?,?,?,?,?,'local',0,NULL,1)
       ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1`
    ).run(id, now, now, preview, content.images.length, contentHash, serialized);
    await d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
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

/* ---------------------------------------------------------------------------
 * 闪念速记「未提交草稿」：纯本地 device_state（**不进 S3、不是小记**）。
 * 目的：随手写到一半被系统杀进程时，下次打开还能把内容捞回来。
 * 《小记》本体仍是手动保存语义；草稿只在保存/取消后清除。
 * ------------------------------------------------------------------------- */

export interface QuickNoteDraft {
  /** 草稿对应的小记 id：一开始就固定，保存时沿用，避免每次重开换 id。 */
  id: string;
  text: string;
  /**
   * 内核草稿的**原样正文**（text/lake body，含富内容：待办/列表/分割线）。
   * 261010 统一小记入口后新增：深链那条也挂内核，草稿若只存纯文本，恢复时会丢掉富格式。
   * 兼容旧草稿（无 body ⇒ 由 text 经无内核写入通道重建，见 QuickNoteComposer）。
   */
  body?: string;
  /** 草稿引用的图片（图片加入时已落盘到 quick-notes/{id}/，这里只记元数据/文件名）。 */
  images: StoredQuickNoteImage[];
  updatedAt: string;
}

const QUICK_NOTE_DRAFT_KEY = "quick-note-draft";

export async function readQuickNoteDraft(d: MobileDb): Promise<QuickNoteDraft | null> {
  const row = await d.prepare("SELECT value FROM device_state WHERE key=?").get(QUICK_NOTE_DRAFT_KEY) as { value?: string } | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<QuickNoteDraft>;
    if (typeof parsed?.id === "string" && parsed.id && typeof parsed?.text === "string") {
      return {
        id: parsed.id,
        text: parsed.text,
        body: typeof parsed.body === "string" ? parsed.body : undefined,
        images: Array.isArray(parsed.images) ? (parsed.images as StoredQuickNoteImage[]) : [],
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    }
  } catch { /* 坏草稿：忽略 */ }
  return null;
}

export async function writeQuickNoteDraft(d: MobileDb, draft: QuickNoteDraft): Promise<void> {
  await d.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(QUICK_NOTE_DRAFT_KEY, JSON.stringify(draft));
}

export async function clearQuickNoteDraft(d: MobileDb): Promise<void> {
  await d.prepare("DELETE FROM device_state WHERE key=?").run(QUICK_NOTE_DRAFT_KEY);
}
