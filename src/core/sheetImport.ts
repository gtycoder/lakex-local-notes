/**
 * CSV / Excel 工作表 → usheet 工作簿（纯函数，主进程导入管线与测试共用）。
 *
 * 口径（v1，按 HANDOFF 调研范围）：
 * - Excel 只导入**值**（含公式结果、日期按 ISO 文本），样式/公式/图表/图片/透视/条件格式不导入；
 * - CSV 无类型信息，全部按文本导入；
 * - 网格只按有效区域 + 默认 35×16 下限，不生成 20 万空行；
 * - 超 Excel 上限明确报错，不静默截断。
 */
import { parseCsv } from "./csv.js";
import {
  normalizeUsheetWorkbook,
  USHEET_DEFAULT_COLUMNS,
  USHEET_DEFAULT_ROWS,
  type UsheetCell,
  type UsheetWorkbook,
  type UsheetWorksheet,
} from "./usheetDoc.js";

export const SHEET_IMPORT_MAX_ROWS = 200_000;
export const SHEET_IMPORT_MAX_COLUMNS = 16_384;

export interface ImportedSheet {
  /** 工作表名（缺省 Sheet1）。 */
  name?: string;
  /** 行 × 列的值；空单元格用 null/undefined/""。 */
  rows: readonly (readonly unknown[])[];
}

export interface SheetImportResult {
  workbook: UsheetWorkbook;
  warnings: string[];
}

function isCellEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** 单元格值 → Univer 单元格；只写能稳定 JSON 序列化的类型（日期转 ISO 文本）。 */
export function sheetCellOf(value: unknown): UsheetCell | null {
  if (isCellEmpty(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    const text = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
    return { v: text, m: text };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return { v: value };
  }
  if (typeof value === "boolean") return { v: value };
  if (typeof value === "string") return { v: value, m: value };
  // read-excel-file 还可能给 bigint 等；统一转字符串，绝不把对象塞进正文。
  const text = String(value);
  return text.trim() ? { v: text, m: text } : null;
}

function assertRange(rows: number, columns: number): void {
  if (rows > SHEET_IMPORT_MAX_ROWS) throw new Error("表格行数 " + rows + " 超过导入上限 " + SHEET_IMPORT_MAX_ROWS);
  if (columns > SHEET_IMPORT_MAX_COLUMNS) throw new Error("表格列数 " + columns + " 超过导入上限 " + SHEET_IMPORT_MAX_COLUMNS);
}

/** 多张工作表 → usheet 工作簿；空表也至少保留一张默认工作表。 */
export function workbookFromSheets(sheets: readonly ImportedSheet[], title: string): SheetImportResult {
  const list = sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [] as unknown[][] }];
  const sheetOrder: string[] = [];
  const sheetMap: Record<string, UsheetWorksheet> = {};
  const warnings: string[] = [];
  let totalRows = 0;
  let totalCols = 0;

  list.forEach((input, index) => {
    const id = "s" + (index + 1);
    const name = (input.name ?? "").trim() || "Sheet" + (index + 1);
    const cellData: Record<string, Record<string, UsheetCell>> = {};
    let lastRow = -1;
    let lastCol = -1;
    input.rows.forEach((row, r) => {
      const target: Record<string, UsheetCell> = {};
      row.forEach((value, c) => {
        const cell = sheetCellOf(value);
        if (!cell) return;
        target[String(c)] = cell;
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      });
      if (Object.keys(target).length > 0) cellData[String(r)] = target;
    });
    const rows = lastRow + 1;
    const columns = lastCol + 1;
    assertRange(rows, columns);
    if (rows > totalRows) totalRows = rows;
    if (columns > totalCols) totalCols = columns;
    const sheet: UsheetWorksheet = {
      id,
      name,
      rowCount: Math.max(USHEET_DEFAULT_ROWS, rows),
      columnCount: Math.max(USHEET_DEFAULT_COLUMNS, columns),
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
      cellData,
    };
    sheetOrder.push(id);
    sheetMap[id] = sheet;
  });

  if (totalRows > SHEET_IMPORT_MAX_ROWS || totalCols > SHEET_IMPORT_MAX_COLUMNS) {
    throw new Error("表格内容超出导入上限");
  }
  const workbook: UsheetWorkbook = {
    id: "workbook",
    name: title.trim() || "表格",
    sheetOrder,
    sheets: sheetMap,
  };
  // 与其他 usheet 落盘同口径：字体 canonical、资源空串归一。
  normalizeUsheetWorkbook(workbook);
  return { workbook, warnings };
}

/** CSV 文本 → 单工作表工作簿（UTF-8 BOM 由 parseCsv 处理）。 */
export function workbookFromCsv(text: string, title: string): SheetImportResult {
  return workbookFromSheets([{ name: "Sheet1", rows: parseCsv(text) }], title);
}