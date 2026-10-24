/**
 * 移动端小记 ↔ 标签关联表：关系是唯一事实，小记正文不含标签。
 * 只写 `quick_note_tag_links` 与 `quick_notes.tags_updated_at`。
 */
import { normalizeQuickNoteTagIds } from "../../core/quickNoteTags.js";
import { assertQuickNoteTagsExist } from "./quickNoteTagsRepository.js";
import type { MobileDb } from "./sqliteDb.js";

type LinkRow = { note_id: string; tag_id: string };

export async function listQuickNoteTagIds(d: MobileDb, noteId: string): Promise<string[]> {
  const rows = await d.prepare("SELECT tag_id FROM quick_note_tag_links WHERE note_id=? ORDER BY position, tag_id").all(noteId) as Array<{ tag_id: string }>;
  return rows.map((row) => String(row.tag_id));
}

export async function listAllQuickNoteTagIds(d: MobileDb): Promise<Map<string, string[]>> {
  const rows = await d.prepare("SELECT note_id, tag_id FROM quick_note_tag_links ORDER BY note_id, position, tag_id").all() as LinkRow[];
  const byNote = new Map<string, string[]>();
  for (const row of rows) {
    const noteId = String(row.note_id);
    const list = byNote.get(noteId);
    if (list) list.push(String(row.tag_id));
    else byNote.set(noteId, [String(row.tag_id)]);
  }
  return byNote;
}

export async function quickNoteTagCounts(d: MobileDb): Promise<Map<string, number>> {
  const rows = await d.prepare("SELECT tag_id, COUNT(*) AS count FROM quick_note_tag_links GROUP BY tag_id").all() as Array<{ tag_id: string; count: number }>;
  return new Map(rows.map((row) => [String(row.tag_id), Number(row.count)] as const));
}

export async function quickNoteTagsUpdatedAt(d: MobileDb, noteId: string): Promise<string> {
  const row = await d.prepare("SELECT tags_updated_at FROM quick_notes WHERE id=?").get(noteId) as { tags_updated_at?: string } | undefined;
  return row?.tags_updated_at ?? "";
}

/** 一次性读出全部关系版本（同步列表用，避免逐条 N+1）。 */
export async function listAllQuickNoteTagsUpdatedAt(d: MobileDb): Promise<Map<string, string>> {
  const rows = await d.prepare("SELECT id, tags_updated_at FROM quick_notes WHERE tags_updated_at <> ''").all() as Array<{ id: string; tags_updated_at: string }>;
  return new Map(rows.map((row) => [String(row.id), String(row.tags_updated_at)] as const));
}

/** 已墓碑的标签 ID（关系合并时过滤：删除标签 = 关系不应复活）。 */
async function deletedQuickNoteTagIds(d: MobileDb): Promise<Set<string>> {
  const rows = await d.prepare("SELECT id FROM quick_note_tags WHERE deleted_at IS NOT NULL").all() as Array<{ id: string }>;
  return new Set(rows.map((row) => String(row.id)));
}

export async function setQuickNoteTags(d: MobileDb, noteId: string, rawTagIds: readonly string[], at = new Date().toISOString()): Promise<string[]> {
  const tagIds = normalizeQuickNoteTagIds(rawTagIds);
  await assertQuickNoteTagsExist(d, tagIds);
  const exists = await d.prepare("SELECT 1 FROM quick_notes WHERE id=?").get(noteId);
  if (!exists) throw new Error("小记不存在");
  await d.transaction(async () => {
    await d.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?").run(noteId);
    for (let index = 0; index < tagIds.length; index += 1) {
      await d.prepare("INSERT INTO quick_note_tag_links(note_id, tag_id, position) VALUES(?,?,?)").run(noteId, tagIds[index], index);
    }
    await d.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?").run(at, noteId);
  });
  return tagIds;
}

/** 事务内版本：调用方已持有事务（SQLite 不支持嵌套 BEGIN）。返回受影响小记数。 */
export async function removeQuickNoteTagLinksInTransaction(d: MobileDb, tagId: string, at = new Date().toISOString()): Promise<number> {
  const noteIds = (await d.prepare("SELECT DISTINCT note_id FROM quick_note_tag_links WHERE tag_id=?").all(tagId) as Array<{ note_id: string }>).map((row) => String(row.note_id));
  if (noteIds.length === 0) return 0;
  await d.prepare("DELETE FROM quick_note_tag_links WHERE tag_id=?").run(tagId);
  for (const noteId of noteIds) await d.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?").run(at, noteId);
  return noteIds.length;
}

/** 事务内版本：合并时源标签关联改指向目标（保留位置、去重）。 */
export async function replaceQuickNoteTagLinksInTransaction(d: MobileDb, sourceId: string, targetId: string, at = new Date().toISOString()): Promise<number> {
  const noteIds = (await d.prepare("SELECT DISTINCT note_id FROM quick_note_tag_links WHERE tag_id=?").all(sourceId) as Array<{ note_id: string }>).map((row) => String(row.note_id));
  if (noteIds.length === 0) return 0;
  for (const noteId of noteIds) {
    const current = await listQuickNoteTagIds(d, noteId);
    const next: string[] = [];
    for (const tagId of current) {
      const value = tagId === sourceId ? targetId : tagId;
      if (!next.includes(value)) next.push(value);
    }
    await d.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?").run(noteId);
    for (let index = 0; index < next.length; index += 1) {
      await d.prepare("INSERT INTO quick_note_tag_links(note_id, tag_id, position) VALUES(?,?,?)").run(noteId, next[index], index);
    }
    await d.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?").run(at, noteId);
  }
  return noteIds.length;
}

/** 远端关系 LWW：远端版本更新才覆盖；已墓碑的标签不写入。 */
export async function applyRemoteQuickNoteTagLinks(d: MobileDb, noteId: string, rawTagIds: readonly string[], remoteUpdatedAt: string): Promise<boolean> {
  if (!remoteUpdatedAt || remoteUpdatedAt <= await quickNoteTagsUpdatedAt(d, noteId)) return false;
  const deleted = await deletedQuickNoteTagIds(d);
  const tagIds = normalizeQuickNoteTagIds(rawTagIds).filter((tagId) => !deleted.has(tagId));
  await d.transaction(async () => {
    await d.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?").run(noteId);
    for (let index = 0; index < tagIds.length; index += 1) {
      await d.prepare("INSERT INTO quick_note_tag_links(note_id, tag_id, position) VALUES(?,?,?)").run(noteId, tagIds[index], index);
    }
    await d.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?").run(remoteUpdatedAt, noteId);
  });
  return true;
}

export async function removeQuickNoteLinks(d: MobileDb, noteId: string): Promise<void> {
  await d.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?").run(noteId);
}
