import {
  buildQuickNoteImageFiles,
  normalizeQuickNoteContent,
  quickNoteBodyFromTextAndImages,
  previewQuickNote,
  serializeQuickNoteContent,
  validateQuickNoteContent,
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
} from "../../core/quickNoteModel.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import type { MobileDb } from "./sqliteDb";
import {
  deleteDraftJournal,
  deleteQuickNoteBody,
  readDraftJournal,
  readQuickNoteBody,
  writeDraftJournal,
  writeQuickNoteBody,
} from "./noteBodies.js";

/**
 * 移动端小记仓储（261019 起与桌面存储架构对齐）：
 * - 正文 = quick-notes/items/{id}.qnote（JSON 文件，内容格式与桌面 .qnote 字节一致）；
 * - SQLite quick_notes 只存元数据 + content_hash（不含正文）；
 * - 未提交草稿 = draft-journal/{id}.json（原 device_state 大字段，与桌面草稿日志同构）。
 */

export interface QuickNoteImageFile {
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
}

export interface QuickNoteListItem {
  id: string;
  /** 创建时间（ISO）：261015 起列表可按创建时间排序，所以它必须一路带到 UI。 */
  createdAt: string;
  previewText: string;
  imageCount: number;
  updatedAt: string;
  firstImage: string | null;
  /** 内核形态正文 + 资源清单：供卡片用桌面同一套只读预览渲染。 */
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

/** DB 提交失败时把正文恢复到写前版本（无旧版本 = 删除本次新写的文件）。 */
async function restoreQuickNoteBody(id: string, previousRaw: string | null): Promise<void> {
  if (previousRaw == null) await deleteQuickNoteBody(id).catch(() => undefined);
  else await writeQuickNoteBody(id, previousRaw).catch(() => undefined);
}

async function readBodyContent(id: string): Promise<StoredQuickNoteContent | null> {
  const text = await readQuickNoteBody(id);
  if (text == null) return null;
  try {
    return JSON.parse(text) as StoredQuickNoteContent;
  } catch {
    return null;
  }
}

export async function listQuickNotes(d: MobileDb): Promise<QuickNoteListItem[]> {
  const rows = await d.prepare("SELECT id, created_at, preview_text, image_count, updated_at FROM quick_notes WHERE deleted_at IS NULL AND restore_pending_at IS NULL ORDER BY updated_at DESC").all() as Array<{
    id: string;
    created_at: string;
    preview_text: string;
    image_count: number;
    updated_at: string;
  }>;
  return Promise.all(rows.map(async (row) => {
    const parsed = await readBodyContent(String(row.id));
    return {
      id: String(row.id),
      createdAt: String(row.created_at),
      previewText: String(row.preview_text),
      imageCount: Number(row.image_count),
      updatedAt: String(row.updated_at),
      firstImage: parsed?.images?.[0]?.filename ?? null,
      body: parsed?.body ?? "",
      images: parsed?.images ?? [],
    };
  }));
}

export async function readQuickNote(d: MobileDb, id: string): Promise<QuickNoteReadResult | null> {
  const row = await d.prepare("SELECT id, preview_text, updated_at FROM quick_notes WHERE id=?").get(id) as {
    id: string;
    preview_text: string;
    updated_at: string;
  } | undefined;
  if (!row) return null;
  const content = await readBodyContent(id);
  if (!content) return null;
  return { id: String(row.id), content, previewText: String(row.preview_text), updatedAt: String(row.updated_at) };
}

export async function saveQuickNote(d: MobileDb, id: string, text: string, images: StoredQuickNoteImage[] = []): Promise<string> {
  const now = new Date().toISOString();
  // 正文（body）口径：移动端只有纯文本编辑器，合成 body 会把桌面端排版的富内容（标题/列表/引用/表格/卡片）
  // 压成纯段落。所以 —— 若**纯文本没变**（用户只是打开又保存、或只调整了图片顺序），沿用原有 body，不压平。
  const previousRaw = await readQuickNoteBody(id);
  let previous: StoredQuickNoteContent | null = null;
  try { previous = previousRaw == null ? null : JSON.parse(previousRaw) as StoredQuickNoteContent; } catch { previous = null; }
  let preservedBody = "";
  if (previous && previous.text === text && typeof previous.body === "string" && previous.body) preservedBody = previous.body;
  const body = preservedBody || quickNoteBodyFromTextAndImages(text, images, (filename) => `http://127.0.0.1:19876/quick-notes/${id}/${filename}`, () => crypto.randomUUID());
  const content = normalizeQuickNoteContent(text, body, images);
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(text, images.length);
  // 先正文文件、后 DB（DB 不声称正文已存在）；DB 失败要把正文恢复到写前版本。
  await writeQuickNoteBody(id, serialized);
  try {
    await d.transaction(async () => {
      await d.prepare(
        `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, sync_state, is_conflict, restore_pending_at, ready_to_sync)
         VALUES (?,?,?,?,?,?,'local',0,NULL,1)
         ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1`
      ).run(id, now, now, preview, images.length, contentHash);
      await d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
    });
  } catch (error) {
    await restoreQuickNoteBody(id, previousRaw);
    throw error;
  }
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
    deps.assets.set(key, f.bytes);
    await deps.saveAssetFile(key, f.bytes);
  }
  const previousRaw = await readQuickNoteBody(id);
  await writeQuickNoteBody(id, serialized);
  try {
    await d.transaction(async () => {
      await d.prepare(
        "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, sync_state, is_conflict, restore_pending_at, ready_to_sync) " +
        "VALUES (?,?,?,?,?,?,'local',0,NULL,1) " +
        "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1"
      ).run(id, now, now, preview, images.length, contentHash);
    });
  } catch (error) {
    await restoreQuickNoteBody(id, previousRaw);
    throw error;
  }
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
  const previousRaw = await readQuickNoteBody(id);
  await writeQuickNoteBody(id, serialized);
  try {
    await d.transaction(async () => {
      await d.prepare(
        `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, sync_state, is_conflict, restore_pending_at, ready_to_sync)
         VALUES (?,?,?,?,?,?,'local',0,NULL,1)
         ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1`
      ).run(id, now, now, preview, content.images.length, contentHash);
      await d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
    });
  } catch (error) {
    await restoreQuickNoteBody(id, previousRaw);
    throw error;
  }
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
  const prev = await readBodyContent(id);
  await d.transaction(async () => {
    // 兼容"直接彻底删除未进回收站的小记"的调用：deleted_at 为空时用当前时间补墓碑时间（原 SQL 会撞 NOT NULL）。
    await d.prepare("INSERT OR REPLACE INTO quick_note_deleted (id, created_at, updated_at, deleted_at) SELECT id, created_at, updated_at, COALESCE(deleted_at, ?) FROM quick_notes WHERE id=?").run(new Date().toISOString(), id);
    await d.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
  });
  await deleteQuickNoteBody(id).catch(() => undefined);
  if (!prev) return;
  try {
    const parsed = validateQuickNoteContent(prev);
    for (const img of parsed.images) {
      await removeAssetFile("quick-notes/" + id + "/" + img.filename).catch(() => undefined);
    }
  } catch { /* 内容解析失败不阻断 purge */ }
}

