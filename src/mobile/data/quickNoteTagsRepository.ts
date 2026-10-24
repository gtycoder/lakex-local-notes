/**
 * 移动端标签目录子系统：只拥有 `quick_note_tags`，不认识小记、不读正文。
 * 关系在 `quickNoteTagLinksRepository`；两者只在 `quickNoteTagService` 里组合。
 */
import { mergeQuickNoteTags, normalizeQuickNoteTag, quickNoteTagId, type QuickNoteTag } from "../../core/quickNoteTags.js";
import type { MobileDb } from "./sqliteDb.js";

type QuickNoteTagRow = {
  id: string;
  name: string;
  sort_order: number;
  pinned: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function mapRow(row: QuickNoteTagRow): QuickNoteTag {
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
  return rows.map(mapRow);
}

export async function quickNoteTagNames(d: MobileDb): Promise<Map<string, string>> {
  return new Map((await listQuickNoteTags(d)).map((tag) => [tag.id, tag.name] as const));
}

async function upsert(d: MobileDb, tag: QuickNoteTag): Promise<void> {
  await d.prepare(
    "INSERT INTO quick_note_tags(id,name,sort_order,pinned,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, pinned=excluded.pinned, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at"
  ).run(tag.id, tag.name, tag.sortOrder, tag.pinned ? 1 : 0, tag.createdAt, tag.updatedAt, tag.deletedAt);
}

async function active(d: MobileDb, id: string): Promise<QuickNoteTagRow | null> {
  const row = await d.prepare("SELECT * FROM quick_note_tags WHERE id=? AND deleted_at IS NULL").get(id) as QuickNoteTagRow | undefined;
  return row ?? null;
}

/** 幂等创建：同名 active 直接返回；同名墓碑复活。 */
export async function ensureQuickNoteTag(d: MobileDb, rawName: string, at = new Date().toISOString()): Promise<QuickNoteTag> {
  const name = normalizeQuickNoteTag(rawName);
  const existing = await d.prepare("SELECT * FROM quick_note_tags WHERE name=? AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(name) as QuickNoteTagRow | undefined;
  if (existing) return mapRow(existing);
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
  await upsert(d, tag);
  return tag;
}

export async function createQuickNoteTag(d: MobileDb, name: string): Promise<QuickNoteTag> {
  return ensureQuickNoteTag(d, name);
}

export async function updateQuickNoteTag(
  d: MobileDb,
  id: string,
  patch: { name?: string; pinned?: boolean; sortOrder?: number },
): Promise<QuickNoteTag> {
  const row = await active(d, id);
  if (!row) throw new Error("标签不存在或已删除");
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
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  await upsert(d, next);
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

/** 写墓碑（关联清理由协调层负责）。 */
export async function tombstoneQuickNoteTag(d: MobileDb, id: string, at = new Date().toISOString()): Promise<void> {
  const row = await active(d, id);
  if (!row) throw new Error("标签不存在或已删除");
  await upsert(d, { ...mapRow(row), updatedAt: at, deletedAt: at });
}

/** 目录 LWW 合并：返回合并后的全量目录（含墓碑）。 */
export async function mergeRemoteQuickNoteTags(d: MobileDb, remote: readonly QuickNoteTag[]): Promise<QuickNoteTag[]> {
  const merged = mergeQuickNoteTags(await listQuickNoteTags(d, { includeDeleted: true }), remote);
  for (const tag of merged) await upsert(d, tag);
  return merged;
}

export async function assertQuickNoteTagsExist(d: MobileDb, tagIds: readonly string[]): Promise<void> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const rows = await d.prepare(`SELECT id FROM quick_note_tags WHERE deleted_at IS NULL AND id IN (${unique.map(() => "?").join(",")})`).all(...unique) as Array<{ id: string }>;
  if (rows.length !== unique.length) throw new Error("标签不存在或已删除");
}
