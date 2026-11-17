import { describe, expect, it } from "vitest";
import {
  createBitableField,
  createBitableView,
  filterOperatorsFor,
  sortModeOf,
  type BitableView,
} from "../../core/bitableDoc";
import { quickFilterPatch, quickSortClearPatch, quickSortMode, quickSortPatch } from "./mobileBitableQuickActions";

function gridWith(sorts?: BitableView["sorts"], filters?: BitableView["filters"]): BitableView {
  const view = createBitableView("grid", "表格", "vew_a");
  if (sorts) view.sorts = sorts;
  if (filters) view.filters = filters;
  return view;
}

const text = createBitableField("text", "标题", "fld_a");
const number = createBitableField("number", "数量", "fld_b");

describe("quickSortPatch（列头升序/降序 → view.sorts）", () => {
  it("该列没有规则 ⇒ 插到最前当主排序键（已有排序降为次键）", () => {
    const view = gridWith([{ fieldId: "fld_b", desc: true }]);
    const patch = quickSortPatch(view, "fld_a", "asc");
    expect(patch?.sorts?.map((rule) => [rule.fieldId, sortModeOf(rule)])).toEqual([
      ["fld_a", "asc"],
      ["fld_b", "desc"],
    ]);
  });

  it("该列已有规则 ⇒ 只换排序方式（原位，不动其它规则）", () => {
    const view = gridWith([{ fieldId: "fld_b", desc: true }, { fieldId: "fld_a", desc: true }]);
    const patch = quickSortPatch(view, "fld_a", "asc");
    expect(patch?.sorts?.map((rule) => [rule.fieldId, sortModeOf(rule)])).toEqual([
      ["fld_b", "desc"],
      ["fld_a", "asc"],
    ]);
  });

  it("单选/多选支持「选项顺序/选项逆序」语义排序（applySortMode 同一映射）", () => {
    const view = gridWith();
    expect(quickSortPatch(view, "fld_c", "optionOrder")?.sorts?.[0]).toEqual({ fieldId: "fld_c", mode: "optionOrder", desc: false });
    expect(quickSortPatch(view, "fld_c", "optionReverse")?.sorts?.[0]).toEqual({ fieldId: "fld_c", mode: "optionOrder", desc: true });
  });

  it("空字段 id ⇒ null（不写）", () => {
    expect(quickSortPatch(gridWith(), "", "asc")).toBeNull();
  });
});

describe("quickSortClearPatch（清除该列排序）", () => {
  it("只删该列的规则；该列没有规则 ⇒ null", () => {
    const view = gridWith([{ fieldId: "fld_a" }, { fieldId: "fld_b", desc: true }]);
    expect(quickSortClearPatch(view, "fld_a")?.sorts?.map((rule) => rule.fieldId)).toEqual(["fld_b"]);
    expect(quickSortClearPatch(view, "fld_c")).toBeNull();
  });
});

describe("quickFilterPatch（筛选此字段 → view.filters）", () => {
  it("按共享默认追加一条规则（与视图配置「+ 字段」同一来源）", () => {
    const view = gridWith(undefined, [{ id: "flt_1", fieldId: "fld_b", operator: "equalTo", value: "3" }]);
    const patch = quickFilterPatch(view, text, true);
    expect(patch?.filters).toHaveLength(2);
    const added = patch?.filters?.[1];
    expect(added && !("filters" in added) && added.fieldId).toBe("fld_a");
    expect(added && !("filters" in added) && added.operator).toBe(filterOperatorsFor(text)[0]);
    // 既有规则不动
    expect(patch?.filters?.[0]).toBe(view.filters![0]);
  });

  it("不可筛选字段 ⇒ null", () => {
    expect(quickFilterPatch(gridWith(), number, false)).toBeNull();
  });
});

describe("quickSortMode（菜单「当前」标记）", () => {
  it("返回该列当前排序方式；没有规则 ⇒ null", () => {
    const view = gridWith([{ fieldId: "fld_c", mode: "optionOrder", desc: true }]);
    expect(quickSortMode(view, "fld_c")).toBe("optionReverse");
    expect(quickSortMode(view, "fld_a")).toBeNull();
  });
});
