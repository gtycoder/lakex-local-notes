/**
 * 移动端表格（usheet）的「布局类」动作：冻结窗格 / 行高 / 列宽。
 *
 * 为什么单独一层：这些动作全部落在 Univer facade 上（`FWorksheet`），逻辑是纯的
 * （读当前选区 → 调若干 facade 方法），抽出来才能在不启 canvas 引擎的情况下单测；
 * 组件只负责「什么时候调用」。
 *
 * 口径：
 * - 冻结行/列 = **冻结到当前行/列（含）**，即 `setFrozenRows(row + 1)` / `setFrozenColumns(col + 1)`；
 * - 行高/列宽按**选中区域的行/列范围**逐个调整（不碰未选中的行），有下限，避免调到 0 之后拖不出来；
 * - 自动行高走内核 `autoFitRow`（按内容自适应，恢复到「默认行高」就靠它）。
 */
export const ROW_HEIGHT_STEP = 8;
export const COLUMN_WIDTH_STEP = 24;
export const MIN_ROW_HEIGHT = 16;
export const MIN_COLUMN_WIDTH = 32;
/** 读不到行高/列宽时的回落（Univer/UniverSheet 默认 24 / 88）。 */
const FALLBACK_ROW_HEIGHT = 24;
const FALLBACK_COLUMN_WIDTH = 88;

/** 动作 id 集合（组件据此把菜单项分派到本模块；单一来源，不在组件里另写清单）。 */
export const USHEET_LAYOUT_ACTIONS: ReadonlySet<string> = new Set([
  "freeze-row", "freeze-col", "freeze-none",
  "row-height-up", "row-height-down", "row-height-auto",
  "col-width-up", "col-width-down",
]);

/** 组件传入的选区（只用到行列范围，便于单测替身）。 */
export interface UsheetLayoutRange {
  getRow(): number;
  getLastRow(): number;
  getColumn(): number;
  getLastColumn(): number;
}

/** 组件传入的 sheet（只用到本模块要调的那几个 facade 方法）。 */
export interface UsheetLayoutSheet {
  setFrozenRows(rows: number): unknown;
  setFrozenColumns(columns: number): unknown;
  cancelFreeze(): unknown;
  getRowHeight(row: number): number;
  setRowHeight(row: number, height: number): unknown;
  autoFitRow(row: number): unknown;
  getColumnWidth(column: number): number;
  setColumnWidth(column: number, width: number): unknown;
}

/**
 * 执行一个布局动作；返回 false = 不是布局动作（调用方继续按别的分支处理，绝不静默吞掉）。
 * 冻结用「当前行 + 1 / 当前列 + 1」：用户点「冻结至当前行」时期望当前这一行也被冻住。
 */
export function applyUsheetLayoutAction(
  action: string,
  range: UsheetLayoutRange,
  sheet: UsheetLayoutSheet,
): boolean {
  if (!USHEET_LAYOUT_ACTIONS.has(action)) return false;
  if (action === "freeze-row") {
    sheet.setFrozenRows(range.getRow() + 1);
    return true;
  }
  if (action === "freeze-col") {
    sheet.setFrozenColumns(range.getColumn() + 1);
    return true;
  }
  if (action === "freeze-none") {
    sheet.cancelFreeze();
    return true;
  }
  if (action === "row-height-auto") {
    for (let row = range.getRow(); row <= range.getLastRow(); row += 1) sheet.autoFitRow(row);
    return true;
  }
  if (action === "row-height-up" || action === "row-height-down") {
    const delta = action === "row-height-up" ? ROW_HEIGHT_STEP : -ROW_HEIGHT_STEP;
    for (let row = range.getRow(); row <= range.getLastRow(); row += 1) {
      const base = sheet.getRowHeight(row) || FALLBACK_ROW_HEIGHT;
      sheet.setRowHeight(row, Math.max(MIN_ROW_HEIGHT, Math.round(base + delta)));
    }
    return true;
  }
  // 列宽（Univer facade 没有"自动列宽"：只提供 +/- 步进）
  const delta = action === "col-width-up" ? COLUMN_WIDTH_STEP : -COLUMN_WIDTH_STEP;
  for (let column = range.getColumn(); column <= range.getLastColumn(); column += 1) {
    const base = sheet.getColumnWidth(column) || FALLBACK_COLUMN_WIDTH;
    sheet.setColumnWidth(column, Math.max(MIN_COLUMN_WIDTH, Math.round(base + delta)));
  }
  return true;
}
