/**
 * 移动端表格网格默认（261020 B 方案）：**只影响移动端新建的表格**，桌面口径保持原样。
 *
 * 背景：网格几何写在正文（Univer 快照）里、跟着文档走；core 的空表工厂两端共享，
 * 所以"移动端 24/120/40/24"必须由移动端在**新建那一刻**注入，不能改 core 默认（用户 261020 定）。
 */
import { describe, expect, it } from "vitest";
import { emptyUsheetBody, emptyUsheetWorkbook } from "../../core/usheetDoc";
import { MOBILE_USHEET_GRID, emptyMobileUsheetBody, withMobileUsheetGrid } from "./mobileSheetGrid";

describe("移动端表格网格默认", () => {
  it("core 的空表保持桌面口径：列宽 88、不写行头/列头", () => {
    const sheet = emptyUsheetWorkbook().sheets?.s1 as Record<string, unknown>;
    expect(sheet.defaultColumnWidth).toBe(88);
    expect(sheet.defaultRowHeight).toBe(24);
    expect(sheet.rowHeader).toBeUndefined();
    expect(sheet.columnHeader).toBeUndefined();
    expect(emptyUsheetBody()).toContain('"defaultColumnWidth":88');
  });

  it("移动端新建正文：列宽 120 / 行高 24 / 行头 40 / 列头 24，且仍是 50×16 空表", () => {
    const body = JSON.parse(emptyMobileUsheetBody()) as { kind: string; version: number; workbook: { sheets: Record<string, Record<string, unknown>> } };
    expect(body.kind).toBe("usheet");
    expect(body.version).toBe(1);
    const sheet = body.workbook.sheets.s1;
    expect(sheet).toMatchObject({ rowCount: 50, columnCount: 16, defaultColumnWidth: 120, defaultRowHeight: 24 });
    expect(sheet.rowHeader).toMatchObject({ width: 40 });
    expect(sheet.columnHeader).toMatchObject({ height: 24 });
    expect(sheet.cellData).toEqual({});
  });

  it("withMobileUsheetGrid 覆盖所有工作表、不动单元格与其它字段", () => {
    const workbook = emptyUsheetWorkbook();
    const sheets = workbook.sheets as Record<string, Record<string, unknown>>;
    sheets.s2 = { id: "s2", name: "Sheet2", rowCount: 10, columnCount: 3, cellData: { 0: { 0: { v: "x" } } } };
    withMobileUsheetGrid(workbook);
    expect(sheets.s1).toMatchObject(MOBILE_USHEET_GRID);
    expect(sheets.s2).toMatchObject({ ...MOBILE_USHEET_GRID, rowCount: 10, columnCount: 3 });
    expect(sheets.s2.cellData).toEqual({ 0: { 0: { v: "x" } } });
  });
});
