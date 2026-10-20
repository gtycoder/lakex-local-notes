/**
 * 移动端表格的数字格式（261020 P1 第二批）。
 *
 * 能力来源：`@univerjs/sheets-numfmt` 给 `FRange` 追加了 `setNumberFormat(pattern)`（运行时 facade mixin）。
 * 这里只做三件事：**选项表（单一来源）**、**注入式调用**（mixin 不存在时明确返回 false，由组件提示，不静默 no-op）、
 * 以及「清空格式」用空 pattern 的口径。
 *
 * pattern 口径（与 Univer/Excel 通用）：
 * - 常规 = 空串（清掉格式，恢复自动）· 文本 = `@` · 数字 = `#,##0.00` · 整数 = `#,##0`
 * - 百分比 = `0.00%` · 货币 = `¥#,##0.00` · 日期 = `yyyy-MM-dd` · 时间 = `HH:mm:ss` · 日期时间 = `yyyy-MM-dd HH:mm:ss`
 */
export interface UsheetNumfmtOption {
  id: string;
  label: string;
  pattern: string;
}

/** 移动端「数字格式」菜单项（顺序即菜单顺序；第一条是清空/常规）。 */
export const USHEET_NUMFMT_OPTIONS: readonly UsheetNumfmtOption[] = [
  { id: "numfmt-general", label: "常规（清除格式）", pattern: "" },
  { id: "numfmt-text", label: "文本", pattern: "@" },
  { id: "numfmt-number", label: "数字（两位小数）", pattern: "#,##0.00" },
  { id: "numfmt-integer", label: "整数", pattern: "#,##0" },
  { id: "numfmt-percent", label: "百分比", pattern: "0.00%" },
  { id: "numfmt-currency", label: "货币（¥）", pattern: "¥#,##0.00" },
  { id: "numfmt-date", label: "日期", pattern: "yyyy-MM-dd" },
  { id: "numfmt-time", label: "时间", pattern: "HH:mm:ss" },
  { id: "numfmt-datetime", label: "日期时间", pattern: "yyyy-MM-dd HH:mm:ss" },
];

export const USHEET_NUMFMT_IDS: ReadonlySet<string> = new Set(USHEET_NUMFMT_OPTIONS.map((option) => option.id));

/** 组件传入的选区：只要 numfmt mixin 的写入口（缺失 = 运行时没装 numfmt 插件）。 */
export interface UsheetNumberFormatRange {
  setNumberFormat?: (pattern: string) => unknown;
}

/**
 * 应用一个数字格式菜单 id；返回 false = 不是数字格式动作，或运行时没有 numfmt mixin
 * （调用方应给用户明确提示，不能静默失败）。
 */
export function applyUsheetNumberFormat(range: UsheetNumberFormatRange, actionId: string): boolean {
  const option = USHEET_NUMFMT_OPTIONS.find((item) => item.id === actionId);
  if (!option) return false;
  if (typeof range.setNumberFormat !== "function") return false;
  range.setNumberFormat(option.pattern);
  return true;
}
