// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { usePanelDrag } from "./usePanelDrag";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function touch(target: Element, type: "touchstart" | "touchmove", x: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: 100 }] });
  target.dispatchEvent(event);
  return event;
}

function Harness() {
  usePanelDrag({
    getPanel: () => document.querySelector<HTMLElement>(".side-panel--left"),
    getMask: () => null,
    isOpen: () => false,
    commit: () => undefined,
    canOpen: () => true,
  });
  return null;
}

describe("usePanelDrag 的命中排除", () => {
  it("画板 SVG 目标也能命中祖先的 data-prevent-swipe，不拉起目录抽屉", async () => {
    const host = document.createElement("div");
    host.innerHTML = '<div data-prevent-swipe class="mobile-board-viewer"><svg><rect /></svg></div>';
    const panel = document.createElement("aside");
    panel.className = "side-panel side-panel--left";
    document.body.append(host, panel);

    const root = createRoot(document.createElement("div"));
    const { act } = await import("react");
    await act(async () => { root.render(createElement(Harness)); });

    const svg = host.querySelector("svg")!;
    touch(svg, "touchstart", 100);
    const move = touch(svg, "touchmove", 180);

    expect(move.defaultPrevented).toBe(false);
    expect(panel.classList.contains("side-panel--swiping")).toBe(false);
    expect(panel.style.transform).toBe("");

    await act(async () => { root.unmount(); });
    host.remove();
    panel.remove();
  });
});
// ── 261106：纯点击不得当作抽屉手势（『点目录行 ⋯ 抽屉闪烁』根因） ──
function touchEnd(target: Element): Event {
  const event = new Event("touchend", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: [] });
  target.dispatchEvent(event);
  return event;
}

const dragState = { open: false, commits: [] as boolean[] };
let dragPanel: HTMLElement;
let dragMask: HTMLElement;

function DragHarness() {
  usePanelDrag({
    getPanel: () => dragPanel,
    getMask: () => dragMask,
    isOpen: () => dragState.open,
    commit: (_side, open) => { dragState.commits.push(open); dragState.open = open; },
    canOpen: () => true,
  });
  return null;
}

async function mountDragHarness() {
  const host = document.createElement("div");
  dragPanel = document.createElement("aside");
  dragPanel.className = "side-panel side-panel--left on";
  dragMask = document.createElement("div");
  dragMask.className = "side-mask on";
  document.body.append(host, dragPanel, dragMask);
  const root = createRoot(host);
  const { act } = await import("react");
  await act(async () => { root.render(createElement(DragHarness)); });
  return { act, root, host };
}

describe("usePanelDrag：tap 与 drag 分离（261106 闪烁修复）", () => {
  it("纯点击（无 touchmove）⇒ 不写内联 transform/opacity、不 commit、不加 swiping 类", async () => {
    dragState.open = true;
    dragState.commits = [];
    const { act, root, host } = await mountDragHarness();
    const target = document.createElement("div");
    document.body.append(target);
    touch(target, "touchstart", 120);
    touchEnd(target);
    expect(dragPanel.style.transform).toBe("");
    expect(dragMask.style.opacity).toBe("");
    expect(dragPanel.classList.contains("side-panel--swiping")).toBe(false);
    expect(dragState.commits).toEqual([]);
    await act(async () => { root.unmount(); });
    host.remove(); target.remove(); dragPanel.remove(); dragMask.remove();
  });

  it("真拖拽（有 touchmove）⇒ 跟手写样式、松手提交一次（打开）", async () => {
    dragState.open = false;
    dragState.commits = [];
    const { act, root, host } = await mountDragHarness();
    const target = document.createElement("div");
    document.body.append(target);
    touch(target, "touchstart", 20);
    touch(target, "touchmove", 900);
    expect(dragPanel.classList.contains("side-panel--swiping")).toBe(true);
    expect(dragPanel.style.transform).not.toBe("");
    touchEnd(target);
    expect(dragState.commits).toEqual([true]);
    expect(dragPanel.classList.contains("side-panel--swiping")).toBe(false);
    vi.useFakeTimers(); await act(async () => { vi.runAllTimers(); root.unmount(); }); vi.useRealTimers();
    host.remove(); target.remove(); dragPanel.remove(); dragMask.remove();
  });
});
