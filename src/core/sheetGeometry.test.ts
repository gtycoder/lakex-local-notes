/**
 * 单元格几何口径护栏（260921 P2 单元格图片）。
 *
 * 口径必须与内核 `calcRowColSize` 一致（见 sheetGeometry.ts 注释）：
 * - 每行/列贡献 `round((len + 1) * zoomRatio)`，**取整在累加内层**；
 * - 隐藏行/列不占空间；
 * - 返回值是模型单位（= 引擎像素 ÷ zoomRatio），乘回 zoomRatio 应逐像素等于引擎值。
 * 口径一旦漂移（尤其「先累加再取整」这种看起来等价的写法），列号一大就会漂十几像素。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_COL_LEN, DEFAULT_ROW_LEN, sheetCellRect, sheetRangeRect, sheetZoom } from "./sheetGeometry.js";
import type { SheetWorksheet } from "./sheetDoc.js";

const CELL_W = DEFAULT_COL_LEN + 1;
const CELL_H = DEFAULT_ROW_LEN + 1;

function sheet(config?: Record<string, unknown>, extra?: Record<string, unknown>): SheetWorksheet {
  return { name: "Sheet1", config: config ?? {}, ...extra } as SheetWorksheet;
}

/** 引擎像素（模型值 × zoom）。 */
function px(rect: { left: number; top: number; width: number; height: number }, zoom: number) {
  return { left: rect.left * zoom, top: rect.top * zoom, width: rect.width * zoom, height: rect.height * zoom };
}

describe("sheetCellRect / sheetRangeRect", () => {
  it("zoom=1：A1 从原点开始，一格 = 列宽+1 × 行高+1（网格线）", () => {
    expect(sheetCellRect(sheet(), 0, 0)).toEqual({ left: 0, top: 0, width: CELL_W, height: CELL_H });
  });

  it("累积位置按「前面所有行列之和」算", () => {
    expect(sheetCellRect(sheet(), 1, 2)).toEqual({ left: CELL_W * 2, top: CELL_H, width: CELL_W, height: CELL_H });
  });

  it("zoom=1.1：取整在累加内层（第 4 列左边界 = 3 × round(74×1.1) = 243px，不是 round(3×74×1.1) = 244px）", () => {
    const s = sheet({}, { zoomRatio: 1.1 });
    const rect = sheetCellRect(s, 0, 3);
    expect(px(rect, 1.1).left).toBeCloseTo(243, 1); // 除以 zoom 后保留两位小数 ⇒ 千分位内可回算
    // 远处列号差异会被放大：第 31 列 = 30 × 81 = 2430px（「先累加再取整」会算成 2442）
    expect(px(sheetCellRect(s, 0, 30), 1.1).left).toBeCloseTo(30 * 81, 1);
    expect(px(rect, 1.1).width).toBeCloseTo(81, 1);
    expect(px(rect, 1.1).height).toBeCloseTo(Math.round(20 * 1.1), 1);
  });

  it("zoom 缺省/非法按 1 处理", () => {
    expect(sheetCellRect(sheet({}, { zoomRatio: 0 }), 0, 1).left).toBe(CELL_W);
    expect(sheetCellRect(sheet({}, { zoomRatio: "x" }), 0, 1).left).toBe(CELL_W);
  });

  it("自定义列宽/行高只影响该行该列及其后", () => {
    const s = sheet({ columnlen: { 1: 199 }, rowlen: { 0: 39 } });
    // 第 3 列左边 = 74（第 1 列）+ 200（第 2 列 = 199+1）
    expect(sheetCellRect(s, 0, 2).left).toBe(CELL_W + 200);
    // 第 2 行上边 = 40（第 1 行 = 39+1）
    expect(sheetCellRect(s, 1, 0).top).toBe(40);
  });

  it("隐藏的行/列不占空间（且自身宽高为 0）", () => {
    const s = sheet({ colhidden: { 0: 0 }, rowhidden: { 1: 0 } });
    expect(sheetCellRect(s, 0, 1).left).toBe(0);
    expect(sheetCellRect(s, 0, 0)).toEqual({ left: 0, top: 0, width: 0, height: CELL_H });
    expect(sheetCellRect(s, 2, 0).top).toBe(CELL_H);
  });

  it("区域：合并单元格取整块（宽高跨多列多行）", () => {
    expect(sheetRangeRect(sheet(), 1, 1, 2, 2)).toEqual({
      left: CELL_W,
      top: CELL_H,
      width: CELL_W * 2,
      height: CELL_H * 2,
    });
  });

  it("区域两个角点顺序无所谓；负索引夹到 0", () => {
    expect(sheetRangeRect(sheet(), 2, 2, 1, 1)).toEqual(sheetRangeRect(sheet(), 1, 1, 2, 2));
    expect(sheetCellRect(sheet(), -1, -1)).toEqual({ left: 0, top: 0, width: CELL_W, height: CELL_H });
  });

  it("sheet 缺失/字段非法时退回默认值（不抛错）", () => {
    expect(sheetCellRect(null, 0, 0)).toEqual({ left: 0, top: 0, width: CELL_W, height: CELL_H });
    const s = { name: "S", config: { columnlen: { 0: "nope" }, rowlen: { 0: 0 } } } as SheetWorksheet;
    expect(sheetCellRect(s, 0, 0)).toEqual({ left: 0, top: 0, width: CELL_W, height: CELL_H });
  });

  it("工作表自带 defaultRowHeight/defaultColWidth 时以其为准", () => {
    const s = sheet({}, { defaultRowHeight: 30, defaultColWidth: 100 });
    expect(sheetCellRect(s, 0, 0)).toEqual({ left: 0, top: 0, width: 101, height: 31 });
  });

  it("sheetZoom：模型单位 ↔ 显示宽度换算的唯一入口（缺省/非法 → 1）", () => {
    expect(sheetZoom(sheet({}, { zoomRatio: 1.1 }))).toBe(1.1);
    expect(sheetZoom(sheet({}))).toBe(1);
    expect(sheetZoom(sheet({}, { zoomRatio: 0 }))).toBe(1);
    expect(sheetZoom(sheet({}, { zoomRatio: "nope" }))).toBe(1);
    expect(sheetZoom(null)).toBe(1);
  });
});