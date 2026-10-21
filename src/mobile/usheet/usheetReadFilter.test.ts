import { describe, expect, it } from "vitest";
import { hasPersistedFilter, readFilterAvailability } from "./usheetReadFilter";

const bodyWith = (resources: Array<{ name: string; data: string }>) =>
  JSON.stringify({ kind: "usheet", version: 1, workbook: { id: "w", sheetOrder: ["s1"], sheets: { s1: { id: "s1" } }, resources } });

describe("阅读态本机筛选（261021 定稿：只对本机生效、绝不写正文）", () => {
  it("没有筛选资源 / 空壳 {} ⇒ 视为没有筛选", () => {
    expect(hasPersistedFilter(bodyWith([]))).toBe(false);
    expect(hasPersistedFilter(bodyWith([{ name: "SHEET_FILTER_PLUGIN", data: "{}" }]))).toBe(false);
  });

  it("有真实筛选条件 ⇒ 识别为已存筛选（读态入口要置灰）", () => {
    const body = bodyWith([{ name: "SHEET_FILTER_PLUGIN", data: '{"s1":{"ref":{"startRow":0,"endRow":9,"startColumn":0,"endColumn":1},"filterColumns":[]}}' }]);
    expect(hasPersistedFilter(body)).toBe(true);
    expect(readFilterAvailability(body)).toEqual({ enabled: false, reason: "这篇表格已有保存的筛选，回编辑态调整" });
  });

  it("坏正文不抛（返回可用，交给内核加载兜底）", () => {
    expect(hasPersistedFilter("not json")).toBe(false);
    expect(readFilterAvailability("{")).toEqual({ enabled: true });
  });
});
