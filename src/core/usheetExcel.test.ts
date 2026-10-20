import { describe, expect, it } from "vitest";
import { buildUsheetExcelModel, sanitizeSheetName, usheetColorHex, usheetColumnWidthChars } from "./usheetExcel.js";
import type { UsheetWorkbook } from "./usheetDoc.js";

function richCell(text: string, source?: string) {
  return {
    p: {
      body: { dataStream: text + "\r" },
      drawings: source
        ? {
            d1: { drawingId: "d1", drawingType: 0, source, docTransform: { size: { width: 40, height: 30 } } },
          }
        : {},
    },
  };
}

function workbook(): UsheetWorkbook {
  return {
    id: "wb",
    sheetOrder: ["s1", "s2"],
    styles: {
      bold: { bl: 1, fs: 14, cl: { rgb: "#ff0000" }, bg: { rgb: "rgb(238,242,250)" } },
      pct: { n: { pattern: "0.00%" } },
      date: { n: { pattern: "yyyy-mm-dd" } },
      wrap: { ht: 2, vt: 2, tb: 3 },
      bordered: {
        bd: {
          t: { s: 1, cl: { rgb: "#333333" } },
          b: { s: 1, cl: { rgb: "#333333" } },
          l: { s: 8, cl: { rgb: "#ff0000" } },
          r: { s: 1, cl: { rgb: "#333333" } },
          tl_br: { s: 4, cl: { rgb: "#333333" } },
        },
      },
    },
    sheets: {
      s1: {
        id: "s1",
        name: "汇总/明细",
        rowCount: 50,
        columnCount: 16,
        defaultColumnWidth: 88,
        defaultRowHeight: 24,
        cellData: {
          "0": { "0": { v: "姓名", s: "bold" }, "1": { v: "比例", s: "wrap" }, "2": { v: "边框", s: "bordered" } },
          "1": { "0": { v: "小明" }, "1": { v: 0.95, s: "pct" }, "2": { v: 46000, s: "date" }, "5": { f: "=B2*2" } },
          "2": { "0": richCell("图表说明", "1700000000000_abcd1234.png") },
        },
        mergeData: [{ startRow: 0, startColumn: 3, endRow: 1, endColumn: 4 }],
        freeze: { xSplit: 1, ySplit: 2, startRow: 2, startColumn: 1 },
        rowData: { "0": { h: 36 } },
        columnData: { "0": { w: 120 } },
        showGridlines: 0,
      },
      s2: {
        id: "s2",
        name: "",
        hidden: 1,
        cellData: { "0": { "0": { v: "隐藏表" } } },
      },
    },
    resources: [
      {
        name: "SHEET_DRAWING_PLUGIN",
        data: JSON.stringify({
          s1: {
            f1: {
              drawingId: "f1",
              drawingType: 0,
              source: "1700000000001_efgh5678.png",
              transform: { width: 120, height: 80 },
              sheetTransform: { from: { row: 2, column: 2, rowOffset: 3, columnOffset: 4 } },
            },
          },
        }),
      },
    ],
  };
}

