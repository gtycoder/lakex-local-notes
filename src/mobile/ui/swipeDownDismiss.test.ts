import { describe, expect, it } from "vitest";
import { SWIPE_DOWN_ENGAGE_PX, shouldDismissOnRelease, shouldEngageSwipeDown, swipeDownThreshold } from "./swipeDownDismiss";

describe("下滑关闭判据（261110）", () => {
  it("只在向下且滚动容器在顶部时接住手势（否则抢列表滚动）", () => {
    expect(shouldEngageSwipeDown(10, 0)).toBe(true);
    expect(shouldEngageSwipeDown(SWIPE_DOWN_ENGAGE_PX, 0)).toBe(false); // 需大于阈值
    expect(shouldEngageSwipeDown(10, 40)).toBe(false); // 列表已滚动
    expect(shouldEngageSwipeDown(-10, 0)).toBe(false); // 向上不接
  });

  it("松手阈值：短面板至少 72，高面板按 25% 但封顶 160", () => {
    expect(swipeDownThreshold(0)).toBe(96);
    expect(swipeDownThreshold(200)).toBe(72);
    expect(swipeDownThreshold(400)).toBe(100);
    expect(swipeDownThreshold(842)).toBe(160);
    expect(swipeDownThreshold(2000)).toBe(160);
    expect(shouldDismissOnRelease(99, 400)).toBe(false);
    expect(shouldDismissOnRelease(100, 400)).toBe(true);
  });
});
