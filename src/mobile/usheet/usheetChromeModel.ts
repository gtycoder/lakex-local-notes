/**
 * 移动端表格 chrome 的**单一来源**（261021 对齐语雀；261022 晚按用户点单改成两行 + T 一级标签）。
 *
 * 这里只放「有哪些按钮/分组/卡片项」与纯查询函数；组件负责渲染，动作仍由 MobileUsheetViewer 按 id 分派。
 * 语雀实测见 docs/MOBILE-USHEET-YUQUE-PARITY.md §2.1（40px 工具条 / 34×32 按钮 / #fafafa / 分组竖线）、
 * §2.3（⋯ 七行图标面板）、§2.4（插入卡）、§2.5（数字格式卡）。
 *
 * 261022 晚用户点单的偏离（**以本节为准**，不是语雀原样）：
 * - 工具条 = **两行**：第一行常用（+ / 撤销 重做 / T / 常规▾ / ⋯），第二行次常用（格式刷 清除格式 / 筛选 排序 冻结 查找 / 链接 公式）；
 * - **增加/减少小数位都收进 ⋯**（不再占一级位置）；
 * - **B / I / S / U / 字体颜色收进 T 的二级卡**（T 留在第一行）；
 * - 十字高亮移到**底栏缩放左侧**（阅读态也能用，纯本机视图）；
 * - ⋯ 只留真正低频的（填充/边框/对齐/合并、小数位、行高/列宽、删除行列）+ 未接占位（待用户裁决）。
 */
import { COLUMN_WIDTH_STEP, ROW_HEIGHT_STEP } from "./usheetLayoutActions";
import { USHEET_NUMFMT_OPTIONS } from "./usheetNumfmt";
import { USHEET_QUICK_FORMULAS } from "./usheetFormulaQuick";
import { USHEET_BORDER_OPTIONS } from "./usheetBorders";

/** 一级工具条按钮 id（与 MobileUsheetViewer 的动作分派对齐）。 */
export type SheetToolbarItemId =
  | "insert" | "undo" | "redo" | "format" | "numfmt" | "more"
  | "format-painter" | "clear-style" | "filter" | "sort" | "freeze" | "find" | "link" | "formula";

export interface SheetToolbarItem {
  id: SheetToolbarItemId;
  label: string;
}

/**
 * 工具条两行（顺序即渲染顺序）。
 *
 * 第一行 = 高频编辑动作；第二行 = 数据/插入类次高频，两行都常驻可见（第二行可横滑）。
 * 真正低频的（填充、边框、对齐、合并、小数位、行高/列宽、删除行列）留在 ⋯；
 * 未接能力（字号/垂直对齐/换行/选择/图表/条件格式/保护）仍放 ⋯ 底部置灰，等用户逐项裁决。
 */
export type SheetToolbarRow = ReadonlyArray<ReadonlyArray<SheetToolbarItem>>;

export const SHEET_TOOLBAR_ROWS: ReadonlyArray<SheetToolbarRow> = [
  [
    [{ id: "insert", label: "插入" }],
    [{ id: "undo", label: "撤销" }, { id: "redo", label: "重做" }],
    [{ id: "format", label: "文字格式" }],
    [{ id: "numfmt", label: "数字格式" }],
    [{ id: "more", label: "更多表格操作" }],
  ],
  [
    [{ id: "format-painter", label: "格式刷" }, { id: "clear-style", label: "清除格式" }],
    [{ id: "filter", label: "筛选" }, { id: "sort", label: "排序" }, { id: "freeze", label: "冻结" }, { id: "find", label: "查找" }],
    [{ id: "link", label: "链接" }, { id: "formula", label: "公式" }],
  ],
];

/** 锚定卡片 id 与几何（⋯ 卡 232 宽、插入卡 216、数字格式卡 168；T/排序/冻结/公式为小卡）。 */
export type SheetCardId = "insert" | "numfmt" | "more" | "format" | "sort" | "freeze" | "formula";

export const SHEET_CARD_META: Record<SheetCardId, { width: number; ariaLabel: string }> = {
  insert: { width: 216, ariaLabel: "插入" },
  numfmt: { width: 168, ariaLabel: "数字格式" },
  more: { width: 232, ariaLabel: "更多表格操作" },
  format: { width: 240, ariaLabel: "文字格式" },
  sort: { width: 180, ariaLabel: "排序" },
  freeze: { width: 180, ariaLabel: "冻结" },
  formula: { width: 200, ariaLabel: "公式" },
};

/** 卡片里的列表行（插入卡 / 数字格式卡 / 小卡 / ⋯ 的子菜单）。 */
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
  /** 颜色色块的十六进制值：有它就把子菜单渲染成**圆点色板**，不是文字行。 */
  swatch?: string;
  /** 子菜单的版式：色板 / 图标行 / 普通列表（默认）。 */
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

