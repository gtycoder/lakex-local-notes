/**
 * 表格（usheet = Univer 工作簿）→ 中立的 Excel 导出模型 —— 纯函数，无 DOM / node: / 第三方依赖。
 *
 * 为什么分两层：这里只做「Univer 快照 → 值 / 样式 / 几何 / 图片引用」的语义映射（可测、可复用）；
 * 真正写 .xlsx 交给主进程的 write-excel-file（依赖只进主进程，core 保持零依赖）。
 *
 * 覆盖：值 / 公式（不带前导 =）/ 数字格式（原样透传 Excel format code）/ 粗斜下划线删除线 /
 *       字号 / 字色 / 底色 / 单元格边框（四边，含线型与颜色）/ 水平·垂直对齐 / 换行 / 行高 / 列宽 / 合并（行列都支持）/ 冻结 /
 *       隐藏工作表（照常导出为可见）/ 富文本单元格文字 / 浮动图片 + 单元格内图片的引用与锚点。
 *
 * 图片只产出「引用 + 位置 + 尺寸」；字节由主进程读资产（webp 等转 png）后交给写库。
 */
import { usheetCellRichText, type UsheetCell, type UsheetWorkbook, type UsheetWorksheet } from "./usheetDoc.js";

export const USHEET_EXCEL_MAX_ROWS = 1048576;
export const USHEET_EXCEL_MAX_COLUMNS = 16384;

/** 与 write-excel-file 的 BorderStyle 同一组字面量（避免主进程再映射一次）。 */
export type UsheetExcelBorderStyle =
  | "thin" | "hair" | "dotted" | "dashed" | "dashDot" | "dashDotDot" | "double"
  | "medium" | "mediumDashed" | "mediumDashDot" | "mediumDashDotDot" | "slantDashDot" | "thick";

export interface UsheetExcelBorderSide {
  style: UsheetExcelBorderStyle;
  color?: string;
}

export interface UsheetExcelBorder {
  top?: UsheetExcelBorderSide;
  bottom?: UsheetExcelBorderSide;
  left?: UsheetExcelBorderSide;
  right?: UsheetExcelBorderSide;
}

export interface UsheetExcelCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "center" | "bottom";
  wrap?: boolean;
  border?: UsheetExcelBorder;
  /** 行高（pt），只挂在行内首个有内容/样式的格子上 */
  height?: number;
}

export interface UsheetExcelCell {
  value?: string | number | boolean;
  /** 公式（已去掉前导 "="） */
  formula?: string;
  /** Excel number format code（来自 Univer style.n.pattern） */
  format?: string;
  style?: UsheetExcelCellStyle;
  columnSpan?: number;
  rowSpan?: number;
}

export interface UsheetExcelImage {
  /** 正文里的引用：资产 filename / data URL / 本地资产 URL */
  source: string;
  /** 0-based 锚点单元格与像素偏移 */
  row: number;
  column: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface UsheetExcelSheet {
  name: string;
  rows: Array<Array<UsheetExcelCell | null>>;
  columns: Array<{ width?: number }>;
  stickyRowsCount: number;
  stickyColumnsCount: number;
  showGridLines: boolean;
  images: UsheetExcelImage[];
  rowCount: number;
  columnCount: number;
  cellCount: number;
}

export interface UsheetExcelModel {
  sheets: UsheetExcelSheet[];
  /** 引用的图片总数（含随后可能因文件缺失被主进程跳过的） */
  imageCount: number;
  /** 导出的单元格数（值/公式/富文本/纯样式），用于判断“空表” */
  cellCount: number;
}

const DRAWING_IMAGE = 0;
const SHEET_DRAWING_PLUGIN = "SHEET_DRAWING_PLUGIN";
/** Univer 默认列宽（像素）；快照缺省时按此估算 */
const DEFAULT_COLUMN_WIDTH_PX = 88;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** CSS/Univer 颜色 → #RRGGBB（库要 hex；rgb() 也兼容；主题色/无效值返回 undefined）。 */
export function usheetColorHex(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const raw = input.trim();
  if (raw === "") return undefined;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const hex = raw.slice(1);
    return ("#" + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]).toUpperCase();
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) return raw.slice(0, 7).toUpperCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(raw);
  if (rgb) {
    const channel = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
    return ("#" + channel(rgb[1]) + channel(rgb[2]) + channel(rgb[3])).toUpperCase();
  }
  return undefined;
}