describe("usheet → Excel 导出模型", () => {
  it("值：原生值 / 公式去 = / 富文本 p 文字 / 数字格式", () => {
    const model = buildUsheetExcelModel(workbook());
    const sheet = model.sheets[0];
    expect(sheet.rows[0][0]?.value).toBe("姓名");
    expect(sheet.rows[1][1]?.value).toBe(0.95);
    expect(sheet.rows[1][1]?.format).toBe("0.00%");
    expect(sheet.rows[1][2]?.format).toBe("yyyy-mm-dd");
    expect(sheet.rows[1][5]?.formula).toBe("B2*2");
    expect(sheet.rows[2][0]?.value).toBe("图表说明");
    expect(model.cellCount).toBe(9); // 主表 8 + 隐藏表 1
  });

  it("样式：粗体 / 字号 / 字色 / 底色 / 对齐 / 换行 / 行高", () => {
    const sheet = buildUsheetExcelModel(workbook()).sheets[0];
    expect(sheet.rows[0][0]?.style).toMatchObject({ bold: true, fontSize: 14, textColor: "#FF0000", backgroundColor: "#EEF2FA", height: 27 });
    expect(sheet.rows[0][1]?.style).toMatchObject({ align: "center", verticalAlign: "center", wrap: true });
  });

  it("边框：四边 style/color 映射；NONE / 对角线不画", () => {
    const sheet = buildUsheetExcelModel(workbook()).sheets[0];
    expect(sheet.rows[0][2]?.style?.border).toEqual({
      top: { style: "thin", color: "#333333" },
      bottom: { style: "thin", color: "#333333" },
      left: { style: "medium", color: "#FF0000" },
      right: { style: "thin", color: "#333333" },
    });
    const none = workbook();
    none.styles = { none: { bd: { t: { s: 0, cl: { rgb: "#000000" } }, l: { s: 99 } } } };
    none.sheets!.s1.cellData = { "0": { "0": { v: "x", s: "none" } } };
    expect(buildUsheetExcelModel(none).sheets[0].rows[0][0]?.style?.border).toBeUndefined();
  });

  it("合并（行列）/ 冻结 / 列宽 / 网格线", () => {
    const sheet = buildUsheetExcelModel(workbook()).sheets[0];
    expect(sheet.rows[0][3]).toMatchObject({ columnSpan: 2, rowSpan: 2 });
    expect(sheet.rows[0][4]).toBeNull();
    expect(sheet.rows[1][4]).toBeNull();
    expect(sheet.stickyRowsCount).toBe(2);
    expect(sheet.stickyColumnsCount).toBe(1);
    expect(sheet.columns[0]?.width).toBe(16.43); // (120-5)/7
    expect(sheet.columns[1]?.width).toBe(11.86); // 默认 88px
    expect(sheet.showGridLines).toBe(false);
  });

  it("图片：单元格内图片（p.drawings）+ 浮动图片（SHEET_DRAWING_PLUGIN），位置/尺寸/偏移", () => {
    const model = buildUsheetExcelModel(workbook());
    const images = model.sheets[0].images;
    expect(model.imageCount).toBe(2);
    expect(images).toEqual([
      { source: "1700000000000_abcd1234.png", row: 2, column: 0, offsetX: 0, offsetY: 0, width: 40, height: 30 },
      { source: "1700000000001_efgh5678.png", row: 2, column: 2, offsetX: 4, offsetY: 3, width: 120, height: 80 },
    ]);
  });

  it("隐藏工作表照常导出、空表名兜底、表名清洗", () => {
    const model = buildUsheetExcelModel(workbook());
    expect(model.sheets.map((sheet) => sheet.name)).toEqual(["汇总_明细", "Sheet2"]);
    expect(model.sheets[1].rows[0][0]?.value).toBe("隐藏表");
  });

  it("表名 / 颜色 / 列宽换算的边界", () => {
    const used = new Set<string>();
    expect(sanitizeSheetName("a/b:c*d?e[f]g", 0, used)).toBe("a_b_c_d_e_f_g");
    expect(sanitizeSheetName("Long".padEnd(40, "x"), 1, used)).toHaveLength(31);
    expect(sanitizeSheetName("a_b_c_d_e_f_g", 2, used)).toBe("a_b_c_d_e_f_g(2)");
    expect(usheetColorHex("#abc")).toBe("#AABBCC");
    expect(usheetColorHex("rgba(16, 24, 40, 0.5)")).toBe("#101828");
    expect(usheetColorHex("var(--lake-text-1)")).toBeUndefined();
    expect(usheetColumnWidthChars(88)).toBe(11.86);
    expect(usheetColumnWidthChars(0)).toBe(1);
  });

  it("没有任何工作表 ⇒ 明确报错", () => {
    expect(() => buildUsheetExcelModel({ sheetOrder: [], sheets: {} })).toThrow(/没有任何工作表/);
  });
});
