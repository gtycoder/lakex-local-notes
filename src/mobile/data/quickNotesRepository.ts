import {
  buildQuickNoteImageFiles,
  migrateLegacyQuickNoteContent,
  normalizeQuickNoteContent,
  quickNoteBodyFromTextAndImages,
  previewQuickNote,
  sameQuickNoteExceptTags,
  serializeQuickNoteContent,
  validateQuickNoteContent,
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
} from "../../core/quickNoteModel.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../../core/quickNoteModel.js";
import {
  mergeQuickNoteTags as mergeTagDirectories,
  normalizeQuickNoteTag,
  normalizeQuickNoteTagIds,
  quickNoteTagId,
  type QuickNoteTag,
} from "../../core/quickNoteTags.js";
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
  /** 标签展示名（由标签表解析，与 content.tagIds 等长）。 */
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

function parseTagsJson(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

type QuickNoteListRow = {
  id: string;
  created_at: string;
  preview_text: string;
  image_count: number;
  updated_at: string;
  first_image: string | null;
  tags_json: string;
  tag_ids_json: string;
};

function quickNoteListItemFromRow(row: QuickNoteListRow): QuickNoteListItem {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    previewText: String(row.preview_text),
    imageCount: Number(row.image_count),
    updatedAt: String(row.updated_at),
    firstImage: row.first_image ? String(row.first_image) : null,
    tags: parseTagsJson(row.tags_json),
    tagIds: parseTagsJson(row.tag_ids_json),
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
  const sql = "SELECT id, created_at, preview_text, image_count, updated_at, first_image, tags_json, tag_ids_json FROM quick_notes"
    + " WHERE " + where
    + " ORDER BY updated_at DESC, id DESC"
    + (bounded ? " LIMIT ?" : "");
  if (bounded) values.push(options.limit! + 1);
  const rows = await d.prepare(sql).all(...values) as QuickNoteListRow[];
  const hasMore = bounded && rows.length > options.limit!;
  const visibleRows = hasMore ? rows.slice(0, options.limit) : rows;
  const items = visibleRows.map(quickNoteListItemFromRow);
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
 * 一次性把旧行的列表标签/首图元数据从 .qnote 回填进 SQLite。
 * 启动迁移路径调用；完成后写 device_state 标记，首页后续只读轻量行，不再批量读正文。
 */
export async function backfillQuickNoteListMetadata(d: MobileDb): Promise<void> {
  const done = await d.prepare("SELECT value FROM device_state WHERE key='quick_note_list_metadata_v1'").get() as { value?: string } | undefined;
  if (done?.value === "1") return;
  const rows = await d.prepare("SELECT id FROM quick_notes WHERE list_metadata_version<1").all() as Array<{ id: string }>;
  const statements: Array<{ statement: string; values: unknown[] }> = [];
  for (const row of rows) {
    const id = String(row.id);
    const content = await readBodyContent(id).catch(() => null);
    const names = content ? (await resolveQuickNoteTagNames(d, content.tagIds)).filter(Boolean) : [];
    statements.push({
      statement: "UPDATE quick_notes SET tags_json=?, tag_ids_json=?, first_image=?, list_metadata_version=1 WHERE id=?",
      values: [JSON.stringify(names), JSON.stringify(content?.tagIds ?? []), content?.images?.[0]?.filename ?? null, id],
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
  return { id: String(row.id), content, tags: (await resolveQuickNoteTagNames(d, content.tagIds)).filter(Boolean), previewText: String(row.preview_text), updatedAt: String(row.updated_at) };
}

async function readQuickNoteWriteBase(id: string): Promise<{ raw: string | null; parsed: StoredQuickNoteContent | null }> {
  const raw = await readQuickNoteBody(id);
  try { return { raw, parsed: raw == null ? null : JSON.parse(raw) as StoredQuickNoteContent }; }
  catch { return { raw, parsed: null }; }
}

/* ---------------------------------------------------------------------------
 * 标签目录（261024）：名称/排序/置顶/墓碑在 quick_note_tags；小记正文只存 tagIds。
 * 与桌面同一套 core 纯函数（ID 派生、LWW 合并、筛选）。
 * ------------------------------------------------------------------------- */

type QuickNoteTagRow = {
  id: string;
  name: string;
  sort_order: number;
  pinned: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function mapQuickNoteTagRow(row: QuickNoteTagRow): QuickNoteTag {
  return {
    id: String(row.id),
    name: String(row.name),
    sortOrder: Number(row.sort_order),
    pinned: !!row.pinned,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

export async function listQuickNoteTags(d: MobileDb, options: { includeDeleted?: boolean } = {}): Promise<QuickNoteTag[]> {
  const where = options.includeDeleted ? "" : "WHERE deleted_at IS NULL";
  const rows = await d.prepare(`SELECT * FROM quick_note_tags ${where} ORDER BY pinned DESC, sort_order, name`).all() as QuickNoteTagRow[];
  return rows.map(mapQuickNoteTagRow);
}

/** 标签 ID → 名称（与 tagIds 等长；未知 ID 给空串）。 */
export async function resolveQuickNoteTagNames(d: MobileDb, tagIds: readonly string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await d.prepare("SELECT id,name FROM quick_note_tags WHERE deleted_at IS NULL").all() as Array<{ id: string; name: string }>;
  const names = new Map(rows.map((row) => [String(row.id), String(row.name)] as const));
  return tagIds.map((id) => names.get(id) ?? "");
}

async function upsertQuickNoteTagRow(d: MobileDb, tag: QuickNoteTag): Promise<void> {
  await d.prepare(
    "INSERT INTO quick_note_tags(id,name,sort_order,pinned,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, pinned=excluded.pinned, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at"
  ).run(tag.id, tag.name, tag.sortOrder, tag.pinned ? 1 : 0, tag.createdAt, tag.updatedAt, tag.deletedAt);
}

/** 幂等创建：同名 active 直接返回；同名墓碑复活。 */
export async function ensureQuickNoteTag(d: MobileDb, rawName: string, at = new Date().toISOString()): Promise<QuickNoteTag> {
  const name = normalizeQuickNoteTag(rawName);
  const existing = await d.prepare("SELECT * FROM quick_note_tags WHERE name=? AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(name) as QuickNoteTagRow | undefined;
  if (existing) return mapQuickNoteTagRow(existing);
  const id = quickNoteTagId(name);
  const previous = await d.prepare("SELECT * FROM quick_note_tags WHERE id=?").get(id) as QuickNoteTagRow | undefined;
  const maxRow = await d.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM quick_note_tags WHERE deleted_at IS NULL").get() as { m: number };
  const tag: QuickNoteTag = {
    id,
    name,
    sortOrder: Number(maxRow.m) + 1,
    pinned: false,
    createdAt: previous ? String(previous.created_at) : at,
    updatedAt: at,
    deletedAt: null,
  };
  await upsertQuickNoteTagRow(d, tag);
  return tag;
}

export async function createQuickNoteTag(d: MobileDb, name: string): Promise<QuickNoteTag> {
  return ensureQuickNoteTag(d, name);
}

async function assertQuickNoteTagIdsExist(d: MobileDb, tagIds: readonly string[]): Promise<void> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const rows = await d.prepare(`SELECT id FROM quick_note_tags WHERE deleted_at IS NULL AND id IN (${unique.map(() => "?").join(",")})`).all(...unique) as Array<{ id: string }>;
  if (rows.length !== unique.length) throw new Error("标签不存在或已删除");
}

/** 更新单条索引的 tags 词（正文没变时不重排）；表不存在时静默（FTS 不可用的环境）。 */
async function updateSearchTags(d: MobileDb, id: string, names: string[], contentHash: string): Promise<void> {
  try {
    const row = await d.prepare("SELECT fts_rowid FROM quick_notes_search_index WHERE quick_note_id=?").get(id) as { fts_rowid: number } | undefined;
    if (!row) return;
    const tagsText = names.join(" ");
    await d.prepare("UPDATE quick_notes_search_index SET tags=?, content_hash=? WHERE quick_note_id=?").run(tagsText, contentHash, id);
    await d.prepare("UPDATE quick_notes_fts SET tags=? WHERE rowid=?").run(tagsText, row.fts_rowid);
  } catch { /* FTS 不可用：搜索会降级 */ }
}

/** 批量改写小记的 tagIds（标签管理专用）；updated_at 不变。 */
async function rewriteQuickNoteTagIds(d: MobileDb, mutate: (tagIds: string[]) => string[]): Promise<{ updated: number; failed: number }> {
  const rows = await d.prepare("SELECT id FROM quick_notes").all() as Array<{ id: string }>;
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const id = String(row.id);
    try {
      let content: StoredQuickNoteContent;
      const raw = await readQuickNoteBody(id);
      if (raw == null) throw new Error("正文缺失");
      const parsed = JSON.parse(raw) as unknown;
      const legacy = migrateLegacyQuickNoteContent(parsed);
      if (legacy) {
        for (const name of legacy.tagNames) await ensureQuickNoteTag(d, name);
        content = legacy.content;
      } else {
        content = validateQuickNoteContent(parsed);
      }
      const nextTagIds = normalizeQuickNoteTagIds(mutate([...content.tagIds]));
      if (nextTagIds.join("\u0000") === content.tagIds.join("\u0000") && !legacy) continue;
      const next = normalizeQuickNoteContent(content.text, content.body, content.images, nextTagIds);
      const serialized = serializeQuickNoteContent(next);
      const contentHash = sha256Sync(new TextEncoder().encode(serialized));
      const names = (await resolveQuickNoteTagNames(d, next.tagIds)).filter(Boolean);
      await writeQuickNoteBody(id, serialized);
      await d.prepare("UPDATE quick_notes SET content_hash=?, sync_state='local', tags_json=?, tag_ids_json=? WHERE id=?").run(contentHash, JSON.stringify(names), JSON.stringify(next.tagIds), id);
      await updateSearchTags(d, id, names, contentHash);
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  return { updated, failed };
}

/** 标签改名后刷新所有小记的 tags_json 与索引 tags 词。 */
async function refreshQuickNoteTagProjections(d: MobileDb): Promise<void> {
  const rows = await d.prepare("SELECT id, content_hash FROM quick_notes").all() as Array<{ id: string; content_hash: string }>;
  const nameById = new Map((await listQuickNoteTags(d)).map((tag) => [tag.id, tag.name] as const));
  for (const row of rows) {
    const id = String(row.id);
    try {
      const content = await readBodyContent(id);
      if (!content) continue;
      const names = content.tagIds.map((tagId) => nameById.get(tagId) ?? "").filter(Boolean);
      await d.prepare("UPDATE quick_notes SET tags_json=?, tag_ids_json=? WHERE id=?").run(JSON.stringify(names), JSON.stringify(content.tagIds), id);
      await updateSearchTags(d, id, names, String(row.content_hash));
    } catch { /* 单条失败不影响管理动作 */ }
  }
}

export async function updateQuickNoteTag(
  d: MobileDb,
  id: string,
  patch: { name?: string; pinned?: boolean; sortOrder?: number },
): Promise<QuickNoteTag> {
  const row = await d.prepare("SELECT * FROM quick_note_tags WHERE id=? AND deleted_at IS NULL").get(id) as QuickNoteTagRow | undefined;
  if (!row) throw new Error("标签不存在或已删除");
  const now = new Date().toISOString();
  let name = String(row.name);
  if (patch.name !== undefined) {
    name = normalizeQuickNoteTag(patch.name);
    if (name !== row.name) {
      const clash = await d.prepare("SELECT id FROM quick_note_tags WHERE name=? AND deleted_at IS NULL AND id<>?").get(name, id) as { id: string } | undefined;
      if (clash) throw new Error(`已存在同名标签“${name}”，请改用合并`);
    }
  }
  const sortOrder = patch.sortOrder ?? Number(row.sort_order);
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) throw new Error("标签排序值无效");
  const next: QuickNoteTag = {
    id,
    name,
    sortOrder,
    pinned: patch.pinned ?? !!row.pinned,
    createdAt: String(row.created_at),
    updatedAt: now,
    deletedAt: null,
  };
  await upsertQuickNoteTagRow(d, next);
  if (name !== row.name) await refreshQuickNoteTagProjections(d);
  return next;
}

export async function reorderQuickNoteTags(d: MobileDb, orderedIds: readonly string[]): Promise<QuickNoteTag[]> {
  const now = new Date().toISOString();
  await d.transaction(async () => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await d.prepare("UPDATE quick_note_tags SET sort_order=?, updated_at=? WHERE id=? AND deleted_at IS NULL").run(index, now, orderedIds[index]);
    }
  });
  return listQuickNoteTags(d);
}

/** 删除标签：只从所有小记移除引用，不删小记。 */
export async function deleteQuickNoteTag(d: MobileDb, id: string): Promise<{ updated: number; failed: number }> {
  const row = await d.prepare("SELECT * FROM quick_note_tags WHERE id=? AND deleted_at IS NULL").get(id) as QuickNoteTagRow | undefined;
  if (!row) throw new Error("标签不存在或已删除");
  const result = await rewriteQuickNoteTagIds(d, (tagIds) => tagIds.filter((tagId) => tagId !== id));
  const now = new Date().toISOString();
  await upsertQuickNoteTagRow(d, { ...mapQuickNoteTagRow(row), updatedAt: now, deletedAt: now });
  return result;
}

/** 合并到目标标签：源 ID 替换为目标 ID，源写墓碑。 */
export async function mergeQuickNoteTags(d: MobileDb, sourceId: string, targetId: string): Promise<{ updated: number; failed: number }> {
  if (sourceId === targetId) return { updated: 0, failed: 0 };
  const source = await d.prepare("SELECT * FROM quick_note_tags WHERE id=? AND deleted_at IS NULL").get(sourceId) as QuickNoteTagRow | undefined;
  const target = await d.prepare("SELECT * FROM quick_note_tags WHERE id=? AND deleted_at IS NULL").get(targetId) as QuickNoteTagRow | undefined;
  if (!source || !target) throw new Error("标签不存在或已删除");
  const result = await rewriteQuickNoteTagIds(d, (tagIds) => {
    if (!tagIds.includes(sourceId)) return tagIds;
    const next: string[] = [];
    for (const tagId of tagIds) {
      const value = tagId === sourceId ? targetId : tagId;
      if (!next.includes(value)) next.push(value);
    }
    return next;
  });
  const now = new Date().toISOString();
  await upsertQuickNoteTagRow(d, { ...mapQuickNoteTagRow(source), updatedAt: now, deletedAt: now });
  return result;
}

/** 同步端口：合并远端标签目录（LWW + 墓碑），返回本端权威列表。 */
export async function applyRemoteQuickNoteTags(d: MobileDb, remote: readonly QuickNoteTag[]): Promise<QuickNoteTag[]> {
  const merged = mergeTagDirectories(await listQuickNoteTags(d, { includeDeleted: true }), remote);
  for (const tag of merged) await upsertQuickNoteTagRow(d, tag);
  const deletedIds = new Set(merged.filter((tag) => tag.deletedAt).map((tag) => tag.id));
  if (deletedIds.size > 0) {
    await rewriteQuickNoteTagIds(d, (tagIds) => tagIds.filter((id) => !deletedIds.has(id)));
  }
  await refreshQuickNoteTagProjections(d);
  return merged;
}

/**
 * 一次性迁移：v2 `tags`（名称）→ v3 `tagIds`；标签目录补行。
 * 失败的行保持原样并下次再试（只有全部成功才写 device_state 标记）。
 */
export async function migrateQuickNotesV3(d: MobileDb): Promise<void> {
  const done = await d.prepare("SELECT value FROM device_state WHERE key='quick_note_content_v3'").get() as { value?: string } | undefined;
  if (done?.value === "1") return;
  const rows = await d.prepare("SELECT id FROM quick_notes").all() as Array<{ id: string }>;
  let failed = 0;
  for (const row of rows) {
    const id = String(row.id);
    try {
      const raw = await readQuickNoteBody(id);
      if (raw == null) continue;
      const parsed = JSON.parse(raw) as unknown;
      const legacy = migrateLegacyQuickNoteContent(parsed);
      if (!legacy) {
        // 已是 v3：仍要把 tag_ids_json 补进列表投影（schema v5 新增列默认 '[]'）。
        const content = validateQuickNoteContent(parsed);
        const names = (await resolveQuickNoteTagNames(d, content.tagIds)).filter(Boolean);
        await d.prepare("UPDATE quick_notes SET tags_json=?, tag_ids_json=? WHERE id=?").run(JSON.stringify(names), JSON.stringify(content.tagIds), id);
        continue;
      }
      for (const name of legacy.tagNames) await ensureQuickNoteTag(d, name);
      const serialized = serializeQuickNoteContent(legacy.content);
      const contentHash = sha256Sync(new TextEncoder().encode(serialized));
      const names = (await resolveQuickNoteTagNames(d, legacy.content.tagIds)).filter(Boolean);
      await writeQuickNoteBody(id, serialized);
      await d.prepare("UPDATE quick_notes SET content_hash=?, sync_state='local', tags_json=?, tag_ids_json=? WHERE id=?").run(contentHash, JSON.stringify(names), JSON.stringify(legacy.content.tagIds), id);
    } catch {
      failed += 1;
    }
  }
  if (failed === 0) {
    await d.prepare("INSERT INTO device_state(key,value) VALUES('quick_note_content_v3','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  }
}


/** 小记写入唯一核心：正文文件先落盘，DB 事务 upsert + 清墓碑；DB 失败恢复正文。 */
async function persistQuickNoteContent(
  d: MobileDb,
  id: string,
  draft: { text: string; body: string; images: StoredQuickNoteImage[]; tagIds?: readonly string[] },
  previous: { raw: string | null; parsed: StoredQuickNoteContent | null },
): Promise<void> {
  const now = new Date().toISOString();
  const tagIds = draft.tagIds ?? previous.parsed?.tagIds ?? [];
  await assertQuickNoteTagIdsExist(d, tagIds);
  const content = normalizeQuickNoteContent(draft.text, draft.body, draft.images, tagIds);
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(content.text, content.images.length);
  const names = (await resolveQuickNoteTagNames(d, content.tagIds)).filter(Boolean);
  const previousRow = await d.prepare("SELECT updated_at FROM quick_notes WHERE id=?").get(id) as { updated_at: string } | undefined;
  const effectiveUpdatedAt = previous.parsed && previousRow && sameQuickNoteExceptTags(previous.parsed, content)
    ? previousRow.updated_at
    : now;
  await writeQuickNoteBody(id, serialized);
  try {
    await d.transaction(async () => {
      await d.prepare(
        `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, sync_state, is_conflict, restore_pending_at, ready_to_sync, tags_json, tag_ids_json, first_image, list_metadata_version)
         VALUES (?,?,?,?,?,?,'local',0,NULL,1,?,?,?,1)
         ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1, tags_json=excluded.tags_json, tag_ids_json=excluded.tag_ids_json, first_image=excluded.first_image, list_metadata_version=1`
      ).run(id, now, effectiveUpdatedAt, preview, content.images.length, contentHash, JSON.stringify(names), JSON.stringify(content.tagIds), content.images[0]?.filename ?? null);
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
  tagIds?: readonly string[],
): Promise<string> {
  // 正文（body）口径：移动端只有纯文本编辑器，合成 body 会把桌面端排版的富内容（标题/列表/引用/表格/卡片）
  // 压成纯段落。所以 —— 若**纯文本没变**（用户只是打开又保存、或只调整了图片顺序），沿用原有 body，不压平。
  const previous = await readQuickNoteWriteBase(id);
  let preservedBody = "";
  if (previous.parsed && previous.parsed.text === text && typeof previous.parsed.body === "string" && previous.parsed.body) preservedBody = previous.parsed.body;
  const body = preservedBody || quickNoteBodyFromTextAndImages(text, images, (filename) => `http://127.0.0.1:19876/quick-notes/${id}/${filename}`, () => crypto.randomUUID());
  await persistQuickNoteContent(d, id, { text, body, images, tagIds }, previous);
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
  tagIds?: readonly string[],
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
  await persistQuickNoteContent(d, id, { text, body, images, tagIds }, previous);
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
  payload: { text: string; body: string; images: StoredQuickNoteImage[]; tags?: readonly string[] },
): Promise<string> {
  const previous = await readQuickNoteWriteBase(id);
  await persistQuickNoteContent(d, id, payload, previous);
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
