
// @vitest-environment jsdom
/** 多选浮动操作条（261106 task-81）：渲染 + 动作回调（不摸 IPC）。 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeSelectionBar, type TreeSelectionBarProps } from "./TreeSelectionBar";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(overrides: Partial<TreeSelectionBarProps> = {}) {
  const props: TreeSelectionBarProps = {
    count: 2,
    actions: { move: true, trash: true, tag: true },
    onMove: vi.fn(),
    onTrash: vi.fn(),
    onTag: vi.fn(),
    onSelectAll: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(TreeSelectionBar, props)));
  return props;
}
const button = (text: string): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((item) => (item.textContent ?? "").trim() === text);
  if (!found) throw new Error("找不到按钮：" + text);
  return found;
};

describe("TreeSelectionBar", () => {
  it("count 为 0 不渲染（多选未激活）", () => {
    render({ count: 0 });
    expect(document.body.querySelector(".tree-selection-bar")).toBeNull();
  });

  it("显示「已选 N 项」+ 文档三个动作 + 全选/取消", () => {
    render();
    expect(document.body.querySelector(".tree-selection-bar__count")?.textContent).toBe("已选 2 项");
    expect(button("移动…")).toBeTruthy();
    expect(button("移入回收站")).toBeTruthy();
    expect(button("打标签…")).toBeTruthy();
    expect(button("全选")).toBeTruthy();
    expect(button("取消")).toBeTruthy();
  });

  it("分组/混选只显示「移动…」（无移入回收站/打标签）", () => {
    render({ actions: { move: true, trash: false, tag: false } });
    expect(button("移动…")).toBeTruthy();
    expect([...document.body.querySelectorAll("button")].some((item) => (item.textContent ?? "").includes("移入回收站"))).toBe(false);
    expect([...document.body.querySelectorAll("button")].some((item) => (item.textContent ?? "").includes("打标签"))).toBe(false);
  });

  it("动作/全选/取消回调；busy 时全部按钮禁用", () => {
    const props = render();
    act(() => button("移动…").click());
    act(() => button("移入回收站").click());
    act(() => button("打标签…").click());
    act(() => button("全选").click());
    act(() => button("取消").click());
    expect(props.onMove).toHaveBeenCalledTimes(1);
    expect(props.onTrash).toHaveBeenCalledTimes(1);
    expect(props.onTag).toHaveBeenCalledTimes(1);
    expect(props.onSelectAll).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    render({ busy: true });
    expect([...document.body.querySelectorAll<HTMLButtonElement>("button")].every((item) => item.disabled)).toBe(true);
  });

  it("结果提示以 role=status 显示（成功/部分失败共用一条）", () => {
    render({ notice: "已移入回收站 2 项" });
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe("已移入回收站 2 项");
  });
});
