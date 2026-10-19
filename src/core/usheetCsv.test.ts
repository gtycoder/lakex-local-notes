import { describe, expect, it } from "vitest";
import { pickUsheetSheet, usheetSheetCsv } from "./usheetCsv.js";
import type { UsheetWorkbook } from "./usheetDoc.js";

function workbook(overrides: Partial<UsheetWorkbook> = {}): UsheetWorkbook {
  return {
    id: "wb",
    name: "表格",
    sheetOrder: ["s1", "s2"],
    sheets: {
      s1: { id: "s1", name: "Sheet1", rowCount: 50, columnCount: 16, cellData: {} },
      s2: { id: "s2", name: "明细", rowCount: 50, columnCount: 16, cellData: {} },
    },
    ...overrides,
  };
}

describe("usheet CSV 导出", () => {
  it("BOM + CRLF + 值口径（显示值 m 优先 / 公式取缓存结果 / 引号与换行转义）", () => {
    const wb = workbook();
    wb.sheets!.s1.cellData = {
      "0": { "0": { v: "姓名", m: "姓名" }, "1": { v: "分数", m: "分数" } },
      "1": { "0": { v: '带,逗号"引号' }, "1": { v: 95, m: "95" } },
      "2": { "0": { v: "多行\n值" }, "1": { f: "=SUM(B2:B2)", v: 95 } },
    };
    const { csv, sheetName, rowCount, columnCount } = usheetSheetCsv(wb);
    expect(sheetName).toBe("Sheet1");
    expect(rowCount).toBe(3);
    expect(columnCount).toBe(2);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("姓名,分数");
    expect(lines[1]).toBe('"带,逗号""引号",95');
    expect(lines[2]).toBe('"多行\n值",95'); // 公式导出缓存结果，不写 =SUM(...)
    expect(csv).not.toContain("=SUM");
  });

  it("只导出有效区域（配置的 50 行空网格不铺出来）", () => {
    const wb = workbook();
    wb.sheets!.s1.cellData = { "0": { "0": { v: "a" } }, "1": { "0": { v: "b" } } };
    const { csv, rowCount, columnCount } = usheetSheetCsv(wb);
    expect(rowCount).toBe(2);
    expect(columnCount).toBe(1);
    expect(csv.replace(/^\uFEFF/, "")).toBe("a\r\nb\r\n");
  });

  it("富文本单元格（cell.p）取纯文本，不再当空格子丢掉", () => {
    const wb = workbook();
    wb.sheets!.s1.cellData = { "0": { "0": { p: { body: { dataStream: "图表说明\r" } } } } };
    const { csv, rowCount } = usheetSheetCsv(wb);
    expect(rowCount).toBe(1);
    expect(csv).toContain("图表说明");
  });

  it("空工作表 ⇒ 空产出（不伪造 BOM / 换行）", () => {
    const result = usheetSheetCsv(workbook());
    expect(result.csv).toBe("");
    expect(result.rowCount).toBe(0);
  });

  it("工作表选择：显式 sheetId 优先，未知 id 回退到 sheetOrder 第一张", () => {
    const wb = workbook();
    wb.sheets!.s2.cellData = { "0": { "0": { v: "第二张" } } };
    expect(usheetSheetCsv(wb, "s2").csv).toContain("第二张");
    expect(usheetSheetCsv(wb, "不存在").sheetName).toBe("Sheet1");
    expect(pickUsheetSheet(wb)?.sheetId).toBe("s1");
  });

  it("没有 sheetOrder 时退回对象里的第一张；没有 sheets 时返回 null", () => {
    const wb = { sheets: { only: { name: "唯一", cellData: { "0": { "0": { v: "x" } } } } } } as UsheetWorkbook;
    expect(pickUsheetSheet(wb)?.sheetId).toBe("only");
    expect(pickUsheetSheet({} as UsheetWorkbook)).toBeNull();
  });
});
