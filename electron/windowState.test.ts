import { describe, expect, it } from "vitest";
import { bootSplashBounds, clampWindowState, type WindowState } from "./windowState";

describe("window state", () => {
  it("clamps restored bounds into the display work area", () => {
    const state: WindowState = { x: -500, y: 1100, width: 1600, height: 100, maximized: false, fullscreen: false };
    expect(clampWindowState(state, { x: 0, y: 0, width: 1440, height: 900 })).toEqual({ x: 0, y: 420, width: 1440, height: 480, maximized: false, fullscreen: false });
  });

  it("falls back to safe defaults for invalid values", () => {
    expect(clampWindowState({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 0, height: -1, maximized: true, fullscreen: false }, { x: 0, y: 0, width: 1440, height: 900 })).toEqual({ x: 80, y: 40, width: 1280, height: 820, maximized: true, fullscreen: false });
  });
});

// 261127 空白窗口事故：boot splash 只按静态矩形摆放（绝不走原生 zoom/全屏过渡）。
describe("boot splash 几何", () => {
  const workArea = { x: 60, y: 33, width: 1452, height: 949 };
  const state: WindowState = { x: 146, y: 98, width: 1280, height: 820, maximized: false, fullscreen: false };

  it("普通恢复 ⇒ 沿用上次 bounds（不缩到工作区也不动位置）", () => {
    expect(bootSplashBounds(state, workArea)).toEqual({ x: 146, y: 98, width: 1280, height: 820 });
  });

  it("最大化恢复 ⇒ 直接铺满工作区（splash 与主窗口最终形态一致）", () => {
    expect(bootSplashBounds({ ...state, maximized: true }, workArea)).toEqual(workArea);
  });

  it("全屏恢复 ⇒ 同样铺满工作区，而不是让 splash 自己进原生全屏", () => {
    expect(bootSplashBounds({ ...state, fullscreen: true }, workArea)).toEqual(workArea);
  });
});
