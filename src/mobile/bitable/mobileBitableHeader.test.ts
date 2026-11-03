/**
 * 头部模型单测（261103 三/四/六批）：只验证「哪些部件在什么状态出现」。
 * 关键契约：头部不依赖 records；只读没有编辑部件；表单视图走精简头部；多视图只读仍可切视图；
 * 只读且有视图状态（筛选/排序/分组）时才出现 chip（编辑态一律不出现）。
 */
import { describe, expect, it } from "vitest";
import { mobileBitableHeaderModel } from "./mobileBitableHeader";

const base = { editable: false, isFormView: false, viewCount: 1, hasViewState: false };

describe("mobileBitableHeaderModel", () => {
  it("编辑态内容视图：视图区 + 字段 + 筛选 + ＋ 全出现（chip 不出现）", () => {
    expect(mobileBitableHeaderModel({ ...base, editable: true, hasViewState: true })).toEqual({
      showViews: true,
      showFieldButton: true,
      showFilterButton: true,
      showAddRecord: true,
      showViewStateChip: false,
    });
  });

  it("只读单视图、无视图状态：只剩表名（第 2 行整段不渲染）", () => {
    expect(mobileBitableHeaderModel(base)).toEqual({
      showViews: false,
      showFieldButton: false,
      showFilterButton: false,
      showAddRecord: false,
      showViewStateChip: false,
    });
  });

  it("只读单视图、有视图状态：第 2 行要渲染（放 chip），仍无字段/筛选/＋", () => {
    expect(mobileBitableHeaderModel({ ...base, hasViewState: true })).toEqual({
      showViews: false,
      showFieldButton: false,
      showFilterButton: false,
      showAddRecord: false,
      showViewStateChip: true,
    });
  });

  it("只读多视图：保留视图页签与视图列表（能切视图），仍无编辑部件；有状态时 chip 出现", () => {
    expect(mobileBitableHeaderModel({ ...base, viewCount: 3, hasViewState: true })).toEqual({
      showViews: true,
      showFieldButton: false,
      showFilterButton: false,
      showAddRecord: false,
      showViewStateChip: true,
    });
  });

  it("表单视图（编辑态）：精简头部，无字段/筛选/＋（表单提交走表单自己）", () => {
    expect(mobileBitableHeaderModel({ ...base, editable: true, isFormView: true, viewCount: 2 })).toEqual({
      showViews: true,
      showFieldButton: false,
      showFilterButton: false,
      showAddRecord: false,
      showViewStateChip: false,
    });
  });

  it("表单视图（只读单视图、有状态）：只剩表名 + chip", () => {
    expect(mobileBitableHeaderModel({ ...base, isFormView: true, hasViewState: true })).toEqual({
      showViews: false,
      showFieldButton: false,
      showFilterButton: false,
      showAddRecord: false,
      showViewStateChip: true,
    });
  });

  it("头部模型只看 editable / isFormView / viewCount / hasViewState，不依赖记录数（纯函数、无副作用）", () => {
    const input = { editable: true, isFormView: false, viewCount: 1, hasViewState: true };
    const frozen = Object.freeze({ ...input });
    expect(() => mobileBitableHeaderModel(frozen)).not.toThrow();
    expect(mobileBitableHeaderModel(input)).toEqual(mobileBitableHeaderModel(input));
  });
});
