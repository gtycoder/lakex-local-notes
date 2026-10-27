import {
  buildQuickNoteImageFiles,
  normalizeQuickNoteContent,
  quickNoteBodyFromTextAndImages,
  previewQuickNote,
  sameQuickNoteContent,
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
import { quickNoteTagNames } from "./quickNoteTagsRepository.js";
import { listAllQuickNoteTagIds, listQuickNoteTagIds, removeQuickNoteLinks, setQuickNoteTagVersion } from "./quickNoteTagLinksRepository.js";

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
  /** 列表投影只带轻量元数据；正文/图片清单由可见卡片按需 readQuickNote。 */
  tags: string[];
  tagIds: string[];
}

export interface QuickNoteCursor {
  updatedAt: string;
  id: string;
}

export interface QuickNotePage {
  items: QuickNoteListItem[];
  nextCursor: QuickNoteCursor | null;
}

export interface QuickNotePageOptions {
  limit?: number;
  cursor?: QuickNoteCursor;
}

export interface QuickNoteReadResult {
  id: string;
  content: StoredQuickNoteContent;
  /** 关联表里的标签 ID（顺序 = 最近添加在前）。 */
  tagIds: string[];
  /** 标签展示名（由标签目录解析）。 */
  tags: string[];
  previewText: string;
  updatedAt: string;
}

export interface QuickNoteTrashItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  previewText: string;
  /** 远端已彻底删除、本机仅保留回收站副本（「云端已删除 · 仅本地」）；恢复上传成功后清除。 */
  cloudDeleted: boolean;
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

type QuickNoteListRow = {
  id: string;
  created_at: string;
  preview_text: string;
  image_count: number;
  updated_at: string;
  first_image: string | null;
};

function quickNoteListItemFromRow(row: QuickNoteListRow, tagIds: readonly string[], names: Map<string, string>): QuickNoteListItem {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    previewText: String(row.preview_text),
    imageCount: Number(row.image_count),
    updatedAt: String(row.updated_at),
    firstImage: row.first_image ? String(row.first_image) : null,
    tags: tagIds.map((id) => names.get(id) ?? ""),
    tagIds: [...tagIds],
  };
}

/** 小记列表投影的分页读取；不传 limit 时保持旧的全集行为。 */
export async function listQuickNotePage(d: MobileDb, options: QuickNotePageOptions = {}): Promise<QuickNotePage> {
  const values: unknown[] = [];
  let where = "deleted_at IS NULL AND restore_pending_at IS NULL";
  if (options.cursor) {
    where += " AND (updated_at < ? OR (updated_at = ? AND id < ?))";
    values.push(options.cursor.updatedAt, options.cursor.updatedAt, options.cursor.id);
  }
  const bounded = typeof options.limit === "number" && options.limit > 0;
  const sql = "SELECT id, created_at, preview_text, image_count, updated_at, first_image FROM quick_notes"
    + " WHERE " + where
    + " ORDER BY updated_at DESC, id DESC"
    + (bounded ? " LIMIT ?" : "");
  if (bounded) values.push(options.limit! + 1);
  const rows = await d.prepare(sql).all(...values) as QuickNoteListRow[];
  const hasMore = bounded && rows.length > options.limit!;
  const visibleRows = hasMore ? rows.slice(0, options.limit) : rows;
  // 关系与目录独立读取（一次查询，避免逐条 N+1）；未知/墓碑标签不展示名称。
  const links = await listAllQuickNoteTagIds(d);
  const names = await quickNoteTagNames(d);
  const items = visibleRows.map((row) => quickNoteListItemFromRow(row, links.get(String(row.id)) ?? [], names));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? { updatedAt: last.updatedAt, id: last.id } : null,
  };
}

export async function listQuickNotes(d: MobileDb): Promise<QuickNoteListItem[]> {
  return (await listQuickNotePage(d)).items;
}

/**
 * 一次性把旧行的首图元数据从 .qnote 回填进 SQLite（标签来自关联表，不再投影到行里）。
 * 启动迁移路径调用；完成后写 device_state 标记，首页后续只读轻量行，不再批量读正文。
 */
