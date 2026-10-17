/**
 * dock 头部「隐藏式筛选」的状态机（纯逻辑，目录栏 / 大纲共用；2026-09-03 对齐）。
 *
 * 交互定稿：
 *   · 默认只有图标（收起）；点图标 => 展开输入框并聚焦；
 *   · 再点图标 => 收起并清空筛选词（图标即开关）；
 *   · Esc => 清空并收起；失焦且内容为空 => 自动收起（有内容则保持展开）；
 *   · 存在筛选词 => 图标常亮（active），提示"目录/大纲正在被筛选"。
 * 与 DockFilter.tsx 的视图实现分离，便于按项目惯例（*.test.ts 纯逻辑）覆盖。
 */

export interface DockFilterState {
  open: boolean;
}

export type DockFilterEvent =
  | { kind: "toggle" }
  | { kind: "input" }
  | { kind: "escape" }
  | { kind: "blur"; value: string }
  | { kind: "external-value"; value: string };

export interface DockFilterStep {
  state: DockFilterState;
  /** true => 调用方需把宿主筛选词清空（收起即清空，不留隐藏筛选） */
  clearValue: boolean;
  /** true => 调用方需聚焦输入框 */
  focus: boolean;
}

/** 筛选词是否生效（纯空格不算）。 */
export function isFilterActive(value: string): boolean {
  return value.trim().length > 0;
}

/** 初始状态：宿主已有筛选词（如上次残留）时直接展开，避免"看不见却在筛选"。 */
export function initialDockFilterState(value: string): DockFilterState {
  return { open: isFilterActive(value) };
}

export function stepDockFilter(state: DockFilterState, event: DockFilterEvent): DockFilterStep {
  switch (event.kind) {
    case "toggle":
      return state.open
        ? { state: { open: false }, clearValue: true, focus: false }
        : { state: { open: true }, clearValue: false, focus: true };
    case "input":
      return { state: { open: true }, clearValue: false, focus: false };
    case "escape":
      return { state: { open: false }, clearValue: true, focus: false };
    case "blur":
      return isFilterActive(event.value)
        ? { state: { open: true }, clearValue: false, focus: false }
        : { state: { open: false }, clearValue: false, focus: false };
    case "external-value":
      if (isFilterActive(event.value) && !state.open) {
        return { state: { open: true }, clearValue: false, focus: false };
      }
      return { state, clearValue: false, focus: false };
  }
}
