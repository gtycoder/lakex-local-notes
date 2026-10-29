// @vitest-environment jsdom
/**
 * useAnchoredMenu 行为护栏（261028 DT-12）：小记页 5 个菜单 + 大纲「展开到级别」收敛成原语后的语义锁。
 *
 * 锁的五条：
 * · 默认关闭；点触发按钮开、再点同一个按钮关（原来的 toggle 口径）；
 * · aria-haspopup/aria-expanded 由 hook 补，按钮本身不用再手写；
 * · 行内「⋯」：同一个菜单服务多行 —— 打开另一行 = 切换，不关闭再打开；点同一行 = 收起；
 * · Esc / 外点关闭仍走 Overlay（这里只验 Esc）；
 * · 行内按钮的 stopPropagation 由 anchorProps 的第二个参数保留（点它不触发整行点击）。
 */
import { act, createElement, useEffect, type ButtonHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAnchoredMenu, type AnchoredMenu, type AnchoredMenuTriggerProps } from "./useAnchoredMenu";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const apiRef: { current: { menu: AnchoredMenu; rowMenu: AnchoredMenu } | null } = { current: null };
const parentClicks: { count: number } = { count: 0 };

/** jsdom 没有 ResizeObserver：usePopoverPosition 用它监听内容尺寸变化（这里只要不抛错）。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function Harness() {
  const menu = useAnchoredMenu({ gap: 6, margin: 6 });
  const rowMenu = useAnchoredMenu({ gap: 6, margin: 6 });
  useEffect(() => { apiRef.current = { menu, rowMenu }; });
  const buttonProps = (props: AnchoredMenuTriggerProps) => props as ButtonHTMLAttributes<HTMLButtonElement>;
  return createElement("div", { id: "click-host", onClick: () => { parentClicks.count += 1; } },
    createElement("button", { id: "trigger", ...buttonProps(menu.anchorProps()) }, "触发"),
    createElement("button", { id: "row-a", ...buttonProps(rowMenu.anchorProps("a", { stopPropagation: true })) }, "A"),
    createElement("button", { id: "row-b", ...buttonProps(rowMenu.anchorProps("b")) }, "B"),
    menu.menu(createElement("button", { role: "menuitem" }, "排序项"), "test-menu-surface"),
    rowMenu.menu(createElement("button", { role: "menuitem" }, "行项"), "test-row-surface"),
  );
}

const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!;
const surface = (className: string) => document.querySelector<HTMLElement>(`.${className}`);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  apiRef.current = null;
  parentClicks.count = 0;
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("useAnchoredMenu：普通菜单", () => {
  it("默认关闭；点触发按钮开、再点关；aria 由 hook 补", () => {
    expect(apiRef.current!.menu.open).toBe(false);
    expect(surface("test-menu-surface")).toBeNull();
    expect(button("trigger").getAttribute("aria-haspopup")).toBe("menu");
    expect(button("trigger").getAttribute("aria-expanded")).toBe("false");

    act(() => button("trigger").click());
    expect(apiRef.current!.menu.open).toBe(true);
    expect(surface("test-menu-surface")).not.toBeNull();
    expect(button("trigger").getAttribute("aria-expanded")).toBe("true");
    // 表面仍是 Overlay 的 .ln-overlay-surface（类名/表面由 Overlay 单一来源提供）
    expect(surface("test-menu-surface")!.className).toContain("ln-overlay-surface");

    act(() => button("trigger").click());
    expect(apiRef.current!.menu.open).toBe(false);
    expect(surface("test-menu-surface")).toBeNull();
    expect(button("trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("定位已算完（不再是屏外 -9999 的占位帧）", () => {
    act(() => button("trigger").click());
    const el = surface("test-menu-surface")!;
    expect(el.style.left).not.toBe("-9999px");
    expect(el.style.left.endsWith("px")).toBe(true);
    expect(el.style.visibility).not.toBe("hidden");
  });

  it("Esc 关闭（Overlay 的栈顶语义不变）", () => {
    act(() => button("trigger").click());
    expect(apiRef.current!.menu.open).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(apiRef.current!.menu.open).toBe(false);
    expect(surface("test-menu-surface")).toBeNull();
  });
});

describe("useAnchoredMenu：行内「⋯」菜单（同一个菜单服务多行）", () => {
  it("打开 A → aria 只落在 A；改点 B = 切换（不关闭再开）；再点 B = 收起", () => {
    act(() => button("row-a").click());
    expect(apiRef.current!.rowMenu.open).toBe(true);
    expect(apiRef.current!.rowMenu.id).toBe("a");
    expect(apiRef.current!.rowMenu.isOpenFor("a")).toBe(true);
    expect(button("row-a").getAttribute("aria-expanded")).toBe("true");
    expect(button("row-b").getAttribute("aria-expanded")).toBe("false");
    expect(surface("test-row-surface")).not.toBeNull();

    act(() => button("row-b").click());
    expect(apiRef.current!.rowMenu.open).toBe(true);
    expect(apiRef.current!.rowMenu.id).toBe("b");
    expect(button("row-a").getAttribute("aria-expanded")).toBe("false");
    expect(button("row-b").getAttribute("aria-expanded")).toBe("true");

    act(() => button("row-b").click());
    expect(apiRef.current!.rowMenu.open).toBe(false);
    expect(apiRef.current!.rowMenu.id).toBeNull();
    expect(surface("test-row-surface")).toBeNull();
  });

  it("stopPropagation 由 anchorProps 保留：点行内按钮不触发整行点击，普通按钮仍冒泡", () => {
    act(() => button("row-a").click());
    expect(parentClicks.count).toBe(0);
    act(() => button("row-b").click());
    expect(parentClicks.count).toBe(1);
  });

  it("close() 同时清 id 与锚点（关闭后 aria 全回到 false）", () => {
    act(() => button("row-a").click());
    act(() => apiRef.current!.rowMenu.close());
    expect(apiRef.current!.rowMenu.open).toBe(false);
    expect(apiRef.current!.rowMenu.id).toBeNull();
    expect(apiRef.current!.rowMenu.anchor).toBeNull();
    expect(button("row-a").getAttribute("aria-expanded")).toBe("false");
  });
});