/** T 卡（文字格式二级）里的四个开关：B / I / S / U。 */
export const SHEET_FORMAT_TOGGLES: ReadonlyArray<{ id: string; label: string; icon: string; key: keyof SheetCellFormatLite }> = [
  { id: "bold", label: "加粗", icon: "bold", key: "bold" },
  { id: "italic", label: "斜体", icon: "italic", key: "italic" },
  { id: "strike", label: "删除线", icon: "strike", key: "strike" },
  { id: "underline", label: "下划线", icon: "underline", key: "underline" },
];

/** T 卡里的字体颜色（8 色圆点）——点一个直接改字色。 */
export const SHEET_FONT_COLORS: SheetMenuItem[] = buildColorMenu("font-");

/** 排序小卡（第二行「排序」）。 */
export const SHEET_SORT_MENU: SheetMenuItem[] = [
  { id: "sort-asc", label: "升序（按当前列）" },
  { id: "sort-desc", label: "降序（按当前列）" },
];

/** 冻结小卡（第二行「冻结」）。 */
export const SHEET_FREEZE_MENU: SheetMenuItem[] = [
  { id: "freeze-row", label: "冻结至当前行" },
  { id: "freeze-col", label: "冻结至当前列" },
  { id: "freeze-none", label: "取消冻结" },
];

/** 公式小卡（第二行「公式」）：5 个快捷函数。 */
export const SHEET_FORMULA_MENU: SheetMenuItem[] = USHEET_QUICK_FORMULAS.map((option) => ({ id: option.id, label: option.label }));

/** 水平对齐：语雀是**图标行**（不是文字行）⇒ childLayout: "icons"。 */
const ALIGN_MENU: SheetMenuItem[] = [
  { id: "align-left", label: "左对齐", icon: "align-left" },
  { id: "align-center", label: "居中对齐", icon: "align-center" },
  { id: "align-right", label: "右对齐", icon: "align-right" },
];

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
  /** 子菜单版式：色板 / 图标行 / 普通列表。 */
  childLayout?: "list" | "swatch" | "icons";
  children?: SheetMenuItem[];
}

export type SheetMoreRow = SheetMoreButton[];

/**
 * ⋯ 卡（261022 晚重排）：只留**真正低频**的能力 + 未接占位。
 * 常用格式（B/I/S/U/字色）在 T 卡；筛选/排序/冻结/查找/链接/公式在第二行；十字高亮在底栏。
 */
export function buildMoreRows(): SheetMoreRow[] {
  return [
    [
      { id: "fill-color", label: "填充颜色", icon: "paintbucket", childLayout: "swatch", children: buildColorMenu("fill-") },
      { id: "border", label: "边框", icon: "grid", children: USHEET_BORDER_OPTIONS.map((option) => ({ id: option.id, label: option.label })) },
      { id: "align", label: "水平对齐", icon: "align-left", childLayout: "icons", children: ALIGN_MENU },
      { id: "merge", label: "合并选中单元格", icon: "merge" },
    ],
    [
      // 用户 261022 晚：增/减小数位**都收进 ⋯**（第一行不再占位）。
      { id: "decimal-up", label: "增加小数位", icon: "plus" },
      { id: "decimal-down", label: "减少小数位", icon: "minus" },
      { id: "row-height", label: "行高", icon: "row-height", children: [
        { id: "row-height-up", label: "增高（+" + ROW_HEIGHT_STEP + "px）" },
        { id: "row-height-down", label: "降低（-" + ROW_HEIGHT_STEP + "px）" },
        { id: "row-height-auto", label: "自动行高（按内容）" },
      ] },
      { id: "col-width", label: "列宽", icon: "col-width", children: [
        { id: "col-width-up", label: "加宽（+" + COLUMN_WIDTH_STEP + "px）" },
        { id: "col-width-down", label: "收窄（-" + COLUMN_WIDTH_STEP + "px）" },
      ] },
    ],
    [
      { id: "delete-row", label: "删除当前行", icon: "rows", danger: true },
      { id: "delete-col", label: "删除当前列", icon: "columns", danger: true },
    ],
    // 未接能力（用户 261022 晚：「先保留、逐个告诉我功能，我来决定」）——保留位置并置灰，等裁决。
    [
      { id: "font-size", label: "字号（暂不支持）", icon: "type", text: "12px", disabled: true },
      { id: "valign", label: "垂直对齐（暂不支持）", icon: "align-vertical", disabled: true },
      { id: "wrap", label: "换行（暂不支持）", icon: "wrap", disabled: true },
      { id: "select", label: "选择（暂不支持）", icon: "select", disabled: true },
      { id: "chart", label: "图表（暂不支持）", icon: "chart", disabled: true },
      { id: "conditional", label: "条件格式（暂不支持）", icon: "table", disabled: true },
      { id: "protect", label: "保护（暂不支持）", icon: "lock", disabled: true },
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
