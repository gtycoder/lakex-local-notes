/**
 * 移动端标签 ↔ 小记的唯一协调层：只有这里同时接触标签目录与关联表。
 * 删除/合并/同步在此编排；其它模块互不认识对方的表。
 *
 * 261105：标签名/关系变化后**只重刷受影响小记的搜索索引**（`quick_notes_search_index.tags` 是派生列）；
 * 旧实现 `reindexAll` 每次改名/删除/合并都把全部小记逐条重建（目标量级 2 万），属过度重建。
 */
import { normalizeQuickNoteTagIds } from "../../core/quickNoteTags.js";
import type { MobileDb } from "./sqliteDb.js";
import {
  addPendingTagDeletes,
  assertQuickNoteTagsExist,
  createQuickNoteTag,
  deleteQuickNoteTag,
  listQuickNoteTags,
  reorderQuickNoteTags,
  updateQuickNoteTag,
} from "./quickNoteTagsRepository.js";
import {
  listAllQuickNoteTagIds,
  listQuickNoteIdsForTags,
  listQuickNoteTagIds,
  quickNoteTagsUpdatedAt,
  removeQuickNoteTagLinksInTransaction,
  replaceQuickNoteTagLinksInTransaction,
  setQuickNoteTags as setQuickNoteTagLinks,
} from "./quickNoteTagLinksRepository.js";
import { indexQuickNote } from "./quickNotesSearch.js";

/** 按小记 id 重刷搜索索引（标签名 / 关系变化的派生列）。 */
export async function reindexQuickNotesByIds(d: MobileDb, noteIds: readonly string[]): Promise<void> {
  for (const noteId of noteIds) await indexQuickNote(d, noteId, true);
}

/** 标签目录变化后：只重刷「关联到这些标签的小记」。新标签/无关联标签 ⇒ 零工作。 */
export async function reindexQuickNotesForTags(d: MobileDb, tagIds: readonly string[]): Promise<void> {
  await reindexQuickNotesByIds(d, await listQuickNoteIdsForTags(d, tagIds));
}

export const mobileQuickNoteTags = {
  list: (d: MobileDb) => listQuickNoteTags(d),
  create: (d: MobileDb, name: string) => createQuickNoteTag(d, name),
  update: async (d: MobileDb, id: string, patch: { name?: string }) => {
    const before = (await listQuickNoteTags(d)).find((tag) => tag.id === id)?.name;
    const affected = await listQuickNoteIdsForTags(d, [id]);
    const tag = await updateQuickNoteTag(d, id, patch);
    if (before !== undefined && before !== tag.name) await reindexQuickNotesByIds(d, affected);
    return tag;
  },
  reorder: (d: MobileDb, ids: readonly string[]) => reorderQuickNoteTags(d, ids),
  /** 删除 = 缺席：物理删行 + 清关联/版本 + 记本机待删（抑制远端重发）。 */
  delete: async (d: MobileDb, id: string) => {
    const affected = await listQuickNoteIdsForTags(d, [id]);
    await assertQuickNoteTagsExist(d, [id]);
    let updated = 0;
    // 事务内只能调用 *InTransaction 版本：SQLite 不支持嵌套 BEGIN。
    await d.transaction(async () => {
      updated = await removeQuickNoteTagLinksInTransaction(d, id);
      await deleteQuickNoteTag(d, id);
      await addPendingTagDeletes(d, [id]);
    });
    await reindexQuickNotesByIds(d, affected);
    return { updated, failed: 0 };
  },
  /** 合并 = 源标签**物理消失**（删除 = 缺席）：关联改指向目标，源 id 进本机待删。 */
  merge: async (d: MobileDb, sourceId: string, targetId: string) => {
    if (sourceId === targetId) return { updated: 0, failed: 0 };
    // 目标必须存在且未被删除（源标签由本事务删除，先校验存在性）。
    await assertQuickNoteTagsExist(d, [targetId, sourceId]);
    const affected = await listQuickNoteIdsForTags(d, [sourceId]);
    let updated = 0;
    await d.transaction(async () => {
      updated = await replaceQuickNoteTagLinksInTransaction(d, sourceId, targetId);
      await deleteQuickNoteTag(d, sourceId);
      await addPendingTagDeletes(d, [sourceId]);
    });
    await reindexQuickNotesByIds(d, affected);
    return { updated, failed: 0 };
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
};
