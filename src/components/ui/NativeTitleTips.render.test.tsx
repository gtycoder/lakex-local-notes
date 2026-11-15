// @vitest-environment jsdom
/**
 * NativeTitleTips（261115 A04 三修）行为护栏：
 *  ① 桌面悬停 350ms 显示 + 摘 title + aria-describedby 关联；
 *  ② 只有 title、没有别的可访问名时保留 title（tip 照样显示）；
 *  ③ 隐藏/卸载时标题与 aria-describedby 复原；
 *  ④ 移动端长按 450ms（未到不显示、到点显示、位移超 8px 取消、pointerup 收起）；
 *  ⑤ 内核区域内的 title 不接管；tip 仍是 body 下单例、组件不新增 DOM。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_DELAY_MS, LONG_PRESS_MS, LONG_PRESS_MOVE_TOLERANCE, isLongPressMoved } from "../../lib/nativeTitleTip";
import { NativeTitleTips, TIP_ID } from "./NativeTitleTips";

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
  await act(async () => { root!.render(<NativeTitleTips />); });
}

function makeAnchor(attrs: Record<string, string>, text = "", parent: Element = document.body): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (text) el.textContent = text;
  parent.appendChild(el);
  return el;
}

function firePointer(
  target: Element,
  type: string,
  init: { pointerType?: string; x?: number; y?: number; relatedTarget?: Element | null } = {},
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    relatedTarget: init.relatedTarget ?? null,
  });
  // jsdom 的 MouseEvent 没有 pointerType：补上组件读取的字段（模拟触屏/鼠标）。
  Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "mouse", configurable: true });
  act(() => { target.dispatchEvent(event); });
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const tipEl = (): HTMLElement | null => document.getElementById(TIP_ID);

describe("NativeTitleTips 桌面悬停", () => {
  it("悬停带 aria-label 的锚点：350ms 后显示 tip、摘掉 title、aria-describedby 指向 tip", async () => {
    await renderTips();
    const anchor = makeAnchor({ title: "保存文档（⌘S）", "aria-label": "保存" });
    firePointer(anchor, "pointerover");
    await advance(HOVER_DELAY_MS - 1);
    expect(tipEl()?.style.display).toBe("none");
    await advance(1);
    expect(tipEl()?.textContent).toBe("保存文档（⌘S）");
    expect(tipEl()?.style.display).toBe("block");
    expect(tipEl()?.getAttribute("role")).toBe("tooltip");
    expect(anchor.hasAttribute("title")).toBe(false);
    expect(anchor.getAttribute("aria-describedby")).toBe(TIP_ID);
  });

  it("悬停只有 title 的锚点：保留 title（不摘），tip 仍显示", async () => {
    await renderTips();
    const anchor = makeAnchor({ title: "仅标题描述" });
    firePointer(anchor, "pointerover");
    await advance(HOVER_DELAY_MS);
    expect(tipEl()?.style.display).toBe("block");
    expect(tipEl()?.textContent).toBe("仅标题描述");
    expect(anchor.getAttribute("title")).toBe("仅标题描述");
    expect(anchor.getAttribute("aria-describedby")).toBe(TIP_ID);
  });

  it("长文本/换行才加宽版类，短提示保持窄条（.ln-tip--wide 规则不变）", async () => {
    await renderTips();
    const short = makeAnchor({ title: "短提示", "aria-label": "短提示" });
    firePointer(short, "pointerover");
    await advance(HOVER_DELAY_MS);
    expect(tipEl()?.classList.contains("ln-tip--wide")).toBe(false);
    firePointer(short, "pointerout", { relatedTarget: document.body });

    const longText = "长".repeat(81);
    const long = makeAnchor({ title: longText, "aria-label": "长提示" });
    firePointer(long, "pointerover");
    await advance(HOVER_DELAY_MS);
    expect(tipEl()?.textContent).toBe(longText);
    expect(tipEl()?.classList.contains("ln-tip--wide")).toBe(true);
  });

  it("离开后：title 复原、aria-describedby 恢复原值/清理", async () => {
    await renderTips();
    const withOriginal = makeAnchor({ title: "带原值", "aria-label": "带原值", "aria-describedby": "existing-hint" });
    firePointer(withOriginal, "pointerover");
    await advance(HOVER_DELAY_MS);
    expect(withOriginal.getAttribute("aria-describedby")).toBe(TIP_ID);
    expect(withOriginal.hasAttribute("title")).toBe(false);
    firePointer(withOriginal, "pointerout", { relatedTarget: document.body });
    expect(withOriginal.getAttribute("title")).toBe("带原值");
    expect(withOriginal.getAttribute("aria-describedby")).toBe("existing-hint");
    expect(tipEl()?.style.display).toBe("none");

    const noOriginal = makeAnchor({ title: "无原值", "aria-label": "无原值" });
    firePointer(noOriginal, "pointerover");
    await advance(HOVER_DELAY_MS);
    expect(noOriginal.getAttribute("aria-describedby")).toBe(TIP_ID);
    firePointer(noOriginal, "pointerout", { relatedTarget: document.body });
    expect(noOriginal.getAttribute("title")).toBe("无原值");
    expect(noOriginal.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("NativeTitleTips 移动端长按", () => {
  it("未到 LONG_PRESS_MS 不显示；到点显示；pointerup 收起并复原 title", async () => {
    await renderTips();
    const anchor = makeAnchor({ title: "长按提示", "aria-label": "长按" });
    firePointer(anchor, "pointerdown", { pointerType: "touch", x: 10, y: 10 });
    await advance(LONG_PRESS_MS - 1);
    expect(tipEl()?.style.display).toBe("none");
    expect(anchor.getAttribute("title")).toBe("长按提示");
    await advance(1);
    expect(tipEl()?.style.display).toBe("block");
    expect(tipEl()?.textContent).toBe("长按提示");
    expect(anchor.getAttribute("aria-describedby")).toBe(TIP_ID);
    expect(anchor.hasAttribute("title")).toBe(false);

    firePointer(anchor, "pointerup", { pointerType: "touch", x: 10, y: 10 });
    expect(tipEl()?.style.display).toBe("none");
    expect(anchor.getAttribute("title")).toBe("长按提示");
    expect(anchor.hasAttribute("aria-describedby")).toBe(false);
  });

  it("pointermove 超过 8px 取消长按；恰好 8px 不取消（边界）", async () => {
    expect(isLongPressMoved({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_TOLERANCE, y: 0 })).toBe(false);
    expect(isLongPressMoved({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_TOLERANCE + 1, y: 0 })).toBe(true);

    await renderTips();
    const moving = makeAnchor({ title: "拖拽不显示" });
    firePointer(moving, "pointerdown", { pointerType: "touch", x: 100, y: 100 });
    firePointer(moving, "pointermove", { pointerType: "touch", x: 100 + LONG_PRESS_MOVE_TOLERANCE + 1, y: 100 });
    await advance(LONG_PRESS_MS);
    expect(tipEl()?.style.display).toBe("none");
    expect(moving.getAttribute("title")).toBe("拖拽不显示");

    const steady = makeAnchor({ title: "恰好边界内" });
    firePointer(steady, "pointerdown", { pointerType: "touch", x: 50, y: 50 });
    firePointer(steady, "pointermove", { pointerType: "touch", x: 50 + LONG_PRESS_MOVE_TOLERANCE, y: 50 });
    await advance(LONG_PRESS_MS);
    expect(tipEl()?.style.display).toBe("block");
    expect(tipEl()?.textContent).toBe("恰好边界内");
  });

  it("点击/滚动立即收起已显示的长按提示", async () => {
    await renderTips();
    const anchor = makeAnchor({ title: "点一下收起" });
    firePointer(anchor, "pointerdown", { pointerType: "touch", x: 5, y: 5 });
    await advance(LONG_PRESS_MS);
    expect(tipEl()?.style.display).toBe("block");
    firePointer(anchor, "click", { x: 5, y: 5 });
    expect(tipEl()?.style.display).toBe("none");

    firePointer(anchor, "pointerdown", { pointerType: "touch", x: 5, y: 5 });
    await advance(LONG_PRESS_MS);
    expect(tipEl()?.style.display).toBe("block");
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(tipEl()?.style.display).toBe("none");
  });
});

describe("NativeTitleTips 内核边界与 DOM 约束", () => {
  it(".ne-engine / .lake-editor-mount 内的 title 不接管（悬停与长按都不显示）", async () => {
    await renderTips();
    for (const cls of ["ne-engine", "lake-editor-mount"]) {
      const box = document.createElement("div");
      box.className = cls;
      document.body.appendChild(box);
      const inner = makeAnchor({ title: "内核提示" }, "", box);
      firePointer(inner, "pointerover");
      await advance(HOVER_DELAY_MS + 50);
      expect(tipEl()?.style.display).toBe("none");
      expect(inner.getAttribute("title")).toBe("内核提示");
      firePointer(inner, "pointerdown", { pointerType: "touch", x: 1, y: 1 });
      await advance(LONG_PRESS_MS);
      expect(tipEl()?.style.display).toBe("none");
      expect(inner.getAttribute("title")).toBe("内核提示");
    }
  });

  it("tip 是 body 下唯一单例，组件本身不新增包裹元素；卸载时全部复原", async () => {
    await renderTips();
    expect(host?.childElementCount).toBe(0);
    expect(document.querySelectorAll("#" + TIP_ID)).toHaveLength(1);
    await act(async () => { root!.render(<NativeTitleTips />); });
    expect(document.querySelectorAll("#" + TIP_ID)).toHaveLength(1);

    const anchor = makeAnchor({ title: "卸载复原", "aria-label": "卸载复原" });
    firePointer(anchor, "pointerover");
    await advance(HOVER_DELAY_MS);
    expect(anchor.getAttribute("aria-describedby")).toBe(TIP_ID);

    act(() => { root!.unmount(); });
    root = null;
    expect(tipEl()).toBeNull();
    expect(anchor.getAttribute("title")).toBe("卸载复原");
    expect(anchor.hasAttribute("aria-describedby")).toBe(false);

    // 卸载后监听已移除：再悬停不会重建 tip。
    firePointer(anchor, "pointerover");
    await advance(HOVER_DELAY_MS);
    expect(tipEl()).toBeNull();
  });
});
