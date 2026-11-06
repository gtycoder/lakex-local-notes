/**
 * 文档树多选纯判据（261106 task-8）：
 * · 只有文档（kind=note）可选；分组一律不可选；
 * · 可选集合 = 当前**可见**行（折叠分支里的文档不参与全选/计数），顺序 = 目录显示顺序。
 */
import { describe, expect, it } from "vitest";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { buildNotebookTreeIndex, flattenVisibleRows } from "./notebookTreeIndex";
import { isTreeRowSelectable, selectableTreeIds } from "./treeSelection";

const node = (id: string, parentId: string | null, sortOrder: number, over: Partial<NotebookTreeItem> = {}): NotebookTreeItem =>
  ({ id, title: "标题-" + id, kind: "note", parentId, sortOrder, icon: null, ...over });

describe("文档树多选判据", () => {
  it("只有文档可选：分组不可选", () => {
    expect(isTreeRowSelectable(node("n1", null, 0))).toBe(true);
    expect(isTreeRowSelectable(node("g1", null, 0, { kind: "group" }))).toBe(false);
  });

  it("可选 id = 可见行里的文档（顺序同目录；折叠分支不参与）", () => {
    const tree = [
      node("g1", "nb1", 0, { kind: "group", title: "分组" }),
      node("c1", "g1", 0),
      node("n1", "nb1", 1),
      node("n2", "nb1", 2),
    ];
    const collapsed = flattenVisibleRows(buildNotebookTreeIndex(tree), "nb1", new Set(["nb1"]));
    expect(selectableTreeIds(collapsed)).toEqual(["n1", "n2"]);

    const expanded = flattenVisibleRows(buildNotebookTreeIndex(tree), "nb1", new Set(["nb1", "g1"]));
    expect(selectableTreeIds(expanded)).toEqual(["c1", "n1", "n2"]);
  });

  it("没有文档（只有分组/空树）⇒ 空集合（页头不显示「选择」入口）", () => {
    expect(selectableTreeIds([])).toEqual([]);
    const groupsOnly = flattenVisibleRows(
      buildNotebookTreeIndex([node("g1", "nb1", 0, { kind: "group" })]),
      "nb1",
      new Set(["nb1"]),
    );
    expect(selectableTreeIds(groupsOnly)).toEqual([]);
  });
});
