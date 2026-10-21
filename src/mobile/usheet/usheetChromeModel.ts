/**
 * 移动端表格 chrome 的**单一来源**（261021：对齐语雀 App 工具条）。
 *
 * 这里只放「有哪些按钮/分组/卡片项」与纯查询函数；组件负责渲染，动作仍由 MobileUsheetViewer 按 id 分派。
 * 语雀实测见 docs/MOBILE-USHEET-YUQUE-PARITY.md §2.1（40px 工具条 / 34×32 按钮 / #fafafa / 分组竖线）、
 * §2.3（⋯ 七行图标面板）、§2.4（插入卡）、§2.5（数字格式卡）。
 */
import { COLUMN_WIDTH_STEP, ROW_HEIGHT_STEP } from "./usheetLayoutActions";
import { USHEET_NUMFMT_OPTIONS } from "./usheetNumfmt";
import { USHEET_QUICK_FORMULAS } from "./usheetFormulaQuick";
import { USHEET_BORDER_OPTIONS } from "./usheetBorders";

/** 一级工具条按钮 id（与 MobileUsheetViewer 的动作分派对齐）。 */
export type SheetToolbarItemId =
  | "insert" | "undo" | "redo" | "format-painter" | "clear-style" | "numfmt" | "decimals" | "more";

export interface SheetToolbarItem {
  id: SheetToolbarItemId;
  label: string;
}

/**
 * 一级工具条的分组（顺序 = 语雀 §2.1 的组序；未支持项不放，避免死按钮）。
 *
 * 261021 用户定稿（对齐语雀 App，去掉「保存」位）：
 * `+ | 撤销 重做 格式刷 清除格式 | 常规▾ | 小数位 | ⋯`
 * —— 保存/退出编辑由工作区顶栏的 ✓ 承担，**工具条不再重复**（用户 261021：「做在工具条里不是多余了吗」）。
 * 一级只放**已经实现**的能力：语雀有而我们没实现过的项继续留在 ⋯ 卡里置灰。
 */
export const SHEET_TOOLBAR_GROUPS: readonly (readonly SheetToolbarItem[])[] = [
  [{ id: "insert", label: "插入" }],
  [{ id: "undo", label: "撤销" }, { id: "redo", label: "重做" },
    { id: "format-painter", label: "格式刷" }, { id: "clear-style", label: "清除格式" }],
  [{ id: "numfmt", label: "数字格式" }],
  [{ id: "decimals", label: "增加小数位" }],
  [{ id: "more", label: "更多表格操作" }],
];

/** 锚定卡片 id 与几何（P2 起按语雀：⋯ 卡 206 宽、插入卡 216 宽、数字格式卡 136 宽）。 */
export type SheetCardId = "insert" | "numfmt" | "more";

export const SHEET_CARD_META: Record<SheetCardId, { width: number; ariaLabel: string }> = {
  insert: { width: 216, ariaLabel: "插入" },
  numfmt: { width: 168, ariaLabel: "数字格式" },
  more: { width: 232, ariaLabel: "更多表格操作" },
};

/** 卡片里的列表行（插入卡 / 数字格式卡 / ⋯ 的子菜单）。 */
export interface SheetMenuItem {
  id: string;
  label: string;
  note?: string;
  danger?: boolean;
  active?: boolean;
  /** 非点击的分组标题（数字格式卡的分类）。 */
  header?: boolean;
  /** 图标名（由 SheetPopCard / SheetMoreCard 映射到 lucide）。 */
  icon?: string;
  /** 颜色色块的十六进制值（261021 P4-2）：有它就把子菜单渲染成**圆点色板**，不是文字行。 */
  swatch?: string;
  /** 子菜单的版式（261021 P4-2）：色板 / 图标行 / 普通列表（默认）。 */
  childLayout?: "list" | "swatch" | "icons";
  children?: SheetMenuItem[];
}

