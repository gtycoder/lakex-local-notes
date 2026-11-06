
/** 「移动…」目录树纯逻辑（261106 task-90）：展开/当前位置/搜索祖先展开/防环/回收站/只允许容器。 */
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../lib/types";
import {
  MOVE_TREE_DISABLED_REASON,
  buildMoveTreeRows,
  currentParentOf,
  initialMoveTreeExpanded,
  moveForbiddenIds,
  visibleMoveTreeRows,
} from "./moveTreeModel";

const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder = 0, title = id): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title,
  noteFileId: nodeType === "note" ? id : null, sortOrder, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);

// nb1 → g1 → [n1, g2 → n2], nb1 → [n3]；nb2 → g3
const NODES = [
  node("nb1", "notebook", null, 0, "笔记本一"),
  node("g1", "group", "nb1", 0, "分组一"),
  node("n1", "note", "g1", 0, "文档一"),
  node("g2", "group", "g1", 1, "分组二"),
  node("n2", "note", "g2", 0, "文档二"),
  node("n3", "note", "nb1", 1, "文档三"),
  node("nb2", "notebook", null, 1, "笔记本二"),
  node("g3", "group", "nb2", 0, "分组三"),
];

const build = (overrides: Partial<Parameters<typeof buildMoveTreeRows>[0]> = {}) =>
  buildMoveTreeRows({ nodes: NODES, movingIds: [], currentParentId: null, expanded: new Set<string>(), query: "", ...overrides });

describe("移动树：层级与展开", () => {
  it("只列容器（笔记本/分组），按目录顺序父在前", () => {
    const { rows } = build({ expanded: new Set(["nb1", "g1"]) });
    expect(rows.map((row) => row.id)).toEqual(["nb1", "g1", "g2", "nb2", "g3"]);
    expect(rows.find((row) => row.id === "n1")).toBeUndefined();
  });

  it("折叠时子项不可见；可见行由父链展开决定", () => {
    const collapsed = build({ expanded: new Set<string>() });
    expect(visibleMoveTreeRows(collapsed.rows).map((row) => row.id)).toEqual(["nb1", "nb2"]);
    const expanded = build({ expanded: new Set(["nb1", "g1", "nb2"]) });
    expect(visibleMoveTreeRows(expanded.rows).map((row) => row.id)).toEqual(["nb1", "g1", "g2", "nb2", "g3"]);
  });

  it("默认展开当前路径（当前父级 + 全部祖先），并标记「当前位置」", () => {
    const expanded = initialMoveTreeExpanded(NODES, "g1");
    expect([...expanded].sort()).toEqual(["g1", "nb1"]);
    const rows = build({ expanded, currentParentId: "g1" }).rows;
    expect(rows.find((row) => row.id === "g1")?.current).toBe(true);
    expect(rows.filter((row) => row.current)).toHaveLength(1);
    expect(visibleMoveTreeRows(rows).map((row) => row.id)).toContain("g2");
  });

  it("当前父级：单条/同父级批量给出；跨父级批量 = null", () => {
    expect(currentParentOf(NODES, ["n1"])).toBe("g1");
    expect(currentParentOf(NODES, ["n1", "n3"])).toBeNull();
    expect(currentParentOf(NODES, ["g1"])).toBe("nb1");
    expect(currentParentOf(NODES, [])).toBeNull();
  });
});

describe("移动树：搜索", () => {
  it("命中项自动展开祖先并高亮；只保留命中 + 祖先链", () => {
    const { rows, matchedIds } = build({ query: "分组二" });
    expect([...matchedIds]).toEqual(["g2"]);
    expect(rows.map((row) => row.id)).toEqual(["nb1", "g1", "g2"]);
    expect(rows.every((row) => row.expanded)).toBe(true);
    expect(rows.find((row) => row.id === "g2")?.matched).toBe(true);
  });

  it("清空搜索恢复树（不保留搜索态强制展开）", () => {
    const { rows } = build({ expanded: new Set<string>() });
    expect(visibleMoveTreeRows(rows).map((row) => row.id)).toEqual(["nb1", "nb2"]);
  });
});

describe("移动树：防环与回收站", () => {
  it("排除自身及其全部后代（禁用并给原因）", () => {
    // 禁用集 = 自身 + 全部后代（含文档；文档本来也不是目标）
    expect([...moveForbiddenIds(NODES, ["g1"])].sort()).toEqual(["g1", "g2", "n1", "n2"]);
    const rows = build({ expanded: new Set(["nb1", "g1"]), movingIds: ["g1"] }).rows;
    expect(rows.find((row) => row.id === "g1")?.disabled).toBe(true);
    expect(rows.find((row) => row.id === "g1")?.reason).toBe(MOVE_TREE_DISABLED_REASON.self);
    expect(rows.find((row) => row.id === "g2")?.disabled).toBe(true);
    expect(rows.find((row) => row.id === "nb2")?.disabled).toBe(false);
  });

  it("回收站内节点禁用并给原因（可缺省）", () => {
    const rows = build({ expanded: new Set(["nb2"]), trashedIds: new Set(["g3"]) }).rows;
    expect(rows.find((row) => row.id === "g3")?.disabled).toBe(true);
    expect(rows.find((row) => row.id === "g3")?.reason).toBe(MOVE_TREE_DISABLED_REASON.trashed);
  });
});
