/**
 * 底部 Sheet / 抽屉「下滑关闭」的**判据单一来源**（261110 用户点单，取代底部 Sheet 上语义错位的右滑关闭）。
 *
 * 手势口径（与语雀/飞书一致）：
 *  · 内部滚动容器**不在顶部**时不启动（否则会抢列表滚动）；
 *  · 向下拖动超过 4px 才接住手势（避免误触）；
 *  · 松手时位移 ≥ 阈值（max(72, 面板高 × 25%)）即关闭，否则回弹。
 * 只有判据在这里；DOM 接线在 useSwipeDownDismiss.ts。
 */
export const SWIPE_DOWN_ENGAGE_PX = 4;

/** 松手判定阈值：短面板也要能拖（下限 72）；高面板按 25% 手感，但**封顶 160** ——
 *  整屏高的抽屉（842）按 25% 要拖 211px，手感过重。 */
export function swipeDownThreshold(heightPx: number): number {
  if (!(heightPx > 0)) return 96;
  return Math.max(72, Math.min(160, Math.round(heightPx * 0.25)));
}

/** 是否接住手势：向下且滚动容器在顶部。 */
export function shouldEngageSwipeDown(deltaY: number, scrollTop: number): boolean {
  return deltaY > SWIPE_DOWN_ENGAGE_PX && scrollTop <= 0;
}

/** 松手时是否关闭。 */
export function shouldDismissOnRelease(deltaY: number, heightPx: number): boolean {
  return deltaY >= swipeDownThreshold(heightPx);
}
