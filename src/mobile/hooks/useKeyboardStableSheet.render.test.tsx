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
  liftToReveal,
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

  it("滚动余量不足时的抬升量：受 Sheet 当前 top 限制（最多抬到贴视口顶）", () => {
    expect(liftToReveal(120, 300)).toBe(120);
    expect(liftToReveal(300, 120)).toBe(120);   // 抬不动那么多 ⇒ 只抬到顶
    expect(liftToReveal(0, 300)).toBe(0);
    expect(liftToReveal(-10, 300)).toBe(0);
    expect(liftToReveal(120, 0)).toBe(0);       // 已在顶
  });
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Harness({ enabled = true, nested = false }: { enabled?: boolean; nested?: boolean }) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useKeyboardStableSheet(sheetRef, enabled);
  return createElement("div", { ref: sheetRef, "data-testid": "sheet" },
    createElement("div", { className: "mb-sheet__body" },
      nested
        ? createElement("div", { "data-testid": "inner" }, createElement("input", { "aria-label": "输入" }))
        : createElement("input", { "aria-label": "输入" })));
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

  it("小表单无滚动余量（内容不足一屏，scrollTop 调不动）⇒ 抬 Sheet 兜底露出输入框（261117）", async () => {
    const sheet = await renderHarness();
    const input = host.querySelector("input")!;
    input.getBoundingClientRect = () => rect(700, 40); // 底边 740 ⇒ 键盘（480-8）之下
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    setInnerHeight(480);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("200px"); // 先钉住（keyboard 前几何）
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    // 滚不动（jsdom 无滚动余量）⇒ 抬 Sheet：200 − min(740+12−472, 200) = 0
    expect(sheet.style.top).toBe("0px");
    expect(sheet.style.height).toBe("600px"); // 抬升不改高度
    // 键盘收起 ⇒ 整体还原
    setInnerHeight(800);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(sheet.style.top).toBe("");
  });

  it("输入框在内层滚动容器里 ⇒ 滚内层（不只 .mb-sheet__body）；够得着就不抬 Sheet", async () => {
    await act(async () => {
      root.render(createElement(Harness, { enabled: true, nested: true }));
    });
    const sheet = host.querySelector('[data-testid="sheet"]') as HTMLElement;
    sheet.getBoundingClientRect = () => rect(200, 600);
    const inner = host.querySelector('[data-testid="inner"]') as HTMLElement;
    Object.defineProperty(inner, "scrollHeight", { configurable: true, value: 400 });
    Object.defineProperty(inner, "clientHeight", { configurable: true, value: 120 });
    inner.getBoundingClientRect = () => rect(480, 120); // 底边 600，跨键盘线（可见底 472）
    const input = host.querySelector("input")!;
    // 矩形随内层 scrollTop 动态变化（滚了就动）——常量 mock 会让"滚后仍被盖"的判定失真
    input.getBoundingClientRect = () => rect(520 - inner.scrollTop, 30); // 底边 550，被键盘盖住、需要滚内层
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    setInnerHeight(480);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(inner.scrollTop).toBe(90);          // 内层被滚（550+12−472）
    expect(sheet.style.top).toBe("200px");     // 滚得动 ⇒ 不抬 Sheet
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
