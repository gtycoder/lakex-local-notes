
/** 桌面目录树多选纯逻辑（261106 task-81）：⌘ 切换 / Shift 区间跳笔记本 / 全选 / 上限 / 动作面。 */
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../lib/types";
import type { TreeIndex } from "../core/treeIndex";
import {
  EMPTY_TREE_SELECTION,
  TREE_SELECTION_MAX,
  clearTreeSelection,
  isSelectableTreeNode,
  plainClickSelection,
  pruneTreeSelection,
  rangeTreeSelection,
  selectAllVisible,
  selectableVisibleOrder,
  toggleTreeSelection,
  treeSelectionActions,
  treeSelectionLimitReached,
} from "./treeSelection";

const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder = 0): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title: id,
  noteFileId: nodeType === "note" ? id : null, sortOrder, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);

function index(nodes: TreeNode[], visibleIds?: readonly string[]): TreeIndex {
  const children = new Map<string | null, TreeNode[]>();
  for (const item of nodes) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  return { childrenByParent: children, visibleIds: new Set(visibleIds ?? nodes.map((item) => item.id)) };
}

// 目录结构：笔记本 nb → [分组 g1 → [文档 n1, n2], 文档 n3]，另一笔记本 nb2 → 文档 n4
const NODES = [
  node("nb", "notebook", null),
  node("g1", "group", "nb"),
  node("n1", "note", "g1", 0),
  node("n2", "note", "g1", 1),
  node("n3", "note", "nb", 1),
  node("nb2", "notebook", null, 1),
  node("n4", "note", "nb2"),
];

describe("可见顺序与可选性", () => {
  it("笔记本不可多选；可见顺序 = DFS，跳过笔记本但继续下钻", () => {
    expect(isSelectableTreeNode({ nodeType: "notebook" })).toBe(false);
    expect(isSelectableTreeNode({ nodeType: "group" })).toBe(true);
    expect(isSelectableTreeNode({ nodeType: "note" })).toBe(true);
    expect(selectableVisibleOrder(index(NODES))).toEqual(["g1", "n1", "n2", "n3", "n4"]);
  });

  it("筛选收窄（visibleIds 变小）后顺序也跟着变", () => {
    expect(selectableVisibleOrder(index(NODES, ["nb", "g1", "n1", "n2"]))).toEqual(["g1", "n1", "n2"]);
  });
});

describe("选择状态变换", () => {
  it("普通点击：退出多选但记锚点（方便紧接着 Shift）", () => {
    const state = plainClickSelection("n2");
    expect(state).toEqual({ ids: [], anchorId: "n2" });
  });

  it("⌘/Ctrl 点击：切换一行，按点击顺序加入；再点移除", () => {
    let state = toggleTreeSelection(EMPTY_TREE_SELECTION, "n1");
    state = toggleTreeSelection(state, "n2");
    expect(state.ids).toEqual(["n1", "n2"]);
    state = toggleTreeSelection(state, "n1");
    expect(state.ids).toEqual(["n2"]);
    expect(state.anchorId).toBe("n1");
  });

  it("Shift 区间：以锚点为界取可见顺序闭区间（自动跳过笔记本，区间内笔记本的子项照常包含）", () => {
    const order = selectableVisibleOrder(index(NODES));
    const state = rangeTreeSelection({ ids: [], anchorId: "n1" }, order, "n3");
    expect(state.ids).toEqual(["n1", "n2", "n3"]);
    // 反向（从下往上）也是同一区间
    const reverse = rangeTreeSelection({ ids: [], anchorId: "n3" }, order, "n1");
    expect(reverse.ids).toEqual(["n1", "n2", "n3"]);
  });

  it("Shift 区间：没有锚点 ⇒ 只选这一行；锚点已不可见 ⇒ 同样退化", () => {
    const order = selectableVisibleOrder(index(NODES, ["nb", "n3"]));
    expect(rangeTreeSelection(EMPTY_TREE_SELECTION, order, "n3").ids).toEqual(["n3"]);
    expect(rangeTreeSelection({ ids: [], anchorId: "n1" }, order, "n3").ids).toEqual(["n3"]);
  });

  it("Esc / 点空白：清空选择（锚点也清）", () => {
    expect(clearTreeSelection()).toEqual(EMPTY_TREE_SELECTION);
  });

  it("全选当前可见；列表变化后剔除不可选的行", () => {
    const order = selectableVisibleOrder(index(NODES));
    const all = selectAllVisible({ ids: [], anchorId: "n2" }, order);
    expect(all.ids).toEqual(order);
    expect(all.anchorId).toBe("n2");
    const pruned = pruneTreeSelection(all, ["n2", "n3"]);
    expect(pruned.ids).toEqual(["n2", "n3"]);
    expect(pruned.anchorId).toBe("n2");
    // 锚点自己被剔除 ⇒ 锚点置空
    expect(pruneTreeSelection(all, ["n3"]).anchorId).toBeNull();
  });

  it("上限 500：满了不再加入（UI 据此提示分批）", () => {
    const big = Array.from({ length: TREE_SELECTION_MAX }, (_, i) => "x" + i);
    let state = { ids: big, anchorId: "x0" } as const;
    expect(treeSelectionLimitReached(state)).toBe(true);
    expect(toggleTreeSelection(state, "y").ids).toEqual(big);
    expect(selectAllVisible(EMPTY_TREE_SELECTION, [...big, "y"]).ids).toHaveLength(TREE_SELECTION_MAX);
  });
});

describe("动作面（按选中类型）", () => {
  const byId = new Map(NODES.map((item) => [item.id, item]));

  it("全文档：移动 / 移入回收站 / 打标签都有", () => {
    const actions = treeSelectionActions(byId, { ids: ["n1", "n2"], anchorId: "n1" });
    expect(actions).toEqual({ move: true, trash: true, pin: true });
  });

  it("含分组（或只有分组）：只剩「移动…」（不提供批量删除/打标签）", () => {
    expect(treeSelectionActions(byId, { ids: ["g1"], anchorId: "g1" })).toEqual({ move: true, trash: false, pin: true });
    expect(treeSelectionActions(byId, { ids: ["g1", "n1"], anchorId: "g1" })).toEqual({ move: true, trash: false, pin: true });
  });

  it("空选择：没有任何动作", () => {
    expect(treeSelectionActions(byId, EMPTY_TREE_SELECTION)).toEqual({ move: false, trash: false, pin: false });
  });
});