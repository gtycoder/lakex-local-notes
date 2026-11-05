/**
 * 小记标签：**标签目录与关联表是唯一事实**，小记正文只存内容（text/body/images）。
 * - 标签目录 `quick_note_tags` 独占名称/排序/置顶；关系在 `quick_note_tag_links(note_id, tag_id, position)`；
 *   两者只在协调层（桌面/移动端各自的 `quickNoteTagService`）里组合。
 * - 标签 ID 由首次创建时的名称派生（`t_` + sha256 前 16 位）⇒ 同一名称在任何一端会得到同一个 ID；
 *   重命名只改目录，不重写 `.qnote`。
 * - 标签目录随小记 Manifest 同步（可选字段 `tags`），每条小记的关系随 `tagIds/tagsUpdatedAt` 同步。
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

/** 由标签名派生稳定 ID：同一名称在任何一端都得到同一个 ID（跨端首次创建不会分叉）。 */
export function quickNoteTagId(name: string): string {
  const normalized = normalizeQuickNoteTag(name);
  return `t_${sha256Sync(new TextEncoder().encode(normalized)).slice(0, 16)}`;
}

/**
 * 标签目录实体（本地表 + 索引共用）。`deletedAt` 非空 = 墓碑。
 *
 * **顺序是设备本地视图**（261105 用户定稿）：目录的展示顺序不参与同步；
 * 本实体也不再带 sortOrder/pinned（置顶功能已整体删除）。
 */
export interface QuickNoteTag {
  id: string;
  name: string;
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
  return {
    id: value.id,
    name,
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

/**
 * 本机拖拽排序（纯函数）：把 `draggedId` 移到 `overId` 之前/之后，返回新顺序。
 * 顺序是**设备本地视图**（不参与同步）；任一 id 不在列表里则原样返回。
 */
export function moveQuickNoteTagOrder(
  ids: readonly string[],
  draggedId: string,
  overId: string,
  position: "before" | "after",
): string[] {
  if (draggedId === overId) return [...ids];
  const remaining = ids.filter((id) => id !== draggedId);
  const overIndex = remaining.indexOf(overId);
  if (!ids.includes(draggedId) || overIndex < 0) return [...ids];
  const insertAt = position === "after" ? overIndex + 1 : overIndex;
  remaining.splice(insertAt, 0, draggedId);
  return remaining;
}

export interface QuickNoteTagSummary extends QuickNoteTag {
  /** 关联小记数（只统计 active 标签）。 */
  count: number;
}

export interface QuickNoteTagIndex {
  /** 按传入目录的**本地展示顺序**排列（不在这里另外排序）。 */
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
  // 顺序 = 调用方传入的目录顺序（设备本地）；这里只做计数与过滤。
  const summaries = [...active.values()]
    .filter((tag) => (counts.get(tag.id) ?? 0) > 0)
    .map((tag) => ({ ...tag, count: counts.get(tag.id) ?? 0 }));
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

/** 标签版本的最小形状（本地表 `QuickNoteTag` 与云端索引条目共用）。 */
export interface QuickNoteTagLike {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/**
 * 标签版本比较：**>0 = a 胜出；0 = 完全等价；<0 = b 胜出**。
 *
 * `updatedAt` 相同时用**确定性 tie-break**（归一化字段串）——两端对同一对记录必须选出同一个赢家，
 * 否则「各留本地」会让改名/删除在两端永远不收敛（`>` 比较下双方都判自己赢）。
 * 顺序/置顶是设备本地视图，**不参与**比较。
 */
export function compareQuickNoteTagVersion(a: QuickNoteTagLike, b: QuickNoteTagLike): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1;
  const keyOf = (tag: QuickNoteTagLike): string => JSON.stringify([tag.name, tag.createdAt, tag.deletedAt ?? null]);
  const ka = keyOf(a);
  const kb = keyOf(b);
  return ka === kb ? 0 : (ka > kb ? 1 : -1);
}

/** 标签表合并（两端同步用）：按 ID + 确定性 LWW；墓碑只保留最新状态。 */
export function mergeQuickNoteTags<T extends QuickNoteTagLike>(
  local: readonly T[],
  remote: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  for (const tag of local) merged.set(tag.id, tag);
  for (const tag of remote) {
    const current = merged.get(tag.id);
    if (!current || compareQuickNoteTagVersion(tag, current) > 0) merged.set(tag.id, tag);
  }
  return [...merged.values()];
}

/**
 * 目录是否等价（同步用）：字段级比较，避免远端目录无变化时也全量重建搜索索引。
 * **顺序不参与比较**（设备本地视图，不参与同步）。
 */
export function sameQuickNoteTagDirectory(a: readonly QuickNoteTagLike[], b: readonly QuickNoteTagLike[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((tag) => [tag.id, tag] as const));
  return a.every((tag) => {
    const other = byId.get(tag.id);
    return !!other
      && tag.name === other.name
      && tag.createdAt === other.createdAt
      && tag.updatedAt === other.updatedAt
      && (tag.deletedAt ?? null) === (other.deletedAt ?? null);
  });
}
