/**
 * 标签页（一级「标签」tab）用到的**计数与聚合纯函数** —— 单一来源，不复制第二套。
 *
 * 口径与桌面「标签空间」一致：
 *  · 文档数 = listNoteTagLinks 里命中该标签、且文档仍存在（不在回收站的文档不在 notes 清单里）；
 *  · 小记数 = 小记 tagIds 命中；同一条重复 id 只算一次；
 *  · 聚合列表 = 文档 + 小记按 updatedAt 倒序（同时间按 kind/id 稳定排序，避免列表跳动）。
 */
import type { QuickNoteTag } from "../../core/quickNoteTags";
import { compareTagUpdatedAtDesc, countTagRefs, tagFallbackTitle } from "../../core/tagAggregate";

/** 文档 ↔ 标签关系表（noteId → tagIds；来自 bridge.listNoteTagLinks）。 */
export type NoteTagLinks = Readonly<Record<string, readonly string[]>>;

/** 聚合/计数只需要这些字段（文档 = LocalNoteSummary 子集；小记 = MobileQuickNote 子集）。 */
export interface TagCountSource {
  id: string;
  tagIds: readonly string[];
}

export interface TagDocSource {
  id: string;
  title: string;
  updatedAt: string;
}

export interface TagQuickSource {
  id: string;
  previewText: string;
  updatedAt: string;
  tagIds: readonly string[];
}

export interface TagAggregateRow {
  kind: "doc" | "quick";
  id: string;
  title: string;
  updatedAt: string;
}

export interface TagCounts {
  docs: Record<string, number>;
  quickNotes: Record<string, number>;
}

export function tagCounts(
  tags: readonly QuickNoteTag[],
  links: NoteTagLinks | null,
  notes: readonly TagDocSource[],
  quickNotes: readonly TagCountSource[],
): TagCounts {
  const known = new Set(tags.map((tag) => tag.id));
  const liveNotes = new Set(notes.map((note) => note.id));
  const docs: Record<string, number> = {};
  const quickNotes_ = {} as Record<string, number>;
  for (const tag of tags) { docs[tag.id] = 0; quickNotes_[tag.id] = 0; }
  for (const [tagId, count] of countTagRefs(links, liveNotes)) {
    if (known.has(tagId)) docs[tagId] = count;
  }
  for (const note of quickNotes) {
    for (const tagId of new Set(note.tagIds)) if (known.has(tagId)) quickNotes_[tagId] += 1;
  }
  return { docs, quickNotes: quickNotes_ };
}

/** 某个标签下的聚合：文档 + 小记，更新时间倒序（同时间按 kind/id 稳定排序）。 */
export function aggregateTagRows(
  tagId: string,
  links: NoteTagLinks | null,
  notes: readonly TagDocSource[],
  quickNotes: readonly TagQuickSource[],
): TagAggregateRow[] {
  const rows: TagAggregateRow[] = [];
  for (const note of notes) {
    if (!(links?.[note.id] ?? []).includes(tagId)) continue;
    rows.push({ kind: "doc", id: note.id, title: note.title || tagFallbackTitle("doc"), updatedAt: note.updatedAt });
  }
  for (const note of quickNotes) {
    if (!note.tagIds.includes(tagId)) continue;
    rows.push({ kind: "quick", id: note.id, title: note.previewText || tagFallbackTitle("quick"), updatedAt: note.updatedAt });
  }
  return rows.sort((a, b) => compareTagUpdatedAtDesc(a, b));
}
