// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickNotesVirtualList } from "./QuickNotesVirtualList";
class Observer { observe() {} unobserve() {} disconnect() {} }
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", Observer);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function(this: HTMLElement) { return this.classList.contains("quick-notes-virtual-item") ? 64 : 640; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 640, height: 640, top: 0, left: 0, right: 640, bottom: 640, toJSON: () => ({}) });
  HTMLElement.prototype.scrollIntoView = () => {};
  HTMLElement.prototype.scrollTo = function(options: ScrollToOptions | number = {}, y?: number) { this.scrollTop = typeof options === "number" ? y ?? 0 : options.top ?? 0; this.dispatchEvent(new Event("scroll")); };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const items = Array.from({ length: 20000 }, (_, index) => ({ id: `q${index}` }));
const render = async (keepIds: string[] = [], revealId: string | null = null) => act(async () => {
  root.render(createElement(QuickNotesVirtualList, { items, mode: "timeline", className: "quick-notes-timeline", visible: true, keepIds, revealId, onRevealed: () => {}, renderItem: item => createElement("article", { "data-quick-note-id": item.id }, createElement("button", null, item.id)) }));
  await new Promise(resolve => setTimeout(resolve, 0));
});
const key = (element: Element, value: string) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); });
describe("桌面小记窗口化", () => {
  it("2万条只挂载视口附近条目，编辑和菜单锚点可在屏外保留", async () => {
    await render(["q15000", "q19000"]);
    const mounted = host.querySelectorAll("[data-quick-note-id]"); expect(mounted.length).toBeGreaterThan(0); expect(mounted.length).toBeLessThan(80);
    expect(host.querySelector('[data-quick-note-id="q15000"]')).not.toBeNull(); expect(host.querySelector('[data-quick-note-id="q19000"]')).not.toBeNull();
    expect(host.querySelector('[aria-setsize="20000"]')).not.toBeNull();
  });
  it("搜索定位屏外目标，键盘可到末条与上一条，不把窗口边界当列表结尾", async () => {
    await render([], "q18000"); expect(host.querySelector('[data-quick-note-id="q18000"]')).not.toBeNull();
    const first = host.querySelector<HTMLButtonElement>("button")!; act(() => first.focus()); key(first, "End"); expect(document.activeElement?.textContent).toBe("q19999");
    key(document.activeElement!, "ArrowUp"); expect(document.activeElement?.textContent).toBe("q19998"); key(document.activeElement!, "Home"); expect(document.activeElement?.textContent).toBe("q0");
    expect(host.querySelectorAll("[data-quick-note-id]").length).toBeLessThan(80);
  });
});
