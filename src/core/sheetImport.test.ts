import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";
import { parseUsheetBody, usheetToBody } from "./usheetDoc.js";
import { sheetCellOf, workbookFromCsv, workbookFromSheets } from "./sheetImport.js";

describe("CSV 解析（通用）", () => {
  it("BOM / 引号 / 引号内换行 / 空字段 / CRLF", () => {
    expect(parseCsv("\uFEFFa,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv('"a,b",c')).toEqual([["a,b", "c"]]);
    expect(parseCsv('"line1\nline2",x')).toEqual([["line1\nline2", "x"]]);
    expect(parseCsv('"he said ""hi""",y')).toEqual([['he said "hi"', "y"]]);
    expect(parseCsv("a,")).toEqual([["a", ""]]);
  });
});

describe("工作表导入：值 → usheet 工作簿", () => {
  it("CSV → 单表，保留文本/空单元格，网格不小于默认 35×16", () => {
    const { workbook } = workbookFromCsv("姓名,年龄\n张三,30\n", "人员表");
    const sheet = workbook.sheets?.s1;
    expect(workbook.name).toBe("人员表");
    expect(workbook.sheetOrder).toEqual(["s1"]);
    expect(sheet?.name).toBe("Sheet1");
    expect(sheet?.cellData?.["0"]?.["0"]?.v).toBe("姓名");
    expect(sheet?.cellData?.["1"]?.["1"]?.v).toBe("30");
    expect(sheet?.rowCount).toBeGreaterThanOrEqual(35);
    expect(sheet?.columnCount).toBeGreaterThanOrEqual(16);
  });

  it("多表 / 日期 / 数字 / 布尔：可落成合法 usheet 正文", () => {
    const { workbook } = workbookFromSheets([
      { name: "第一张", rows: [["x", 1, true], [new Date("2026-11-07T00:00:00Z")]] },
      { name: "第二张", rows: [["y"]] },
    ], "预算");
    expect(workbook.sheetOrder).toEqual(["s1", "s2"]);
    expect(workbook.sheets?.s1?.cellData?.["0"]?.["1"]?.v).toBe(1);
    expect(workbook.sheets?.s1?.cellData?.["0"]?.["2"]?.v).toBe(true);
    expect(workbook.sheets?.s1?.cellData?.["1"]?.["0"]?.m).toBe("2026-11-07");
    const body = usheetToBody(workbook);
    expect(parseUsheetBody(body)?.workbook.sheetOrder).toEqual(["s1", "s2"]);
  });

  it("单元格只接受可稳定 JSON 化的值；空值不生成单元格", () => {
    expect(sheetCellOf(null)).toBeNull();
    expect(sheetCellOf("  ")).toBeNull();
    expect(sheetCellOf(Number.NaN)).toBeNull();
    expect(sheetCellOf(2)).toEqual({ v: 2 });
    expect(sheetCellOf(false)).toEqual({ v: false });
  });
});