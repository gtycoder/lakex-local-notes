/**
 * 移动端：文档 ↔ 标签关系（主库 notes 的同库关系表；261105 P1）。
 *
 * 定稿：目录单一来源 = quick-notes 库 tags（已随 quick-notes 索引同步）；文档关系只存 id/顺序/版本。
 * 与桌面同名语义：集合 + 关系版本 LWW；**保留本机顺序、远端新增插最前**；应用时过滤目录不存在的 id。
 */
import { normalizeQuickNoteTagIds, shouldSkipEmptyTagDirectoryCleanup } from "../../core/quickNoteTags.js";
import type { MobileDb } from "./sqliteDb.js";

const KIND = "note";

export async function listNoteTagIds(d: MobileDb, noteId: string): Promise<string[]> {
  const rows = await d.prepare("SELECT tag_id FROM tag_links WHERE target_kind=? AND target_id=? ORDER BY position, tag_id").all(KIND, noteId) as Array<{ tag_id: string }>;
  return rows.map((row) => String(row.tag_id));
}

/**
 * 批量读「指定文档」的标签（属性面板/文档列表筛选用；单条 SQL，避免逐篇往返）。
 * 顺序 = tag_links.position 本机视图（与单篇 listNoteTagIds 同口径）。
 * 分批是为了避开 SQLite 变量上限（999）；列表一次可能带几百篇。
 */
export async function listNoteTagIdsForNotes(d: MobileDb, noteIds: readonly string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(noteIds.filter((id) => typeof id === "string" && id.length > 0))];
  const out = new Map<string, string[]>();
  if (unique.length === 0) return out;
  const CHUNK = 400;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const rows = await d.prepare(
      "SELECT target_id, tag_id FROM tag_links WHERE target_kind=? AND target_id IN (" + part.map(() => "?").join(",") + ") ORDER BY target_id, position, tag_id"
    ).all(KIND, ...part) as Array<{ target_id: string; tag_id: string }>;
    for (const row of rows) {
      const noteId = String(row.target_id);
      const list = out.get(noteId);
      if (list) list.push(String(row.tag_id));
      else out.set(noteId, [String(row.tag_id)]);
    }
  }
  return out;
}

/** 全部文档关系（同步清单用，避免 N+1）。 */
export async function listAllNoteTagIds(d: MobileDb): Promise<Map<string, string[]>> {
  const rows = await d.prepare("SELECT target_id, tag_id FROM tag_links WHERE target_kind=? ORDER BY target_id, position, tag_id").all(KIND) as Array<{ target_id: string; tag_id: string }>;
  const byNote = new Map<string, string[]>();
  for (const row of rows) {
    const noteId = String(row.target_id);
    const list = byNote.get(noteId);
    if (list) list.push(String(row.tag_id));
    else byNote.set(noteId, [String(row.tag_id)]);
  }
  return byNote;
}

export async function noteTagsUpdatedAt(d: MobileDb, noteId: string): Promise<string> {
  const row = await d.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind=? AND target_id=?").get(KIND, noteId) as { links_updated_at?: string } | undefined;
  return row?.links_updated_at ? String(row.links_updated_at) : "";
}

export async function listAllNoteTagsUpdatedAt(d: MobileDb): Promise<Map<string, string>> {
  const rows = await d.prepare("SELECT target_id, links_updated_at FROM tag_link_versions WHERE target_kind=? AND links_updated_at <> ''").all(KIND) as Array<{ target_id: string; links_updated_at: string }>;
  return new Map(rows.map((row) => [String(row.target_id), String(row.links_updated_at)] as const));
}

async function writeLinks(d: MobileDb, noteId: string, tagIds: readonly string[]): Promise<void> {
  await d.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=?").run(KIND, noteId);
  if (tagIds.length === 0) return;
  // 一条多值 INSERT（移动端一次桥往返 ≈68ms；逐条写 5 个标签 ≈400ms）。
  const values = tagIds.map(() => "(?,?,?,?)").join(",");
  const params: unknown[] = [];
  tagIds.forEach((tagId, index) => params.push(KIND, noteId, tagId, index));
  await d.prepare("INSERT OR IGNORE INTO tag_links(target_kind,target_id,tag_id,position) VALUES " + values).run(...params);
}

