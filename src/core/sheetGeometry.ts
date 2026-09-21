/**
 * 表格网格几何（纯逻辑，桌面/移动端共享）：单元格 / 单元格区域的矩形。
 *
 * 为什么自己算：FortuneSheet 把网格画在 canvas 上，DOM 里没有行/列节点，公开 API 也不暴露
 * `visibledatarow/visibledatacolumn`；而「单元格图片」要把图片精确压在单元格上（且随列宽/行高/
 * 隐藏/合并/缩放变化重算）。这里按内核 `calcRowColSize` 的**同一口径**复算：
 * - 每行/列贡献 `round((len + 1) * zoomRatio)`——**+1 是网格线，round 在累加内层**
 *   （内核是 `ch_width += Math.round((len + 1) * zoomRatio)`，累加的是已取整的增量；
 *   若按「先累加再取整」算，列号一大就会漂移到十几像素）；
 * - 隐藏行/列不占空间（内核直接 `continue`，累积值不变）。
 *
 * 返回值单位是**模型单位**（= 引擎像素 ÷ zoomRatio）：内核渲染浮动图时统一乘 `zoomRatio`
 * （`left * zoomRatio`），所以模型里存这个值，渲染出来正好等于引擎的 `visibledatacolumn`。
 * 因此缩放变化时必须重算（编辑器在 `onOp` 里做）。
 *
 * 边界：本文件属 `src/core`（禁平台依赖），只依赖 sheetDoc 的类型。
 */
import type { SheetWorksheet } from "./sheetDoc.js";

/** 内核默认行高（settings.defaultRowHeight @ zoom 1）。 */
export const DEFAULT_ROW_LEN = 19;
/** 内核默认列宽（settings.defaultColWidth @ zoom 1）。 */
export const DEFAULT_COL_LEN = 73;

export interface SheetCellRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 正值数字；0/NaN/负数/非数字 → null（走默认值）。 */
function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function zoomOf(sheet: Record<string, unknown>): number {
  const zoom = Number(sheet.zoomRatio);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** [from, toExclusive) 的像素跨度（引擎口径：逐项 round 后累加；隐藏项跳过）。 */
function spanPx(
  lenMap: Record<string, unknown>,
  hiddenMap: Record<string, unknown>,
  from: number,
  toExclusive: number,
  fallback: number,
  zoom: number,
): number {
  let px = 0;
  for (let i = from; i < toExclusive; i += 1) {
    if (hiddenMap[i] != null) continue;
    px += Math.round(((positiveNumber(lenMap[i]) ?? fallback) + 1) * zoom);
  }
  return px;
}

/**
 * 区域 (r1,c1)-(r2,c2) 的矩形（模型单位，含网格线）。两个角点顺序无所谓（内部取 min/max）；
 * 行列索引夹到 >=0。
 */
export function sheetRangeRect(
  sheet: SheetWorksheet | null | undefined,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): SheetCellRect {
  const sheetObj = record(sheet);
  const config = record(sheetObj.config);
  const rowlen = record(config.rowlen);
  const columnlen = record(config.columnlen);
  const rowhidden = record(config.rowhidden);
  const colhidden = record(config.colhidden);
  const defaultRow = positiveNumber(sheetObj.defaultRowHeight) ?? DEFAULT_ROW_LEN;
  const defaultCol = positiveNumber(sheetObj.defaultColWidth) ?? DEFAULT_COL_LEN;
  const zoom = zoomOf(sheetObj);

  const fromRow = Math.max(0, Math.trunc(Math.min(r1, r2)));
  const fromCol = Math.max(0, Math.trunc(Math.min(c1, c2)));
  const toRow = Math.max(fromRow, Math.trunc(Math.max(r1, r2)));
  const toCol = Math.max(fromCol, Math.trunc(Math.max(c1, c2)));

  const topPx = spanPx(rowlen, rowhidden, 0, fromRow, defaultRow, zoom);
  const leftPx = spanPx(columnlen, colhidden, 0, fromCol, defaultCol, zoom);
  const heightPx = spanPx(rowlen, rowhidden, fromRow, toRow + 1, defaultRow, zoom);
  const widthPx = spanPx(columnlen, colhidden, fromCol, toCol + 1, defaultCol, zoom);

  // 除以 zoom 会引入长浮点尾巴（243 / 1.1 = 220.90909090…）：保留两位小数，误差 < 0.005px（不可见），
  // 正文里的几何也不会被无意义的尾数撑大。
  const model = (value: number) => Math.round((value / zoom) * 100) / 100;
  return { left: model(leftPx), top: model(topPx), width: model(widthPx), height: model(heightPx) };
}

/** 单元格 (r,c) 的矩形（模型单位，含网格线）。 */
export function sheetCellRect(sheet: SheetWorksheet | null | undefined, r: number, c: number): SheetCellRect {
  return sheetRangeRect(sheet, r, c, r, c);
}

/**
 * sheet 的缩放比例（内核 `zoomRatio`；缺省/非法 → 1）。
 * 引擎像素（CSS px）= 模型单位 × 本值——需要「模型宽度 ↔ 显示宽度」换算的调用方（如按显示宽度
 * 选缩略图档位）用它，别再自己读 `zoomRatio`。
 */
export function sheetZoom(sheet: SheetWorksheet | null | undefined): number {
  return zoomOf(record(sheet));
}