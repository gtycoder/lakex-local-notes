/**
 * 移动端表格「排序 / 筛选」的**数据区判定**（纯函数，单一来源，可单测）。
 *
 * 为什么不直接用内核的 `sheet.command.sort-range-asc`：那是 **sort-ui 的 UI 包装命令**，
 * 会先走它的前置校验并弹「是否扩展选区」一类对话框（设备实测：单格选中时弹
 * 「所选区域仅有一行，无法排序」的桌面对话框），在移动端是不可接受的形态。
 * 我们改为**自己算数据区**，再派发数据层命令 `sheet.command.sort-range`（无 UI 副作用）。
 *
 * 口径（尽量可预期、不猜语义）：
 * 1. 用户**显式选中了 ≥2 行 × ≥2 列** 的矩形 ⇒ 就排这个矩形（他不含表头是他的选择，与 Excel 一致）；
 * 2. 其余情况（单格 / 单列 / 单行）⇒ 以**活动列**为锚点上下找连续非空块，再把列方向扩到该块已用的列
 *    —— 排序必须整行一起动，否则只挪一列会把数据错位；
 * 3. 表头判定只在一个明确信号上做：**首行是文本、次行不是文本**（典型「表头 + 数据」）⇒ `hasTitle`，
 *    此时排序起始行 = 首行 + 1。不猜更多形态（宁可把表头排进去，也不静默按猜测定"要不要包含表头"）。
 */
export interface SortFilterSheet {
  maxRows: number;
  maxColumns: number;
  getValue: (row: number, column: number) => unknown;
}

/** 选区（facade 的 FRange 取 row/lastRow/column/lastColumn 即可）。 */
export interface SheetSelection {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

/** 判定出来的数据块（含表头行）。行/列都是**绝对下标**，闭区间。 */
export interface SheetBlock {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  /** 首行是表头 ⇒ 排序/筛选的数据从 startRow + 1 开始。 */
  hasTitle: boolean;
}

export type BlockResult = { ok: true; block: SheetBlock } | { ok: false; reason: "empty" | "single-row" | "invalid" };

/** 扫描连续块的**行上限**：防止超大数据表把主线程拖住（超出后按单行报不可排序）。 */
export const SORT_SCAN_ROW_LIMIT = 5000;

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

const looksNumeric = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const text = value.trim().replace(/,/g, "");
  return text !== "" && !Number.isNaN(Number(text));
};

/** 该列在 [top, bottom] 区间内是否有任何非空值（用于列方向扩边）。 */
function columnHasData(sheet: SortFilterSheet, column: number, top: number, bottom: number): boolean {
  for (let row = top; row <= bottom; row += 1) if (!isEmpty(sheet.getValue(row, column))) return true;
  return false;
}

