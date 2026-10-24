/**
 * 标签 ↔ 小记的唯一协调层：只有这里同时接触「标签目录」和「关联表」。
 * 标签 store / 关联 store / 小记 store 互不认识对方的表；删除/合并/同步在此编排。
 */
import type { DbLike } from "./dbLike.js";
import { sameQuickNoteTagDirectory, type QuickNoteTag } from "../src/core/quickNoteTags.js";
import type { QuickNoteTagsStore } from "./quickNoteTagsStore.js";
import type { QuickNoteTagLinksStore } from "./quickNoteTagLinksStore.js";

export class QuickNoteTagService {
  constructor(
    private readonly db: DbLike,
    private readonly tags: QuickNoteTagsStore,
    private readonly links: QuickNoteTagLinksStore,
    /** 标签名变化后刷新搜索索引里的标签词（由小记子系统提供，方向是单向回调）。 */
    private readonly onTagNamesChanged: () => void,
  ) {}

  list(options: { includeDeleted?: boolean } = {}): QuickNoteTag[] {
    return this.tags.list(options);
  }

  create(name: string): QuickNoteTag {
    return this.tags.create(name);
  }

  update(id: string, patch: { name?: string; pinned?: boolean; sortOrder?: number }): QuickNoteTag {
    const before = this.tags.list().find((tag) => tag.id === id)?.name;
    const tag = this.tags.update(id, patch);
    if (before !== undefined && before !== tag.name) this.onTagNamesChanged();
    return tag;
  }

  reorder(orderedIds: readonly string[]): QuickNoteTag[] {
    return this.tags.reorder(orderedIds);
  }

  /** 删除标签：只清关联，不删小记、不改正文。 */
  delete(id: string): { updated: number; failed: number } {
    let updated = 0;
    this.db.transaction(() => {
      this.tags.tombstone(id);
      updated = this.links.removeTag(id);
    })();
    this.onTagNamesChanged();
    return { updated, failed: 0 };
  }

  /** 合并到目标标签：关联整体改指向，源标签写墓碑。 */
  merge(sourceId: string, targetId: string): { updated: number; failed: number } {
    if (sourceId === targetId) return { updated: 0, failed: 0 };
    // 目标必须存在且未被删除（源标签在 tombstone 时会自行校验）。
    this.tags.assertExist([targetId]);
    let updated = 0;
    this.db.transaction(() => {
      updated = this.links.replaceTag(sourceId, targetId);
      this.tags.tombstone(sourceId);
    })();
    this.onTagNamesChanged();
    return { updated, failed: 0 };
  }

  /** 目录同步：LWW 合并目录 + 清掉墓碑标签的关联。返回本端权威目录。 */
  applyRemote(remote: readonly QuickNoteTag[]): QuickNoteTag[] {
    const before = this.tags.list({ includeDeleted: true });
    // 远端没有目录：只返回本端权威目录（不做全量重建；否则每轮同步都会重刷所有小记索引）。
    if (remote.length === 0) return before;
    let merged: QuickNoteTag[] = [];
    let linksRemoved = 0;
    this.db.transaction(() => {
      merged = this.tags.mergeRemote(remote);
      for (const tag of merged) {
        if (tag.deletedAt) linksRemoved += this.links.removeTag(tag.id);
      }
    })();
    if (linksRemoved > 0 || !sameQuickNoteTagDirectory(before, merged)) this.onTagNamesChanged();
    return merged;
  }

  counts(): Map<string, number> {
    return this.links.counts();
  }

  tagIds(noteId: string): string[] {
    return this.links.listFor(noteId);
  }

  allTagIds(): Map<string, string[]> {
    return this.links.listAll();
  }

  tagsUpdatedAt(noteId: string): string {
    return this.links.tagsUpdatedAt(noteId);
  }

  setNoteTags(noteId: string, tagIds: readonly string[]): string[] {
    return this.links.setForNote(noteId, tagIds);
  }

  applyRemoteLinks(noteId: string, tagIds: readonly string[], tagsUpdatedAt: string): boolean {
    return this.links.applyRemote(noteId, tagIds, tagsUpdatedAt);
  }

  removeNoteLinks(noteId: string): void {
    this.links.removeNote(noteId);
  }
}
