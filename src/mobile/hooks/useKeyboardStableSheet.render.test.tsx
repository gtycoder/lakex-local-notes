// @vitest-environment jsdom
/**
 * 261106 task-94：键盘「覆盖而不推动」弹窗。
 * 覆盖：纯判据（键盘高度/补偿样式/露出滚动量）、hook（focusin 记录几何 → 视口变矮钉住 top/height →
 * 键盘收起还原；无键盘零副作用）、以及 MobileSheet 原语接线（所有含输入 Sheet 共用）。
 */
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compensatedSheetStyle,
  keyboardInsetOf,
  scrollDeltaToReveal,
  useKeyboardStableSheet,
} from "./useKeyboardStableSheet";
import { MobileSheet } from "../ui/MobileSheet";

const setInnerHeight = (value: number): void => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value });
};
const rect = (top: number, height: number): DOMRect => ({
  top, height, bottom: top + height, left: 0, right: 390, width: 390, x: 0, y: top,
  toJSON: () => ({}),
} as DOMRect);

describe("纯判据", () => {
  it("键盘高度：不足阈值（<80）视为 0；否则取差值", () => {
    expect(keyboardInsetOf(800, 480)).toBe(320);
    expect(keyboardInsetOf(800, 750)).toBe(0);   // 地址栏抖动不算键盘
    expect(keyboardInsetOf(800, 800)).toBe(0);
    expect(keyboardInsetOf(0, 0)).toBe(0);
  });

  it("补偿样式：top/height 固定、bottom:auto、max-height:none（底边落到键盘下方）", () => {
    expect(compensatedSheetStyle({ top: 200, height: 600 })).toEqual({ top: "200px", height: "600px", bottom: "auto", maxHeight: "none" });
  });

  it("输入框露出所需滚动量：超出可见底边才滚，带余量", () => {
    expect(scrollDeltaToReveal(760, 700)).toBe(72);
    expect(scrollDeltaToReveal(600, 700)).toBe(0);
  });
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Harness({ enabled = true }: { enabled?: boolean }) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useKeyboardStableSheet(sheetRef, enabled);
  return createElement("div", { ref: sheetRef, "data-testid": "sheet" },
    createElement("div", { className: "mb-sheet__body" }, createElement("input", { "aria-label": "输入" })));
}

const renderHarness = async (enabled = true): Promise<HTMLElement> => {
  await act(async () => { root.render(createElement(Harness, { enabled })); });
  const sheet = host.querySelector('[data-testid="sheet"]') as HTMLElement;
  sheet.getBoundingClientRect = () => rect(200, 600);
  return sheet;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  setInnerHeight(800);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useKeyboardStableSheet", () => {
  it("focus 记录几何；视口变矮 ⇒ 钉住 top/height；键盘收起 ⇒ 还原", async () => {
    const sheet = await renderHarness();
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    setInnerHeight(480);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("200px");
    expect(sheet.style.height).toBe("600px");
    expect(sheet.style.bottom).toBe("auto");
    expect(sheet.style.maxHeight).toBe("none");

    setInnerHeight(800);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("");
    expect(sheet.style.height).toBe("");
  });

  it("没有键盘（视口不变/小抖动）⇒ 零副作用", async () => {
    const sheet = await renderHarness();
    const input = host.querySelector("input")!;
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    setInnerHeight(760);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("");
    expect(sheet.style.height).toBe("");
  });

  it("enabled=false（Sheet 未打开）⇒ 不挂监听、不写样式", async () => {
    const sheet = await renderHarness(false);
    setInnerHeight(480);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("");
  });
});

describe("MobileSheet 原语接线（所有含输入 Sheet 共用）", () => {
  it("输入框获得焦点后键盘弹起：.mb-sheet 的 top/height 被钉住，关闭键盘后还原", async () => {
    await act(async () => {
      root.render(createElement(MobileSheet, {
        open: true,
        title: "标签",
        onClose: () => undefined,
        children: createElement("input", { "aria-label": "标签名" }),
      }));
    });
    const sheet = host.querySelector(".mb-sheet") as HTMLElement;
    expect(sheet).toBeTruthy();
    sheet.getBoundingClientRect = () => rect(300, 500);
    const input = host.querySelector('input[aria-label="标签名"]') as HTMLInputElement;
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    setInnerHeight(500);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("300px");
    expect(sheet.style.height).toBe("500px");

    setInnerHeight(800);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("");
  });
});
