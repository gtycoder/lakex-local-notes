/**
 * 移动端表格编辑态 chrome 的**单一来源**（261023 v5，用户定稿方向）。
 *
 * 形态 = 文档编辑器的底部 dock：单行图标工具条贴在键盘上沿；点一级按钮展开的面板**占住键盘区域**
 * （与文档 dock 一致：键盘不显示、工具条停在面板上方、再点同一颗收起并放回键盘）。
 *
 * 一级按钮（顺序定稿）：＋插入 | T 文字格式 | 数据 | 视图 | ⋯ 更多 | 撤销 | 重做 |（右侧固定）键盘。
 * 公式栏不进这里：移动端编辑输入面用内核原生移动公式栏（261025 起，见 useNativeSheetFormulaBar）。
 *
 * 语雀/钉钉实测与取舍记录见 HANDOFF 261023 与 docs/preview/mobile-sheet-prototype.html。
 */
import { USHEET_NUMFMT_OPTIONS } from "./usheetNumfmt";
import { USHEET_QUICK_FORMULAS } from "./usheetFormulaQuick";
import { USHEET_BORDER_OPTIONS } from "./usheetBorders";

/* ---------------- 一级 dock ---------------- */

export type SheetDockId = "insert" | "format" | "data" | "view" | "more";

export interface SheetDockItem {
  id: SheetDockId;
  label: string;
}

/** 顺序即渲染顺序（定稿：插在最前、更多在撤销之前）。 */
export const SHEET_DOCK_ITEMS: ReadonlyArray<SheetDockItem> = [
  { id: "insert", label: "插入" },
  { id: "format", label: "文字格式" },
  { id: "data", label: "数据" },
  { id: "view", label: "视图" },
  { id: "more", label: "更多" },
];

/* ---------------- 插入面板 ---------------- */

/** 上排 4 连块：插入行列（钉钉式：只有图标、蓝色、无文字）。 */
export type SheetInserterId = "row-above" | "row-below" | "col-left" | "col-right";

export const SHEET_INSERTER_ACTIONS: ReadonlyArray<{ id: SheetInserterId; label: string }> = [
  { id: "row-above", label: "在上方插入行" },
  { id: "row-below", label: "在下方插入行" },
  { id: "col-left", label: "在左侧插入列" },
  { id: "col-right", label: "在右侧插入列" },
];

/** 白块（4 列）：与文档插入面板同款（图标在上、文字在下）。公式按用户要求放「更多」。 */
export type SheetInsertTileId = "image" | "sign" | "link" | "date" | "attachment" | "chart" | "comment";

export const SHEET_INSERT_TILES: ReadonlyArray<{ id: SheetInsertTileId; label: string; icon: string; disabled?: boolean }> = [
  { id: "image", label: "单元格图片", icon: "image", disabled: true },
  { id: "sign", label: "手写签名", icon: "sign", disabled: true },
  { id: "link", label: "链接", icon: "link" },
  { id: "date", label: "日期", icon: "date" },
  { id: "attachment", label: "附件", icon: "attachment", disabled: true },
  { id: "chart", label: "图表", icon: "chart", disabled: true },
  { id: "comment", label: "批注", icon: "comment", disabled: true },
];

/* ---------------- T 面板（文字格式） ---------------- */

export interface SheetCellFormatLite {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Univer 的右对齐在 facade 里读出来是 "normal"（历史坑），两种都接。 */
  align: "left" | "center" | "right" | "normal" | "general";
  numfmt: string;
  /** 垂直对齐（261023 新增；general/undefined = 默认 middle）。 */
  valign?: "top" | "middle" | "bottom" | "general";
  /** 字号（px，来自 SetFontSize 命令；空 = 默认 14）。 */
  size?: number;
  /** 字体颜色（内核 style.cl.rgb；空 = 默认色）。 */
  fontColor?: string;
  /** 单元格背景色（内核 style.bg.rgb；空 = 无填充）。 */
  bgColor?: string;
}

