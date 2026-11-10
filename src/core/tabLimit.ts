/**
 * 多标签上限与自动淘汰的纯逻辑（LRU + 钉住保护）。
 * limit=0 表示不限制；淘汰永不选中当前激活标签；存在非钉住候选时优先淘汰非钉住标签。
 *
 * **261110 用户定稿：上限按空间独立计算**（文档空间与日记空间各算各的；日记端开 8 个不影响文档端）。
 * 空间判据 = `tab.space`（缺省 = library），`options.space` 给出本次参与计数的空间；
 * 不传 `space` 时保持旧行为（全量计数），移动端单空间调用因此零改动。
 */

/** 标签所属空间（桌面两个带标签条的空间；缺省 = 文档）。 */
export type TabSpace = "library" | "diary";

export interface TabLike {
  noteId: string;
  lastAccessedAt: number;
  /** 缺省 = library（文档空间）。 */
  space?: TabSpace;
}

export interface EvictionOptions {
  limit: number;
  activeNoteId: string | null;
  pinnedNoteIds?: ReadonlySet<string>;
  /** 只在这个空间内计数/淘汰（用户 261110 定稿：上限按空间独立）。 */
  space?: TabSpace;
  /** 本次不得淘汰的 id（审计 F01：保存失败/未确认持久化的标签必须留在原处）。
   * 被保护的标签**不补位**——补位会淘汰另一个尚未确认持久化的标签，等于换个对象丢数据。 */
  protectNoteIds?: ReadonlySet<string>;
}

/** 返回需要淘汰的 noteId 列表（数量 = 超出上限的个数，按淘汰优先级从高到低）。 */
export function selectEvictionIds(tabs: readonly TabLike[], options: EvictionOptions): string[] {
  const { limit, activeNoteId, pinnedNoteIds, protectNoteIds, space } = options;
  if (limit <= 0) return [];
  const scoped = space ? tabs.filter((tab) => (tab.space ?? "library") === space) : tabs;
  const evictCount = scoped.length - limit;
  if (evictCount <= 0) return [];

  const removable = scoped.filter((tab) => tab.noteId !== activeNoteId);
  const sorted = [...removable].sort((a, b) => {
    const pinA = pinnedNoteIds?.has(a.noteId) ? 1 : 0;
    const pinB = pinnedNoteIds?.has(b.noteId) ? 1 : 0;
    if (pinA !== pinB) return pinA - pinB;
    return a.lastAccessedAt - b.lastAccessedAt;
  });
  // 先按 LRU 选出 evictCount 个候选，再剔除受保护者；剔除后**不补位**（保持与"实际已持久化"的候选集一致）。
  const result: string[] = [];
  let considered = 0;
  for (const tab of sorted) {
    if (considered >= evictCount) break;
    considered += 1;
    if (protectNoteIds?.has(tab.noteId)) continue;
    result.push(tab.noteId);
  }
  return result;
}

/**
 * 返回应用上限后的标签数组（幂等）。用于 setOpenTabs 更新器内部，
 * 保证并发打开/创建时也以“最新已提交状态”强制封顶，避免基于旧 ref 的竞态。
 */
export function trimTabsToLimit<T extends TabLike>(tabs: readonly T[], options: EvictionOptions): T[] {
  const evicted = selectEvictionIds(tabs, options);
  if (evicted.length === 0) return [...tabs] as T[];
  const evictedSet = new Set(evicted);
  return tabs.filter((tab) => !evictedSet.has(tab.noteId)) as T[];
}