/** 「插入」卡：**保留我们自己的插行列/合并能力**（语雀 App 的 + 是插入数据，没有插行列）。 */
export function buildInsertMenu(): SheetMenuItem[] {
  return [
    { id: "row-above", label: "在上方插入行", icon: "row-above" },
    { id: "row-below", label: "在下方插入行", icon: "row-below" },
    { id: "col-left", label: "在左侧插入列", icon: "col-left" },
    { id: "col-right", label: "在右侧插入列", icon: "col-right" },
    { id: "merge", label: "合并选中单元格", icon: "merge" },
  ];
}

const COLOR_NAMES: Array<[string, string]> = [
  ["#e5484d", "红色"], ["#f76b15", "橙色"], ["#ffb224", "黄色"], ["#30a46c", "绿色"],
  ["#0091ff", "蓝色"], ["#8e4ec6", "紫色"], ["#8b8d98", "灰色"], ["#11181c", "黑色"],
];

export function buildColorMenu(prefix: "font-" | "fill-"): SheetMenuItem[] {
  return COLOR_NAMES.map(([value, label]) => ({ id: prefix + value, label, swatch: value }));
}

export interface SheetCellFormatLite {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Univer 的右对齐在 facade 里读出来是 "normal"（历史坑），两种都接。 */
  align: "left" | "center" | "right" | "normal" | "general";
  numfmt: string;
}

/** ⋯ 卡的一颗图标按钮（语雀七行面板的一格）。 */
export interface SheetMoreButton {
  id: string;
  label: string;
  icon: string;
  /** 文字型按钮（语雀「字号 12px」那种）；有 text 时不画图标。 */
  text?: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  /** 子菜单版式（261021 P4-2）：色板 / 图标行 / 普通列表。 */
  childLayout?: "list" | "swatch" | "icons";
  children?: SheetMenuItem[];
}

export type SheetMoreRow = SheetMoreButton[];

/** 水平对齐：语雀是**图标行**（不是文字行）⇒ childLayout: "icons"。 */
const ALIGN_MENU: SheetMenuItem[] = [
  { id: "align-left", label: "左对齐", icon: "align-left" },
  { id: "align-center", label: "居中对齐", icon: "align-center" },
  { id: "align-right", label: "右对齐", icon: "align-right" },
];

const FREEZE_MENU: SheetMenuItem[] = [
  { id: "freeze-row", label: "冻结至当前行" },
  { id: "freeze-col", label: "冻结至当前列" },
  { id: "freeze-none", label: "取消冻结" },
];

/**
 * ⋯ 卡 = 语雀的七行图标网格 + 第八行「我们自己的布局/删除/更多工具」。
 * 语雀有、我们没接的能力**保留位置并置灰**（不删项破坏版式）；置灰按钮在卡片里禁用，长按/标题有说明。
 */
