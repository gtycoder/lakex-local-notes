/**
 * 移动端「多选/选择模式」的**纯状态机**（261106 task-82，单一判据）：
 * 列表（小记 / 文档列表 / 回收站）共用一套，不在各页面各写一份布尔组合。
 *
 * 语义：
 *  · 进入 = 长按某行（带该行 id）或点「选择」入口（不带 id）；
 *  · 选择态下点行 = 切换该行；点「全选」= 选当前可见的全部（全选后点「全不选」清空）；
 *  · 退出 = 顶部「取消」/ 返回键 / 操作完成。
 * 不入选择的地方（明确约定）：目录抽屉与标签页长按 = 拖拽；笔记本卡片长按 = 改名/图标菜单。
 */

export interface SelectionState {
  /** 是否处于选择模式。 */
  active: boolean;
  /** 已选 id（保持插入顺序；用于「已选 N」与批量操作目标顺序）。 */
  ids: readonly string[];
}

export const EMPTY_SELECTION: SelectionState = { active: false, ids: [] };
/** 与 core 批量端口同一上限（500）：移动端也必须在进入选择/全选时就截断，
 *  否则 2 万篇「全选」会先卡主线程、再被 core 整批拒绝。 */
export const SELECTION_MAX = 500;

/** 进入选择模式：可带首行 id（长按进入）。 */
export function selectionEnter(state: SelectionState, id?: string | null): SelectionState {
  if (id == null) return { active: true, ids: [] };
  return { active: true, ids: state.active && state.ids.includes(id) ? [...state.ids] : [id] };
}

/** 选择态下切换一行；未进入时等于「以该行进入」。 */
export function selectionToggle(state: SelectionState, id: string): SelectionState {
  if (!state.active) return { active: true, ids: [id] };
  if (state.ids.includes(id)) return { active: true, ids: state.ids.filter((x) => x !== id) };
  if (state.ids.length >= SELECTION_MAX) return state; // 达上限不再追加；UI 提示由调用方给。
  return { active: true, ids: [...state.ids, id] };
}

/** 选当前可见的全部（去重、按传入顺序）。state 仅为签名一致（全选不看原有选择）。 */
export function selectionSelectAll(_state: SelectionState, visibleIds: readonly string[]): SelectionState {
  // 用 Set 去重（旧实现每条 includes ⇒ 2 万篇 O(n²) 卡死）；到 500 上限即停。
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of visibleIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= SELECTION_MAX) break;
  }
  return { active: true, ids };
}

/** 清空已选，但留在选择模式。 */
export function selectionClear(state: SelectionState): SelectionState {
  return state.active ? { active: true, ids: [] } : EMPTY_SELECTION;
}

/** 退出选择模式（顶部取消 / 返回键 / 操作完成）。 */
export function selectionExit(): SelectionState {
  return EMPTY_SELECTION;
}

export function selectionCount(state: SelectionState): number {
  return state.ids.length;
}

/** 当前可见的是否「已全选」（空列表不算全选）。 */
export function selectionAllSelected(state: SelectionState, visibleIds: readonly string[]): boolean {
  if (!state.active || visibleIds.length === 0) return false;
  // 可见数超过上限时不可能「全选」（最多 500），避免按钮显示全选却只选一部分。
  if (visibleIds.length > SELECTION_MAX) return false;
  const selected = new Set(state.ids);
  return visibleIds.every((id) => selected.has(id));
}

/** 列表变化后剔除已不存在的 id（回收站恢复/删除、筛选切换都会用到）。 */
export function selectionPrune(state: SelectionState, visibleIds: readonly string[]): SelectionState {
  if (!state.active) return EMPTY_SELECTION;
  const keep = new Set(visibleIds);
  const ids = state.ids.filter((id) => keep.has(id));
  if (ids.length === state.ids.length) return state;
  return { active: true, ids };
}

export function selectionIncludes(state: SelectionState, id: string): boolean {
  return state.ids.includes(id);
}
