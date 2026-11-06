
/** 「移动到…」目标候选（261106 task-81）：只列容器；排除选中项及其后代（防环）。 */
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../lib/types";
import { buildMoveTargets } from "./moveTargets";

const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder = 0): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title: id,
  noteFileId: nodeType === "note" ? id : null, sortOrder, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);

const NODES = [
  node("nb1", "notebook", null),
  node("g1", "group", "nb1"),
  node("n1", "note", "g1"),
  node("g2", "group", "nb1", 1),
  node("nb2", "notebook", null, 1),
  node("n2", "note", "nb2"),
];

describe("移动到…目标候选", () => {
  it("只列笔记本与分组（文档不是合法父级），顺序 = 目录顺序，深度用于缩进", () => {
    expect(buildMoveTargets(NODES, []).map((t) => [t.id, t.depth])).toEqual([
      ["nb1", 0], ["g1", 1], ["g2", 1], ["nb2", 0],
    ]);
  });

  it("排除选中项及其全部后代（把分组移进自己的子项 = 环）", () => {
    const targets = buildMoveTargets(NODES, ["g1"]);
    expect(targets.map((t) => t.id)).toEqual(["nb1", "g2", "nb2"]);
    // 选中文档时不妨碍任何容器（文档没有子项）
    expect(buildMoveTargets(NODES, ["n1"]).map((t) => t.id)).toEqual(["nb1", "g1", "g2", "nb2"]);
  });

  it("选中笔记本（理论不会发生）时整棵子树都不列", () => {
    expect(buildMoveTargets(NODES, ["nb1"]).map((t) => t.id)).toEqual(["nb2"]);
  });
});
