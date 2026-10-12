/**
 * 文档分屏的左栏宽度几何（**单一来源**，261012）。
 *
 * 为什么单独一个文件：分屏宽度此前只活在 `MultiTabEditor` 的本地 state 里，
 * 容器变窄（缩窗 / 开关目录栏 / 开关大纲栏）时**没有任何人重算** ⇒ 固定 px 的左栏把右栏压成 0
 * （261012 实测：容器 760 / --split-left 776 → 两列 760+0，右栏内容消失、分隔条被 overflow:hidden 裁掉）。
 * 抽成纯函数才能被单测卡住（原来的护栏是源码字符串断言，几何回归全穿）。
 *
 * 口径（用户可见行为）：
 * - 容器放得下「左最小 + 右最小」⇒ **优先保住用户拖出来的宽度**，只在越界时夹到 `容器宽 - 右最小`；
 * - 容器放不下 ⇒ 两栏各半（都保住、都不越界），而不是让右栏塌成 0；容器再变宽时按用户原宽度恢复。
 */
export interface SplitWidthLimits {
  /** 左栏最小宽度（px）。 */
  minLeft: number;
  /** 右栏最小宽度（px）：拖拽与重夹都以它为准，绝不让右栏失去可见宽度。 */
  minRight: number;
  /** 左栏最大宽度（px）。 */
  maxLeft: number;
}

/** 分屏宽度的默认上下限（与 `MultiTabEditor` 传给 `SplitHandle` 的值同源）。 */
export const SPLIT_WIDTH_LIMITS: SplitWidthLimits = { minLeft: 280, minRight: 280, maxLeft: 2400 };

/** 把「用户期望的左栏宽度(px)」夹进容器。`containerWidth <= 0`（尚未量到）时只按上下限夹。 */
export function clampSplitLeft(
  containerWidth: number,
  desired: number,
  limits: SplitWidthLimits = SPLIT_WIDTH_LIMITS,
): number {
  const { minLeft, minRight, maxLeft } = limits;
  const want = Number.isFinite(desired) ? desired : minLeft;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return Math.max(minLeft, Math.min(maxLeft, want));
  }
  // 容器连两条最小值都放不下：两栏各半（都可见），不做越界 px
  if (containerWidth < minLeft + minRight) return Math.max(1, Math.round(containerWidth / 2));
  const upper = Math.max(minLeft, Math.min(maxLeft, containerWidth - minRight));
  return Math.min(Math.max(want, minLeft), upper);
}
