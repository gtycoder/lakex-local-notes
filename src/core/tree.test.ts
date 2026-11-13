/**
 * 261114 级联删除配套：桌面删除笔记本/分组/文档时，用 subtreeIds 收集「要一起关闭的标签」。
 * 这个集合必须覆盖多级子级（否则删分组后子文档标签仍开着 ⇒ 保存被拒/关不掉）。
 */
import { describe, expect, it } from "vitest";
import { subtreeIds } from "./tree.js";
import type { TreeNode } from "./sharedTypes.js";

const T = "2026-11-13T00:00:00.000Z";
function node(id: string, parentId: string | null): TreeNode {
  return {
    id,
    workspaceId: "default",
    parentId,
    nodeType: "note",
    title: id,
    noteFileId: id,
    sortOrder: 0,
    createdAt: T,
    updatedAt: T,
    isConflict: false,
    icon: null,
  };
}

describe("subtreeIds（删除时关闭标签的子树集合）", () => {
  it("多级分组 + 多级文档：包含全部后代、不含旁观节点", () => {
    const nodes = [
      node("nb", null),
      node("g1", "nb"),
      node("g2", "g1"),
      node("doc", "g2"),
      node("child", "doc"),
      node("grand", "child"),
      node("sibling", "g1"),
      node("other", "other-nb"),
    ];
    expect([...subtreeIds(nodes, "g1")].sort()).toEqual(["child", "doc", "g1", "g2", "grand", "sibling"].sort());
    expect([...subtreeIds(nodes, "doc")].sort()).toEqual(["child", "doc", "grand"].sort());
    expect([...subtreeIds(nodes, "nb")]).toHaveLength(7);
    expect(subtreeIds(nodes, "missing").has("missing")).toBe(true); // 自身始终在集合内（调用方再比对标签）
  });

  it("父环（坏库）不会无限循环：环上节点各纳入一次", () => {
    const nodes = [node("a", "b"), node("b", "a"), node("c", "a")];
    const ids = subtreeIds(nodes, "a");
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
  });
});
