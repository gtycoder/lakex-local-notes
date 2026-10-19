/**
 * 表格（usheet = Univer 工作簿）→ CSV —— 纯函数，无 DOM / node: 依赖（桌面导出与测试共用）。
 *
 * 口径（对齐多维表 D01）：
 * - UTF-8 **BOM** + **CRLF**（Windows Excel 打开中文/多行不乱码、不并格）；
 * - 单元格文本 = 显示值 `m`，没有就退回原始值 `v`；富文本单元格取 `p` 的纯文本；公式单元格优先缓存结果，不写 `=...`（CSV 不是公式格式）；
 * - 只导出**有效区域**（最后一个非空单元格所在行列），不把配置的 `rowCount` 空行全部铺出来；
 * - 工作表选择：显式 sheetId 优先；缺省取 `sheetOrder[0]`（导出入口拿不到当前工作表时）。
 *
 * 上限是**显式报错**而非静默截断（AGENTS：不许静默丢用户数据）。
 */
import { usheetCellRichText, type UsheetCell, type UsheetWorkbook, type UsheetWorksheet } from "./usheetDoc.js";

/** 单次导出的行列硬上限：超了明确报错，不静默截断。 */
export const USHEET_CSV_MAX_ROWS = 200000;
export const USHEET_CSV_MAX_COLUMNS = 16384;

export interface UsheetSheetRef {
  sheetId: string;
  sheet: UsheetWorksheet;
}

export interface UsheetCsvResult {
  csv: string;
  sheetId: string;
  sheetName: string;
  /** 导出的数据行数（有效区域内） */
  rowCount: number;
  /** 导出的列数（有效区域内） */
  columnCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从工作簿里挑一张工作表：显式 id → sheetOrder 第一个存在的 → 对象里的第一张。 */
export function pickUsheetSheet(workbook: UsheetWorkbook, sheetId?: string | null): UsheetSheetRef | null {
  const sheets = isRecord(workbook.sheets) ? (workbook.sheets as Record<string, UsheetWorksheet>) : {};
  if (sheetId && isRecord(sheets[sheetId])) return { sheetId, sheet: sheets[sheetId] };
  const order = Array.isArray(workbook.sheetOrder) ? workbook.sheetOrder : [];
  for (const id of order) {
    if (typeof id === "string" && isRecord(sheets[id])) return { sheetId: id, sheet: sheets[id] };
  }
  const first = Object.keys(sheets)[0];
  return first ? { sheetId: first, sheet: sheets[first] } : null;
}

/** 单元格 → 导出文本。只读显示值；富文本单元格退回 `p` 的纯文本；绝不漏内部对象 JSON。 */
function cellText(cell: UsheetCell | undefined): string {
  if (!cell || !isRecord(cell)) return "";
  const display = cell.m ?? cell.v;
  if (typeof display === "string") return display;
  if (typeof display === "number" || typeof display === "boolean") return String(display);
  return usheetCellRichText(cell);
}

function escapeCsv(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return '"' + value.replace(/"/g, '""') + '"';
}

/**
 * 有效区域：最后一个“有文本”的单元格决定行列数；没有任何内容 ⇒ 0×0。
 * 注意公式即使没有缓存值也算内容（`f` 存在即非空），避免丢一整张“只填了公式”的表。
 */
function usedRange(sheet: UsheetWorksheet): { rows: number; columns: number } {
  const cellData = isRecord(sheet.cellData) ? (sheet.cellData as Record<string, Record<string, UsheetCell>>) : {};
  let rows = 0;
  let columns = 0;
  for (const [rowKey, row] of Object.entries(cellData)) {
    const r = Number(rowKey);
    if (!Number.isInteger(r) || r < 0 || !isRecord(row)) continue;
    for (const [colKey, cell] of Object.entries(row)) {
      const c = Number(colKey);
      if (!Number.isInteger(c) || c < 0) continue;
      const hasFormula = isRecord(cell) && typeof cell.f === "string" && cell.f.trim().length > 0;
      if (!hasFormula && cellText(cell) === "") continue;
      if (r + 1 > rows) rows = r + 1;
      if (c + 1 > columns) columns = c + 1;
    }
  }
  return { rows, columns };
}

function assertRange(rows: number, columns: number): void {
  if (rows > USHEET_CSV_MAX_ROWS) throw new Error(`表格行数 ${rows} 超过 CSV 导出上限 ${USHEET_CSV_MAX_ROWS}`);
  if (columns > USHEET_CSV_MAX_COLUMNS) throw new Error(`表格列数 ${columns} 超过 CSV 导出上限 ${USHEET_CSV_MAX_COLUMNS}`);
}

/** 工作簿 → 某一张工作表的 CSV 文本（BOM + CRLF）。 */
export function usheetSheetCsv(workbook: UsheetWorkbook, sheetId?: string | null): UsheetCsvResult {
  const ref = pickUsheetSheet(workbook, sheetId);
  if (!ref) throw new Error("表格正文里没有任何工作表");
  const { sheet } = ref;
  const sheetName = typeof sheet.name === "string" && sheet.name.trim() ? sheet.name : "Sheet1";
  const { rows, columns } = usedRange(sheet);
  assertRange(rows, columns);
  if (rows === 0 || columns === 0) {
    return { csv: "", sheetId: ref.sheetId, sheetName, rowCount: 0, columnCount: 0 };
  }
  const cellData = sheet.cellData as Record<string, Record<string, UsheetCell>>;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = cellData[String(r)] ?? {};
    const fields: string[] = [];
    for (let c = 0; c < columns; c++) fields.push(escapeCsv(cellText(row[String(c)])));
    lines.push(fields.join(","));
  }
  // BOM 只加在非空产出上：空工作表的导出结果就是空文件（调用方给“工作表为空”的提示）。
  return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", sheetId: ref.sheetId, sheetName, rowCount: rows, columnCount: columns };
}
