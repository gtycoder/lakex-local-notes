// @vitest-environment jsdom
/**
 * 261110 用户点单：底部 Sheet 下滑关闭（跟手 → 过阈值关闭 / 未过回弹）。
 * 这条护栏只验 DOM 接线（判据本身在 swipeDownDismiss.test.ts）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSheet } from "./MobileSheet";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
});

const touch = (type: string, clientY: number) => {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  const list = [{ clientX: 10, clientY }];
  Object.defineProperty(ev, "touches", { value: type !== "touchend" && type !== "touchcancel" ? list : [] });
  Object.defineProperty(ev, "changedTouches", { value: list });
  return ev;
};

const render = (onClose: () => void, open = true) => act(() => {
  root.render(createElement(MobileSheet, { open, title: "筛选", onClose, children: createElement("div", null, "body") }));
});

describe("MobileSheet 下滑关闭（261110）", () => {
  it("拖过阈值松手 → 关闭；拖动中表面进入 is-dragging", () => {
    const sheet = document.querySelector(".mb-sheet");
    expect(sheet).toBeNull();
    const onClose = vi.fn();
    render(onClose);
    const el = document.querySelector<HTMLElement>(".mb-sheet")!;
    act(() => { el.dispatchEvent(touch("touchstart", 100)); });
    act(() => { el.dispatchEvent(touch("touchmove", 260)); });
    expect(el.classList.contains("is-dragging")).toBe(true);
    act(() => { el.dispatchEvent(touch("touchend", 260)); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("未过阈值松手 → 回弹，不关闭", () => {
    const onClose = vi.fn();
    render(onClose);
    const el = document.querySelector<HTMLElement>(".mb-sheet")!;
    act(() => { el.dispatchEvent(touch("touchstart", 100)); });
    act(() => { el.dispatchEvent(touch("touchmove", 140)); });
    act(() => { el.dispatchEvent(touch("touchend", 140)); });
    expect(onClose).not.toHaveBeenCalled();
    expect(el.classList.contains("is-dragging")).toBe(false);
  });

  it("内部滚动容器不在顶部 → 不接手势（不抢列表滚动）", () => {
    const onClose = vi.fn();
    render(onClose);
    const el = document.querySelector<HTMLElement>(".mb-sheet")!;
    const body = el.querySelector<HTMLElement>(".mb-sheet__body")!;
    Object.defineProperty(body, "scrollTop", { value: 120, configurable: true });
    act(() => { el.dispatchEvent(touch("touchstart", 100)); });
    act(() => { el.dispatchEvent(touch("touchmove", 300)); });
    expect(el.classList.contains("is-dragging")).toBe(false);
    act(() => { el.dispatchEvent(touch("touchend", 300)); });
    expect(onClose).not.toHaveBeenCalled();
  });
});
