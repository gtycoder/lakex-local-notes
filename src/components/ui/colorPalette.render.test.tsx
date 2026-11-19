// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorPalette } from "./ColorPalette";
import { COLOR_BOARD_VALUES, OPTION_COLOR_BOARD_GROUPS, OPTION_COLOR_BOARD_VALUES } from "../../core/colorPalette";

/**
 * 选项色候选收窄护栏（261119 用户点单）：ColorPalette 是共享件 ——
 * 缺省仍是全量 70 色（背景/文字/填色等全色阶入口），只有传 groups 的入口（多维表选项色）才收成 2 行。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let anchor: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  anchor = document.createElement("button");
  document.body.append(anchor);
});
afterEach(() => { act(() => root.unmount()); host.remove(); anchor.remove(); vi.unstubAllGlobals(); });

const candidateHexes = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-label^="颜色 "]')]
  .map((b) => b.getAttribute("aria-label")!.slice("颜色 ".length));

describe("ColorPalette（共享选色盘）候选集合", () => {
  it("缺省 = 全量 70 内核色板 × 7 行（背景色/文字色等全色阶入口不受选项色收窄影响）", () => {
    act(() => root.render(createElement(ColorPalette, {
      anchor, value: undefined, recentKey: "test-full",
      onPick: () => {}, onClose: () => {}, defaultLabel: "无背景色", onDefault: () => {},
    })));
    expect(candidateHexes()).toEqual([...COLOR_BOARD_VALUES]);
    expect(document.querySelectorAll(".bt-color-row").length).toBe(7);
    expect(document.body.textContent).toContain("无背景色");
    expect(document.body.textContent).toContain("最近使用自定义颜色");
  });

  it("传 groups = 选项色板 ⇒ 只出 2 行 × 10 候选（上下同列同色相），默认项/最近使用/更多颜色不变", () => {
    act(() => root.render(createElement(ColorPalette, {
      anchor, value: "#FF4D4F", recentKey: "test-option", groups: OPTION_COLOR_BOARD_GROUPS,
      onPick: () => {}, onClose: () => {}, defaultLabel: "无背景色", onDefault: () => {},
    })));
    expect(candidateHexes()).toEqual([...OPTION_COLOR_BOARD_VALUES]);
    expect(document.querySelectorAll(".bt-color-row").length).toBe(2);
    // 候选仍是桌面支持集的子集（不自造色值）
    expect(candidateHexes().every((hex) => COLOR_BOARD_VALUES.includes(hex))).toBe(true);
    expect(document.body.textContent).toContain("无背景色");
    expect(document.body.textContent).toContain("最近使用自定义颜色");
    expect(document.querySelector('input[type="color"]')).toBeTruthy();
    // 已存色值照常回显选中态（optionColorHex 口径；收窄只影响可选集合）
    expect(document.querySelector(".bt-color-swatch.is-selected")).toBeTruthy();
  });
});
