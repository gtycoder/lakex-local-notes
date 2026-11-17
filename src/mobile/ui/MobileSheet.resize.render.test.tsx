// @vitest-environment jsdom
/**
 * Sheet 头部拖拽调整高度（261117 用户点单：记录面板太矮、要能自主上下调整）：
 * 上拉变高、下拉变矮、松手停驻（自由停驻）；拖到最小高度继续下拉松手 = 关闭；
 * 头部拖拽**不**触发下滑关闭（手势边界：内容区下滑 = 关闭，头部拖拽 = 调高度）。
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
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const touch = (type: string, clientY: number) => {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  const list = [{ clientX: 10, clientY }];
  Object.defineProperty(ev, "touches", { value: type !== "touchend" && type !== "touchcancel" ? list : [] });
  Object.defineProperty(ev, "changedTouches", { value: list });
  return ev;
};

const render = async (onClose = vi.fn()) => {
  await act(async () => {
    root.render(createElement(MobileSheet, {
      open: true, resizable: true, title: "编辑记录", onClose,
      children: createElement("div", null, "body"),
    }));
  });
  const sheet = host.querySelector<HTMLElement>(".mb-sheet")!;
  sheet.getBoundingClientRect = () => ({ top: 200, height: 384, bottom: 584, left: 0, right: 390, width: 390, x: 0, y: 200, toJSON: () => ({}) } as DOMRect);
  return { sheet, onClose, head: host.querySelector<HTMLElement>(".mb-sheet__head")! };
};

describe("Sheet 头部拖拽调高度", () => {
  it("上拉变高、松手停驻；下拉变矮（自由停驻）", async () => {
    const { sheet, head, onClose } = await render();
    act(() => { head.dispatchEvent(touch("touchstart", 300)); });
    act(() => { head.dispatchEvent(touch("touchmove", 200)); }); // 上拉 100
    expect(sheet.style.height).toBe("484px");
    expect(onClose).not.toHaveBeenCalled(); // 头部拖拽不触发关闭
    act(() => { head.dispatchEvent(touch("touchend", 200)); });
    expect(sheet.style.height, "松手停驻").toBe("484px");
    // 下拉变矮
    act(() => { head.dispatchEvent(touch("touchstart", 200)); });
    act(() => { head.dispatchEvent(touch("touchmove", 260)); }); // 下拉 60
    expect(sheet.style.height).toBe("324px");
    act(() => { head.dispatchEvent(touch("touchend", 260)); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("拖到最小高度后继续下拉过阈值松手 = 关闭", async () => {
    const { sheet, head, onClose } = await render();
    sheet.getBoundingClientRect = () => ({ top: 400, height: 269, bottom: 669, left: 0, right: 390, width: 390, x: 0, y: 400, toJSON: () => ({}) } as DOMRect); // 已在最小高度附近
    act(() => { head.dispatchEvent(touch("touchstart", 200)); });
    act(() => { head.dispatchEvent(touch("touchmove", 300)); });
    act(() => { head.dispatchEvent(touch("touchend", 300)); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