/** 工作表名：Excel 非法字符替换、31 字符上限、空名兜底、重名加 (2)/(3)。 */
export function sanitizeSheetName(name: string, index: number, used: Set<string>): string {
  const base = (name || "Sheet" + (index + 1))
    .replace(/[\[\]:*?\/\\]/g, "_")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, 31) || "Sheet" + (index + 1);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const tail = "(" + suffix + ")";
    candidate = base.slice(0, Math.max(1, 31 - tail.length)) + tail;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function worksheetStyles(workbook: UsheetWorkbook): Record<string, unknown> {
  return isRecord(workbook.styles) ? workbook.styles : {};
}

function resolveStyle(workbook: UsheetWorkbook, cell: UsheetCell): Record<string, unknown> | null {
  const s = (cell as { s?: unknown }).s;
  if (typeof s === "string") {
    const style = worksheetStyles(workbook)[s];
    return isRecord(style) ? style : null;
  }
  return isRecord(s) ? s : null;
}

function isOn(value: unknown): boolean {
  return value === 1 || value === true;
}

/** Univer BorderStyleTypes → 库的 BorderStyle 字面量；NONE/未知返回 undefined（不画边）。 */
const BORDER_STYLE_BY_ENUM: Record<number, UsheetExcelBorderStyle> = {
  1: "thin", 2: "hair", 3: "dotted", 4: "dashed", 5: "dashDot", 6: "dashDotDot",
  7: "double", 8: "medium", 9: "mediumDashed", 10: "mediumDashDot",
  11: "mediumDashDotDot", 12: "slantDashDot", 13: "thick",
};

function borderSideFrom(value: unknown): UsheetExcelBorderSide | undefined {
  if (!isRecord(value)) return undefined;
  const style = typeof value.s === "number" ? BORDER_STYLE_BY_ENUM[value.s] : undefined;
  if (!style) return undefined;
  const color = usheetColorHex(isRecord(value.cl) ? value.cl.rgb : undefined);
  return color ? { style, color } : { style };
}

/** 只搬四边；对角线（tl_br / bl_tr …）不支持，忽略。 */
function borderFrom(style: Record<string, unknown>): UsheetExcelBorder | undefined {
  const bd = style.bd;
  if (!isRecord(bd)) return undefined;
  const border: UsheetExcelBorder = {};
  const top = borderSideFrom(bd.t);
  const bottom = borderSideFrom(bd.b);
  const left = borderSideFrom(bd.l);
  const right = borderSideFrom(bd.r);
  if (top) border.top = top;
  if (bottom) border.bottom = bottom;
  if (left) border.left = left;
  if (right) border.right = right;
  return Object.keys(border).length > 0 ? border : undefined;
}

/** Univer style → 导出样式（数字格式单独走 format）。只映射有值且库支持的字段。 */
export function usheetStyleFrom(style: Record<string, unknown> | null): UsheetExcelCellStyle | undefined {
  if (!style) return undefined;
  const out: UsheetExcelCellStyle = {};
  if (isOn(style.bl)) out.bold = true;
  if (isOn(style.it)) out.italic = true;
  const ul = style.ul;
  const st = style.st;
  if (isRecord(ul) && isOn(ul.s)) out.underline = true;
  else if (isRecord(st) && isOn(st.s)) out.strike = true; // 库的 textDecoration 只能表达一种，优先下划线
  const fs = positiveNumber(style.fs);
  if (fs) out.fontSize = Math.round(fs * 100) / 100;
  const text = usheetColorHex(isRecord(style.cl) ? style.cl.rgb : undefined);
  if (text) out.textColor = text;
  const bg = usheetColorHex(isRecord(style.bg) ? style.bg.rgb : undefined);
  if (bg) out.backgroundColor = bg;
  if (style.ht === 1) out.align = "left";
  else if (style.ht === 2) out.align = "center";
  else if (style.ht === 3) out.align = "right";
  if (style.vt === 1) out.verticalAlign = "top";
  else if (style.vt === 2) out.verticalAlign = "center";
  else if (style.vt === 3) out.verticalAlign = "bottom";
  if (style.tb === 3) out.wrap = true;
  const border = borderFrom(style);
  if (border) out.border = border;
  return Object.keys(out).length > 0 ? out : undefined;
}

function numberFormat(style: Record<string, unknown> | null): string | undefined {
  if (!style || !isRecord(style.n)) return undefined;
  const pattern = style.n.pattern;
  return typeof pattern === "string" && pattern.trim() !== "" ? pattern : undefined;
}

