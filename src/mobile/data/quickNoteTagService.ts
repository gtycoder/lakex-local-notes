/**
 * 移动端标签 ↔ 小记的唯一协调层：只有这里同时接触标签目录与关联表。
 * 删除/合并/同步在此编排；其它模块互不认识对方的表。
 */
import { normalizeQuickNoteTagIds, sameQuickNoteTagDirectory, type QuickNoteTag } from "../../core/quickNoteTags.js";
import type { MobileDb } from "./sqliteDb.js";
import {
  assertQuickNoteTagsExist,
  createQuickNoteTag,
  listQuickNoteTags,
  mergeRemoteQuickNoteTags,
  reorderQuickNoteTags,
  tombstoneQuickNoteTag,
  updateQuickNoteTag,
} from "./quickNoteTagsRepository.js";
import {
  applyRemoteQuickNoteTagLinks,
  listAllQuickNoteTagIds,
  listQuickNoteTagIds,
  quickNoteTagsUpdatedAt,
  removeQuickNoteTagLinksInTransaction,
  replaceQuickNoteTagLinksInTransaction,
  setQuickNoteTags as setQuickNoteTagLinks,
} from "./quickNoteTagLinksRepository.js";
import { indexQuickNote } from "./quickNotesSearch.js";

async function reindexAll(d: MobileDb): Promise<void> {
  const rows = await d.prepare("SELECT id FROM quick_notes WHERE deleted_at IS NULL").all() as Array<{ id: string }>;
  for (const row of rows) await indexQuickNote(d, String(row.id), true);
}

export const mobileQuickNoteTags = {
  list: (d: MobileDb, options: { includeDeleted?: boolean } = {}) => listQuickNoteTags(d, options),
  create: (d: MobileDb, name: string) => createQuickNoteTag(d, name),
  update: async (d: MobileDb, id: string, patch: { name?: string; pinned?: boolean; sortOrder?: number }) => {
    const before = (await listQuickNoteTags(d)).find((tag) => tag.id === id)?.name;
    const tag = await updateQuickNoteTag(d, id, patch);
    if (before !== undefined && before !== tag.name) await reindexAll(d);
    return tag;
  },
  reorder: (d: MobileDb, ids: readonly string[]) => reorderQuickNoteTags(d, ids),
  delete: async (d: MobileDb, id: string) => {
    let updated = 0;
    // 事务内只能调用 *InTransaction 版本：SQLite 不支持嵌套 BEGIN。
    await d.transaction(async () => {
      await tombstoneQuickNoteTag(d, id);
      updated = await removeQuickNoteTagLinksInTransaction(d, id);
    });
    await reindexAll(d);
    return { updated, failed: 0 };
  },
  merge: async (d: MobileDb, sourceId: string, targetId: string) => {
    if (sourceId === targetId) return { updated: 0, failed: 0 };
    // 目标必须存在且未被删除（源标签在 tombstone 时会自行校验）。
    await assertQuickNoteTagsExist(d, [targetId]);
    let updated = 0;
    await d.transaction(async () => {
      updated = await replaceQuickNoteTagLinksInTransaction(d, sourceId, targetId);
      await tombstoneQuickNoteTag(d, sourceId);
    });
    await reindexAll(d);
    return { updated, failed: 0 };
  },
  applyRemote: async (d: MobileDb, remote: readonly QuickNoteTag[]) => {
    const before = await listQuickNoteTags(d, { includeDeleted: true });
    // 远端没有目录：只返回本端权威目录（不做全量重建；否则每轮同步都会重刷所有小记索引）。
    if (remote.length === 0) return before;
    let merged: QuickNoteTag[] = [];
    let linksRemoved = 0;
    await d.transaction(async () => {
      merged = await mergeRemoteQuickNoteTags(d, remote);
      for (const tag of merged) {
        if (tag.deletedAt) linksRemoved += await removeQuickNoteTagLinksInTransaction(d, tag.id);
      }
    });
    if (linksRemoved > 0 || !sameQuickNoteTagDirectory(before, merged)) await reindexAll(d);
    return merged;
  },
  tagIds: (d: MobileDb, noteId: string) => listQuickNoteTagIds(d, noteId),
  allTagIds: (d: MobileDb) => listAllQuickNoteTagIds(d),
  tagsUpdatedAt: (d: MobileDb, noteId: string) => quickNoteTagsUpdatedAt(d, noteId),
  setNoteTags: async (d: MobileDb, noteId: string, rawTagIds: readonly string[]) => {
    // 标签存在性校验放在协调层：关系仓储不认识目录仓储（只接收已校验的 ID）。
    const tagIds = normalizeQuickNoteTagIds(rawTagIds);
    await assertQuickNoteTagsExist(d, tagIds);
    const next = await setQuickNoteTagLinks(d, noteId, tagIds);
    // 关系独立于正文：标签变了要单独强刷这条小记的搜索索引（否则按新标签搜不到）。
    await indexQuickNote(d, noteId, true);
    return next;
  },
  applyRemoteLinks: async (d: MobileDb, noteId: string, tagIds: readonly string[], updatedAt: string) => {
    // 删除标签 = 关系不应复活；墓碑集合由目录侧（协调层）提供，关系仓储仍不认识目录表。
    const deleted = new Set((await listQuickNoteTags(d, { includeDeleted: true })).filter((tag) => tag.deletedAt).map((tag) => tag.id));
    const changed = await applyRemoteQuickNoteTagLinks(d, noteId, tagIds, updatedAt, deleted);
    if (changed) await indexQuickNote(d, noteId, true);
    return changed;
  },
};
