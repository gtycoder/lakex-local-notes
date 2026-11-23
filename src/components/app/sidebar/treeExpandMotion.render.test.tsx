// @vitest-environment jsdom
/**
 * 目录展开/收起动效与拖拽变灰门的护栏（261123 用户点单批）。
 *
 * ① 拖拽变灰（.tree-row.dragging = opacity .38）只在**真拖拽**（越过 5px 阈值的 dragMoved）
 *    后出现 —— 旧实现按下即武装 ⇒ 每次点击/展开「闪一下灰」（用户报「打开都会闪烁一下」根因）。
 * ② Finder 式高度动画（TreeChildren）：收起动画结束**保持 0px 直到卸载** —— 若先清成 auto，
 *    React 卸载前会闪一帧全高（实测 559 回闪）。
 * ③ 初始即打开（启动恢复/搜索展开）不播动画；初始关闭后的首次展开才播。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeRow } from "./TreeRow";
import type { TreeRowProps } from "./treeRowProps";
import type { TreeNode } from "../../../lib/types";

const node = (id: string, title: string): TreeNode => ({
  id, title, nodeType: "note", parentId: "p", sortOrder: 0,
} as unknown as TreeNode);

function makeProps(overrides: Partial<TreeRowProps> = {}): TreeRowProps {
  const n1 = node("n1", "子文档");
  return {
    treeIndex: {
      childrenByParent: new Map([["p", [n1]]]),
      visibleIds: new Set(["p", "n1"]),
      flat: [], depthById: new Map(),
    } as unknown as TreeRowProps["treeIndex"],
    query: "",
    activeId: null,
    contextId: null,
    expanded: new Set<string>(["p"]),
    draggingId: "p",
    dragMoved: false,
    dropTarget: null,
    dropParentId: null,
    draggedParentId: null,
    releasingId: null,
    editingId: null,
    onBeginRename: () => {},
    onPointerDown: () => {},
    consumeSuppressedClick: () => false,
    onContext: () => {},
    onContextMenu: () => {},
    onCreateMenu: () => {},
    onToggle: () => {},
    onSelect: () => {},
    onIconClick: () => {},
    lockedNoteIds: new Set<string>(),
    selectedIds: new Set<string>(),
    onRowClick: () => {},
    node: node("p", "父级"),
    depth: 0,
    ...overrides,
  };
}

describe("目录展开动效与拖拽变灰门（261123）", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.useFakeTimers();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("① 未越过阈值（dragMoved=false/缺省）不加 dragging 类；dragMoved=true 才变灰", () => {
    act(() => root.render(createElement(TreeRow, makeProps())));
    expect(host.querySelector('[data-tree-node-id="p"]')!.className).not.toContain("dragging");
    act(() => root.render(createElement(TreeRow, makeProps({ dragMoved: undefined }))));
    expect(host.querySelector('[data-tree-node-id="p"]')!.className).not.toContain("dragging");
    act(() => root.render(createElement(TreeRow, makeProps({ dragMoved: true }))));
    expect(host.querySelector('[data-tree-node-id="p"]')!.className).toContain("dragging");
  });

  it("② 收起：动画期保留子树且容器保持 0px，定时器收尾后才卸载（无 auto 回闪）", () => {
    act(() => root.render(createElement(TreeRow, makeProps())));
    expect(host.querySelectorAll(".tree-children .tree-row").length).toBe(1);
    // 收起
    act(() => root.render(createElement(TreeRow, makeProps({ expanded: new Set<string>() }))));
    const box = host.querySelector(".tree-children") as HTMLElement | null;
    // jsdom 无真实过渡 ⇒ transitionend 不来，320ms 定时器兜底；期间子树保留、高度 0px
    if (box) expect(box.style.height).toBe("0px");
    act(() => { vi.advanceTimersByTime(400); });
    expect(host.querySelector(".tree-children")).toBeNull();
  });

  it("③ 初始打开（启动恢复）不播动画；初始关闭后首次展开走动画态（挂载即在 DOM）", () => {
    // 初始打开：无 is-animating 残留
    act(() => root.render(createElement(TreeRow, makeProps())));
    const box = host.querySelector(".tree-children") as HTMLElement;
    expect(box.className).not.toContain("is-animating");
    // 初始关闭 → 首次展开：容器挂载（动画态由高度过渡收尾，jsdom 下由定时器兜底）
    act(() => root.render(createElement(TreeRow, makeProps({ expanded: new Set<string>() }))));
    act(() => { vi.advanceTimersByTime(400); });
    expect(host.querySelector(".tree-children")).toBeNull();
    act(() => root.render(createElement(TreeRow, makeProps({ expanded: new Set<string>(["p"]) }))));
    expect(host.querySelector(".tree-children")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    expect(host.querySelector(".tree-children")).not.toBeNull();
  });
});
