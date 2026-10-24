/**
 * 小记标签：**标签表是目录与元数据的唯一来源**，小记正文只存 `tagIds`。
 * - 标签 ID 由首次创建时的名称派生（`t_` + sha256 前 16 位）⇒ 两端各自迁移同一名称会得到同一个 ID；
 *   重命名只改标签表，不重写小记正文。
 * - 标签表随小记 Manifest 同步（可选字段 `tags`），小记正文仍按内容 hash 同步。
 */

import { sha256Sync } from "./sha256Sync.js";

export const MAX_QUICK_NOTE_TAGS = 20;
export const MAX_QUICK_NOTE_TAG_LENGTH = 32;
export const UNTAGGED_FILTER_LABEL = "无标签";
/** 标签 ID 的形态（派生 ID；只允许安全字符，可直接进 manifest/DB 主键）。 */
export const QUICK_NOTE_TAG_ID_RE = /^t_[a-f0-9]{16}$/;

export class QuickNoteTagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickNoteTagError";
  }
}

/** 标签名归一：NFC、去首尾空白、连续空白压成一个空格；长度按 Unicode 字符数计。 */
export function normalizeQuickNoteTag(raw: unknown): string {
  if (typeof raw !== "string") throw new QuickNoteTagError("标签名必须是文本");
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name) throw new QuickNoteTagError("标签名不能为空");
  if (name === UNTAGGED_FILTER_LABEL) throw new QuickNoteTagError(`“${UNTAGGED_FILTER_LABEL}”是筛选状态，不能作为标签名`);
  if ([...name].length > MAX_QUICK_NOTE_TAG_LENGTH) {
    throw new QuickNoteTagError(`标签名不能超过 ${MAX_QUICK_NOTE_TAG_LENGTH} 个字符`);
  }
  return name;
}

/** 标签名列表归一（仅用于 v2→v3 迁移；新内容一律存 tagIds）。 */
export function normalizeQuickNoteTags(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new QuickNoteTagError("小记标签格式无效");
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const tag = normalizeQuickNoteTag(value);
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > MAX_QUICK_NOTE_TAGS) throw new QuickNoteTagError(`每条小记最多 ${MAX_QUICK_NOTE_TAGS} 个标签`);
  return tags;
}

/** 由标签名派生稳定 ID：同一名称在任何一端都得到同一个 ID（迁移/跨端首次创建不会分叉）。 */
export function quickNoteTagId(name: string): string {
  const normalized = normalizeQuickNoteTag(name);
  return `t_${sha256Sync(new TextEncoder().encode(normalized)).slice(0, 16)}`;
}

/** 标签目录实体（本地表 + Manifest 共用）。`deletedAt` 非空 = 墓碑。 */
export interface QuickNoteTag {
  id: string;
  name: string;
  /** 目录展示顺序（升序）；置顶优先于它。 */
  sortOrder: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function requireIsoTime(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new QuickNoteTagError(`${label}无效`);
  return raw;
}

/** 标签实体校验/归一（读取本地行、Manifest 条目与 IPC 入参共用）。 */
export function normalizeQuickNoteTagEntity(raw: unknown): QuickNoteTag {
  if (!raw || typeof raw !== "object") throw new QuickNoteTagError("标签记录格式无效");
  const value = raw as Partial<QuickNoteTag>;
  if (typeof value.id !== "string" || !QUICK_NOTE_TAG_ID_RE.test(value.id)) throw new QuickNoteTagError("标签 ID 无效");
  const name = normalizeQuickNoteTag(value.name);
  const sortOrder = value.sortOrder ?? 0;
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) throw new QuickNoteTagError("标签排序值无效");
  return {
    id: value.id,
    name,
    sortOrder,
    pinned: !!value.pinned,
    createdAt: requireIsoTime(value.createdAt, "标签创建时间"),
    updatedAt: requireIsoTime(value.updatedAt, "标签更新时间"),
    deletedAt: value.deletedAt == null ? null : requireIsoTime(value.deletedAt, "标签删除时间"),
  };
}

/** 小记的标签 ID 列表：去重、限制每条上限；无效 ID 直接拒绝。 */
export function normalizeQuickNoteTagIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new QuickNoteTagError("小记标签格式无效");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !QUICK_NOTE_TAG_ID_RE.test(value)) throw new QuickNoteTagError("小记标签 ID 无效");
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  if (ids.length > MAX_QUICK_NOTE_TAGS) throw new QuickNoteTagError(`每条小记最多 ${MAX_QUICK_NOTE_TAGS} 个标签`);
  return ids;
}

