// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { usePanelDrag } from "./usePanelDrag";

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