async function upsertVersion(d: MobileDb, noteId: string, at: string): Promise<void> {
  await d.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES(?,?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(KIND, noteId, at);
}

/** 整组替换（用户动作 / 转换继承）；存在性由协调层校验。 */
export async function setNoteTags(d: MobileDb, noteId: string, rawTagIds: readonly string[], at = new Date().toISOString()): Promise<string[]> {
  const tagIds = normalizeQuickNoteTagIds(rawTagIds);
  await d.transaction(async () => {
    await writeLinks(d, noteId, tagIds);
    await upsertVersion(d, noteId, at);
  });
  return tagIds;
}

/**
 * **事务内**整组替换（261106 task-82 批量操作复用）：调用方已持事务（SQLite 不支持嵌套 BEGIN）。
 * 语义与 setNoteTags 完全一致（关系 + 版本一起写），只是不自带事务。
 */
export async function setNoteTagsInTransaction(d: MobileDb, noteId: string, rawTagIds: readonly string[], at = new Date().toISOString()): Promise<string[]> {
  const tagIds = normalizeQuickNoteTagIds(rawTagIds);
  await writeLinks(d, noteId, tagIds);
  await upsertVersion(d, noteId, at);
  return tagIds;
}

/**
 * 远端关系 LWW：版本更新才覆盖；只接受目录里 active 的 id；保留本机顺序、远端新增插最前。
 * 返回是否采纳。**旧索引无字段时调用方不会调用**（state 保留本机关系）。
 */
export async function applyRemoteNoteTags(
  d: MobileDb,
  noteId: string,
  rawTagIds: readonly string[],
  remoteUpdatedAt: string,
): Promise<boolean> {
  if (!remoteUpdatedAt || remoteUpdatedAt <= await noteTagsUpdatedAt(d, noteId)) return false;
  // 目录过滤拆到 cleanupOrphanNoteTagLinks（saveState 末尾、目录合并之后）。
  const tagIds = normalizeQuickNoteTagIds(rawTagIds);
  const local = await listNoteTagIds(d, noteId);
  const remoteSet = new Set(tagIds);
  const added = tagIds.filter((tagId) => !local.includes(tagId));
  const next = [...added, ...local.filter((tagId) => remoteSet.has(tagId))];
  await d.transaction(async () => {
    await writeLinks(d, noteId, next);
    await upsertVersion(d, noteId, remoteUpdatedAt);
  });
  return true;
}

/**
 * 删除标签（**事务内**版本）：清该标签的文档关系并推进受影响文档版本（删除也能传播）。
 * 调用方已持事务（移动端 SQLite 不支持嵌套 BEGIN）；返回受影响文档数。
 */
export async function removeNoteTagLinksInTransaction(d: MobileDb, tagId: string, at = new Date().toISOString()): Promise<number> {
  const targets = await d.prepare("SELECT target_id FROM tag_links WHERE target_kind=? AND tag_id=?").all(KIND, tagId) as Array<{ target_id: string }>;
  if (targets.length === 0) return 0;
  await d.prepare("DELETE FROM tag_links WHERE target_kind=? AND tag_id=?").run(KIND, tagId);
  for (const target of targets) await upsertVersion(d, String(target.target_id), at);
  return targets.length;
}

/** 合并标签（**事务内**版本）：源标签的文档关系改指目标（去重、保留位置）+ 推进版本。 */
export async function mergeNoteTagLinksInTransaction(d: MobileDb, sourceId: string, targetId: string, at = new Date().toISOString()): Promise<number> {
  if (sourceId === targetId) return 0;
  const targets = await d.prepare("SELECT target_id FROM tag_links WHERE target_kind=? AND tag_id=?").all(KIND, sourceId) as Array<{ target_id: string }>;
  if (targets.length === 0) return 0;
  for (const target of targets) {
    const noteId = String(target.target_id);
    const current = await listNoteTagIds(d, noteId);
    const next: string[] = [];
    for (const tagId of current) {
      const value = tagId === sourceId ? targetId : tagId;
      if (!next.includes(value)) next.push(value);
    }
    await writeLinks(d, noteId, next);
    await upsertVersion(d, noteId, at);
  }
  return targets.length;
}

/** 便捷封装（自带事务；非协调层调用方用）。 */
export async function removeNoteTagEverywhere(d: MobileDb, tagId: string, at = new Date().toISOString()): Promise<number> {
  let updated = 0;
  await d.transaction(async () => { updated = await removeNoteTagLinksInTransaction(d, tagId, at); });
  return updated;
}

export async function mergeNoteTagEverywhere(d: MobileDb, sourceId: string, targetId: string, at = new Date().toISOString()): Promise<number> {
  let updated = 0;
  await d.transaction(async () => { updated = await mergeNoteTagLinksInTransaction(d, sourceId, targetId, at); });
  return updated;
}

/** 启动/目录收敛自检：清「关系指向不存在标签」的孤儿行（返回清理行数）。 */
export async function cleanupOrphanNoteTagLinks(d: MobileDb, validTagIds: ReadonlySet<string>, at = new Date().toISOString()): Promise<number> {
  // 空目录保护（P1）：小记库降级时目录可能返回空集合，此时**绝不能**按「孤儿」清空文档标签
  //（那会清掉全部关系并 bump 版本、随同步扩散到所有端）。真正的删除标签走删除/合并路径。
  if (validTagIds.size === 0) {
    const existing = await d.prepare("SELECT COUNT(*) AS c FROM tag_links WHERE target_kind=?").get(KIND) as { c?: number } | undefined;
    if (shouldSkipEmptyTagDirectoryCleanup(0, Number(existing?.c ?? 0))) return 0;
  }
  const rows = await d.prepare("SELECT tag_id, target_id FROM tag_links WHERE target_kind=?").all(KIND) as Array<{ tag_id: string; target_id: string }>;
  const orphans = rows.filter((row) => !validTagIds.has(String(row.tag_id)));
  if (orphans.length === 0) return 0;
  await d.transaction(async () => {
    for (const orphan of orphans) {
      await d.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=? AND tag_id=?").run(KIND, orphan.target_id, orphan.tag_id);
      await upsertVersion(d, String(orphan.target_id), at);
    }
  });
  return orphans.length;
}