/** 新标签放最前，保持与语雀一致的“最近添加在前”。 */
export function addQuickNoteTagId(ids: readonly string[], id: string): string[] {
  if (!QUICK_NOTE_TAG_ID_RE.test(id)) throw new QuickNoteTagError("标签 ID 无效");
  if (ids.includes(id)) return [...ids];
  return normalizeQuickNoteTagIds([id, ...ids]);
}

export function removeQuickNoteTagId(ids: readonly string[], id: string): string[] {
  return ids.filter((tagId) => tagId !== id);
}

export interface QuickNoteTagSummary extends QuickNoteTag {
  /** 关联小记数（只统计 active 标签）。 */
  count: number;
}

export interface QuickNoteTagIndex {
  /** 已排序：置顶优先 → sortOrder → 名称。 */
  tags: QuickNoteTagSummary[];
  untaggedCount: number;
}

/**
 * 标签目录 + 小记引用 → 展示用索引。
 * 条目来自**标签表**（不是正文并集）；墓碑与未被任何小记引用的标签都不展示。
 */
export function buildQuickNoteTagIndex<T>(
  notes: readonly T[],
  tags: readonly QuickNoteTag[],
  tagIdsOf: (note: T) => readonly string[] = (note) => (note as { tagIds: readonly string[] }).tagIds,
): QuickNoteTagIndex {
  const active = new Map(tags.filter((tag) => !tag.deletedAt).map((tag) => [tag.id, tag] as const));
  const counts = new Map<string, number>();
  let untaggedCount = 0;
  for (const note of notes) {
    const unique = new Set(tagIdsOf(note).filter((id) => active.has(id)));
    if (unique.size === 0) untaggedCount += 1;
    for (const id of unique) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const summaries = [...active.values()]
    .filter((tag) => (counts.get(tag.id) ?? 0) > 0)
    .map((tag) => ({ ...tag, count: counts.get(tag.id) ?? 0 }));
  summaries.sort((a, b) =>
    Number(b.pinned) - Number(a.pinned)
    || a.sortOrder - b.sortOrder
    || a.name.localeCompare(b.name, "zh-CN"));
  return { tags: summaries, untaggedCount };
}

/**
 * 完整目录 + 索引计数 → 选择器/管理页选项：**含 0 条小记的标签**（刚创建、还没保存进小记）。
 * 只用于「展示名称/选择」，不要拿去渲染标签条（标签条只展示有计数的标签）。
 */
export function buildQuickNoteTagOptions(
  directory: readonly QuickNoteTag[],
  summaries: readonly QuickNoteTagSummary[],
): QuickNoteTagSummary[] {
  const counts = new Map(summaries.map((tag) => [tag.id, tag.count] as const));
  return directory
    .filter((tag) => !tag.deletedAt)
    .map((tag) => ({ ...tag, count: counts.get(tag.id) ?? 0 }));
}

/** 标签筛选：单选 / 无标签 / 多选包含 + 排除（全部按 ID，重命名不影响筛选）。 */
export type QuickNoteTagFilter =
  | { kind: "all" }
  | { kind: "untagged" }
  | { kind: "tag"; id: string }
  | { kind: "selection"; include: readonly string[]; exclude: readonly string[] };

export function matchesQuickNoteTagFilter(tagIds: readonly string[], filter: QuickNoteTagFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "untagged") return tagIds.length === 0;
  if (filter.kind === "tag") return tagIds.includes(filter.id);
  if (filter.include.length > 0 && !filter.include.every((id) => tagIds.includes(id))) return false;
  if (filter.exclude.some((id) => tagIds.includes(id))) return false;
  return true;
}

export function filterQuickNotesByTag<T>(
  notes: readonly T[],
  filter: QuickNoteTagFilter,
  tagIdsOf: (note: T) => readonly string[] = (note) => (note as { tagIds: readonly string[] }).tagIds,
): T[] {
  return notes.filter((note) => matchesQuickNoteTagFilter(tagIdsOf(note), filter));
}

/** 标签表合并（两端同步用）：按 ID + `updatedAt` LWW；墓碑只保留最新状态。 */
export function mergeQuickNoteTags(
  local: readonly QuickNoteTag[],
  remote: readonly QuickNoteTag[],
): QuickNoteTag[] {
  const merged = new Map<string, QuickNoteTag>();
  for (const tag of local) merged.set(tag.id, tag);
  for (const tag of remote) {
    const current = merged.get(tag.id);
    if (!current || tag.updatedAt > current.updatedAt) merged.set(tag.id, tag);
  }
  return [...merged.values()];
}