/** 单元格 → 导出值（公式优先；其次原生值；再次富文本 p 的纯文本）。 */
export function usheetCellToExport(workbook: UsheetWorkbook, cell: UsheetCell): UsheetExcelCell | null {
  if (!isRecord(cell)) return null;
  const style = resolveStyle(workbook, cell);
  const mappedStyle = usheetStyleFrom(style);
  const format = numberFormat(style);
  const formula = typeof cell.f === "string" ? cell.f.trim().replace(/^=/, "") : "";
  if (formula) {
    return { formula, ...(format ? { format } : {}), ...(mappedStyle ? { style: mappedStyle } : {}) };
  }
  const value = cell.v;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { value, ...(format ? { format } : {}), ...(mappedStyle ? { style: mappedStyle } : {}) };
  }
  const rich = usheetCellRichText(cell);
  if (rich !== "") {
    return { value: rich, ...(format ? { format } : {}), ...(mappedStyle ? { style: mappedStyle } : {}) };
  }
  return mappedStyle ? { style: mappedStyle } : null;
}

interface DrawingLike {
  drawingType?: unknown;
  hidden?: unknown;
  source?: unknown;
  transform?: { width?: unknown; height?: unknown } | null;
  docTransform?: { size?: { width?: unknown; height?: unknown } } | null;
  sheetTransform?: { from?: { row?: unknown; column?: unknown; rowOffset?: unknown; columnOffset?: unknown } | null; } | null;
}

function drawingSize(drawing: Record<string, unknown>): { width: number; height: number } | null {
  const asDrawing = drawing as DrawingLike;
  const transform = isRecord(asDrawing.transform) ? asDrawing.transform : null;
  const width = positiveNumber(transform?.width);
  const height = positiveNumber(transform?.height);
  if (width && height) return { width, height };
  const docTransform = isRecord(asDrawing.docTransform) ? asDrawing.docTransform : null;
  const size = isRecord(docTransform?.size) ? docTransform.size : null;
  const docWidth = positiveNumber(size?.width);
  const docHeight = positiveNumber(size?.height);
  if (docWidth && docHeight) return { width: docWidth, height: docHeight };
  return null;
}

function drawingSource(drawing: Record<string, unknown>): string | null {
  const source = (drawing as DrawingLike).source;
  return typeof source === "string" && source.trim() !== "" ? source : null;
}

function isVisibleDrawing(drawing: Record<string, unknown>): boolean {
  const hidden = (drawing as DrawingLike).hidden;
  return !(hidden === 1 || hidden === true);
}

/** 一张工作表内的图片：单元格 p.drawings（锚在单元格） + 浮动 drawing 资源（锚在 sheetTransform.from）。 */
function collectImages(sheet: UsheetWorksheet, sheetId: string, drawingResource: unknown): UsheetExcelImage[] {
  const images: UsheetExcelImage[] = [];
  const cellData = isRecord(sheet.cellData) ? (sheet.cellData as Record<string, Record<string, UsheetCell>>) : {};
  for (const [rowKey, row] of Object.entries(cellData)) {
    const rowIndex = positiveInt(Number(rowKey));
    if (rowIndex === null || !isRecord(row)) continue;
    for (const [colKey, cell] of Object.entries(row)) {
      const columnIndex = positiveInt(Number(colKey));
      if (columnIndex === null || !isRecord(cell)) continue;
      const p = (cell as { p?: unknown }).p;
      if (!isRecord(p) || !isRecord(p.drawings)) continue;
      for (const drawing of Object.values(p.drawings)) {
        if (!isRecord(drawing)) continue;
        if (drawing.drawingType !== undefined && drawing.drawingType !== DRAWING_IMAGE) continue;
        if (!isVisibleDrawing(drawing)) continue;
        const source = drawingSource(drawing);
        const size = drawingSize(drawing);
        if (!source || !size) continue;
        images.push({ source, row: rowIndex, column: columnIndex, offsetX: 0, offsetY: 0, width: size.width, height: size.height });
      }
    }
  }
  // 浮动图：SHEET_DRAWING_PLUGIN 的 data = { [sheetId]: { [drawingId]: drawing } }
  if (isRecord(drawingResource) && isRecord(drawingResource[sheetId])) {
    for (const drawing of Object.values(drawingResource[sheetId] as Record<string, unknown>)) {
      if (!isRecord(drawing)) continue;
      if (drawing.drawingType !== DRAWING_IMAGE) continue;
      if (!isVisibleDrawing(drawing)) continue;
      const source = drawingSource(drawing);
      const size = drawingSize(drawing);
      const from = isRecord(drawing.sheetTransform) && isRecord(drawing.sheetTransform.from) ? drawing.sheetTransform.from : null;
      if (!source || !size || !from) continue;
      const row = positiveInt(from.row);
      const column = positiveInt(from.column);
      if (row === null || column === null) continue;
      images.push({
        source,
        row,
        column,
        offsetX: typeof from.columnOffset === "number" && Number.isFinite(from.columnOffset) ? Math.max(0, from.columnOffset) : 0,
        offsetY: typeof from.rowOffset === "number" && Number.isFinite(from.rowOffset) ? Math.max(0, from.rowOffset) : 0,
        width: size.width,
        height: size.height,
      });
    }
  }
  return images;
}

