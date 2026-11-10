// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeIconPicker } from "./NodeIconPicker";

/**
 * 目录节点图标/表情选择器（261110 第二批）：两组页签统一走 kit 的 .ln-tabs__item；
 * 表情/插画选择格（__emoji / .node-icon-cell）是登记过的**面板专属网格例外**（格高由栅格决定，
 * 硬降成 27px 图标钮会把表情与插画挤扁），这里只断言例外仍存在、且页签不再是自定义类。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let anchor: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  anchor = document.createElement("button");
  document.body.append(anchor);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); anchor.remove(); vi.unstubAllGlobals(); });

const classesOf = (el: Element): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

describe("NodeIconPicker（261110 第二批）", () => {
  it("顶部两页签 = ln-tabs__item（不再有 node-icon-picker__type-tab）", () => {
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "notebook", value: null, onPick: vi.fn(), onClose: vi.fn() })));
    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('.node-icon-picker__types [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["表情符号", "图标"]);
    for (const tab of tabs) {
      expect(tab.className).toContain("ln-tabs__item");
      expect(classesOf(tab).every((name) => name.startsWith("ln-") || name.startsWith("is-"))).toBe(true);
    }
    expect(document.body.querySelector(".node-icon-picker__type-tab")).toBeNull();
    // 移除钮已是 ln-btn--ghost（第一批）
    const remove = [...document.body.querySelectorAll<HTMLButtonElement>(".node-icon-picker__types button")].find((b) => (b.textContent ?? "").includes("移除"))!;
    expect(remove.className).toContain("ln-btn--ghost");
  });

  it("切到「图标」页：插画格是登记例外（node-icon-cell），点击回灌图标值", () => {
    const onPick = vi.fn();
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "notebook", value: null, onPick, onClose: vi.fn() })));
    const iconTab = [...document.body.querySelectorAll<HTMLButtonElement>('.node-icon-picker__types [role="tab"]')].find((b) => (b.textContent ?? "") === "图标")!;
    act(() => iconTab.click());
    const cells = [...document.body.querySelectorAll<HTMLButtonElement>(".node-icon-cell")];
    expect(cells.length).toBeGreaterThan(0);
    act(() => cells[0]!.click());
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("文档类型（note）= 只有表情，不渲染页签", () => {
    act(() => root.render(createElement(NodeIconPicker, { anchor, nodeType: "note", value: null, onPick: vi.fn(), onClose: vi.fn() })));
    expect(document.body.querySelector(".node-icon-picker__types")).toBeNull();
    expect(document.body.querySelector(".node-icon-picker__head")).not.toBeNull();
  });
});
