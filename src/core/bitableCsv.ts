/**
 * 多维表 CSV 导入导出（专项 D01）——**纯函数**，无 DOM / React / node: 依赖。
 *
 * 导出走「Excel 通用」格式：
 * - **UTF-8 BOM**（Windows Excel 双击打开中文不乱码的关键）+ **CRLF** 行尾 + RFC 4180 引号规则；
 * - 首行 = 字段显示名，其后每条记录一行；
 * - 单元格值复用**展示口径单一来源** `bitableFieldText`（多选/附件/关联以 ", " 连接，与界面同源）；
 *   布尔按 Excel 习惯输出 `TRUE`/`FALSE`（不用展示用的「是/否」）；
 * - 附件只出**展示文件名**（磁盘名绝不外显），系统时间到分钟。
 *
 * 导入走主流路线：**首行当表头 → 列映射 → 逐格按目标字段类型转换**；
 * 转换失败**丢弃该单元格**（留空）并记录原因，绝不写坏值；一条记录所有映射列都失败才丢整行。
 */
import {
  BITABLE_PROGRESS_MAX,
  BITABLE_RATING_MAX,
  bitableAttachments,
  bitableFieldText,
  bitableRecordTitle,
  createBitableField,
  relationTargetTable,
  type BitableAttachment,
  type BitableDisplayContext,
  type BitableDoc,
  type BitableField,
  type BitableFieldType,
  type BitableRecord,
  type BitableTable,
} from "./bitableDoc.js";
import { addBitableRecordWithValues } from "./bitableMutations.js";

/** UTF-8 BOM：Excel（尤其 Windows）据它判定编码，缺了中文会乱码。 */
export const BITABLE_CSV_BOM = "\uFEFF";
/** Excel 通用行尾。 */
export const BITABLE_CSV_EOL = "\r\n";
/** 多选/附件/关联等多值单元格的连接符（与展示口径一致）。 */
export const BITABLE_CSV_MULTI_SEPARATOR = ", ";

/** 单字段 → CSV 字段（RFC 4180：含逗号/引号/换行才包裹，内部引号双写）。 */
export function csvEscapeField(value: string): string {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

export interface BitableCsvOptions {
  /**
   * 附件/图片单元格的展示覆盖（压缩包导出用：把单元格指向归档内相对路径，如 `附件/报告.pdf`）。
   * 不传时走展示口径（只出文件名，见 `bitableFieldText`）。
   */
  attachmentLabel?: (attachment: BitableAttachment) => string;
}

/** 单元格展示文本（导出用）：布尔走 Excel 口径，其余复用展示单一来源（附件可被 options 覆盖）。 */
function csvCellText(field: BitableField, record: BitableRecord, ctx?: BitableDisplayContext, options?: BitableCsvOptions): string {
  if (field.type === "boolean") {
    const v = record.values[field.id];
    return v === true ? "TRUE" : v === false ? "FALSE" : "";
  }
  if ((field.type === "attachment" || field.type === "image") && options?.attachmentLabel) {
    return bitableAttachments(record.values[field.id]).map((attachment) => options.attachmentLabel!(attachment)).join(BITABLE_CSV_MULTI_SEPARATOR);
  }
  return bitableFieldText(record, field, ctx);
}

/** 整表（全部字段 + 全部记录，不受视图筛选/排序/隐藏影响）→ CSV 文本（含 BOM）。 */
export function bitableTableCsv(table: BitableTable, ctx?: BitableDisplayContext, options?: BitableCsvOptions): string {
  const fields = table.fields;
  const lines: string[] = [];
  lines.push(fields.map((field) => csvEscapeField(field.name)).join(","));
  for (const record of table.records) {
    lines.push(fields.map((field) => csvEscapeField(csvCellText(field, record, ctx, options))).join(","));
  }
  return BITABLE_CSV_BOM + lines.join(BITABLE_CSV_EOL) + BITABLE_CSV_EOL;
}

/**
 * RFC 4180 解析：支持引号包裹、字段内换行、双写引号转义、CRLF/LF/CR 行尾；开头 BOM 会被剥离。
 */
export function parseCsv(text: string): string[][] {
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { if (s[i + 1] === "\n") i++; row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
    if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export interface CsvColumnMapping {
  /** CSV 列下标。 */
  column: number;
  /** 目标：已有字段 / 新建文本字段 / 忽略。 */
  target: { kind: "field"; fieldId: string } | { kind: "new"; type: BitableFieldType } | { kind: "skip" };
}

export interface CsvImportIssue {
  /** 数据行号（1-based，不含表头）。 */
  row: number;
  column: number;
  header: string;
  reason: string;
}

export interface CsvImportResult {
  doc: BitableDoc;
  added: number;
  droppedCells: number;
  droppedRows: number;
  issues: CsvImportIssue[];
}

/** 默认映射：按表头名精确匹配已有字段（去空白），匹配不到默认「忽略」。 */
export function defaultCsvMapping(table: BitableTable, header: readonly string[]): CsvColumnMapping[] {
  return header.map((name, column) => {
    const trimmed = (name ?? "").trim();
    const field = trimmed ? table.fields.find((item) => item.name === trimmed) : undefined;
    return { column, target: field ? { kind: "field" as const, fieldId: field.id } : { kind: "skip" as const } };
  });
}

const CSV_TRUE = new Set(["true", "1", "是", "yes", "y", "✓"]);
const CSV_FALSE = new Set(["false", "0", "否", "no", "n"]);
function parseBoolean(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (CSV_TRUE.has(v)) return true;
  if (CSV_FALSE.has(v)) return false;
  return undefined;
}

type CoerceResult = { ok: true; value: unknown } | { ok: false; reason: string };

/** 单格按目标字段类型转换；失败给出人话原因（该格会被丢弃）。 */
export function coerceCsvCell(field: BitableField, raw: string, ctx?: BitableDisplayContext): CoerceResult {
  const text = raw.trim();
  switch (field.type) {
    case "text":
    case "link":
      return { ok: true, value: raw };
    case "number": {
      const n = Number(text);
      if (text === "" || !Number.isFinite(n)) return { ok: false, reason: "不是有效数字" };
      return { ok: true, value: n };
    }
    case "rating": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 1 || n > BITABLE_RATING_MAX) return { ok: false, reason: `评分需为 1-${BITABLE_RATING_MAX} 的整数` };
      return { ok: true, value: n };
    }
    case "progress": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 0 || n > BITABLE_PROGRESS_MAX) return { ok: false, reason: `进度需为 0-${BITABLE_PROGRESS_MAX} 的整数` };
      return { ok: true, value: n };
    }
    case "boolean": {
      const v = parseBoolean(text);
      if (v === undefined) return { ok: false, reason: "布尔需为 TRUE/FALSE/1/0/是/否" };
      return { ok: true, value: v };
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, reason: "日期需为 YYYY-MM-DD" };
      return { ok: true, value: text };
    }
    case "select": {
      const option = field.options?.find((o) => o.name === text);
      if (!option) return { ok: false, reason: `单选没有匹配的选项「${text}」` };
      return { ok: true, value: option.id };
    }
    case "multiSelect": {
      const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return { ok: false, reason: "多选为空" };
      const ids: string[] = [];
      for (const part of parts) {
        const option = field.options?.find((o) => o.name === part);
        if (!option) return { ok: false, reason: `多选没有匹配的选项「${part}」` };
        ids.push(option.id);
      }
      return { ok: true, value: ids };
    }
    case "relationOneWay":
    case "relationTwoWay": {
      const target = relationTargetTable(ctx, field);
      if (!target) return { ok: false, reason: "关联目标表不存在" };
      const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return { ok: false, reason: "关联为空" };
      const ids: string[] = [];
      for (const part of parts) {
        const record = target.records.find((r) => bitableRecordTitle(target, r, ctx).trim() === part);
        if (!record) return { ok: false, reason: `关联记录「${part}」未找到` };
        ids.push(record.id);
      }
      return { ok: true, value: ids };
    }
    case "createdTime":
    case "updatedTime":
      return { ok: false, reason: "系统时间字段只读，不能导入" };
    case "ai":
      return { ok: false, reason: "AI 字段由生成产生，不能从 CSV 导入" };
    case "attachment":
    case "image":
      return { ok: false, reason: "附件/图片不能从 CSV 导入" };
    default:
      return { ok: true, value: raw };
  }
}