/** 把选区解析成可排序/可筛选的数据块；失败时给**可读原因**（调用方负责 toast，不静默）。 */
export function resolveSheetBlock(selection: SheetSelection, sheet: SortFilterSheet): BlockResult {
  const { startRow, endRow, startColumn, endColumn } = selection;
  if (
    !Number.isInteger(startRow) || !Number.isInteger(endRow) || !Number.isInteger(startColumn) || !Number.isInteger(endColumn)
    || startRow < 0 || startColumn < 0 || endRow < startRow || endColumn < startColumn
  ) {
    return { ok: false, reason: "invalid" };
  }

  // ① 显式矩形（≥2 行 × ≥2 列）：原样使用用户的选择。
  if (endRow > startRow && endColumn > startColumn) {
    return { ok: true, block: { startRow, endRow, startColumn, endColumn, hasTitle: false } };
  }

  // ② 单格 / 单列 / 单行：以「行区间中点在活动列」为锚点上下扩连续非空块。
  const anchorColumn = startColumn;
  const anchorRow = startRow;
  const anchor = sheet.getValue(anchorRow, anchorColumn);
  if (isEmpty(anchor)) return { ok: false, reason: "empty" };

  let top = anchorRow;
  while (top > 0 && top > anchorRow - SORT_SCAN_ROW_LIMIT && !isEmpty(sheet.getValue(top - 1, anchorColumn))) top -= 1;
  let bottom = anchorRow;
  while (bottom < sheet.maxRows - 1 && bottom < anchorRow + SORT_SCAN_ROW_LIMIT && !isEmpty(sheet.getValue(bottom + 1, anchorColumn))) bottom += 1;

  // 行范围 = 锚点所在的**连续非空块**（不用选区去截断：选区可能跨过空白行，按它算会把两块数据混在一起）。
  const blockTop = top;
  const blockBottom = bottom;
  if (blockBottom <= blockTop) return { ok: false, reason: "single-row" };

  // ③ 列方向扩到该行区间的已用列（整行一起动）。
  let left = Math.min(startColumn, anchorColumn);
  let right = Math.max(endColumn, anchorColumn);
  while (left > 0 && columnHasData(sheet, left - 1, blockTop, blockBottom)) left -= 1;
  while (right < sheet.maxColumns - 1 && columnHasData(sheet, right + 1, blockTop, blockBottom)) right += 1;

  // ④ 表头只在**一个明确信号**上判：首行是文本，且该列下面**全部是数值**（典型「表头 + 数值列」）。
  //    纯文本列（如「A/B/C」这种数据本身是文字）与「文字表头 + 文字数据」**不判**表头 ——
  //    宁可把首行一起排进去，也不静默按猜测定"要不要跳过首行"（用户想排除表头可显式选中数据区）。
  const first = sheet.getValue(blockTop, anchorColumn);
  let belowAllNumeric = blockBottom > blockTop;
  for (let row = blockTop + 1; row <= blockBottom && belowAllNumeric; row += 1) {
    const value = sheet.getValue(row, anchorColumn);
    if (!isEmpty(value) && !looksNumeric(value)) belowAllNumeric = false;
  }
  const hasTitle = typeof first === "string" && !looksNumeric(first) && belowAllNumeric;
  if (hasTitle && blockBottom <= blockTop + 1) return { ok: false, reason: "single-row" };

  return { ok: true, block: { startRow: blockTop, endRow: blockBottom, startColumn: left, endColumn: right, hasTitle } };
}

export type SortDirection = "asc" | "desc";

export interface SortRangePlan {
  range: { startRow: number; startColumn: number; endRow: number; endColumn: number };
  orderRules: Array<{ type: SortDirection; colIndex: number }>;
  hasTitle: boolean;
}

export type SortRangeResult = { ok: true; plan: SortRangePlan } | { ok: false; reason: "empty" | "single-row" | "invalid" };

/** 生成 `sheet.command.sort-range` 的参数（活动列 = 排序依据；排序必须整行移动 ⇒ range 覆盖整块）。 */
export function planSortRange(selection: SheetSelection, sheet: SortFilterSheet, direction: SortDirection): SortRangeResult {
  const resolved = resolveSheetBlock(selection, sheet);
  if (!resolved.ok) return resolved;
  const { block } = resolved;
  const dataStartRow = block.hasTitle ? block.startRow + 1 : block.startRow;
  if (block.endRow <= dataStartRow) return { ok: false, reason: "single-row" };
  return {
    ok: true,
    plan: {
      range: { startRow: block.startRow, startColumn: block.startColumn, endRow: block.endRow, endColumn: block.endColumn },
      orderRules: [{ type: direction, colIndex: selection.startColumn }],
      hasTitle: block.hasTitle,
    },
  };
}

/** 原因 → 用户可读文案（移动端没有 hover，一律 toast 明说）。 */
export function blockFailureMessage(reason: "empty" | "single-row" | "invalid"): string {
  if (reason === "empty") return "先选中要排序/筛选的数据（当前格是空的）";
  if (reason === "single-row") return "所选区域只有一行，无法排序或筛选";
  return "当前选区无效";
}
