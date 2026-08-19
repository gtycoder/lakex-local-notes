/**
 * 多标签上限与自动淘汰的纯逻辑（LRU + 钉住保护）。
 * limit=0 表示不限制；淘汰永不选中当前激活标签；存在非钉住候选时优先淘汰非钉住标签。
 */

export interface TabLike {
  noteId: string;
  lastAccessedAt: number;
}

export interface EvictionOptions {
  limit: number;
  activeNoteId: string | null;
  pinnedNoteIds?: ReadonlySet<string>;
}

/** 返回需要淘汰的 noteId 列表（数量 = 超出上限的个数，按淘汰优先级从高到低）。 */
export function selectEvictionIds(tabs: readonly TabLike[], options: EvictionOptions): string[] {
  const { limit, activeNoteId, pinnedNoteIds } = options;
  if (limit <= 0) return [];
  const evictCount = tabs.length - limit;
  if (evictCount <= 0) return [];

  const removable = tabs.filter((tab) => tab.noteId !== activeNoteId);
  const sorted = [...removable].sort((a, b) => {
    const pinA = pinnedNoteIds?.has(a.noteId) ? 1 : 0;
    const pinB = pinnedNoteIds?.has(b.noteId) ? 1 : 0;
    if (pinA !== pinB) return pinA - pinB;
    return a.lastAccessedAt - b.lastAccessedAt;
  });
  return sorted.slice(0, evictCount).map((tab) => tab.noteId);
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
