/**
 * 移动端表格「表单视图」只读覆盖层（261104）。
 *
 * 只读逐行：表头 = 工作表第一行（字段名），数据区 = 其余行；底部 Sheet 一次展示一行，
 * 上一行/下一行/关闭。**不订阅、不写 onChange、不改选区/正文** ⇒ 打开与翻行都不会触发保存。
 *
 * 数据来源：宿主（MobileUsheetViewer）从当前工作表 facade 读 getRange(0,0,maxRows,maxColumns).getValues()
 * 后交给 buildSheetFormRows；本组件只做展示与行游标，便于单测。
 */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";

export interface SheetFormField {
  /** 字段名 = 第一行对应单元格；首行该列空时回退为列号（A/B/...）。 */
  label: string;
  /** 单元格显示值（数字转字符串；空串在 UI 上显示为占位符）。 */
  value: string;
}

export interface SheetFormRow {
  /** 原始行号（1 基，含表头；第一行数据 = 2）。 */
  index: number;
  fields: SheetFormField[];
}

/** 列号 → Excel 列名（0 → A，25 → Z，26 → AA）。 */
export function sheetColumnLabel(index: number): string {
  let value = Math.max(0, Math.floor(index));
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

/** 单元格值 → 展示文本（空/null 为 ""；布尔按中文；数字原样）。 */
export function sheetCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "是" : "否";
  return "";
}

/**
 * 表头 + 数据区 → 表单行。
 * 用到的列 = 表头非空 **或** 任一数据行有值；数据行里全空的（整行无值）不展示。
 */
export function buildSheetFormRows(values: readonly unknown[][]): SheetFormRow[] {
  if (values.length === 0) return [];
  const header = Array.isArray(values[0]) ? values[0] : [];
  const data = values.slice(1);
  let width = header.length;
  for (const row of data) if (Array.isArray(row) && row.length > width) width = row.length;
  const usedColumns: number[] = [];
  for (let column = 0; column < width; column += 1) {
    if (sheetCellText(header[column])) {
      usedColumns.push(column);
      continue;
    }
    if (data.some((row) => sheetCellText(row?.[column]) !== "")) usedColumns.push(column);
  }
  if (usedColumns.length === 0) return [];
  const rows: SheetFormRow[] = [];
  data.forEach((row, offset) => {
    const fields = usedColumns.map((column) => ({
      label: sheetCellText(header[column]) || sheetColumnLabel(column),
      value: sheetCellText(row?.[column]),
    }));
    if (fields.every((field) => field.value === "")) return;
    rows.push({ index: offset + 2, fields });
  });
  return rows;
}

export interface MobileSheetFormViewProps {
  open: boolean;
  rows: readonly SheetFormRow[];
  /** 工作表名（只作为上下文提示，不改标题）。 */
  sheetName?: string;
  onClose: () => void;
}

export function MobileSheetFormView({ open, rows, sheetName, onClose }: MobileSheetFormViewProps) {
  const [cursor, setCursor] = useState(0);
  const total = rows.length;

  // 每次打开（或数据换了）回到第一行。
  useEffect(() => {
    if (open) setCursor(0);
  }, [open, rows]);

  const current = total === 0 ? 0 : Math.min(cursor, total - 1);
  const row = rows[current];

  return (
    <MobileSheet
      open={open}
      title="表单视图"
      onClose={onClose}
      className="mb-usheet-form-sheet"
      bodyClassName="mb-usheet-form"
      footer={
        <div className="mb-sheet__foot mb-usheet-form__foot">
          <button
            type="button"
            className="mb-btn mb-btn--secondary"
            aria-label="上一行"
            disabled={current === 0}
            onClick={() => setCursor(Math.max(0, current - 1))}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            上一行
          </button>
          <button
            type="button"
            className="mb-btn mb-btn--secondary"
            aria-label="下一行"
            disabled={total === 0 || current + 1 >= total}
            onClick={() => setCursor(Math.min(total - 1, current + 1))}
          >
            下一行
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      }
    >
      {total === 0 || !row ? (
        <div className="mb-empty mb-empty--inset">当前工作表没有数据行（第一行作为字段名）</div>
      ) : (
        <>
          <div className="mb-usheet-form__meta">
            {sheetName ? sheetName + " " : ""}第 {current + 1} 行，共 {total} 行
          </div>
          <div className="mb-usheet-form__row">
            {row.fields.map((field, offset) => (
              <div className="mb-usheet-form__field" key={field.label + "-" + offset}>
                <span className="mb-usheet-form__label" title={field.label}>{field.label}：</span>
                <span className="mb-usheet-form__value">{field.value === "" ? "—" : field.value}</span>
              </div>
            ))}
          </div>
          <div className="mb-usheet-form__meta">工作表第 {row.index} 行</div>
        </>
      )}
    </MobileSheet>
  );
}

export default MobileSheetFormView;
