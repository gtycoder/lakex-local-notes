// @vitest-environment jsdom
/**
 * 「输入框不被键盘盖」判据（inputBottom ≤ innerHeight − 8）的可复用断言测试。
 * 口径与 261117 多维表键盘收口/命名弹窗真机实测一致；render 测试复用 elementKeyboardCoverage /
 * assertInputNotKeyboardCovered，不要再在测试里各抄一份不等式。
 */
import { describe, expect, it } from "vitest";

import {
  assertInputNotKeyboardCovered,
  describeKeyboardCoverage,
  elementKeyboardCoverage,
  keyboardCoverageOf,
  KEYBOARD_COVER_MARGIN_PX,
} from "./keyboardCoverage";

const elWithBottom = (bottom: number): { getBoundingClientRect(): { bottom: number } } => ({
  getBoundingClientRect: () => ({ bottom }),
});

describe("键盘遮挡纯判据（inputBottom ≤ innerHeight − 8）", () => {
  it("口径余量 = 8：恰好贴住可见底边不算被盖，超出 1px 即被盖", () => {
    expect(KEYBOARD_COVER_MARGIN_PX).toBe(8);
    expect(keyboardCoverageOf(792, 800)).toEqual({ inputBottom: 792, visibleBottom: 792, covered: false });
    expect(keyboardCoverageOf(793, 800).covered).toBe(true);
  });

  it("键盘弹起后的 innerHeight 是口径里的视口高（同输入框，视口变矮即判盖）", () => {
    expect(keyboardCoverageOf(700, 800).covered).toBe(false);
    expect(keyboardCoverageOf(700, 690).covered).toBe(true);
  });

  it("可视区底边 = innerHeight − margin；margin 可覆写", () => {
    expect(keyboardCoverageOf(500, 600, 20)).toEqual({ inputBottom: 500, visibleBottom: 580, covered: false });
    expect(keyboardCoverageOf(581, 600, 20).covered).toBe(true);
  });

  it("视口未测量（innerHeight ≤ 0）不判盖（不误报）", () => {
    expect(keyboardCoverageOf(400, 0).covered).toBe(false);
    expect(keyboardCoverageOf(400, -10).covered).toBe(false);
  });
});

describe("DOM 断言入口（jsdom：rect / innerHeight 均可 stub）", () => {
  it("elementKeyboardCoverage 取元素底边与 window.innerHeight 比对", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 522 });
    expect(elementKeyboardCoverage(elWithBottom(370))).toEqual({ inputBottom: 370, visibleBottom: 514, covered: false });
    expect(elementKeyboardCoverage(elWithBottom(515)).covered).toBe(true);
    // 显式 innerHeight 优先（设备探针常把键盘态视口高传进来）
    expect(elementKeyboardCoverage(elWithBottom(515), 600).covered).toBe(false);
  });

  it("assertInputNotKeyboardCovered：被盖抛错且带两数；未盖返回判据明细", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 522 });
    expect(assertInputNotKeyboardCovered(elWithBottom(370))).toEqual({ inputBottom: 370, visibleBottom: 514, covered: false });
    expect(() => assertInputNotKeyboardCovered(elWithBottom(600))).toThrow(/inputBottom=600 visibleBottom=514/);
  });

  it("describeKeyboardCoverage 把两数一并打出（设备对不上先看这两个数）", () => {
    expect(describeKeyboardCoverage(keyboardCoverageOf(370, 522))).toBe("inputBottom=370 visibleBottom=514（innerHeight−8）");
  });
});
