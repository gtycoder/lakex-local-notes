import { describe, expect, it } from "vitest";
import { blockFailureMessage, planSortRange, resolveSheetBlock, type SortFilterSheet } from "./usheetSortPlan";

/** 用矩阵造一个假表（null = 空格）。 */
function sheetOf(rows: unknown[][]): SortFilterSheet {
  const maxRows = Math.max(rows.length, 1);
  const maxColumns = Math.max(...rows.map((r) => r.length), 1);
  return {
    maxRows,
    maxColumns,
    getValue: (row, column) => rows[row]?.[column] ?? null,
  };
}

const sel = (startRow: number, endRow: number, startColumn: number, endColumn: number) =>
  ({ startRow, endRow, startColumn, endColumn });

describe("移动端表格排序/筛选的数据区判定（261021 P5）", () => {
  it("显式矩形（≥2 行 × ≥2 列）原样使用，不猜表头", () => {
    const sheet = sheetOf([["姓名", "分数"], ["A", 10], ["B", 20]]);
    const r = resolveSheetBlock(sel(0, 2, 0, 1), sheet);
    expect(r).toEqual({ ok: true, block: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1, hasTitle: false } });
  });

  it("单格选中数值列：「文本表头 + 数值数据」⇒ hasTitle，排序从表头下一行开始", () => {
    const sheet = sheetOf([["分数"], [10], [20], [5]]);
    const r = resolveSheetBlock(sel(1, 1, 0, 0), sheet);
    expect(r).toMatchObject({ ok: true, block: { startRow: 0, endRow: 3, hasTitle: true } });
    const plan = planSortRange(sel(1, 1, 0, 0), sheet, "desc");
    expect(plan).toEqual({
      ok: true,
      plan: { range: { startRow: 0, startColumn: 0, endRow: 3, endColumn: 0 }, orderRules: [{ type: "desc", colIndex: 0 }], hasTitle: true },
    });
  });

  it("纯文本列（首行不是数字、次行也是文本）不判表头", () => {
    const sheet = sheetOf([["苹果"], ["香蕉"], ["橙子"]]);
    expect(resolveSheetBlock(sel(1, 1, 0, 0), sheet)).toMatchObject({ ok: true, block: { hasTitle: false } });
  });

  it("列方向扩到整行的已用列（排序必须整行一起动）", () => {
    const sheet = sheetOf([["名称", "数量", "备注"], ["A", 3, "x"], ["B", 1, "y"], ["C", 2, "z"]]);
    const r = resolveSheetBlock(sel(1, 1, 0, 0), sheet);
    // 锚列是文本列（A/B/C）⇒ 不判表头（只认「表头文本 + 下面全数值」这一个信号）
    expect(r).toMatchObject({ ok: true, block: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2, hasTitle: false } });
  });

  it("锚点空 / 只有一行 ⇒ 明确失败原因（调用方 toast，不静默）", () => {
    const sparse = sheetOf([[null, null], [null, 5], [null, null]]);
    expect(resolveSheetBlock(sel(0, 0, 0, 0), sparse)).toEqual({ ok: false, reason: "empty" });
    const oneRow = sheetOf([[1], [null]]);
    expect(resolveSheetBlock(sel(0, 0, 0, 0), oneRow)).toEqual({ ok: false, reason: "single-row" });
    expect(blockFailureMessage("empty")).toContain("先选中");
    expect(blockFailureMessage("single-row")).toContain("只有一行");
  });

  it("排序失败时不产出坏 plan（单行数据）", () => {
    const sheet = sheetOf([["标题"], [7]]);
    expect(planSortRange(sel(1, 1, 0, 0), sheet, "asc")).toEqual({ ok: false, reason: "single-row" });
  });
});
