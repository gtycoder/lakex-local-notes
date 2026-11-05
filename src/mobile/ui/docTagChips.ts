/**
 * 文档标签的**只读**展示模型（261105 P1）：目录是唯一名称来源，关系只提供 id/顺序。
 *
 * 两个消费点共用同一份解析（避免属性面板与列表筛选各写一套）：
 *  - 属性面板：单篇的 chips（顺序 = 本机 tag_links.position）；
 *  - 文档列表筛选：只列「至少一篇文档在用」的标签，顺序 = 标签目录的设备本地顺序。
 *
 * 降级：目录里不存在的 id（他端已删/尚未同步到本机）**不渲染**，只回计数给 UI 提示。
 * 纯函数、零 IO：数据由 bridge 层取（noteTagReads.loadNoteTagIdsForNotes / bridge.listQuickNoteTags）。
 */

export interface DocTagDirectoryEntry {
  id: string;
  name: string;
}

export interface DocTagChip {
  id: string;
  name: string;
}

export interface DocTagChipView {
  chips: DocTagChip[];
  /** 目录里找不到的 tag 数（去重）——UI 用一句提示说明「已隐藏」。 */
  unresolved: number;
}

/** 单篇文档：tagIds（本机顺序）→ chips；未解析 id 只计数。 */
export function resolveDocTagChips(tagIds: readonly string[], directory: readonly DocTagDirectoryEntry[]): DocTagChipView {
  const byId = new Map(directory.map((entry) => [entry.id, entry.name] as const));
  const chips: DocTagChip[] = [];
  let unresolved = 0;
  for (const id of new Set(tagIds)) {
    const name = byId.get(id);
    if (name === undefined) { unresolved += 1; continue; }
    chips.push({ id, name });
  }
  return { chips, unresolved };
}

export interface DocTagFilterChip extends DocTagChip {
  /** 该标签下的文档数（当前列表内）。 */
  count: number;
}

export interface DocTagFilterView {
  chips: DocTagFilterChip[];
  /** 文档里用到、但目录不存在的标签数（去重）。这些标签不参与筛选（点了也没有名字可展示）。 */
  unresolvedTags: number;
}

/**
 * 文档列表的筛选标签：只列被至少一篇文档使用的标签；顺序 = 目录顺序（设备本地视图）。
 * 单篇传入的 tagIds 顺序不参与（集合语义）。
 */
export function collectDocTagFilterOptions(
  docs: readonly { id: string; tagIds: readonly string[] }[],
  directory: readonly DocTagDirectoryEntry[],
): DocTagFilterView {
  const counts = new Map<string, number>();
  const unknown = new Set<string>();
  const known = new Set(directory.map((entry) => entry.id));
  for (const doc of docs) {
    for (const id of new Set(doc.tagIds)) {
      if (!known.has(id)) { unknown.add(id); continue; }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const chips: DocTagFilterChip[] = [];
  for (const entry of directory) {
    const count = counts.get(entry.id);
    if (count) chips.push({ id: entry.id, name: entry.name, count });
  }
  return { chips, unresolvedTags: unknown.size };
}

/** 列表筛选：null = 全部；否则只留含该标签的文档。 */
export function filterDocsByTag<T extends { id: string }>(
  docs: readonly T[],
  tagIdsByDoc: Readonly<Record<string, readonly string[]>>,
  activeTagId: string | null,
): T[] {
  if (!activeTagId) return [...docs];
  return docs.filter((doc) => (tagIdsByDoc[doc.id] ?? []).includes(activeTagId));
}
