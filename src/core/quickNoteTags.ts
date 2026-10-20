/** 小记标签：随 `.qnote` 内容同步，不维护独立标签目录。 */

export const MAX_QUICK_NOTE_TAGS = 20;
export const MAX_QUICK_NOTE_TAG_LENGTH = 32;
export const UNTAGGED_FILTER_LABEL = "无标签";

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

/** 读取旧内容时缺省 `tags` 视为空数组；重复标签按首次出现去重。 */
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

/** 新标签放最前，保持与语雀一致的“最近添加在前”。 */
export function addQuickNoteTag(tags: readonly string[], raw: unknown): string[] {
  const tag = normalizeQuickNoteTag(raw);
  if (tags.includes(tag)) return [...tags];
  return normalizeQuickNoteTags([tag, ...tags]);
}

export function removeQuickNoteTag(tags: readonly string[], name: string): string[] {
  return tags.filter((tag) => tag !== name);
}

export interface QuickNoteTagSummary {
  name: string;
  count: number;
}

export interface QuickNoteTagIndex {
  tags: QuickNoteTagSummary[];
  untaggedCount: number;
}

/** 标签集合 = 全部有效小记标签的并集；不持久化，列表加载后现算。 */
export function buildQuickNoteTagIndex<T>(
  notes: readonly T[],
  tagsOf: (note: T) => readonly string[] = (note) => (note as { tags: readonly string[] }).tags,
): QuickNoteTagIndex {
  const counts = new Map<string, number>();
  let untaggedCount = 0;
  for (const note of notes) {
    const unique = new Set(tagsOf(note));
    if (unique.size === 0) untaggedCount += 1;
    for (const tag of unique) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const tags = [...counts].map(([name, count]) => ({ name, count }));
  tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
  return { tags, untaggedCount };
}

export type QuickNoteTagFilter =
  | { kind: "all" }
  | { kind: "tag"; name: string }
  | { kind: "untagged" };

export function filterQuickNotesByTag<T>(
  notes: readonly T[],
  filter: QuickNoteTagFilter,
  tagsOf: (note: T) => readonly string[] = (note) => (note as { tags: readonly string[] }).tags,
): T[] {
  if (filter.kind === "all") return [...notes];
  if (filter.kind === "untagged") return notes.filter((note) => tagsOf(note).length === 0);
  return notes.filter((note) => tagsOf(note).includes(filter.name));
}