function parseDrawingResource(workbook: UsheetWorkbook): unknown {
  const resources = Array.isArray(workbook.resources) ? workbook.resources : [];
  for (const resource of resources) {
    if (!isRecord(resource) || resource.name !== SHEET_DRAWING_PLUGIN || typeof resource.data !== "string") continue;
    try {
      return JSON.parse(resource.data);
    } catch {
      return null;
    }
  }
  return null;
}

function sheetEntries(workbook: UsheetWorkbook): Array<{ id: string; sheet: UsheetWorksheet }> {
  const sheets = isRecord(workbook.sheets) ? (workbook.sheets as Record<string, UsheetWorksheet>) : {};
  const order = Array.isArray(workbook.sheetOrder) ? workbook.sheetOrder.filter((id): id is string => typeof id === "string") : [];
  const ids = [...order.filter((id) => isRecord(sheets[id])), ...Object.keys(sheets).filter((id) => !order.includes(id))];
  return ids.map((id) => ({ id, sheet: sheets[id] }));
}

interface MergeRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

function mergeRanges(sheet: UsheetWorksheet): MergeRange[] {
  const raw = (sheet as { mergeData?: unknown }).mergeData;
  if (!Array.isArray(raw)) return [];
  const out: MergeRange[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const startRow = positiveInt(item.startRow);
    const endRow = positiveInt(item.endRow);
    const startColumn = positiveInt(item.startColumn);
    const endColumn = positiveInt(item.endColumn);
    if (startRow === null || endRow === null || startColumn === null || endColumn === null) continue;
    if (endRow < startRow || endColumn < startColumn) continue;
    if (endRow === startRow && endColumn === startColumn) continue;
    out.push({ startRow, endRow, startColumn, endColumn });
  }
  return out;
}

function columnWidthPx(sheet: UsheetWorksheet, column: number): number {
  const columnData = (sheet as { columnData?: unknown }).columnData;
  const entry = isRecord(columnData) ? (columnData as Record<string, unknown>)[String(column)] : undefined;
  const width = isRecord(entry) ? positiveNumber(entry.w) : null;
  if (width) return width;
  return positiveNumber(sheet.defaultColumnWidth) ?? DEFAULT_COLUMN_WIDTH_PX;
}

/** Univer 像素宽 → Excel 字符宽（近似：Calibri 11 下 1 字符 = 7px + 5px 内边距）。 */
export function usheetColumnWidthChars(px: number): number {
  const chars = (px - 5) / 7;
  return Math.max(1, Math.min(255, Math.round(chars * 100) / 100));
}

function rowHeightPoints(sheet: UsheetWorksheet, row: number): number | null {
  const rowData = (sheet as { rowData?: unknown }).rowData;
  const entry = isRecord(rowData) ? (rowData as Record<string, unknown>)[String(row)] : undefined;
  const px = isRecord(entry) ? positiveNumber(entry.h) : null;
  return px ? Math.round(px * 0.75 * 100) / 100 : null;
}

