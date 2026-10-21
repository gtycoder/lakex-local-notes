/**
 * 移动端表格「边框」（261021 P5，纯能力项、零新依赖）。
 *
 * 内核能力 = `FRange.setBorder(type, style, color)`（`@univerjs/sheets` facade）：
 * - `type` 来自 `BorderType` 枚举（**字符串值**：top/bottom/left/right/all/outside/inside/none…）；
 * - `style` 来自 `BorderStyleTypes`（数字枚举，THIN = 1；运行时从 `univerAPI.Enum` 取，不写死数字）；
 * - `color` 是**文档数据里的颜色**（随正文保存，不是 UI 令牌）⇒ 这里的常量属于"内容色"，
 *   口径与 `usheetChromeModel` 的 COLOR_NAMES 相同（颜色字面量只出现在移动端数据模块，不进 CSS）。
 */
export interface UsheetBorderOption {
  id: string;
  label: string;
  /** `BorderType` 的字符串值（与内核枚举逐字一致）。 */
  borderType: string;
}

/** 边框选项（顺序即菜单顺序；对齐语雀边框面板的常用项，其余线型先不做）。 */
export const USHEET_BORDER_OPTIONS: readonly UsheetBorderOption[] = [
  { id: "border-all", label: "全部框线", borderType: "all" },
  { id: "border-outside", label: "外边框", borderType: "outside" },
  { id: "border-inside", label: "内部框线", borderType: "inside" },
  { id: "border-top", label: "上边框", borderType: "top" },
  { id: "border-bottom", label: "下边框", borderType: "bottom" },
  { id: "border-left", label: "左边框", borderType: "left" },
  { id: "border-right", label: "右边框", borderType: "right" },
  { id: "border-none", label: "无框线", borderType: "none" },
];

export const USHEET_BORDER_IDS: ReadonlySet<string> = new Set(USHEET_BORDER_OPTIONS.map((option) => option.id));

/** 文档里的边框颜色（随正文落盘；改这里等于改用户文档的默认边框观感）。 */
export const USHEET_BORDER_COLOR = "#c8ccd2";

/** 组件传入的选区：只要 setBorder 的写入口（缺失 = 运行时没装表格内核）。 */
export interface UsheetBorderRange {
  setBorder?: (type: string, style: number, color?: string) => unknown;
}

/**
 * 应用一个边框项；返回 false = 不是边框动作，或运行时没有 setBorder facade
 * （调用方要给用户明确提示，不静默 no-op）。
 */
export function applyUsheetBorder(range: UsheetBorderRange, actionId: string, style: number, color = USHEET_BORDER_COLOR): boolean {
  const option = USHEET_BORDER_OPTIONS.find((item) => item.id === actionId);
  if (!option) return false;
  if (typeof range.setBorder !== "function") return false;
  range.setBorder(option.borderType, style, color);
  return true;
}
