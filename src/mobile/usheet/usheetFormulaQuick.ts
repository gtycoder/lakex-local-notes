/**
 * 移动端表格「常用公式」快捷插入（261020 P1 第四批）。
 *
 * 语义对齐 Excel/Google Sheets 的 Σ：**选中要放公式的单元格**，在它**上方同一列**自动找一段
 * **连续数值块**，写入 `=SUM(上方区域)`（AVERAGE/COUNT/MAX/MIN 同）。移动端手打公式太难，
 * 这是最小可用且不覆盖既有数据的做法：
 * - 只写**当前活动单元格**（用户自己选的位置），绝不往选区下方/旁边乱写；
 * - 只认**上方连续数值**（遇到空/文本/公式即停），找不到就给明确提示，不猜；
 * - 不提供「先选区域再插入」——选区语义在移动端容易被误拖，先不做（见 HANDOFF）。
 */
export interface UsheetQuickFormulaOption {
  id: string;
  label: string;
  /** 写入正文的函数名（大小写按 Univer/Excel 惯例）。 */
  fn: "SUM" | "AVERAGE" | "COUNT" | "MAX" | "MIN";
}

export const USHEET_QUICK_FORMULAS: readonly UsheetQuickFormulaOption[] = [
  { id: "quickformula-sum", label: "求和 SUM", fn: "SUM" },
  { id: "quickformula-average", label: "平均值 AVERAGE", fn: "AVERAGE" },
  { id: "quickformula-count", label: "计数 COUNT", fn: "COUNT" },
  { id: "quickformula-max", label: "最大值 MAX", fn: "MAX" },
  { id: "quickformula-min", label: "最小值 MIN", fn: "MIN" },
];

export const USHEET_QUICK_FORMULA_IDS: ReadonlySet<string> = new Set(USHEET_QUICK_FORMULAS.map((item) => item.id));

/** 0 → A、25 → Z、26 → AA（与 Univer/Excel 的列名一致）。 */
export function columnName(index: number): string {
  let value = Math.max(0, Math.floor(index));
  let name = "";
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }
  return name;
}

/** 用于判断「是不是数值」：Univer 里数值就是 number（文本型数字不算，避免把文本当区间求和）。 */
function isNumericCell(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface UsheetQuickFormulaPlan {
  /** 要写入的完整公式（A1 记法）。 */
  formula: string;
  /** 写入目标（= 用户选中的活动单元格，0-based）。 */
  targetRow: number;
  targetColumn: number;
}

/**
 * 计算「选中单元格 + 一键函数」该写什么：从选中格**向上**收集连续数值，生成 `=FN(A1:A3)`。
 * 任何前置条件不满足都返回 null（调用方给明确提示），绝不覆盖、绝不猜。
 */
export function planUsheetQuickFormula(
  actionId: string,
  anchor: { row: number; col: number },
  getValue: (row: number, col: number) => unknown,
): UsheetQuickFormulaPlan | null {
  const option = USHEET_QUICK_FORMULAS.find((item) => item.id === actionId);
  if (!option) return null;
  const row = Math.floor(anchor.row);
  const col = Math.floor(anchor.col);
  if (!Number.isFinite(row) || !Number.isFinite(col) || row <= 0 || col < 0) return null;
  let startRow = row;
  for (let probe = row - 1; probe >= 0; probe -= 1) {
    if (!isNumericCell(getValue(probe, col))) break;
    startRow = probe;
  }
  if (startRow >= row) return null; // 上方没有连续数值
  const column = columnName(col);
  const formula = "=" + option.fn + "(" + column + (startRow + 1) + ":" + column + row + ")";
  return { formula, targetRow: row, targetColumn: col };
}
