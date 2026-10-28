import { describe, expect, it } from "vitest";
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import { buildNotebookTreeIndex, firstNoteInTree, flattenVisibleRows } from "./notebookTreeIndex";

const node = (
  id: string,
  parentId: string | null,
  sortOrder: number,
  over: Partial<NotebookTreeItem> = {},
): NotebookTreeItem => ({ id, title: id, kind: "note", parentId, sortOrder, icon: null, ...over });

/** nb1 · [g1(分组) · n1 · n2(子文档)] · n3 · g2(空分组) */
const fixture = (): NotebookTreeItem[] => [
  node("g1", "nb1", 3, { kind: "group" }),
  node("n2", "g1", 1),
  node("n3", "nb1", 1),
  node("n1", "g1", 2),
  node("g2", "nb1", 4, { kind: "group" }),
];

describe("buildNotebookTreeIndex", () => {
  it("按 parentId 分桶、组内按 sortOrder 稳定排序", () => {
    const index = buildNotebookTreeIndex(fixture());
    expect(index.childrenOf("nb1").map((item) => item.id)).toEqual(["n3", "g1", "g2"]);
    expect(index.childrenOf("g1").map((item) => item.id)).toEqual(["n2", "n1"]);
  });

  it("sortOrder 相同时保持输入顺序（稳定排序，与旧 childrenOf 一致）", () => {
    const index = buildNotebookTreeIndex([
      node("b", "nb1", 1),
      node("a", "nb1", 1),
      node("c", "nb1", 0),
    ]);
    expect(index.childrenOf("nb1").map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("byId 与旧的 tree.find 同语义：重复 id 取第一个", () => {
    const index = buildNotebookTreeIndex([
      node("dup", "nb1", 1, { title: "第一篇" }),
      node("dup", "nb1", 2, { title: "第二篇" }),
    ]);
    expect(index.byId.get("dup")?.title).toBe("第一篇");
    expect(index.byId.get("missing")).toBeUndefined();
  });

  it("无子节点返回共享空数组（不分配、可安全比较引用）", () => {
    const index = buildNotebookTreeIndex(fixture());
    expect(index.childrenOf("n3")).toHaveLength(0);
    expect(index.childrenOf("n3")).toBe(index.childrenOf("不存在"));
  });

  it("parentId 为 null 的孤儿行不会挂到笔记本下", () => {
    const index = buildNotebookTreeIndex([node("orphan", null, 0), node("n", "nb1", 0)]);
    expect(index.childrenOf("nb1").map((item) => item.id)).toEqual(["n"]);
  });
});

describe("flattenVisibleRows", () => {
  it("折叠时只出根层；展开后子层紧随父行、depth 递增", () => {
    const index = buildNotebookTreeIndex(fixture());
    const collapsed = flattenVisibleRows(index, "nb1", new Set(["nb1"]));
    expect(collapsed.map((row) => row.item.id)).toEqual(["n3", "g1", "g2"]);
    expect(collapsed.every((row) => row.depth === 0)).toBe(true);

    const expanded = flattenVisibleRows(index, "nb1", new Set(["nb1", "g1"]));
    expect(expanded.map((row) => row.item.id)).toEqual(["n3", "g1", "n2", "n1", "g2"]);
    expect(expanded.map((row) => row.depth)).toEqual([0, 0, 1, 1, 0]);
  });

  it("只展开部分分支：收起分支的子行不出现在扁平结果里", () => {
    const tree = [node("g1", "nb1", 1, { kind: "group" }), node("n1", "g1", 1), node("g2", "nb1", 2, { kind: "group" }), node("n2", "g2", 1)];
    const index = buildNotebookTreeIndex(tree);
    const rows = flattenVisibleRows(index, "nb1", new Set(["nb1", "g2"]));
    expect(rows.map((row) => row.item.id)).toEqual(["g1", "g2", "n2"]);
  });

  it("脏数据成环不会死循环（visited 兜底）", () => {
    const index = buildNotebookTreeIndex([
      node("g1", "nb1", 1, { kind: "group" }),
      node("g2", "g1", 1, { kind: "group" }),
      node("g1", "g2", 2, { kind: "group" }),
    ]);
    const rows = flattenVisibleRows(index, "nb1", new Set(["nb1", "g1", "g2"]));
    expect(rows.map((row) => row.item.id)).toEqual(["g1", "g2"]);
  });

  it("2000 节点平铺：一次索引 + 一次扁平化（防回退成每次 filter+sort 的 O(n²)）", () => {
    const tree = Array.from({ length: 2000 }, (_, i) => node("fx" + i, "nb1", i));
    const started = performance.now();
    const index = buildNotebookTreeIndex(tree);
    const rows = flattenVisibleRows(index, "nb1", new Set(["nb1"]));
    const elapsed = performance.now() - started;
    expect(rows).toHaveLength(2000);
    expect(rows[1999].item.id).toBe("fx1999");
    // 实测 ≈0.3ms；阈值刻意宽松（CI 抖动），只拦「又变回每个节点 filter+sort」的量级回退。
    expect(elapsed).toBeLessThan(100);
  });
});

describe("firstNoteInTree", () => {
  it("深度优先找第一篇文档（分组在第一位时下钻）", () => {
    const index = buildNotebookTreeIndex(fixture());
    expect(firstNoteInTree(index, "nb1")?.id).toBe("n3");
  });

  it("分组整体在前时下钻到分组内第一篇文档", () => {
    const index = buildNotebookTreeIndex([
      node("g1", "nb1", 1, { kind: "group" }),
      node("n1", "g1", 1),
      node("n2", "nb1", 2),
    ]);
    expect(firstNoteInTree(index, "nb1")?.id).toBe("n1");
  });

  it("只有分组 / 空树返回 null", () => {
    expect(firstNoteInTree(buildNotebookTreeIndex([node("g1", "nb1", 1, { kind: "group" })]), "nb1")).toBeNull();
    expect(firstNoteInTree(buildNotebookTreeIndex([]), "nb1")).toBeNull();
  });
});
