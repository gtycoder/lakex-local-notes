import { describe, expect, it } from "vitest";
import { computeDropPosition, computeSiblingDragOffsets, getDropIndicator, isCrossingSibling, isValidTreeDrop } from "./treeDrag";

describe("tree drag offsets", () => {
  it("moves the siblings between source and target up when dragging down", () => {
    expect(computeSiblingDragOffsets(["a", "b", "c", "d"], "a", "c", "after", 38)).toEqual({ b: -38, c: -38 });
  });

  it("moves the siblings between target and source down when dragging up", () => {
    expect(computeSiblingDragOffsets(["a", "b", "c", "d"], "d", "b", "before", 38)).toEqual({ b: 38, c: 38 });
  });

  it("does not displace siblings for inside drops or the source row", () => {
    expect(computeSiblingDragOffsets(["a", "b"], "a", "b", "inside", 38)).toEqual({});
    expect(computeSiblingDragOffsets(["a", "b"], "a", "a", "after", 38)).toEqual({});
  });

  it("shows the crossing state only for before/after sibling movement", () => {
    expect(isCrossingSibling("a", "b", "before")).toBe(true);
    expect(isCrossingSibling("a", "b", "after")).toBe(true);
    expect(isCrossingSibling("a", "b", "inside")).toBe(false);
    expect(isCrossingSibling("a", "b", "before", false)).toBe(false);
  });
});


describe("tree drop validity", () => {
  const notebook = { id: "nb", nodeType: "notebook" as const, parentId: null };
  const group = { id: "g", nodeType: "group" as const, parentId: "nb" };
  const note = { id: "n", nodeType: "note" as const, parentId: "nb" };

  it("rejects moving a note/group before or after a root notebook", () => {
    expect(isValidTreeDrop(note, notebook, "before")).toBe(false);
    expect(isValidTreeDrop(group, notebook, "after")).toBe(false);
  });

  it("allows moving a child before/after a sibling inside its notebook", () => {
    expect(isValidTreeDrop(note, group, "before")).toBe(true);
    expect(isValidTreeDrop(group, note, "after")).toBe(true);
  });
});


describe("drop indicator", () => {
  it("uses a line for every before/after drop, including cross-level drops", () => {
    expect(getDropIndicator("before")).toBe("line");
    expect(getDropIndicator("after")).toBe("line");
    expect(getDropIndicator("inside")).toBe("parent");
  });
});


describe("computeDropPosition（行高自适应阈值）", () => {
  const rect38 = { top: 100, height: 38 };
  it("顶部 6px 内 → before（38 行高 25% = 9.5，取 min(12, max(6, 9.5)) = 9.5）", () => {
    expect(computeDropPosition(rect38, 100 + 5)).toBe("before");
  });
  it("中间 → inside", () => {
    expect(computeDropPosition(rect38, 100 + 19)).toBe("inside");
  });
  it("底部 6px 内 → after", () => {
    expect(computeDropPosition(rect38, 100 + 37)).toBe("after");
  });
  it("小行（28px）阈值 = max(6, 28*0.25=7) = 7px → 7px 内 before", () => {
    expect(computeDropPosition({ top: 0, height: 28 }, 2)).toBe("before"); // 2 < 7
    expect(computeDropPosition({ top: 0, height: 28 }, 7)).toBe("before"); // 边界 = 7 → before（ratio < zone）
    expect(computeDropPosition({ top: 0, height: 28 }, 8)).toBe("inside"); // 8 > 7 → inside
  });
  it("无有效行高返回 null", () => {
    expect(computeDropPosition({ top: 0, height: 0 }, 10)).toBeNull();
  });
});

