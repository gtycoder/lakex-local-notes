/**
 * 移动端标签 ↔ 目标关联表：关系是唯一事实，正文/索引不存标签名。
 * 表：tag_links(target_kind,target_id,tag_id,position) + tag_link_versions(每目标关系版本)。
 */
import { normalizeQuickNoteTagIds } from "../../core/quickNoteTags.js";
import type { MobileDb } from "./sqliteDb.js";

const KIND = "quickNote";

function q(d: MobileDb, sql: string) { return d.prepare(sql); }

export async function listQuickNoteTagIds(d: MobileDb, noteId: string): Promise<string[]> {
  const rows = await q(d, "SELECT tag_id FROM tag_links WHERE target_kind=? AND target_id=? ORDER BY position, tag_id").all(KIND, noteId) as Array<{ tag_id: string }>;
  return rows.map((row) => String(row.tag_id));
}

export async function listAllQuickNoteTagIds(d: MobileDb): Promise<Map<string, string[]>> {
  const rows = await q(d, "SELECT target_id, tag_id FROM tag_links WHERE target_kind=? ORDER BY target_id, position, tag_id").all(KIND) as Array<{ target_id: string; tag_id: string }>;
  const byNote = new Map<string, string[]>();
  for (const row of rows) {
    const noteId = String(row.target_id);
    const list = byNote.get(noteId);
    if (list) list.push(String(row.tag_id));
    else byNote.set(noteId, [String(row.tag_id)]);
  }
  return byNote;
}

export async function quickNoteTagsUpdatedAt(d: MobileDb, noteId: string): Promise<string> {
  const row = await q(d, "SELECT links_updated_at FROM tag_link_versions WHERE target_kind=? AND target_id=?").get(KIND, noteId) as { links_updated_at?: string } | undefined;
  return row?.links_updated_at ?? "";
}

/** 一次性读出全部关系版本（同步列表用，避免逐条 N+1）。 */
export async function listAllQuickNoteTagsUpdatedAt(d: MobileDb): Promise<Map<string, string>> {
  const rows = await q(d, "SELECT target_id, links_updated_at FROM tag_link_versions WHERE target_kind=? AND links_updated_at <> ''").all(KIND) as Array<{ target_id: string; links_updated_at: string }>;
  return new Map(rows.map((row) => [String(row.target_id), String(row.links_updated_at)] as const));
}

async function writeLinks(d: MobileDb, noteId: string, tagIds: readonly string[]): Promise<void> {
  await d.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=?").run(KIND, noteId);
  for (let index = 0; index < tagIds.length; index += 1) {
    await d.prepare("INSERT OR IGNORE INTO tag_links(target_kind,target_id,tag_id,position) VALUES(?,?,?,?)").run(KIND, noteId, tagIds[index], index);
  }
}

async function upsertVersion(d: MobileDb, noteId: string, at: string): Promise<void> {
  await d.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES(?,?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(KIND, noteId, at);
}

export async function setQuickNoteTags(d: MobileDb, noteId: string, rawTagIds: readonly string[], at = new Date().toISOString()): Promise<string[]> {
  const tagIds = normalizeQuickNoteTagIds(rawTagIds);
  const exists = await q(d, "SELECT 1 FROM quick_notes WHERE id=?").get(noteId);
  if (!exists) throw new Error("小记不存在");
  await d.transaction(async () => {
    await writeLinks(d, noteId, tagIds);
    await upsertVersion(d, noteId, at);
  });
  return tagIds;
}

/** 事务内版本：调用方已持有事务（SQLite 不支持嵌套 BEGIN）。返回受影响小记数。 */
export async function removeQuickNoteTagLinksInTransaction(d: MobileDb, tagId: string, at = new Date().toISOString()): Promise<number> {
  const rows = await q(d, "SELECT target_kind,target_id FROM tag_links WHERE tag_id=?").all(tagId) as Array<{ target_kind: string; target_id: string }>;
  if (rows.length === 0) return 0;
  const noteIds = rows.filter((row) => row.target_kind === KIND).map((row) => String(row.target_id));
  await d.prepare("DELETE FROM tag_links WHERE tag_id=?").run(tagId);
  for (const noteId of noteIds) await upsertVersion(d, noteId, at);
  return noteIds.length;
}

/** 事务内版本：合并时源标签关联改指向目标（保留位置、去重）。 */
export async function replaceQuickNoteTagLinksInTransaction(d: MobileDb, sourceId: string, targetId: string, at = new Date().toISOString()): Promise<number> {
  const rows = await q(d, "SELECT target_kind,target_id FROM tag_links WHERE tag_id=?").all(sourceId) as Array<{ target_kind: string; target_id: string }>;
  if (rows.length === 0) return 0;
  const noteIds = rows.filter((row) => row.target_kind === KIND).map((row) => String(row.target_id));
  for (const noteId of noteIds) {
    const current = await listQuickNoteTagIds(d, noteId);
    const next: string[] = [];
    for (const tagId of current) {
      const value = tagId === sourceId ? targetId : tagId;
      if (!next.includes(value)) next.push(value);
    }
    await writeLinks(d, noteId, next);
    await upsertVersion(d, noteId, at);
  }
  await d.prepare("DELETE FROM tag_links WHERE tag_id=? AND target_kind<>?").run(sourceId, KIND);
  return noteIds.length;
}

/** 远端关系 LWW：远端版本更新才覆盖；deletedTagIds 由协调层传入（已墓碑的标签不写入）。 */
export async function applyRemoteQuickNoteTagLinks(d: MobileDb, noteId: string, rawTagIds: readonly string[], remoteUpdatedAt: string, deletedTagIds: ReadonlySet<string>): Promise<boolean> {
  if (!remoteUpdatedAt || remoteUpdatedAt <= await quickNoteTagsUpdatedAt(d, noteId)) return false;
  const tagIds = normalizeQuickNoteTagIds(rawTagIds).filter((tagId) => !deletedTagIds.has(tagId));
  await d.transaction(async () => {
    await writeLinks(d, noteId, tagIds);
    await upsertVersion(d, noteId, remoteUpdatedAt);
  });
  return true;
}

export async function removeQuickNoteLinks(d: MobileDb, noteId: string): Promise<void> {
  await d.transaction(async () => {
    await d.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=?").run(KIND, noteId);
    await d.prepare("DELETE FROM tag_link_versions WHERE target_kind=? AND target_id=?").run(KIND, noteId);
  });
}

/** 恢复/复制后把关系版本推进到指定时间。 */
export async function setQuickNoteTagVersion(d: MobileDb, noteId: string, at: string): Promise<void> {
  await upsertVersion(d, noteId, at);
}