/**
 * 导入：按 mapping 把 CSV 数据行追加到 tableId。
 * - 新建字段只建**文本**列（不臆造复杂类型）；
 * - 每格转换失败只丢该格并记录 issue；一条记录所有映射列都失败才丢整行；
 * - 关联字段经 `addBitableRecordWithValues` 走双向镜像唯一写入口。
 */
export function importCsvRows(
  doc: BitableDoc,
  tableId: string,
  rows: readonly string[][],
  mapping: readonly CsvColumnMapping[],
  options: { hasHeader?: boolean } = {},
): CsvImportResult {
  const hasHeader = options.hasHeader ?? true;
  const table = doc.tables.find((t) => t.id === tableId);
  if (!table) return { doc, added: 0, droppedCells: 0, droppedRows: 0, issues: [] };
  const header = hasHeader ? (rows[0] ?? []) : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const fields: BitableField[] = [...table.fields];
  const resolved: Array<{ column: number; field: BitableField }> = [];
  for (const m of mapping) {
    const target = m.target;
    if (target.kind === "skip") continue;
    if (target.kind === "new") {
      const created = createBitableField(target.type, (header[m.column] ?? "").trim() || "导入列");
      fields.push(created);
      resolved.push({ column: m.column, field: created });
    } else {
      const existing = fields.find((f) => f.id === target.fieldId);
      if (existing) resolved.push({ column: m.column, field: existing });
    }
  }
  let tables = doc.tables.map((t) => (t.id !== tableId ? t : { ...t, fields }));

  const issues: CsvImportIssue[] = [];
  let added = 0;
  let droppedCells = 0;
  let droppedRows = 0;
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const ctx: BitableDisplayContext = { tables };
    const values: Record<string, unknown> = {};
    let anyValue = false;
    for (const { column, field } of resolved) {
      const raw = row[column] ?? "";
      if (raw.trim() === "") continue;
      const result = coerceCsvCell(field, raw, ctx);
      if (result.ok) { values[field.id] = result.value; anyValue = true; }
      else {
        droppedCells++;
        issues.push({ row: r + 1, column, header: header[column] ?? "", reason: result.reason });
      }
    }
    if (!anyValue) { droppedRows++; continue; }
    const out = addBitableRecordWithValues(tables, tableId, values);
    tables = out.tables;
    added++;
  }
  return { doc: { ...doc, tables }, added, droppedCells, droppedRows, issues };
}

/** 生成导入结果的人话摘要（UI 提示用）。 */
export function csvImportSummary(result: CsvImportResult): string {
  const parts = [`已导入 ${result.added} 条记录`];
  if (result.droppedCells > 0) parts.push(`丢弃 ${result.droppedCells} 个单元格`);
  if (result.droppedRows > 0) parts.push(`跳过 ${result.droppedRows} 行`);
  return parts.join("，");
}

/** 导出文件名（表名 → 可安全落盘的文件名）。 */
export function csvFileNameFor(table: BitableTable): string {
  const safe = table.name.replace(/[\\/:*?"<>|\r\n]/g, "_").trim() || "数据表";
  return `${safe}.csv`;
}
