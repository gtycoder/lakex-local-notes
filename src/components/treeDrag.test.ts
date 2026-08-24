import { describe, expect, it } from "vitest";
import { computeSiblingDragOffsets, getDropIndicator, isCrossingSibling, isValidTreeDrop } from "./treeDrag";

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
