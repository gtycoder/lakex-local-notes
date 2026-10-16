/**
 * 移动端手势公共核心（对齐思源 mobile/util/touchGesture.ts + touch.ts 的判定口径）。
 * 只放纯函数/常量，供 usePanelDrag / useHorizontalSwipe / 弹层右滑关闭共用，避免各写一套轴锁。
 */
export type TouchAxis = "x" | "y";
/** 抽屉侧：左 = 目录（设置页也复用它），右 = 大纲。 */
export type PanelSide = "left" | "right";

/** 轴锁阈值：位移先越过它才判定横/纵（与思源 SIZE_DRAG_THRESHOLD 同量级）。 */
export const GESTURE_AXIS_THRESHOLD = 8;
/** 抽屉提交阈值：慢拖需越过视口宽的 1/3（思源 touch.ts:311）。 */
export const PANEL_COMMIT_RATIO = 1 / 3;
/** 快速滑动窗口：抬手时距 touchstart 小于该值即视为“快滑”，短距离也提交（思源 touch.ts:309）。 */
export const QUICK_FLICK_MS = 1000;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 位移先越过阈值且横向占优才算横滑；否则返回 undefined（交给纵向滚动）。 */
export function getTouchAxis(xDiff: number, yDiff: number, threshold = GESTURE_AXIS_THRESHOLD): TouchAxis | undefined {
  if (Math.max(Math.abs(xDiff), Math.abs(yDiff)) < threshold) return undefined;
  return Math.abs(xDiff) > Math.abs(yDiff) ? "x" : "y";
}

/** 横向滚动的内容件（对齐思源对 table/code/AV 的显式判定，不做通用祖先 overflow 遍历——
 *  通用遍历会命中 1px 级 scrollWidth 误差，反而把正常滑动误判为“可滚动内容”而拉不出抽屉）。 */
const HSCROLL_CONTENT = ".ne-table-wrap, .ne-table-hole, .ne-codeblock, .ne-codeblock-content, .av__scroll, .av__kanban, .viewer-container";

/**
 * 手势落点是否处于“可横向滚动”的内容里（对齐思源 isHorizontalScrollable）：
 * 命中且该内容在滑动方向仍可继续滚动 → 交给原生横向滚动，不触发抽屉。dx = currentX - startX。
 */
export function isHorizontalScrollable(target: HTMLElement | null, dx: number): boolean {
  if (!target || typeof target.closest !== "function") return false;
  const element = target.closest<HTMLElement>(HSCROLL_CONTENT);
  if (!element || element.scrollWidth <= element.clientWidth + 1) return false;
  if (dx < 0 && Math.ceil(element.clientWidth + element.scrollLeft) < element.scrollWidth) return true;
  if (dx > 0 && element.scrollLeft > 1) return true;
  return false;
}

/** 抽屉跟手进度：raw>0 表示往“拉开该侧”的方向；已展开时从 1 递减到 0（反向滑动自然回退）。 */
export function panelProgress(openAtStart: boolean, raw: number, width: number): number {
  return openAtStart ? clamp01(1 + raw / width) : clamp01(raw / width);
}

/**
 * 新手势要拉开哪一侧：右滑开左栏、左滑开右栏（思源口径）。
 * 该侧没有可开的面板时返回 null ⇒ 手势作废、不拉任何抽屉（例：表格/多维表/画板没有大纲，
 * 左滑就不该拉出一个空面板）。只用于“打开”，已展开的面板仍按原逻辑滑动关闭。
 */
export function swipeTargetSide(dx: number, canOpen?: (side: PanelSide) => boolean): PanelSide | null {
  const side: PanelSide = dx > 0 ? "left" : "right";
  return !canOpen || canOpen(side) ? side : null;
}

/**
 * 释放时是否提交到“目标态”（openAtStart 时目标态是继续开；否则是打开）：
 * 慢拖越过视口宽 1/3，或快速短滑（<quickMs 且位移过阈值）。反向滑动 moved 归 0 → 不提交。
 */
export function panelCommit(openAtStart: boolean, raw: number, elapsedMs: number, width: number, quickMs = QUICK_FLICK_MS): boolean {
  const moved = openAtStart ? Math.max(0, -raw) : Math.max(0, raw);
  const quickFlick = elapsedMs < quickMs && moved > GESTURE_AXIS_THRESHOLD;
  const passed = moved > width * PANEL_COMMIT_RATIO || quickFlick;
  return openAtStart ? !passed : passed;
}
