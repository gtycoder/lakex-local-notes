// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowShortcuts, type WindowShortcutHandlers } from "./useWindowShortcuts";

/**
 * 壳层快捷键接线护栏：真正的键位语义在 `src/lib/shortcuts/registry.test.ts`（纯函数）；
 * 这里验证「一个 capture 监听 + 只命中时 preventDefault + Esc 无条件 + 组字态跳过」。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Harness(props: WindowShortcutHandlers) {
  useWindowShortcuts(props);
  return null;
}

const render = (handlers: WindowShortcutHandlers) => {
  act(() => root.render(createElement(Harness, handlers)));
};

const press = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useWindowShortcuts", () => {
  it("命中壳层命令：调用 handler 并 preventDefault", () => {
    const onSearch = vi.fn();
    render({ run: { "global-search": onSearch }, onEscape: vi.fn() });
    const event = press({ key: "p", code: "KeyP", metaKey: true });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("未注册的组合键不抢：不 preventDefault、不调用任何 handler", () => {
    const onSearch = vi.fn();
    render({ run: { "global-search": onSearch }, onEscape: vi.fn() });
    const event = press({ key: "p", code: "KeyP", metaKey: true, shiftKey: true });
    expect(onSearch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("输入法组字中跳过（不抢键）", () => {
    const onCloseTab = vi.fn();
    render({ run: { "close-tab": onCloseTab }, onEscape: vi.fn() });
    const event = new KeyboardEvent("keydown", { key: "w", code: "KeyW", metaKey: true, isComposing: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("Escape 无条件交给 onEscape（菜单/浮层既有语义）", () => {
    const onEscape = vi.fn();
    render({ run: {}, onEscape });
    press({ key: "Escape", code: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("处理器缺省时不再兜底（未接线命令保持无副作用）", () => {
    render({ run: {}, onEscape: vi.fn() });
    const event = press({ key: "F9", code: "F9" });
    expect(event.defaultPrevented).toBe(false);
  });
});
