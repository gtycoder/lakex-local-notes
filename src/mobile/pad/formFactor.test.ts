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

  it("expanded 还要求高度：手机横屏 / 扁窗口回落到 medium（不把内容挤扁）", () => {
    // 手机横屏 842×390：宽度过 800，但没有高度放双侧栏 ⇒ medium 单栏（保持手机逻辑）
    expect(formFactorOf(842, 390)).toBe("medium");
    // 平板竖/横屏都有高度 ⇒ expanded
    expect(formFactorOf(800, 1280)).toBe("expanded");
    expect(formFactorOf(1280, 800)).toBe("expanded");
    // 阈值边界 559/560
    expect(formFactorOf(1024, FORM_FACTOR_BREAKPOINTS.expandedMinHeight - 1)).toBe("medium");
    expect(formFactorOf(1024, FORM_FACTOR_BREAKPOINTS.expandedMinHeight)).toBe("expanded");
    // 分屏/自由窗口的扁窗同样回落
    expect(formFactorOf(1600, 480)).toBe("medium");
    // 宽 <600 时高度不参与：仍是 compact
    expect(formFactorOf(412, 2000)).toBe("compact");
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