/* ---------------------------------------------------------------------------
 * 闪念速记「未提交草稿」：draft-journal/{id}.json（与桌面草稿日志同构、纯本机）。
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
   */
  body?: string;
  /** 草稿引用的图片（图片加入时已落盘到 quick-notes/{id}/，这里只记元数据/文件名）。 */
  images: StoredQuickNoteImage[];
  updatedAt: string;
}

export async function readQuickNoteDraft(d: MobileDb): Promise<QuickNoteDraft | null> {
  // 草稿正文只在 draft-journal/{id}.json；device_state 仅存一个 id 指针（BodyStore 没有 list 能力）。
  const pointer = await d.prepare("SELECT value FROM device_state WHERE key='quick_note_draft_id'").get() as { value?: string } | undefined;
  if (!pointer?.value) return null;
  const raw = await readDraftJournal(String(pointer.value));
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QuickNoteDraft>;
    if (typeof parsed.id !== "string" || !parsed.id || typeof parsed.text !== "string") return null;
    return {
      id: parsed.id,
      text: parsed.text,
      body: typeof parsed.body === "string" ? parsed.body : undefined,
      images: Array.isArray(parsed.images) ? (parsed.images as StoredQuickNoteImage[]) : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

export async function writeQuickNoteDraft(d: MobileDb, draft: QuickNoteDraft): Promise<void> {
  // 指针（只存 id）用于下次冷启动找到草稿文件；正文始终只在文件里。
  // 草稿 id 变了（重开写作卡换了 id）时清掉旧文件，避免 draft-journal 里堆无人引用的旧稿。
  const previous = await d.prepare("SELECT value FROM device_state WHERE key='quick_note_draft_id'").get() as { value?: string } | undefined;
  await writeDraftJournal(draft.id, JSON.stringify(draft));
  if (previous?.value && previous.value !== draft.id) await deleteDraftJournal(String(previous.value)).catch(() => undefined);
  await d.prepare("INSERT INTO device_state(key,value) VALUES('quick_note_draft_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(draft.id);
}

export async function clearQuickNoteDraft(d: MobileDb): Promise<void> {
  const row = await d.prepare("SELECT value FROM device_state WHERE key='quick_note_draft_id'").get() as { value?: string } | undefined;
  if (row?.value) await deleteDraftJournal(String(row.value)).catch(() => undefined);
  await d.prepare("DELETE FROM device_state WHERE key='quick_note_draft_id'").run();
}
