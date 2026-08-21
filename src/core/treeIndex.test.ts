import { describe, expect, it } from "vitest";
import { buildTreeIndex } from "./treeIndex.js";
import type { TreeNode } from "./types.js";

const nodes: TreeNode[] = [
  { id: "book", parentId: null, nodeType: "notebook", title: "工作", sortOrder: 0, updatedAt: "", syncState: "local", workspaceId: "ws", noteFileId: null, createdAt: "", isConflict: false },
  { id: "group", parentId: "book", nodeType: "group", title: "项目", sortOrder: 0, updatedAt: "", syncState: "local", workspaceId: "ws", noteFileId: null, createdAt: "", isConflict: false },
  { id: "match", parentId: "group", nodeType: "note", title: "性能记录", sortOrder: 0, updatedAt: "", syncState: "local", workspaceId: "ws", noteFileId: null, createdAt: "", isConflict: false },
  { id: "other", parentId: "book", nodeType: "note", title: "日记", sortOrder: 1, updatedAt: "", syncState: "local", workspaceId: "ws", noteFileId: null, createdAt: "", isConflict: false },
];

describe("buildTreeIndex", () => {
  it("indexes sorted children and keeps all nodes visible without a query", () => {
    const index = buildTreeIndex(nodes, "");
    expect(index.childrenByParent.get(null)?.map((node) => node.id)).toEqual(["book"]);
    expect(index.childrenByParent.get("book")?.map((node) => node.id)).toEqual(["group", "other"]);
    expect([...index.visibleIds]).toEqual(["book", "group", "match", "other"]);
  });

  it("keeps matching ancestors visible while excluding unrelated branches", () => {
    const index = buildTreeIndex(nodes, "性能");
    expect([...index.visibleIds].sort()).toEqual(["book", "group", "match"]);
    expect(index.childrenByParent.get("book")?.filter((node) => index.visibleIds.has(node.id)).map((node) => node.id)).toEqual(["group"]);
  });
});