/** B / I / S / U 四个开关（横排一条白条）。 */
export const SHEET_FORMAT_TOGGLES: ReadonlyArray<{
  id: "bold" | "italic" | "strike" | "underline";
  label: string;
  glyph: string;
}> = [
  { id: "bold", label: "加粗", glyph: "B" },
  { id: "italic", label: "斜体", glyph: "I" },
  { id: "underline", label: "下划线", glyph: "U" },
  { id: "strike", label: "删除线", glyph: "S" },
];

/** 水平对齐（一条白条）。 */
export const SHEET_ALIGN_H: ReadonlyArray<{ id: "left" | "center" | "right"; label: string }> = [
  { id: "left", label: "左" },
  { id: "center", label: "中" },
  { id: "right", label: "右" },
];

/** 垂直对齐（一条白条；用户定稿「列表换成对齐」）。 */
export const SHEET_ALIGN_V: ReadonlyArray<{ id: "top" | "middle" | "bottom"; label: string }> = [
  { id: "top", label: "上" },
  { id: "middle", label: "中" },
  { id: "bottom", label: "下" },
];

/** 字体颜色（一条白条：A × 8）。 */
export const SHEET_FONT_COLORS: ReadonlyArray<{ id: string; label: string; value: string }> = [
  { id: "font-default", label: "默认", value: "" },
  { id: "font-gray", label: "灰色", value: "#8b8d98" },
  { id: "font-red", label: "红色", value: "#e5484d" },
  { id: "font-orange", label: "橙色", value: "#f76b15" },
  { id: "font-yellow", label: "黄色", value: "#ffb224" },
  { id: "font-green", label: "绿色", value: "#30a46c" },
  { id: "font-blue", label: "蓝色", value: "#0091ff" },
  { id: "font-purple", label: "紫色", value: "#8e4ec6" },
];

/** 背景填充：两行（无 + 浅色 / 强色），同文档 T 面板。 */
export const SHEET_FILL_LIGHT: ReadonlyArray<{ id: string; label: string; value: string }> = [
  { id: "fill-none", label: "无填充", value: "" },
  { id: "fill-pink", label: "浅粉", value: "#fde2e2" },
  { id: "fill-peach", label: "浅橙", value: "#fde8d7" },
  { id: "fill-cream", label: "浅黄", value: "#fdf3cf" },
  { id: "fill-mint", label: "浅绿", value: "#e3f5e3" },
  { id: "fill-sky", label: "浅蓝", value: "#e0ecfb" },
  { id: "fill-lilac", label: "浅紫", value: "#f0e6fb" },
];

export const SHEET_FILL_STRONG: ReadonlyArray<{ id: string; label: string; value: string }> = [
  { id: "fill-gray", label: "深灰", value: "#d9d9d9" },
  { id: "fill-red", label: "红", value: "#e5484d" },
  { id: "fill-orange", label: "橙", value: "#f76b15" },
  { id: "fill-yellow", label: "黄", value: "#d9a300" },
  { id: "fill-green", label: "绿", value: "#30a46c" },
  { id: "fill-blue", label: "蓝", value: "#0091ff" },
  { id: "fill-purple", label: "紫", value: "#8e4ec6" },
];

/** 字号固定档（照文档 T 面板：8 档）。 */
export const SHEET_FONT_SIZES: ReadonlyArray<number> = [14, 15, 16, 19, 22, 24, 29, 32];

/* ---------------- 通用菜单项（工作表列表浮层 SheetPopCard 仍在用） ---------------- */

export interface SheetMenuItem {
  id: string;
  label: string;
  note?: string;
  danger?: boolean;
  active?: boolean;
  header?: boolean;
  icon?: string;
  swatch?: string;
  childLayout?: "list" | "swatch" | "icons";
  children?: SheetMenuItem[];
}

/* ---------------- 数据 / 视图面板 ---------------- */

export interface SheetPanelRow {
  id: string;
  label: string;
  /** 行首线性图标 id（SheetDockPanel 里映射成 lucide 组件）。 */
  icon: string;
  note?: string;
  disabled?: boolean;
  switch?: boolean;
  switchOn?: boolean;
}

