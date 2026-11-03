import { describe, expect, it } from "vitest";
import { FORM_FACTOR_BREAKPOINTS, effectiveWindowHeight, formFactorOf, isPadLayout } from "./formFactor";

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

  it("键盘不改形态：有效高度取「innerHeight 与稳定外壳高」的较大值", () => {
    // 平板 1280×744，弹键盘后 innerHeight 掉到 460：稳定外壳高 744 ⇒ 仍是 expanded
    expect(effectiveWindowHeight(460, 744)).toBe(744);
    expect(formFactorOf(1280, effectiveWindowHeight(460, 744))).toBe("expanded");
    // 手机横屏 915×412：稳定外壳高也是 412 ⇒ 仍是 medium
    expect(formFactorOf(915, effectiveWindowHeight(412, 412))).toBe("medium");
    // 首次启动 shell 尚未测量（0）⇒ 等价旧行为
    expect(effectiveWindowHeight(412, 0)).toBe(412);
    expect(effectiveWindowHeight(0, 0)).toBe(0);
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
