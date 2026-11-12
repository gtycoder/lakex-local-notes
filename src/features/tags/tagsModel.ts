/**
 * 标签空间（桌面一级入口「标签」）的**纯逻辑**（261105 P1）。
 *
 * 定稿：标签空间 = **只读聚合视图 + 就地元数据管理**，不是第三个同步空间。
 * - 目录沿用 quick-notes 库的 tags（已同步；active only、含 0 引用标签）；
 * - 文档关系在主库 tag_links(target_kind='note')，经 IPC list_note_tag_links 一次性取回；
 * - 本文件只做数据整形/筛选/排序，零 IO、可单测。
 */
import type { NoteSummary, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";
import { compareTagUpdatedAtDesc, countTagRefs, tagFallbackTitle } from "../../core/tagAggregate";
import type { NoteKind } from "../../core/noteKind";

/** 目录行（展示用）：引用计数 = 文档数 / 小记数（同一篇文档重复引用只算一次）。 */
export interface TagDirectoryEntry {
  id: string;
  name: string;
  /** 最小可取到的"最近更新"（标签自身 updatedAt；没有引用时为标签自身时间）。 */
  updatedAt: string;
  docCount: number;
  quickNoteCount: number;
}

/** 文档 → 标签 id（本机 position 顺序）。 */
export type DocumentTagLinks = Record<string, string[]>;

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** IPC 回来的关系表兜底校验（脏数据宁可丢掉也不要让页面崩）。 */
export function normalizeDocumentTagLinks(raw: unknown): DocumentTagLinks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DocumentTagLinks = {};
  for (const [noteId, tagIds] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof noteId !== "string" || noteId.length === 0 || !isStringArray(tagIds)) continue;
    const unique = [...new Set(tagIds)];
    if (unique.length > 0) out[noteId] = unique;
  }
  return out;
}

/** 每个标签的文档引用数（同一篇重复引用只算一次；liveNoteIds 过滤已不存在/回收站的文档）。 */
export function documentCountByTag(links: DocumentTagLinks, liveNoteIds?: ReadonlySet<string>): Map<string, number> {
  return countTagRefs(links, liveNoteIds);
}

/** 每个标签的小记引用数（小记列表 summary 已带 tagIds）。 */
export function quickNoteCountByTag(quickNotes: readonly QuickNoteListSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of quickNotes) {
    for (const tagId of new Set(note.tagIds ?? [])) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  }
  return counts;
}

/**
 * 标签目录（保持传入目录顺序 = 本机标签顺序：未手动排序 = 新→旧、手动排序 = sort_order）。
 * 只统计 active 标签；引用数来自文档关系 + 小记列表。
 */
export function buildTagDirectory(input: {
  tags: readonly QuickNoteTag[];
  documentLinks: DocumentTagLinks;
  notes?: readonly NoteSummary[];
  quickNotes: readonly QuickNoteListSummary[];
}): TagDirectoryEntry[] {
  const liveNoteIds = input.notes ? new Set(input.notes.map((note) => note.id)) : undefined;
  const docCounts = documentCountByTag(input.documentLinks, liveNoteIds);
  const quickCounts = quickNoteCountByTag(input.quickNotes);
  // 目录本身已是 active-only（标签删除 = 缺席，没有墓碑字段）⇒ 这里不再过滤。
  return input.tags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      updatedAt: tag.updatedAt,
      docCount: docCounts.get(tag.id) ?? 0,
      quickNoteCount: quickCounts.get(tag.id) ?? 0,
    }));
}

/** 聚合列表条目（文档/小记统一形状，只读展示 + 跳转用）。 */
export interface TagAggregateItem {
  kind: "doc" | "quickNote";
  id: string;
  title: string;
  updatedAt: string;
  /** 小记预览文本（文档没有；文档标题来自 summary）。 */
  previewText?: string;
  /** 文档类型（仅 kind==="doc" 时有）：只读预览据此选内核视图 / 结构化只读视图。 */
  docKind?: NoteKind;
}

/** 只看文档 / 只看小记 / 两者都要。 */
export type TagAggregateKindFilter = "all" | "doc" | "quickNote";

const byUpdatedAtDesc = (a: TagAggregateItem, b: TagAggregateItem): number => compareTagUpdatedAtDesc(a, b);

/**
 * 某个标签下的内容（文档分组 + 小记分组，各自按更新时间倒序）。
 * 文档 = 关系表里有该 tag 的文档；小记 = tagIds 含该 tag 的小记。
 * `filter` 只决定返回哪几组（切换「只看文档 / 只看小记」），不改变组内排序。
 */
