// @vitest-environment jsdom
import { act, createElement, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTopMenus } from "./useTopMenus";

/**
 * 261112 回归：顶栏「更多」菜单里点二级菜单（如「导出 ▸」的任意一项）必须真的触发动作。
 *
 * 根因（曾经）：useTopMenus 的 pointerdown 外点关闭没认「嵌套浮层」——`<Submenu>` 的二级菜单
 * 是**独立 portal 表面**（不在 trigger/menu 的 DOM 里）⇒ pointerdown 先关父菜单、子项在 click
 * 之前被卸载，用户看到「导出不能用」。判据现与 Overlay 同源（isInsideOverlaySurface）。
 *
 * 本测试用「第二个 React root + 独立 DOM 表面」模拟 <Submenu> 的 portal 关系（不用 createPortal：
 * 那是浮层原语门禁保留给 Overlay 的），钉住三条：①子菜单内按下不关父菜单且 click 能触达；
 * ②菜单外按下仍关闭；③触发按钮/菜单表面内按下不关闭。
 */
let host: HTMLDivElement;
let root: Root;
let subHost: HTMLDivElement | null;
let subRoot: Root | null;
const state = { topMenuOpen: false, subClicks: 0 };

function MoreMenuHarness(): ReactElement {
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { topMenuOpen, setTopMenuOpen } = useTopMenus({ moreTriggerRef, moreMenuRef });
  state.topMenuOpen = topMenuOpen;
  return createElement("div", null,
    createElement("button", { ref: moreTriggerRef, onClick: () => setTopMenuOpen(true) }, "更多"),
    topMenuOpen
      ? createElement("div", { ref: moreMenuRef, "data-context-menu": true, role: "menu" },
          createElement("button", { role: "menuitem", "data-testid": "menu-item" }, "导出"))
      : null,
  );
}

/** 与 <Submenu> 同构：二级菜单在**另一个 surface**（这里用第二个 root 的独立 DOM 模拟 portal）里。 */
function mountSubmenu(): void {
  subHost = document.createElement("div");
  subHost.setAttribute("data-context-menu", "");
  document.body.append(subHost);
  subRoot = createRoot(subHost);
  act(() => {
    subRoot!.render(createElement("div", { role: "menu", className: "context-menu-submenu" },
      createElement("button", {
        role: "menuitem",
        "data-testid": "sub-item",
        onClick: () => { state.subClicks += 1; },
      }, "导出为 Markdown 资料包")));
  });
}

const openMenu = () => {
  act(() => root.render(createElement(MoreMenuHarness)));
  const trigger = host.querySelector("button")!;
  act(() => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(state.topMenuOpen).toBe(true);
};
const pointerDown = (element: Element) => act(() => { element.dispatchEvent(new Event("pointerdown", { bubbles: true })); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.topMenuOpen = false;
  state.subClicks = 0;
  subHost = null;
  subRoot = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  if (subRoot) act(() => subRoot!.unmount());
  host.remove();
  subHost?.remove();
  vi.unstubAllGlobals();
});

describe("顶栏菜单的外点关闭（嵌套二级菜单豁免）", () => {
  it("二级菜单（独立表面）里按下不关父菜单，且 click 仍能落到子项", () => {
    openMenu();
    mountSubmenu();
    const item = document.querySelector('[data-testid="sub-item"]')!;
    pointerDown(item);
    expect(state.topMenuOpen).toBe(true);
    expect(document.querySelector(".context-menu-submenu")).not.toBeNull();
    act(() => { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(state.subClicks).toBe(1);
  });

  it("菜单外的按下仍然关闭（不是把外点关闭整个废掉）", () => {
    openMenu();
    const outside = document.createElement("div");
    document.body.append(outside);
    pointerDown(outside);
    outside.remove();
    expect(state.topMenuOpen).toBe(false);
  });

  it("触发按钮与菜单表面内的按下不关闭", () => {
    openMenu();
    pointerDown(host.querySelector("button")!);
    expect(state.topMenuOpen).toBe(true);
    pointerDown(document.querySelector('[data-testid="menu-item"]')!);
    expect(state.topMenuOpen).toBe(true);
  });
});