export function buildMoreRows(fmt: SheetCellFormatLite): SheetMoreRow[] {
  return [
    // 语雀 ⋯ 卡第一行只有「小数位−」；「增」已提到一级常驻栏（见 SHEET_TOOLBAR_GROUPS）。
    [{ id: "decimal-down", label: "减少小数位", icon: "minus" }],
    [
      { id: "font-size", label: "字号（暂不支持）", icon: "type", text: "12px", disabled: true },
      { id: "bold", label: "加粗", icon: "bold", active: fmt.bold },
      { id: "italic", label: "斜体", icon: "italic", active: fmt.italic },
      { id: "strike", label: "删除线", icon: "strike", active: fmt.strike },
      { id: "underline", label: "下划线", icon: "underline", active: fmt.underline },
    ],
    [
      { id: "font-color", label: "字体颜色", icon: "baseline", childLayout: "swatch", children: buildColorMenu("font-") },
      { id: "fill-color", label: "填充颜色", icon: "paintbucket", childLayout: "swatch", children: buildColorMenu("fill-") },
      // 261021 P5：边框已接（FRange.setBorder；线型固定 THIN、颜色在 usheetBorders 里）。
      { id: "border", label: "边框", icon: "grid", children: USHEET_BORDER_OPTIONS.map((option) => ({ id: option.id, label: option.label })) },
    ],
    [
      { id: "align", label: "水平对齐", icon: "align-left", childLayout: "icons", children: ALIGN_MENU },
      { id: "valign", label: "垂直对齐（暂不支持）", icon: "align-vertical", disabled: true },
      { id: "wrap", label: "换行（暂不支持）", icon: "wrap", disabled: true },
      { id: "merge", label: "合并选中单元格", icon: "merge" },
    ],
    [
      // 261021 P5：筛选/排序已接（Univer 独立包 1.0.3）。排序走我们自己的子菜单，筛选开内核的移动筛选面板。
      { id: "filter", label: "筛选", icon: "filter" },
      { id: "sort", label: "排序", icon: "sort", children: [
        { id: "sort-asc", label: "升序（按当前列）" },
        { id: "sort-desc", label: "降序（按当前列）" },
      ] },
      { id: "conditional", label: "条件格式（暂不支持）", icon: "table", disabled: true },
    ],
    [
      { id: "link", label: "链接（暂不支持）", icon: "link", disabled: true },
      { id: "select", label: "选择（暂不支持）", icon: "select", disabled: true },
      { id: "chart", label: "图表（暂不支持）", icon: "chart", disabled: true },
      { id: "formula", label: "公式", icon: "sigma", children: USHEET_QUICK_FORMULAS.map((option) => ({ id: option.id, label: option.label })) },
    ],
    [
      { id: "freeze", label: "冻结窗格", icon: "freeze", children: FREEZE_MENU },
      { id: "protect", label: "保护（暂不支持）", icon: "lock", disabled: true },
      // 查找替换：包已装、接线后两端 UI 都不出来（261021 记录，待单独排查），先保持置灰，不留死按钮。
      { id: "find", label: "查找替换（待接入）", icon: "search", disabled: true },
    ],
    [
      { id: "row-height", label: "行高", icon: "row-height", children: [
        { id: "row-height-up", label: "增高（+" + ROW_HEIGHT_STEP + "px）" },
        { id: "row-height-down", label: "降低（-" + ROW_HEIGHT_STEP + "px）" },
        { id: "row-height-auto", label: "自动行高（按内容）" },
      ] },
      { id: "col-width", label: "列宽", icon: "col-width", children: [
        { id: "col-width-up", label: "加宽（+" + COLUMN_WIDTH_STEP + "px）" },
        { id: "col-width-down", label: "收窄（-" + COLUMN_WIDTH_STEP + "px）" },
      ] },
      { id: "delete-row", label: "删除当前行", icon: "rows", danger: true },
      { id: "delete-col", label: "删除当前列", icon: "columns", danger: true },
      { id: "more-tools", label: "更多表格工具", icon: "wrench" },
    ],
  ];
}

/** 数字格式卡的当前档位显示（默认「常规」）。 */
export function numfmtLabelOf(pattern: string): string {
  const found = USHEET_NUMFMT_OPTIONS.find((option) => option.pattern === (pattern || ""));
  return found ? found.label.replace(/（.*）$/, "") : "常规";
}

/** 数字格式卡（入口 = 一级「常规▾」；按语雀的类别分组，不支持的完整清单先不摆）。 */
export function buildNumfmtMenu(currentPattern: string): SheetMenuItem[] {
  const group = (header: string, ids: string[]): SheetMenuItem[] => [
    { id: "header-" + header, label: header, header: true },
    ...USHEET_NUMFMT_OPTIONS.filter((option) => ids.includes(option.id)).map((option) => ({
      id: option.id,
      label: option.label,
      note: option.pattern === (currentPattern || "") ? "当前" : undefined,
    })),
  ];
  return [
    ...group("通用", ["numfmt-general", "numfmt-text"]),
    ...group("数值", ["numfmt-number", "numfmt-integer", "numfmt-percent", "numfmt-currency"]),
    ...group("日期时间", ["numfmt-date", "numfmt-time", "numfmt-datetime"]),
  ];
}