function buildSheet(workbook: UsheetWorkbook, sheetId: string, sheet: UsheetWorksheet, index: number, usedNames: Set<string>, drawingResource: unknown): UsheetExcelSheet {
  const merges = mergeRanges(sheet);
  const images = collectImages(sheet, sheetId, drawingResource);
  const cellData = isRecord(sheet.cellData) ? (sheet.cellData as Record<string, Record<string, UsheetCell>>) : {};
  const exportedCells = new Map<string, UsheetExcelCell>();
  let rows = 0;
  let columns = 0;
  const bump = (row: number, column: number) => {
    if (row + 1 > rows) rows = row + 1;
    if (column + 1 > columns) columns = column + 1;
  };
  for (const [rowKey, row] of Object.entries(cellData)) {
    const rowIndex = positiveInt(Number(rowKey));
    if (rowIndex === null || !isRecord(row)) continue;
    for (const [colKey, cell] of Object.entries(row)) {
      const columnIndex = positiveInt(Number(colKey));
      if (columnIndex === null || !isRecord(cell)) continue;
      const exported = usheetCellToExport(workbook, cell);
      if (!exported) continue;
      exportedCells.set(rowIndex + ":" + columnIndex, exported);
      bump(rowIndex, columnIndex);
    }
  }
  for (const merge of merges) bump(merge.endRow, merge.endColumn);
  for (const image of images) bump(image.row, image.column);
  if (rows > USHEET_EXCEL_MAX_ROWS) throw new Error("工作表行数 " + rows + " 超过 Excel 上限 " + USHEET_EXCEL_MAX_ROWS);
  if (columns > USHEET_EXCEL_MAX_COLUMNS) throw new Error("工作表列数 " + columns + " 超过 Excel 上限 " + USHEET_EXCEL_MAX_COLUMNS);
  rows = Math.max(rows, 1);
  columns = Math.max(columns, 1);
  const grid: Array<Array<UsheetExcelCell | null>> = Array.from({ length: rows }, () => Array.from({ length: columns }, () => null));
  for (const [key, cell] of exportedCells) {
    const [rowText, columnText] = key.split(":");
    grid[Number(rowText)][Number(columnText)] = cell;
  }
  // 行高：挂到该行第一个非空格子上
  for (let row = 0; row < rows; row++) {
    const height = rowHeightPoints(sheet, row);
    if (!height) continue;
    const first = grid[row].findIndex((cell) => cell !== null);
    if (first < 0) continue;
    const cell = grid[row][first];
    if (!cell) continue;
    cell.style = { ...(cell.style ?? {}), height };
  }
  // 合并：左上角挂 span，覆盖格置 null
  for (const merge of merges) {
    const columnSpan = merge.endColumn - merge.startColumn + 1;
    const rowSpan = merge.endRow - merge.startRow + 1;
    const topLeft = grid[merge.startRow][merge.startColumn] ?? {};
    topLeft.columnSpan = columnSpan;
    topLeft.rowSpan = rowSpan;
    grid[merge.startRow][merge.startColumn] = topLeft;
    for (let row = merge.startRow; row <= merge.endRow; row++) {
      for (let column = merge.startColumn; column <= merge.endColumn; column++) {
        if (row === merge.startRow && column === merge.startColumn) continue;
        grid[row][column] = null;
      }
    }
  }
  const columnOptions = Array.from({ length: columns }, (_, column) => ({ width: usheetColumnWidthChars(columnWidthPx(sheet, column)) }));
  const freeze = isRecord((sheet as { freeze?: unknown }).freeze) ? ((sheet as { freeze?: Record<string, unknown> }).freeze ?? {}) : {};
  const stickyRowsCount = Math.min(rows, positiveInt(freeze.ySplit) ?? 0);
  const stickyColumnsCount = Math.min(columns, positiveInt(freeze.xSplit) ?? 0);
  const showGridLines = (sheet as { showGridlines?: unknown }).showGridlines !== 0;
  return {
    name: sanitizeSheetName(typeof sheet.name === "string" ? sheet.name : "", index, usedNames),
    rows: grid,
    columns: columnOptions,
    stickyRowsCount,
    stickyColumnsCount,
    showGridLines,
    images,
    rowCount: rows,
    columnCount: columns,
    cellCount: exportedCells.size,
  };
}

/** 工作簿 → 导出模型（所有工作表，按 sheetOrder；隐藏表也导出为可见）。 */
export function buildUsheetExcelModel(workbook: UsheetWorkbook): UsheetExcelModel {
  const entries = sheetEntries(workbook);
  if (entries.length === 0) throw new Error("表格正文里没有任何工作表");
  const usedNames = new Set<string>();
  const drawingResource = parseDrawingResource(workbook);
  const sheets = entries.map((entry, index) => buildSheet(workbook, entry.id, entry.sheet, index, usedNames, drawingResource));
  return {
    sheets,
    imageCount: sheets.reduce((sum, sheet) => sum + sheet.images.length, 0),
    cellCount: sheets.reduce((sum, sheet) => sum + sheet.cellCount, 0),
  };
}
