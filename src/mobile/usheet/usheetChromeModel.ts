/**
 * 移动端表格 chrome 的**单一来源**（261020 设计定稿：仿文档 dock 的交互语言，不照抄语雀视觉）。
 *
 * 设计口径（用户 261020 定稿）：
 * - 一级 dock（与文档/小记同一套）：`＋ 插入 · Aa 文字格式 · B 加粗 · 常规(数字格式) · ⋯ 更多 · ↶ 撤销 · ↷ 重做 · ⌨`；
 *   撤销/重做**留在主条**；「数字格式」按钮显示当前格式文字（常规/百分比…）。
 * - 二级全部走**底部面板**（复用文档 dock 的 `.med-f-*` 卡片/按钮原语），不新造顶部下拉卡。
 * - `Aa` 面板只保留**文字样式**（字号 / B I U S / 对齐 / 字色 / 底色 / 清除格式）；
 *   冻结、行高列宽、常用公式、工作表放 `⋯` 面板。
 * - 顶部公式栏（21px）常驻；底部 32px 页签/缩放栏常驻；阅读态保留一条轻工具条（先做缩放/工作表入口）。
 */
import { MOBILE_BOARD_LIGHT, MOBILE_BOARD_SOLID, QUICK_TEXT_COLORS } from "../../core/colorPalette";
import { USHEET_NUMFMT_OPTIONS, type UsheetNumfmtOption } from "./usheetNumfmt";
import { USHEET_QUICK_FORMULAS } from "./usheetFormulaQuick";
import { COLUMN_WIDTH_STEP, ROW_HEIGHT_STEP } from "./usheetLayoutActions";

export type UsheetPanelId = "insert" | "font" | "numfmt" | "more";

export interface UsheetDockItem {
  id: string;
  label: string;
  kind: "panel" | "action";
  panel?: UsheetPanelId;
  /** 文字型按钮（Aa / 常规）；无 = 图标按钮。 */
  text?: string;
  action?: "bold" | "undo" | "redo";
}

/** 一级 dock（顺序即界面顺序；⌨ 是组件里的固定尾键，不在此表）。 */
export const USHEET_DOCK: readonly UsheetDockItem[] = [
  { id: "insert", label: "插入", kind: "panel", panel: "insert" },
  { id: "font", label: "文字格式", kind: "panel", panel: "font", text: "Aa" },
  { id: "bold", label: "加粗", kind: "action", action: "bold" },
  { id: "numfmt", label: "数字格式", kind: "panel", panel: "numfmt", text: "常规" },
  { id: "more", label: "更多", kind: "panel", panel: "more" },
  { id: "undo", label: "撤销", kind: "action", action: "undo" },
  { id: "redo", label: "重做", kind: "action", action: "redo" },
] as const;

/** 字号档位（与表格单元格实际可用字号一致；不与文档正文档位混用）。 */
export const USHEET_FONT_SIZES: readonly number[] = [12, 13, 14, 16, 18, 20, 24, 28, 32] as const;

/** 字色（与文档 dock「字色」同一份语雀口径色板）。 */
export const USHEET_TEXT_COLORS = QUICK_TEXT_COLORS;
/** 底色：浅色行（语雀 2×7 的第一行）+ 无填充格由 UI 侧画。 */
export const USHEET_FILL_COLORS = MOBILE_BOARD_LIGHT;
/** 实色行（备用；底色面板第二行，与文档底色面板同构）。 */
export const USHEET_FILL_SOLID = MOBILE_BOARD_SOLID;

export interface UsheetActionItem {
  id: string;
  label: string;
}
export interface UsheetPanelGroup {
  label: string;
  items: readonly UsheetActionItem[];
}

/** ＋ 插入面板（只放我们支持的能力；图片等未接的能力不出现）。 */
export const USHEET_INSERT_GROUPS: readonly UsheetPanelGroup[] = [
  { label: "行", items: [{ id: "row-above", label: "在上方插入行" }, { id: "row-below", label: "在下方插入行" }] },
  { label: "列", items: [{ id: "col-left", label: "在左侧插入列" }, { id: "col-right", label: "在右侧插入列" }] },
  { label: "单元格", items: [{ id: "merge", label: "合并选中单元格" }] },
] as const;

/** ⋯ 更多面板：布局（冻结/行高/列宽）+ 常用公式（工作表操作走底栏 ≡）。 */
export const USHEET_MORE_GROUPS: readonly UsheetPanelGroup[] = [
  {
    label: "冻结窗格",
    items: [{ id: "freeze-row", label: "冻结至当前行" }, { id: "freeze-col", label: "冻结至当前列" }, { id: "freeze-none", label: "取消冻结" }],
  },
  {
    label: "行高",
    items: [
      { id: "row-height-up", label: "增高 +" + ROW_HEIGHT_STEP },
      { id: "row-height-down", label: "降低 −" + ROW_HEIGHT_STEP },
      { id: "row-height-auto", label: "自动行高" },
    ],
  },
  {
    label: "列宽",
    items: [{ id: "col-width-up", label: "加宽 +" + COLUMN_WIDTH_STEP }, { id: "col-width-down", label: "收窄 −" + COLUMN_WIDTH_STEP }],
  },
  { label: "常用公式", items: USHEET_QUICK_FORMULAS.map((option) => ({ id: option.id, label: option.label })) },
] as const;

/** 数字格式面板选项（单一来源沿用 usheetNumfmt）。 */
export const USHEET_NUMFMT_ITEMS: readonly UsheetNumfmtOption[] = USHEET_NUMFMT_OPTIONS;

/** 把当前 range 的 number format pattern 映射成按钮文字（认不出就沿用「常规」）。 */
export function numfmtLabelOf(pattern: string | undefined | null): string {
  const normalized = (pattern ?? "").trim();
  if (!normalized) return "常规";
  const hit = USHEET_NUMFMT_OPTIONS.find((option) => option.pattern === normalized);
  // dock 按钮宽 43px：去掉括号说明（如「货币（¥）」→「货币」），认不出就显示「自定义」
  return hit ? hit.label.replace(/（[^）]*）/g, "") : "自定义";
}

/** 面板的「对齐」回显：Univer 的 get 返回 left / center / normal（=右对齐）/ general，
 *  而 setter 只收 left / center / normal（`right` 不被接受）⇒ 读出时统一映射成 UI 的 right，
 *  写入时仍按内核取值（见 MobileUsheetViewer.runAction）。 */
export function alignOf(raw: string | null | undefined): "left" | "center" | "right" | "general" {
  if (raw === "normal") return "right";
  return raw === "left" || raw === "center" ? raw : "general";
}

/** 下划线 / 删除线的内核表示在不同版本里可能是 `{ s: 1 }` 也可能就是 `1` ⇒ 两种形状都认。 */
export function lineFlagOf(value: unknown): boolean {
  if (typeof value === "number") return value === 1;
  if (value && typeof value === "object") return (value as { s?: number }).s === 1;
  return false;
}
