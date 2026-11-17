import { describe, expect, it } from "vitest";
import { clampSheetHeight, shouldDismissFromResize, SHEET_RESIZE_MIN_RATIO } from "./useSheetResize";

describe("Sheet 高度拖拽判据", () => {
  it("高度钳制在 [35%, 92%] 视口之间", () => {
    expect(clampSheetHeight(100, 1000)).toBe(350);
    expect(clampSheetHeight(500, 1000)).toBe(500);
    expect(clampSheetHeight(2000, 1000)).toBe(920);
  });

  it("拖到最小高度后继续下拉过阈值 = 关闭；未到最小高度只调高度不关", () => {
    const min = 1000 * SHEET_RESIZE_MIN_RATIO;
    expect(shouldDismissFromResize(100, min, 1000)).toBe(true);
    expect(shouldDismissFromResize(30, min, 1000)).toBe(false); // 没过阈值
    expect(shouldDismissFromResize(100, min + 60, 1000)).toBe(false); // 还能变矮
    expect(shouldDismissFromResize(-100, min, 1000)).toBe(false); // 上拉 = 调高
  });
});
