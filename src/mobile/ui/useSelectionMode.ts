/**
 * 移动端多选模式的 React 接线（261106 task-82）：判据全在 ./selection 的纯函数里，这里只做 state 壳。
 * 三个列表（小记 / 文档列表 / 回收站）共用 —— 不要再各写一份 active/ids 布尔组合。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPTY_SELECTION,
  selectionAllSelected,
  selectionClear,
  selectionCount,
  selectionEnter,
  selectionExit,
  selectionIncludes,
  selectionPrune,
  selectionSelectAll,
  selectionToggle,
  type SelectionState,
} from "./selection";

export interface SelectionApi {
  active: boolean;
  ids: readonly string[];
  count: number;
  allSelected: boolean;
  isSelected(id: string): boolean;
  /** 长按/「选择」入口：带 id 表示以该行进入。 */
  enter(id?: string | null): void;
  toggle(id: string): void;
  selectAll(): void;
  clearAll(): void;
  /** 全选 ↔ 全不选。 */
  toggleAll(): void;
  exit(): void;
}

/** allIds = 当前**可见**行的 id（全选/剪枝都以它为准）。 */
export function useSelectionMode(allIds: readonly string[]): SelectionApi {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);
  const idsKey = allIds.join("\u0000");

  // 列表变化（恢复/删除/筛选）后剔除失效 id：否则「已选 N」会含已不存在的行。
  useEffect(() => {
    setState((current) => selectionPrune(current, allIds));
    // 依赖 idsKey：父级每次渲染可能给新数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, allIds.length]);

  const enter = useCallback((id?: string | null) => { setState((current) => selectionEnter(current, id ?? null)); }, []);
  const toggle = useCallback((id: string) => { setState((current) => selectionToggle(current, id)); }, []);
  const selectAll = useCallback(() => { setState((current) => selectionSelectAll(current, allIds)); }, [allIds]);
  const clearAll = useCallback(() => { setState((current) => selectionClear(current)); }, []);
  const exit = useCallback(() => { setState(selectionExit()); }, []);
  const allSelected = useMemo(() => selectionAllSelected(state, allIds), [state, allIds]);
  const toggleAll = useCallback(() => {
    setState((current) => (selectionAllSelected(current, allIds) ? selectionClear(current) : selectionSelectAll(current, allIds)));
  }, [allIds]);

  return {
    active: state.active,
    ids: state.ids,
    count: selectionCount(state),
    allSelected,
    isSelected: useCallback((id: string) => selectionIncludes(state, id), [state]),
    enter,
    toggle,
    selectAll,
    clearAll,
    toggleAll,
    exit,
  };
}
