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
  it("焦点离开窗口时允许Window目标，不把它当DOM节点传给contains", async () => {
    await render(); const errors: string[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.message); event.preventDefault(); };
    window.addEventListener("error", onError);
    try {
      const button = host.querySelector<HTMLButtonElement>("button")!; act(() => button.focus());
      // JSDOM的构造器不接受Window品牌，显式模拟窗口边界事件的目标。
      const event = new FocusEvent("focusout", { bubbles: true });
      Object.defineProperty(event, "relatedTarget", { value: window });
      act(() => button.dispatchEvent(event));
      expect(errors).toEqual([]);
    } finally { window.removeEventListener("error", onError); }
  });
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
  it("隐藏再显示、跨越24条阈值都保留编辑组件及未提交内容", async () => {
    const draw = (visible: boolean, count: number, id: string) => act(async () => {
      root.render(createElement(QuickNotesVirtualList, {
        items: items.slice(0, count), mode: "timeline", className: "quick-notes-timeline", visible, keepIds: [id], revealId: null, onRevealed: () => {},
        renderItem: item => createElement("article", { "data-quick-note-id": item.id }, createElement("input", { defaultValue: item.id })),
      }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await draw(true, 20000, "q15000");
    const editing = host.querySelector<HTMLInputElement>('[data-quick-note-id="q15000"] input')!; editing.value = "未保存的正文";
    await draw(false, 20000, "q15000"); expect(editing.isConnected).toBe(true);
    await draw(true, 20000, "q15000"); expect(host.querySelector('[data-quick-note-id="q15000"] input')).toBe(editing); expect(editing.value).toBe("未保存的正文");
    await draw(true, 25, "q0"); const first = host.querySelector<HTMLInputElement>('[data-quick-note-id="q0"] input')!; first.value = "阈值草稿";
    await draw(true, 24, "q0"); expect(host.querySelector('[data-quick-note-id="q0"] input')).toBe(first);
    await draw(true, 25, "q0"); expect(host.querySelector('[data-quick-note-id="q0"] input')).toBe(first); expect(first.value).toBe("阈值草稿");
  });
  it("媒体和内嵌控件保留自己的方向键、Home和End", async () => {
    await act(async () => {
      root.render(createElement(QuickNotesVirtualList, { items, mode: "timeline", className: "quick-notes-timeline", visible: true, keepIds: [], revealId: null, onRevealed: () => {},
        renderItem: item => createElement("article", { "data-quick-note-id": item.id }, createElement("button", null, item.id), createElement("video", { controls: true, tabIndex: 0 }), createElement("div", { role: "slider", tabIndex: 0 })),
      }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    for (const control of host.querySelectorAll<HTMLElement>('video,[role="slider"]')) {
      act(() => control.focus()); key(control, "End"); expect(document.activeElement).toBe(control);
      key(control, "ArrowDown"); expect(document.activeElement).toBe(control);
    }
  });
});
