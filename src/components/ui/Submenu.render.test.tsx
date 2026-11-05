// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Submenu } from "./Overlay";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const key = (element: Element, value: string) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); });
describe("子菜单键盘路径", () => {
  it("可聚焦触发器，右键展开/上下移动/左键回到触发器/Esc先关子层", () => {
    act(() => root.render(createElement(Submenu, { label: "导出", children: [createElement("button", { key: 1, role: "menuitem" }, "PDF"), createElement("button", { key: 2, role: "menuitem", disabled: true }, "不可用"), createElement("button", { key: 3, role: "menuitem" }, "Word")] })));
    const trigger = host.querySelector("button")!; act(() => trigger.focus()); key(trigger, "ArrowRight");
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.context-menu-submenu button:not(:disabled)')]; expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], "ArrowDown"); expect(document.activeElement).toBe(buttons[1]); key(buttons[1], "Home"); expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], "ArrowLeft"); expect(document.querySelector('.context-menu-submenu')).toBeNull(); expect(document.activeElement).toBe(trigger);
    key(trigger, "ArrowUp"); expect(document.activeElement?.textContent).toBe("Word"); key(document.activeElement!, "Tab"); expect(document.activeElement).toBe(trigger); key(trigger, "ArrowUp"); key(document.activeElement!, "Escape"); expect(document.activeElement).toBe(trigger); expect(document.querySelector('.context-menu-submenu')).toBeNull();
  });
});
