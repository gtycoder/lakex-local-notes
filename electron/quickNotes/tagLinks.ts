/**
 * 小记**标签关系**（与标签目录子系统的桥）—— 261112 从 electron/quickNotes.ts 拆出。
 *
 * 边界：本模块只做「关系 + 目录落库 + 关系版本」，不碰正文/资源；
 * 写完关系后负责把受影响小记的搜索索引刷新（FTS 里的标签词跟着变）。
 * 依赖方向：tags/links/tagService（下层）+ search（旁路）；save/trash 不经过这里，也不被这里调用。
 */
import { AppError } from "../../src/core/storeErrors.js";
import type { DbLike } from "../dbLike.js";
import type { QuickNoteTag } from "../../src/core/quickNoteTags.js";
import type { QuickNoteTagsStore } from "../quickNoteTagsStore.js";
import type { QuickNoteTagLinksStore } from "../quickNoteTagLinksStore.js";
import type { QuickNoteTagService } from "../quickNoteTagService.js";
import {
  reindexQuickNoteSearchForNoteIds,
  reindexQuickNoteSearchTags,
  reindexQuickNoteSearchTagsForTags,
  type QuickNoteSearchDeps,
} from "./searchIndex.js";

export interface QuickNoteTagLinkDeps {
  readonly db: DbLike;
  readonly tags: QuickNoteTagsStore;
  readonly links: QuickNoteTagLinksStore;
  readonly tagService: QuickNoteTagService;
  readonly search: QuickNoteSearchDeps;
}

/** 关联 API（薄封装）：逻辑在标签子系统/关联 store，小记侧只负责刷新自己的搜索索引。 */
export function listQuickNoteTagIds(deps: QuickNoteTagLinkDeps, noteId: string): string[] {
  return deps.links.listFor(noteId);
}

/** 设置一条小记的标签关系（独立 API，不属于保存正文）。 */
export function setQuickNoteTags(deps: QuickNoteTagLinkDeps, noteId: string, tagIds: readonly string[]): string[] {
  readRowForTags(deps, noteId);
  const next = deps.tagService.setNoteTags(noteId, tagIds);
  reindexQuickNoteSearchTags(deps.search, noteId);
  return next;
}

/** 同步端口：远端关系 LWW。返回是否采纳。 */
export function applyRemoteQuickNoteTagLinks(deps: QuickNoteTagLinkDeps, noteId: string, tagIds: readonly string[], tagsUpdatedAt: string): boolean {
  const changed = deps.tagService.applyRemoteLinks(noteId, tagIds, tagsUpdatedAt);
  if (changed) reindexQuickNoteSearchTags(deps.search, noteId);
  return changed;
}

/**
 * 目录落库（同步端口，261105「删除 = 缺席」）——**单事务**：
 *  - upsert 给定 active 行（name/createdAt/updatedAt；**不碰本机 sort_order**，新行追加末尾）；
 *  - `removedIds` = 本轮判定删除（他端已删 / 本机待删）的标签：物理删目录行 + 清关联/关系版本，
 *    不存在的 id = no-op（幂等）。删除压编辑：远端重发也不复活（抑制集合由 core 的 pendingTagDeletes 给）。
 * 关联删掉前先收集受影响小记，事务后重刷它们的搜索索引（否则 FTS 里残留旧标签词）。
 */
export function mergeQuickTags(deps: QuickNoteTagLinkDeps, tags: readonly QuickNoteTag[], removedIds: readonly string[] = []): void {
  const removed = [...new Set(removedIds)];
  const before = deps.tags.nameById();
  const notesLosingTag = deps.links.listNoteIdsForTags(removed);
  const tx = deps.db.transaction(() => {
    // 远端新标签追加到本机末尾；已有行只更新 name/createdAt/updatedAt，不动本机 sort_order。
    let sortOrder = deps.tags.nextSortOrder();
    for (const tag of tags) {
      if (deps.tags.upsert(tag, sortOrder)) sortOrder += 1;
    }
    for (const id of removed) {
      deps.links.clearTag(id);
      deps.tags.deleteIfExists(id);
    }
  });
  tx();
  const changed = tags.filter((tag) => before.get(tag.id) !== tag.name).map((tag) => tag.id);
  if (changed.length > 0) reindexQuickNoteSearchTagsForTags(deps.search, changed);
  if (notesLosingTag.length > 0) reindexQuickNoteSearchForNoteIds(deps.search, notesLosingTag);
}

/** 关系已被删（删除标签/合并源标签）后用：按小记 id 重刷索引里的标签词（不能靠 tag_links 反查）。 */
export function reindexSearchForNoteIds(deps: QuickNoteTagLinkDeps, noteIds: readonly string[]): void {
  reindexQuickNoteSearchForNoteIds(deps.search, noteIds);
}

function readRowForTags(deps: QuickNoteTagLinkDeps, noteId: string): void {
  const exists = deps.db.prepare("SELECT 1 FROM quick_notes WHERE id=?").get(noteId);
  if (!exists) throw new AppError("NotFound", "小记不存在");
}