export const SHEET_DATA_ROWS: ReadonlyArray<SheetPanelRow> = [
  { id: "sort-asc", label: "按当前列升序", icon: "sortAsc" },
  { id: "sort-desc", label: "按当前列降序", icon: "sortDesc" },
  { id: "filter", label: "筛选", icon: "filter", switch: true },
  { id: "find", label: "查找替换", icon: "find" },
  { id: "validation", label: "数据验证（下拉列表）", icon: "validation", note: "占位", disabled: true },
  { id: "split", label: "分列", icon: "split", note: "占位", disabled: true },
];

export const SHEET_VIEW_ROWS: ReadonlyArray<SheetPanelRow> = [
  { id: "freeze", label: "冻结行列", icon: "freeze" },
  { id: "formview", label: "表单视图", icon: "form", note: "占位", disabled: true },
  { id: "chartview", label: "图表视图", icon: "chart", note: "占位", disabled: true },
];

export const SHEET_ZOOM_LEVELS: ReadonlyArray<{ id: "zoom-default" | "zoom-fit" | "zoom-focus"; label: string; value: number }> = [
  { id: "zoom-default", label: "默认", value: 1 },
  { id: "zoom-fit", label: "全景", value: 0.85 },
  { id: "zoom-focus", label: "聚焦", value: 1.15 },
];

/**
 * 面板下限高度（拿不到键盘高时）：必须放得下最高的**常驻**面板 ——
 * 「更多」7 行 = 7×40 + 6 分隔 + 14 内距 = 294；T 面板 = 300。
 * 阅读态点「编辑」直接开面板（没弹过键盘）时用它，避免底行被切。
 */
export const SHEET_PANEL_MIN_HEIGHT = 300;

/* ---------------- 更多面板 ---------------- */

export type SheetMoreId = "numfmt" | "border" | "formula" | "merge" | "painter" | "clear" | "conditional";

export const SHEET_MORE_ROWS: ReadonlyArray<{ id: SheetMoreId; label: string; icon: string; disabled?: boolean }> = [
  { id: "numfmt", label: "数字格式", icon: "number" },
  { id: "border", label: "边框", icon: "border" },
  { id: "formula", label: "公式", icon: "formula" },
  { id: "merge", label: "合并单元格", icon: "merge" },
  { id: "painter", label: "格式刷", icon: "painter" },
  { id: "clear", label: "清除格式", icon: "clear" },
  { id: "conditional", label: "条件格式", icon: "conditional", disabled: true },
];

/** 更多面板的下钻列表（数字格式 / 边框 / 公式）。 */
export function buildMoreSubMenu(
  id: "numfmt" | "border" | "formula",
  currentNumfmt = "",
): Array<{ id: string; label: string; note?: string }> {
  if (id === "numfmt") {
    return USHEET_NUMFMT_OPTIONS.map((option) => ({
      id: option.id,
      label: option.label,
      note: option.pattern === (currentNumfmt || "") ? "当前" : undefined,
    }));
  }
  if (id === "border") {
    return USHEET_BORDER_OPTIONS.map((option) => ({ id: option.id, label: option.label }));
  }
  return USHEET_QUICK_FORMULAS.map((option) => ({ id: option.id, label: option.label }));
}

/** 数字格式的简写（显示当前档位用）。 */
export function numfmtLabelOf(pattern: string): string {
  const found = USHEET_NUMFMT_OPTIONS.find((option) => option.pattern === (pattern || ""));
  return found ? found.label.replace(/（.*）$/, "") : "常规";
}

/**
 * 颜色归一化：内核可能回 `#E5484D` / `rgb(229, 72, 77)` / 空串，面板反显比较必须走这一处。
 * 输出统一为小写 `#rrggbb`（认不出的值原样小写返回，仍可做相等比较）。
 */
export function normalizeSheetColor(value: string | null | undefined): string {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "";
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (rgb) {
    return "#" + [rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("");
  }
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return "#" + text.slice(1).split("").map((char) => char + char).join("");
  return text;
}

/** 两个颜色是否同一个（默认色/无填充 = 空串）。 */
export function sheetColorEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeSheetColor(a) === normalizeSheetColor(b);
}

/**
 * 面板内容下方是否还有可滚动余量（底部渐隐提示的**唯一判据**）。
 * 2px 容差吸收亚像素取整：恰好贴底时不留一条假提示。
 */
export function sheetPanelNeedsFade(
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  tolerance = 2,
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop > tolerance;
}