export async function backfillQuickNoteListMetadata(d: MobileDb): Promise<void> {
  // 261027：不再只看一次性 device_state 标记 —— 之后同步才导入的行 list_metadata_version=0，
  // 按旧逻辑永远轮不到回填（首页卡片空白/无图）。改为「有未回填行就干活」，标志只用来跳过空跑。
  const rows = await d.prepare("SELECT id FROM quick_notes WHERE list_metadata_version<1").all() as Array<{ id: string }>;
  if (rows.length === 0) {
    await d.prepare("INSERT INTO device_state(key,value) VALUES('quick_note_list_metadata_v1','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    return;
  }
  const statements: Array<{ statement: string; values: unknown[] }> = [];
  for (const row of rows) {
    const id = String(row.id);
    const content = await readBodyContent(id).catch(() => null);
    statements.push({
      statement: "UPDATE quick_notes SET preview_text=?, image_count=?, first_image=?, list_metadata_version=1 WHERE id=?",
      values: [content ? previewQuickNote(content.text, content.images.length) : "", content?.images?.length ?? 0, content?.images?.[0]?.filename ?? null, id],
    });
  }
  if (statements.length > 0) {
    if (d.executeSet) {
      for (let i = 0; i < statements.length; i += 200) await d.executeSet(statements.slice(i, i + 200));
    } else {
      await d.transaction(async () => {
        for (const item of statements) await d.prepare(item.statement).run(...item.values);
      });
    }
  }
  await d.prepare(
    "INSERT INTO device_state(key,value) VALUES('quick_note_list_metadata_v1','1') ON CONFLICT(key) DO UPDATE SET value='1'",
  ).run();
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
  const tagIds = await listQuickNoteTagIds(d, id);
  const names = await quickNoteTagNames(d);
  return {
    id: String(row.id),
    content,
    tagIds,
    tags: tagIds.map((tagId) => names.get(tagId) ?? ""),
    previewText: String(row.preview_text),
    updatedAt: String(row.updated_at),
  };
}

async function readQuickNoteWriteBase(id: string): Promise<{ raw: string | null; parsed: StoredQuickNoteContent | null }> {
  const raw = await readQuickNoteBody(id);
  try { return { raw, parsed: raw == null ? null : JSON.parse(raw) as StoredQuickNoteContent }; }
  catch { return { raw, parsed: null }; }
}

async function persistQuickNoteContent(
  d: MobileDb,
  id: string,
  draft: { text: string; body: string; images: StoredQuickNoteImage[] },
  previous: { raw: string | null; parsed: StoredQuickNoteContent | null },
): Promise<void> {
  const now = new Date().toISOString();
  const content = normalizeQuickNoteContent(draft.text, draft.body, draft.images);
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(content.text, content.images.length);
  const previousRow = await d.prepare("SELECT updated_at FROM quick_notes WHERE id=?").get(id) as { updated_at: string } | undefined;
  const effectiveUpdatedAt = previous.parsed && previousRow && sameQuickNoteContent(previous.parsed, content)
    ? previousRow.updated_at
    : now;
  await writeQuickNoteBody(id, serialized);
  try {
    await d.transaction(async () => {
      await d.prepare(
        `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, is_dirty, is_conflict, restore_pending_at, ready_to_sync, first_image, list_metadata_version)
         VALUES (?,?,?,?,?,?,1,0,NULL,1,?,1)
         ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, is_dirty=1, deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1, first_image=excluded.first_image, list_metadata_version=1`
      ).run(id, now, effectiveUpdatedAt, preview, content.images.length, contentHash, content.images[0]?.filename ?? null);
      // 活跃写入统一清删除墓碑，避免“活跃行 + 墓碑”二义性。
      await d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
    });
  } catch (error) {
    await restoreQuickNoteBody(id, previous.raw);
    throw error;
  }
}

export async function saveQuickNote(
  d: MobileDb,
  id: string,
  text: string,
  images: StoredQuickNoteImage[] = [],
): Promise<string> {
  // 正文（body）口径：移动端只有纯文本编辑器，合成 body 会把桌面端排版的富内容（标题/列表/引用/表格/卡片）
  // 压成纯段落。所以 —— 若**纯文本没变**（用户只是打开又保存、或只调整了图片顺序），沿用原有 body，不压平。
  const previous = await readQuickNoteWriteBase(id);
  let preservedBody = "";
  if (previous.parsed && previous.parsed.text === text && typeof previous.parsed.body === "string" && previous.parsed.body) preservedBody = previous.parsed.body;
  const body = preservedBody || quickNoteBodyFromTextAndImages(text, images, (filename) => `http://127.0.0.1:19876/quick-notes/${id}/${filename}`, () => crypto.randomUUID());
  await persistQuickNoteContent(d, id, { text, body, images }, previous);
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
  const previous = await readQuickNoteWriteBase(id);

  // 先落盘图片文件（纯文件为准，完全不用 BLOB；落盘失败抛错——文件是唯一真相，不能静默降级）。
  // 不做旧文件清理：与文档资源一致（每次上传生成唯一新文件，旧文件由 GC/孤儿清理回收；冗余是设计理念）。
  for (const f of imageFilesWithKey) {
    const key = "quick-notes/" + id + "/" + f.filename;
    deps.assets.set(key, f.bytes);
    await deps.saveAssetFile(key, f.bytes);
  }
  const body = quickNoteBodyFromTextAndImages(text, images, (filename) => `http://127.0.0.1:19876/quick-notes/${id}/${filename}`, () => crypto.randomUUID());
  await persistQuickNoteContent(d, id, { text, body, images }, previous);
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
  const previous = await readQuickNoteWriteBase(id);
  await persistQuickNoteContent(d, id, payload, previous);
  return id;
}

export async function deleteQuickNote(d: MobileDb, id: string): Promise<void> {
  await d.prepare("UPDATE quick_notes SET deleted_at=?, restore_pending_at=NULL, is_dirty=1, ready_to_sync=1 WHERE id=?").run(new Date().toISOString(), id);
}

export async function listQuickNoteTrash(d: MobileDb): Promise<QuickNoteTrashItem[]> {
  const rows = await d.prepare("SELECT id, created_at, updated_at, deleted_at, preview_text, cloud_deleted FROM quick_notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all() as Array<{ id: string; created_at: string; updated_at: string; deleted_at: string; preview_text: string; cloud_deleted: number }>;
  return rows.map((r) => ({
    id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at),
    previewText: String(r.preview_text), cloudDeleted: r.cloud_deleted === 1,
  }));
}

export async function restoreQuickNote(d: MobileDb, id: string): Promise<void> {
  const row = await d.prepare("SELECT 1 FROM quick_notes WHERE id=? AND deleted_at IS NOT NULL").get(id);
  if (!row) throw new Error("小记不在回收站");
  const now = new Date().toISOString();
  // 恢复 = 本地重新拥有这条小记：若关系还在，把关系版本推进到当前，标签才会随清单同步出去。
  const tagsUpdatedAt = (await listQuickNoteTagIds(d, id)).length > 0 ? now : "";
  await d.prepare("UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=? WHERE id=?").run(now, now, id);
  if (tagsUpdatedAt) await setQuickNoteTagVersion(d, id, tagsUpdatedAt);
}

export async function purgeQuickNote(
  d: MobileDb,
  id: string,
  removeAssetFile: (key: string) => Promise<void>,
): Promise<void> {
  const prev = await readBodyContent(id);
  await d.transaction(async () => {
    // 兼容"直接彻底删除未进回收站的小记"的调用：deleted_at 为空时用当前时间补墓碑时间（原 SQL 会撞 NOT NULL）。
    // purged_at 非空 = 本地彻底删除墓碑（v3 quickPurges）；只有软删语义的墓碑 purged_at 保持 NULL。
    const now = new Date().toISOString();
    await d.prepare("INSERT OR REPLACE INTO quick_note_deleted (id, created_at, updated_at, deleted_at, purged_at) SELECT id, created_at, updated_at, COALESCE(deleted_at, ?), ? FROM quick_notes WHERE id=?").run(now, now, id);
    await d.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
    await removeQuickNoteLinks(d, id);
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
  /** 草稿引用的标签 ID（标签表是唯一来源）。 */
  tagIds?: string[];
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
      tagIds: Array.isArray(parsed.tagIds) ? parsed.tagIds.filter((tagId): tagId is string => typeof tagId === "string") : [],
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
