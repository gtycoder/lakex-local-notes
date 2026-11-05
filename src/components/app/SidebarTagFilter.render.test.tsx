// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarTagFilter } from "./SidebarTagFilter";
import { EMPTY_TAG_SELECTION, type TagSelection } from "../../features/tags/tagsModel";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";

/**
 * 侧栏标签筛选 = 目录筛选浮层的**下段**（P1 三修）：不再有独立标签图标/弹层，
 * 直接渲染「包含 / 排除」两段 chips；选择状态由宿主持有（这里只回灌 onChange）。
 */
const tags: QuickNoteTagSummary[] = [
  { id: "t1", name: "灵感", createdAt: "T", updatedAt: "T", count: 0 },
  { id: "t2", name: "项目", createdAt: "T", updatedAt: "T", count: 0 },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(selection: TagSelection = EMPTY_TAG_SELECTION, props: Partial<{ tags: QuickNoteTagSummary[] }> = {}) {
  const onChange = vi.fn();
  act(() => root.render(createElement(SidebarTagFilter, { tags: props.tags ?? tags, selection, onChange })));
  return onChange;
}
const chips = (): HTMLButtonElement[] => [...document.body.querySelectorAll<HTMLButtonElement>("button.quick-note-tag")];
const chip = (label: string): HTMLButtonElement => {
  const found = chips().find((btn) => (btn.textContent ?? "").includes(label));
  if (!found) throw new Error("找不到标签 chip：" + label);
  return found;
};

describe("SidebarTagFilter（并入原 Filter 的标签段）", () => {
  it("渲染「包含 / 排除」两段（没有独立图标/触发按钮）", () => {
    render();
    expect(document.body.textContent).toContain("包含");
    expect(document.body.textContent).toContain("排除");
    // 三修：不再有独立「按标签筛选」触发按钮（原来那个 Tag 图标）
    expect(document.body.querySelector('button[aria-label="按标签筛选"]')).toBeNull();
    expect(document.body.querySelectorAll(".sidebar-tag-filter__chips")).toHaveLength(2);
  });

  it("包含切换：点击 chip 回灌 {include:[id]}；再点取消", () => {
    const onChange = render();
    act(() => chip("灵感").click());
    expect(onChange).toHaveBeenLastCalledWith({ include: ["t1"], exclude: [] });
    // 重新渲染会换一个新的 onChange mock ⇒ 用新引用断言取消动作
    const onChange2 = render({ include: ["t1"], exclude: [] });
    act(() => chip("灵感").click());
    expect(onChange2).toHaveBeenLastCalledWith({ include: [], exclude: [] });
  });

  it("排除切换与包含互斥（同一标签不会同时在两段）", () => {
    const onChange = render({ include: ["t1"], exclude: [] });
    const rows = [...document.body.querySelectorAll<HTMLElement>(".sidebar-tag-filter__row")];
    const excludeRow = rows[1]!;
    const target = [...excludeRow.querySelectorAll<HTMLButtonElement>("button.quick-note-tag")].find((btn) => (btn.textContent ?? "").includes("灵感"))!;
    act(() => target.click());
    expect(onChange).toHaveBeenLastCalledWith({ include: [], exclude: ["t1"] });
  });

  it("生效中显示摘要与清除；aria-pressed 标出选中态", () => {
    const onChange = render({ include: ["t1"], exclude: ["t2"] });
    expect(document.body.textContent).toContain("已筛选");
    expect(chip("灵感").getAttribute("aria-pressed")).toBe("true");
    act(() => document.body.querySelector<HTMLButtonElement>('button[aria-label="清除标签筛选"]')!.click());
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_TAG_SELECTION);
  });

  it("空目录：给可读提示（不再是隐形图标）", () => {
    render(EMPTY_TAG_SELECTION, { tags: [] });
    expect(document.body.textContent).toContain("还没有标签");
    expect(document.body.querySelectorAll(".quick-note-tag")).toHaveLength(0);
  });
});
