import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  selectionAllSelected,
  selectionClear,
  selectionCount,
  selectionEnter,
  selectionExit,
  selectionIncludes,
  selectionPrune,
  selectionSelectAll,
  selectionToggle,
} from "./selection";

describe("选择模式纯状态机（task-82）", () => {
  it("长按带 id 进入 = 只选该行；不带 id 进入 = 空选择", () => {
    expect(selectionEnter(EMPTY_SELECTION, "a")).toEqual({ active: true, ids: ["a"] });
    expect(selectionEnter(EMPTY_SELECTION)).toEqual({ active: true, ids: [] });
    expect(selectionEnter(EMPTY_SELECTION, null)).toEqual({ active: true, ids: [] });
  });

  it("选择态下点行 = 切换（未进入时点行等于以该行进入）", () => {
    expect(selectionToggle(EMPTY_SELECTION, "a")).toEqual({ active: true, ids: ["a"] });
    const one = selectionToggle(EMPTY_SELECTION, "a");
    expect(selectionToggle(one, "b")).toEqual({ active: true, ids: ["a", "b"] });
    expect(selectionToggle(selectionToggle(one, "b"), "a")).toEqual({ active: true, ids: ["b"] });
  });

  it("全选 = 可见集合去重保序；全不选 = 清空但仍留在选择模式；退出 = 复位", () => {
    const all = selectionSelectAll(EMPTY_SELECTION, ["a", "b", "a", "c"]);
    expect(all).toEqual({ active: true, ids: ["a", "b", "c"] });
    expect(selectionClear(all)).toEqual({ active: true, ids: [] });
    expect(selectionExit()).toEqual(EMPTY_SELECTION);
    expect(selectionClear(EMPTY_SELECTION)).toEqual(EMPTY_SELECTION);
  });

  it("allSelected：空可见集不算全选；包含全部可见 id 才算", () => {
    const state = selectionSelectAll(EMPTY_SELECTION, ["a", "b"]);
    expect(selectionAllSelected(state, ["a", "b"])).toBe(true);
    expect(selectionAllSelected(state, ["a", "b", "c"])).toBe(false);
    expect(selectionAllSelected(state, [])).toBe(false);
    expect(selectionAllSelected(EMPTY_SELECTION, ["a"])).toBe(false);
  });

  it("列表变化后剪枝：只保留仍可见的 id；无变化时返回同一对象", () => {
    const state = selectionSelectAll(EMPTY_SELECTION, ["a", "b", "c"]);
    expect(selectionPrune(state, ["a", "c"])).toEqual({ active: true, ids: ["a", "c"] });
    expect(selectionPrune(state, ["a", "b", "c"])).toBe(state);
    expect(selectionPrune(EMPTY_SELECTION, ["a"])).toEqual(EMPTY_SELECTION);
  });

  it("计数 / 命中判断", () => {
    const state = selectionSelectAll(EMPTY_SELECTION, ["a", "b"]);
    expect(selectionCount(state)).toBe(2);
    expect(selectionIncludes(state, "a")).toBe(true);
    expect(selectionIncludes(state, "z")).toBe(false);
  });
});
