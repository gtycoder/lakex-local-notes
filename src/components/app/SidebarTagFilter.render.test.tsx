// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarTagFilter } from "./SidebarTagFilter";
import { EMPTY_TAG_SELECTION, type TagSelection } from "../../features/tags/tagsModel";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";

/** 侧栏「按标签筛选」（P1）：chips + 多选包含/排除；a11y：按钮都有 aria 名称。 */
const tags: QuickNoteTagSummary[] = [
  { id: "t1", name: "灵感", createdAt: "T", updatedAt: "T", count: 0 },
  { id: "t2", name: "项目", createdAt: "T", updatedAt: "T", count: 0 },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // usePopoverPosition 测量时要 ResizeObserver（jsdom 没有）。
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(selection: TagSelection) {
  const onChange = vi.fn();
  act(() => root.render(createElement(SidebarTagFilter, { tags, selection, onChange })));
  return onChange;
}
const buttonByAria = (label: string): HTMLButtonElement => {
  const found = document.body.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
  if (!found) throw new Error("找不到按钮：" + label);
  return found;
};

describe("SidebarTagFilter（侧栏按标签筛选）", () => {
  it("默认只有「按标签筛选」按钮；展开后出现包含/排除两段", () => {
    render(EMPTY_TAG_SELECTION);
    expect(buttonByAria("按标签筛选").getAttribute("aria-pressed")).toBe("false");
    act(() => buttonByAria("按标签筛选").click());
    expect(document.body.textContent).toContain("必须同时包含");
    expect(document.body.textContent).toContain("排除");
    expect(buttonByAria("按标签筛选").getAttribute("aria-pressed")).toBe("true");
  });

  it("包含/排除互相切换（同一标签不会同时出现在两边）", () => {
    const onChange = render(EMPTY_TAG_SELECTION);
    act(() => buttonByAria("按标签筛选").click());
    const includeChip = [...document.body.querySelectorAll<HTMLButtonElement>(".sidebar-tag-filter__chips .quick-note-tag")].find((btn) => (btn.textContent ?? "").includes("灵感"))!;
    act(() => includeChip.click());
    expect(onChange).toHaveBeenLastCalledWith({ include: ["t1"], exclude: [] });
  });

  it("生效中的选择显示为 chips，可单个移除或一键清除", () => {
    const onChange = render({ include: ["t1"], exclude: ["t2"] });
    expect(document.body.textContent).toContain("灵感");
    expect(document.body.textContent).toContain("非 项目");
    act(() => buttonByAria("移除包含标签 灵感").click());
    expect(onChange).toHaveBeenLastCalledWith({ include: [], exclude: ["t2"] });
    const clear = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "") === "清除")!;
    act(() => clear.click());
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_TAG_SELECTION);
  });

  it("目录为空时面板显示「还没有标签」", () => {
    act(() => root.render(createElement(SidebarTagFilter, { tags: [], selection: EMPTY_TAG_SELECTION, onChange: () => {} })));
    act(() => buttonByAria("按标签筛选").click());
    expect(document.body.textContent).toContain("还没有标签");
  });
});