export function buildTagAggregate(input: {
  tagId: string | null;
  documentLinks: DocumentTagLinks;
  notes: readonly NoteSummary[];
  quickNotes: readonly QuickNoteListSummary[];
  filter?: TagAggregateKindFilter;
}): { docs: TagAggregateItem[]; quickNotes: TagAggregateItem[]; total: number } {
  const filter = input.filter ?? "all";
  const tagId = input.tagId;
  const docs: TagAggregateItem[] = [];
  const quickNotes: TagAggregateItem[] = [];
  if (!tagId) return { docs, quickNotes, total: 0 };
  if (filter !== "quickNote") {
    for (const note of input.notes) {
      const tagIds = input.documentLinks[note.id];
      if (!tagIds || !tagIds.includes(tagId)) continue;
      docs.push({ kind: "doc", id: note.id, title: note.title || tagFallbackTitle("doc"), updatedAt: note.updatedAt, docKind: note.kind ?? "doc" });
    }
    docs.sort(byUpdatedAtDesc);
  }
  if (filter !== "doc") {
    for (const note of input.quickNotes) {
      if (!(note.tagIds ?? []).includes(tagId)) continue;
      quickNotes.push({
        kind: "quickNote",
        id: note.id,
        title: note.previewText || tagFallbackTitle("quickNote"),
        updatedAt: note.updatedAt,
        previewText: note.previewText,
      });
    }
    quickNotes.sort(byUpdatedAtDesc);
  }
  return { docs, quickNotes, total: docs.length + quickNotes.length };
}

// ===== 侧栏「按标签筛选」=====

/** 包含 / 排除（复用小记的筛选语义：包含=必须同时有；排除=不能有任何一个）。 */
export interface TagSelection {
  include: readonly string[];
  exclude: readonly string[];
}

export const EMPTY_TAG_SELECTION: TagSelection = { include: [], exclude: [] };

export function isTagSelectionActive(selection: TagSelection): boolean {
  return selection.include.length > 0 || selection.exclude.length > 0;
}

/** 单选切换（同一标签不能同时出现在 include 与 exclude）。 */
export function toggleTagSelection(selection: TagSelection, tagId: string, mode: "include" | "exclude"): TagSelection {
  const has = (list: readonly string[]) => list.includes(tagId);
  if (mode === "include") {
    return {
      include: has(selection.include) ? selection.include.filter((id) => id !== tagId) : [...selection.include, tagId],
      exclude: selection.exclude.filter((id) => id !== tagId),
    };
  }
  return {
    include: selection.include.filter((id) => id !== tagId),
    exclude: has(selection.exclude) ? selection.exclude.filter((id) => id !== tagId) : [...selection.exclude, tagId],
  };
}

/** 文档是否命中当前筛选（无筛选 ⇒ 恒 true）。 */
export function matchesTagSelection(tagIds: readonly string[], selection: TagSelection): boolean {
  if (!isTagSelectionActive(selection)) return true;
  if (!selection.include.every((id) => tagIds.includes(id))) return false;
  return !selection.exclude.some((id) => tagIds.includes(id));
}

/**
 * 按标签筛选目录树：**正文/子树保持原顺序**，只隐藏不命中的文档行；
 * 非文档节点（笔记本/分组）在有可见后代时保留（否则整列空掉会让人以为目录丢了）。
 * 无筛选时原样返回（同一引用，不触发无谓 render）。
 */
export function computeTagVisibleIds<T extends { id: string; nodeType: string; noteFileId?: string | null; parentId?: string | null }>(
  nodes: readonly T[],
  links: DocumentTagLinks,
  selection: TagSelection,
): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const visible = new Set<string>();
  for (const node of nodes) {
    if (node.nodeType !== "note") continue;
    const tagIds = links[node.noteFileId ?? node.id] ?? [];
    if (matchesTagSelection(tagIds, selection)) visible.add(node.id);
  }
  // 祖先（命中的文档 → 其分组/笔记本链）也要留下，否则树会断。
  for (const id of [...visible]) {
    let parentId = byId.get(id)?.parentId ?? null;
    let guard = 0;
    while (parentId && guard++ < 64) {
      if (visible.has(parentId)) break;
      visible.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  return visible;
}

/** 按标签筛选目录树（节点数组版；侧栏只隐藏显示，拖拽排序仍用完整兄弟集合）。 */
export function filterTreeByTagSelection<T extends { id: string; nodeType: string; noteFileId?: string | null; parentId?: string | null }>(
  nodes: readonly T[],
  links: DocumentTagLinks,
  selection: TagSelection,
): T[] {
  if (!isTagSelectionActive(selection)) return nodes as T[];
  const visible = computeTagVisibleIds(nodes, links, selection);
  return nodes.filter((node) => visible.has(node.id));
}

/** 目录拖动排序：把 dragged 移到 over 之前/之后（单一来源 = core 的 moveQuickNoteTagOrder）。 */
export { moveQuickNoteTagOrder as moveTagOrder } from "../../core/quickNoteTags";
