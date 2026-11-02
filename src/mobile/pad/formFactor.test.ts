import { describe, expect, it } from "vitest";
import { FORM_FACTOR_BREAKPOINTS, formFactorOf, isPadLayout } from "./formFactor";

describe("平板形态判据（按窗口宽）", () => {
  it("三档边界：<600 compact / 600–799 medium / ≥800 expanded", () => {
    expect(formFactorOf(0)).toBe("compact");
    expect(formFactorOf(412)).toBe("compact");
    expect(formFactorOf(FORM_FACTOR_BREAKPOINTS.medium - 1)).toBe("compact");
    expect(formFactorOf(FORM_FACTOR_BREAKPOINTS.medium)).toBe("medium");
    expect(formFactorOf(744)).toBe("medium");      // iPad mini 竖屏
    expect(formFactorOf(FORM_FACTOR_BREAKPOINTS.expanded - 1)).toBe("medium");
    expect(formFactorOf(FORM_FACTOR_BREAKPOINTS.expanded)).toBe("expanded");
    expect(formFactorOf(1024)).toBe("expanded");
    expect(formFactorOf(1280)).toBe("expanded");   // Galaxy Tab S9 横屏
  });

  it("非法宽度退回 compact（不因 NaN 把手机切到平板布局）", () => {
    expect(formFactorOf(Number.NaN)).toBe("compact");
    expect(formFactorOf(Number.POSITIVE_INFINITY)).toBe("compact");
  });

  it("只有 medium / expanded 算平板布局", () => {
    expect(isPadLayout("compact")).toBe(false);
    expect(isPadLayout("medium")).toBe(true);
    expect(isPadLayout("expanded")).toBe(true);
  });
});
