// @vitest-environment jsdom
/**
 * 移动端 title 气泡（261115 A04）：
 *  · 薄壳 MobileTitleTips 只调共享 installNativeTitleTips，class 用 mb-tip；
 *  · 触屏走长按 450ms，显示/复原 aria-describedby；
 *  · 静态卡住：移动端不 import 桌面组件，MobileApp 挂一次，kit.css 有 mb-tip 自有规则。
 */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS } from "../../lib/nativeTitleTip";
import { MOBILE_TIP_ID, MobileTitleTips } from "./MobileTitleTips";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
});

async function renderTips(): Promise<void> {
  await act(async () => { root!.render(<MobileTitleTips />); });
}

function makeAnchor(attrs: Record<string, string>, text = ""): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (text) el.textContent = text;
  document.body.appendChild(el);
  return el;
}

function firePointer(target: Element, type: string, init: { pointerType?: string; x?: number; y?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 0, clientY: init.y ?? 0 });
  Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "mouse", configurable: true });
  act(() => { target.dispatchEvent(event); });
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const tipEl = (): HTMLElement | null => document.getElementById(MOBILE_TIP_ID);

describe("MobileTitleTips", () => {
  it("触屏长按 450ms 显示 mb-tip、关联 aria-describedby；pointerup 收起并复原", async () => {
    await renderTips();
    const anchor = makeAnchor({ title: "移动端提示", "aria-label": "移动端" });
    firePointer(anchor, "pointerdown", { pointerType: "touch", x: 12, y: 20 });
    await advance(LONG_PRESS_MS - 1);
    expect(tipEl()?.style.display).toBe("none");
    await advance(1);

    const tip = tipEl();
    expect(tip?.className).toBe("mb-tip");
    expect(tip?.getAttribute("role")).toBe("tooltip");
    expect(tip?.textContent).toBe("移动端提示");
    expect(tip?.style.display).toBe("block");
    expect(anchor.getAttribute("aria-describedby")).toBe(MOBILE_TIP_ID);
    expect(anchor.hasAttribute("title")).toBe(false);

    firePointer(anchor, "pointerup", { pointerType: "touch", x: 12, y: 20 });
    expect(tipEl()?.style.display).toBe("none");
    expect(anchor.getAttribute("title")).toBe("移动端提示");
    expect(anchor.hasAttribute("aria-describedby")).toBe(false);
  });

  it("长文本走 mb-tip--wide（移动端宽版类）", async () => {
    await renderTips();
    const anchor = makeAnchor({ title: "长".repeat(81), "aria-label": "长提示" });
    firePointer(anchor, "pointerdown", { pointerType: "touch", x: 1, y: 1 });
    await advance(LONG_PRESS_MS);
    expect(tipEl()?.classList.contains("mb-tip--wide")).toBe(true);
  });
});

describe("移动端 title 拦截器接线（静态）", () => {
  it("MobileTitleTips 不 import 桌面组件；MobileApp 只挂一次；kit.css 有 mb-tip 自有规则", () => {
    const shell = read("./MobileTitleTips.tsx");
    expect(shell).toContain('from "../../lib/nativeTitleTip"');
    expect(shell).not.toMatch(/components\//);

    const app = read("../MobileApp.tsx");
    expect(app).toContain('from "./ui/MobileTitleTips"');
    expect(app).toContain("<MobileTitleTips />");
    expect(app).not.toMatch(/NativeTitleTips/);

    const kit = read("../kit.css");
    expect(kit).toMatch(/^\.mb-tip \{/m);
    expect(kit).toMatch(/^\.mb-tip--wide \{/m);
    expect(kit).toMatch(/z-index: var\(--lake-z-tooltip\)/);
  });
});
