/**
 * 标签 ↔ 小记的唯一协调层：只有这里同时接触「标签目录」和「关联表」。
 * 标签 store / 关联 store / 小记 store 互不认识对方的表；删除/合并/同步在此编排。
 *
 * 261105 定稿「删除 = 缺席」：删除标签 = 物理删目录行 + 清关联/版本 + 记本机待删
 * （不上传；远端重发也不复活 = 删除压编辑）。云端 tags[] 只出现 active 标签，墓碑不进索引。
 */
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import {
  normalizeQuickNoteTagIds,
  QuickNoteTagError,
  type QuickNoteTag,
} from "../src/core/quickNoteTags.js";
import type { QuickNoteTagsStore } from "./quickNoteTagsStore.js";
import type { QuickNoteTagLinksStore } from "./quickNoteTagLinksStore.js";

export class QuickNoteTagService {
  constructor(
    private readonly db: DbLike,
    private readonly tags: QuickNoteTagsStore,
    private readonly links: QuickNoteTagLinksStore,
    /**
     * 标签目录/关系变化后刷新搜索索引里的标签词。
     * `tagIds` = 改名等「关联仍在」的场景；`noteIds` = 关联已被删掉（删除/合并源标签）
     * 但对应小记索引仍需重刷标签词的场景（删完再按关联反查就查不到了）。
     */
    private readonly onTagNamesChanged: (tagIds: readonly string[], noteIds?: readonly string[]) => void,
  ) {}

  /** 目录列表：删除 = 缺席（表里只有 active 行），没有「含墓碑」选项。 */
  list(): QuickNoteTag[] {
    return this.tags.list();
  }

  create(name: string): QuickNoteTag {
    return this.tags.create(name);
  }

  update(id: string, patch: { name?: string }): QuickNoteTag {
    const before = this.tags.list().find((tag) => tag.id === id)?.name;
    const tag = this.tags.update(id, patch);
    if (before !== undefined && before !== tag.name) this.onTagNamesChanged([id]);
    return tag;
  }

  reorder(orderedIds: readonly string[]): QuickNoteTag[] {
    return this.tags.reorder(orderedIds);
  }

  /**
   * 删除标签（261105 定稿：**删除 = 缺席**）：只清关联，不删小记、不改正文。
   * - 物理删目录行（不写 deleted_at 墓碑）+ 清该标签所有关联/关系版本；
   * - 把 id 记进**本机待删**：远端还带着它（离线删除 / 他端未同步）时必须按已删处理，
   *   **删除压编辑**，不因远端重发而复活。
   */
  delete(id: string): { updated: number; failed: number } {
    let noteIds: string[] = [];
    this.db.transaction(() => {
      // 受影响小记必须在删关联前收集（删完就查不到了）。
      noteIds = this.links.clearTag(id);
      this.tags.remove(id);
      this.tags.addPendingDeletes([id]);
    })();
    this.onTagNamesChanged([id], noteIds);
    return { updated: noteIds.length, failed: 0 };
  }

  /** 合并到目标标签：关联整体改指向，源标签**物理删除**（删除 = 缺席，同时记本机待删抑制远端重发）。 */
  merge(sourceId: string, targetId: string): { updated: number; failed: number } {
    if (sourceId === targetId) return { updated: 0, failed: 0 };
    // 目标必须存在（源标签在 remove 时会自行校验）。
    this.tags.assertExist([targetId]);
    let noteIds: string[] = [];
    this.db.transaction(() => {
      noteIds = this.links.replaceTag(sourceId, targetId);
      this.tags.remove(sourceId);
      // 源标签 id 就是「本机已删」：远端若还带着它（他端尚未合并），不能在下一轮被当成新标签拉回。
      this.tags.addPendingDeletes([sourceId]);
    })();
    this.onTagNamesChanged([sourceId, targetId], noteIds);
    return { updated: noteIds.length, failed: 0 };
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

  setNoteTags(noteId: string, rawTagIds: readonly string[]): string[] {
    // 标签存在性校验放在协调层：关系 store 不认识目录 store（只接收已校验的 ID）。
    const tagIds = this.normalizeTagIds(rawTagIds);
    this.tags.assertExist(tagIds);
    return this.links.setForNote(noteId, tagIds);
  }

  applyRemoteLinks(noteId: string, tagIds: readonly string[], tagsUpdatedAt: string): boolean {
    // 删除 = 缺席（261105）：没有墓碑集合可查，关系侧只认识「本机待删」——
    // 远端回放一个本机已删标签的关系时，不得把它重新挂到小记上。
    const suppressed = new Set(this.tags.listPendingDeletes());
    return this.links.applyRemote(noteId, tagIds, tagsUpdatedAt, suppressed);
  }

  removeNoteLinks(noteId: string): void {
    this.links.removeNote(noteId);
  }

  private normalizeTagIds(rawTagIds: readonly string[]): string[] {
    try { return normalizeQuickNoteTagIds(rawTagIds); }
    catch (error) {
      if (error instanceof QuickNoteTagError) throw new AppError("InvalidInput", error.message);
      throw error;
    }
  }
}
