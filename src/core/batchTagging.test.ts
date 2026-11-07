import { describe, expect, it } from "vitest";
import { filterBatchTagOptions, isValidBatchTagName, normalizeBatchTagName, toggleBatchTagSelection } from "./batchTagging";

describe("批量打标公共纯逻辑", () => {
  it("选择只追加/取消当前项，保持点击顺序", () => {
    expect(toggleBatchTagSelection([], "a")).toEqual(["a"]);
    expect(toggleBatchTagSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleBatchTagSelection(["a", "b"], "a")).toEqual(["b"]);
  });
  it("标签名复用 quick-notes 唯一规则", () => {
    expect(normalizeBatchTagName("  灵感  ")).toBe("灵感");
    expect(isValidBatchTagName("灵感")).toBe(true);
    expect(isValidBatchTagName("   ")).toBe(false);
    expect(() => normalizeBatchTagName("   ")).toThrow();
  });
  it("搜索过滤大小写不敏感", () => {
    const options = [{ name: "Work" }, { name: "灵感" }];
    expect(filterBatchTagOptions(options, "work")).toEqual([{ name: "Work" }]);
    expect(filterBatchTagOptions(options, "  ")).toEqual(options);
  });
});
