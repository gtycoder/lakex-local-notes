import { describe, expect, it } from "vitest";
import { FONT_SIZE_FALLBACK, currentFontSize, fontStepState, nearestFontSize, stepFontSize } from "./FontSizeStepper";

/** 移动端文档字号的 8 档（= EditorDock 的 MOBILE_FONT_SIZES：内核 12 档掐头去尾）。 */
const SIZES = [14, 15, 16, 19, 22, 24, 29, 32] as const;

describe("字号步进器的档位纯函数", () => {
  it("档位上的值原样显示，± 落在相邻档（16 → 15 / 19）", () => {
    expect(fontStepState(16, SIZES)).toEqual({ current: 16, prev: 15, next: 19, atMin: false, atMax: false });
    expect(stepFontSize(16, SIZES, -1)).toBe(15);
    expect(stepFontSize(16, SIZES, 1)).toBe(19);
  });

  it("无值 = 默认 16 的最近档；± 仍按相邻档步进", () => {
    expect(FONT_SIZE_FALLBACK).toBe(16);
    expect(currentFontSize(null, SIZES)).toBe(16);
    expect(fontStepState(null, SIZES)).toEqual({ current: 16, prev: 15, next: 19, atMin: false, atMax: false });
    expect(stepFontSize(null, SIZES, -1)).toBe(15);
    expect(stepFontSize(null, SIZES, 1)).toBe(19);
  });

  it("越界值夹到最近档（低于 14 → 14；高于 32 → 32），并在边界禁用对应按钮", () => {
    expect(fontStepState(9, SIZES)).toMatchObject({ current: 14, prev: 14, next: 15, atMin: true, atMax: false });
    expect(fontStepState(40, SIZES)).toMatchObject({ current: 32, prev: 29, next: 32, atMin: false, atMax: true });
  });

  it("首尾档：− 在 14 置灰、+ 在 32 置灰，且步进返回自身", () => {
    expect(fontStepState(14, SIZES).atMin).toBe(true);
    expect(fontStepState(32, SIZES).atMax).toBe(true);
    expect(stepFontSize(14, SIZES, -1)).toBe(14);
    expect(stepFontSize(32, SIZES, 1)).toBe(32);
  });

  it("档位之间的值（如粘贴来的 18）原样显示，± 取严格相邻档（16 / 19）而不是跳档", () => {
    expect(fontStepState(18, SIZES)).toMatchObject({ current: 18, prev: 16, next: 19 });
  });

  it("最近档：默认字号不在档位表里时取真最近档（16 → 18）；等距取较大档", () => {
    expect(nearestFontSize(16, [12, 18, 24])).toBe(18);
    expect(nearestFontSize(15, [12, 18])).toBe(18);
    expect(nearestFontSize(16, [])).toBe(16);
  });

  it("档位表为空：显示默认 16，± 都置灰（不给不存在的档位）", () => {
    expect(fontStepState(null, [])).toEqual({ current: 16, prev: 16, next: 16, atMin: true, atMax: true });
    expect(stepFontSize(null, [], 1)).toBe(16);
  });
});
