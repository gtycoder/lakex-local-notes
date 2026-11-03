/**
 * 只读态「视图状态摘要」纯函数单测（261103 六批 B1）。
 * 判据：只汇总筛选/排序/分组；筛选按规则数（含嵌套分组）；三者皆空返回 ""；初始页签优先筛选。
 */
import { describe, expect, it } from "vitest";
import { createBitableFilterRule, createBitableView, type BitableView } from "../../core/bitableDoc";
import { bitableViewStateSummary, bitableViewStateTab } from "./mobileBitableViewState";

const rule = (fieldId: string) => createBitableFilterRule({ id: fieldId, name: fieldId, type: "text" });

function withRules(patch: Partial<BitableView>): BitableView {
  return { ...createBitableView("grid", "表格", "v"), ...patch };
}

describe("bitableViewStateSummary（只读视图状态摘要）", () => {
  it("没有筛选/排序/分组 → 空字符串（不显示空 chip）", () => {
    expect(bitableViewStateSummary(createBitableView("grid", "表格", "v"))).toBe("");
    expect(bitableViewStateSummary(withRules({ filters: [], sorts: [], groups: [] }))).toBe("");
  });

  it("只有筛选：按**规则数**计数（嵌套分组里的规则累计）", () => {
    expect(bitableViewStateSummary(withRules({ filters: [rule("f1"), rule("f2")] }))).toBe("已筛选 2");
    const nested = withRules({
      filters: [{ id: "g1", operator: "and", filters: [rule("f1"), rule("f2"), { id: "g2", operator: "or", filters: [rule("f3")] }] }],
    });
    expect(bitableViewStateSummary(nested)).toBe("已筛选 3");
  });

  it("只有排序 / 只有分组", () => {
    expect(bitableViewStateSummary(withRules({ sorts: [{ fieldId: "f1" }] }))).toBe("已排序 1");
    expect(bitableViewStateSummary(withRules({ groups: [{ fieldId: "f1" }] }))).toBe("已分组 1");
  });

  it("三者都有：用「 · 」连接，顺序 筛选/排序/分组", () => {
    expect(bitableViewStateSummary(withRules({
      filters: [rule("f1")], sorts: [{ fieldId: "f1" }, { fieldId: "f2" }], groups: [{ fieldId: "f2" }],
    }))).toBe("已筛选 1 · 已排序 2 · 已分组 1");
  });

  it("初始页签：优先筛选 → 排序 → 分组；都没有返回 null", () => {
    expect(bitableViewStateTab(withRules({ filters: [rule("f1")], sorts: [{ fieldId: "f1" }] }))).toBe("filter");
    expect(bitableViewStateTab(withRules({ sorts: [{ fieldId: "f1" }], groups: [{ fieldId: "f1" }] }))).toBe("sort");
    expect(bitableViewStateTab(withRules({ groups: [{ fieldId: "f1" }] }))).toBe("group");
    expect(bitableViewStateTab(createBitableView("grid", "表格", "v"))).toBeNull();
  });
});
