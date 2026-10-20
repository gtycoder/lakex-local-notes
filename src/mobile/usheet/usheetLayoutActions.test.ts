/**
 * 移动端表格「布局类」动作护栏（261020 P1：冻结窗格 / 行高 / 列宽）。
 *
 * 用替身记录 facade 调用：这是纯逻辑层，不需要启 Univer/canvas。
 */
import { describe, expect, it } from "vitest";
import {
  applyUsheetLayoutAction, COLUMN_WIDTH_STEP, MIN_COLUMN_WIDTH, MIN_ROW_HEIGHT,
  ROW_HEIGHT_STEP, USHEET_LAYOUT_ACTIONS,
} from "./usheetLayoutActions";

function fakes(options: { rows?: Record<number, number>; cols?: Record<number, number> } = {}) {
  const calls: Array<[string, ...number[]]> = [];
  const range = {
    getRow: () => 2, getLastRow: () => 3, getColumn: () => 1, getLastColumn: () => 2,
  };
  const sheet = {
    setFrozenRows: (rows: number) => { calls.push(["setFrozenRows", rows]); },
    setFrozenColumns: (columns: number) => { calls.push(["setFrozenColumns", columns]); },
    cancelFreeze: () => { calls.push(["cancelFreeze"]); },
    getRowHeight: (row: number) => options.rows?.[row] ?? 0,
    setRowHeight: (row: number, height: number) => { calls.push(["setRowHeight", row, height]); },
    autoFitRow: (row: number) => { calls.push(["autoFitRow", row]); },
    getColumnWidth: (column: number) => options.cols?.[column] ?? 0,
    setColumnWidth: (column: number, width: number) => { calls.push(["setColumnWidth", column, width]); },
  };
  return { range, sheet, calls };
}

describe("usheet 布局动作（冻结 / 行高 / 列宽）", () => {
  it("动作清单与实现一一对应；非布局动作返回 false（调用方继续处理，不静默吞）", () => {
    expect([...USHEET_LAYOUT_ACTIONS].sort()).toEqual([
      "col-width-down", "col-width-up", "freeze-col", "freeze-none", "freeze-row",
      "row-height-auto", "row-height-down", "row-height-up",
    ]);
    const { range, sheet } = fakes();
    expect(applyUsheetLayoutAction("bold", range, sheet)).toBe(false);
  });

  it("冻结 = 冻结到当前行/列（含当前）；取消冻结", () => {
    const a = fakes();
    applyUsheetLayoutAction("freeze-row", a.range, a.sheet);
    applyUsheetLayoutAction("freeze-col", a.range, a.sheet);
    applyUsheetLayoutAction("freeze-none", a.range, a.sheet);
    expect(a.calls).toEqual([["setFrozenRows", 3], ["setFrozenColumns", 2], ["cancelFreeze"]]);
  });

  it("行高：对选中行逐个 ±步进（有下限、缺值用默认 24）", () => {
    const up = fakes({ rows: { 2: 40, 3: 0 } });
    applyUsheetLayoutAction("row-height-up", up.range, up.sheet);
    expect(up.calls).toEqual([
      ["setRowHeight", 2, 40 + ROW_HEIGHT_STEP],
      ["setRowHeight", 3, 24 + ROW_HEIGHT_STEP], // 读不到 → 默认 24
    ]);
    const down = fakes({ rows: { 2: MIN_ROW_HEIGHT, 3: 30 } });
    applyUsheetLayoutAction("row-height-down", down.range, down.sheet);
    expect(down.calls).toEqual([
      ["setRowHeight", 2, MIN_ROW_HEIGHT],   // 不会调到下限以下
      ["setRowHeight", 3, 30 - ROW_HEIGHT_STEP],
    ]);
  });

  it("自动行高：选中行逐个 autoFitRow；列宽 ±步进有下限", () => {
    const auto = fakes();
    applyUsheetLayoutAction("row-height-auto", auto.range, auto.sheet);
    expect(auto.calls).toEqual([["autoFitRow", 2], ["autoFitRow", 3]]);

    const cols = fakes({ cols: { 1: 0, 2: MIN_COLUMN_WIDTH } });
    applyUsheetLayoutAction("col-width-up", cols.range, cols.sheet);
    expect(cols.calls).toEqual([
      ["setColumnWidth", 1, 88 + COLUMN_WIDTH_STEP], // 读不到 → 默认 88
      ["setColumnWidth", 2, MIN_COLUMN_WIDTH + COLUMN_WIDTH_STEP],
    ]);
    const narrow = fakes({ cols: { 1: 40, 2: MIN_COLUMN_WIDTH } });
    applyUsheetLayoutAction("col-width-down", narrow.range, narrow.sheet);
    expect(narrow.calls).toEqual([
      ["setColumnWidth", 1, MIN_COLUMN_WIDTH], // 40-24 低于下限 ⇒ 夹到 32
      ["setColumnWidth", 2, MIN_COLUMN_WIDTH],
    ]);
  });
});
