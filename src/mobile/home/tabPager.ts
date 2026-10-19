/**
 * 首页首层 tab（小记 ↔ 知识库）的**横向分页判据** —— 纯函数，单一来源。
 *
 * 交互形态（261019 用户点单）：对齐语雀 App 的横向分页 —— **手指跟手拖动 + 松手吸附**，
 * 由浏览器原生横向滚动容器（`overflow-x:auto` + `scroll-snap-type:x mandatory`）完成，
 * 等价于语雀 RN 侧的 `react-native-pager-view`；这里只负责"滚动位置 → 页码 → tab"的取整与夹紧。
 * DOM 侧（事件、inert、滚动对齐）在 `HomePage`，不在这里。
 */
export const HOME_TABS = ["quick", "library"] as const;
export type HomeTab = (typeof HOME_TABS)[number];

function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/** tab → 分页下标（未知值回落到第一页）。 */
export function tabIndex(tab: HomeTab): number {
  const i = HOME_TABS.indexOf(tab);
  return i < 0 ? 0 : i;
}

/** 分页下标 → tab（越界夹紧；用于"滚到哪一页就切哪个 tab"）。 */
export function tabAt(index: number, count: number = HOME_TABS.length): HomeTab {
  return HOME_TABS[clampIndex(index, Math.min(count, HOME_TABS.length))] ?? HOME_TABS[0];
}

/** 第 index 页对应的滚动位置（px）；宽度非法时归 0（首帧还没量到宽，不要算出一个假位置）。 */
export function pagerScrollLeft(index: number, width: number, count: number = HOME_TABS.length): number {
  if (!(width > 0) || !Number.isFinite(width)) return 0;
  return clampIndex(index, Math.min(count, HOME_TABS.length)) * width;
}

/**
 * 当前滚动位置落在哪一页（吸附完成后用；`scrollLeft` 在回弹/超额时可能是负数或越界 ⇒ 夹紧）。
 * 取整口径 = 四舍五入：过半即视为下一页（与原生吸附的判定方向一致）。
 */
export function settledIndex(scrollLeft: number, width: number, count: number = HOME_TABS.length): number {
  if (!(width > 0) || !Number.isFinite(width) || !Number.isFinite(scrollLeft)) return 0;
  return clampIndex(Math.round(scrollLeft / width), Math.min(count, HOME_TABS.length));
}
