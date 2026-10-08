/**
 * 表格编辑器（kind="sheet"）：FortuneSheet。
 * 原 jspreadsheet CE 实现已替换；选型/补丁/风险见 docs/ARCHITECTURE.md。
 *
 * 关键约束：
 * - FortuneSheet 用 canvas 渲染；在 display:none 容器里首次挂载会量到 0 尺寸 ⇒ 本组件只在
 *   「首次可见」后才真正挂载 <Workbook>（keep-alive 隐藏的 tab 不初始化 canvas）；实测隐藏→显示
 *   后 canvas 能自动恢复尺寸（spike，260919）。
 * - 非受控数据：data 只作初始值；变更走 onChange，防抖后序列化回 SheetDoc v2。**不要**把 onChange
 *   的 data 再回灌给 <Workbook>（会打断输入/光标跳动）。宿主用 key=[noteId]-[reloadKey] 保证换文档重挂。
 * - 只读（回收站/锁定/被他端删除）：allowEdit=false + 不挂自动保存。
 * - CSP：FortuneSheet 的 insertRowOrColumn 用 new Function，已由
 *   patches/@fortune-sheet+core+1.0.4.patch 替换为 apply（prod CSP 无 unsafe-eval）。
 * - **图片走资产管线（260920 P1）**：内核插图产出的是 base64 data URL，宿主在保存前把它提升成
 *   `note-assets/{noteId}/` 里的资产文件（复用内核同一条 `uploadLakeResource` 通道），正文只写 filename、
 *   渲染时再拼 URL。提升未落地前**推迟保存**（正文绝不落 base64）。见 docs/STORAGE-LAYERS.md。
 * - **单元格图片（260921 P2）**：`images[]` 里带 `cell:{r,c}` 锚点的就是单元格图片 —— 复用内核浮动图通道渲染
 *   （滚动跟随/视口裁剪/缩放全免费），几何由宿主按单元格矩形一直跟着走（`core/sheetGeometry.ts`），
 *   「锁比例 + 不超过原图」交给 CSS `object-fit: scale-down`，指针事件关闭（点击命中单元格）。
 *   插入/替换走自定义工具栏项；`Delete` 删除、粘贴图片插入；冻结区内的图补 `translate` 偏移。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import "./sheetEditor.css";
import { readSheetView, writeSheetView } from "./sheetViewStore";
import { ColorPalette, lastUsedColor } from "../../components/ColorPalette.js";
import { SheetBgColorIcon, SheetTextColorIcon } from "./sheetColorIcons.js";
import { emptySheetBody, parseSheetBody, sheetImageDiskSrc, sheetImageSrc, sheetsToBody, type SheetWorksheet } from "../../core/sheetDoc.js";
import { sheetRangeRect, sheetZoom } from "../../core/sheetGeometry.js";
import { uploadLakeResource } from "../editor/resourceUpload";
import { openImagePreview } from "../editor/imagePreview";
import { native } from "../../lib/native";
import { ASSET_PORT, assetThumbWidthForCss } from "../../lib/assetPort";
import { Download, Maximize2, Trash2 } from "lucide-react";

/** 自动保存防抖：FortuneSheet 每次变更都回调，必须合并。 */
const AUTOSAVE_DEBOUNCE_MS = 1500;
/** 行高重算节流：批量写入（粘贴/填充）等一拍即可。 */
const AUTO_ROW_THROTTLE_MS = 160;
/** 全表重算（列宽变化）的**静默窗口**：拖列宽会连续改 columnlen，窗口内不重算、停手后只跑一次（261008）。 */
const AUTO_ROW_FULL_THROTTLE_MS = 400;
/** 默认缩放 = 100%（261008 用户：「默认就是 110% 是当时我随口说的，改回 100%」）。
 *  `LEGACY_DEFAULT_ZOOM` 是旧默认值：本机记忆里等于它的缩放一律视为"没自定义过" ⇒ 回落新默认（旧值打开即归一化）。 */
const DEFAULT_SHEET_ZOOM = 1;
const LEGACY_DEFAULT_ZOOM = 1.1;
/**
 * 单元格默认字体（= 产品字体 MiSans，与 \`--lake-font-family\` 首族一致）。用户要求「默认用全局字体、
 * 不支持修改」⇒ 不放「字体」工具栏项。
 * ⚠️ **只给单个族名**：内核 \`getFontSet\` 会把多族串去掉引号后**整体加引号成"一个"族名**
 * （\`"BlinkMacSystemFont, Segoe UI, PingFang SC, …"\` 并不存在）⇒ 实际渲染落到内核自带回退栈
 * \`Helvetica Neue / PingFang SC\`。这正是用户 261008 报「表格不是 MiSans」的根因；
 * 单族名不会被加引号，缺字由内核自带回退栈补齐。
 */
const GLOBAL_FONT = "MiSans";
/**
 * 261008 之前写进正文的旧默认值（多族串，被内核当单一族名 ⇒ 实际渲染 Helvetica Neue/PingFang SC）。
 * 打开旧文档时就地归一化；只认这一条的**精确匹配**，不动内核/用户设过的其它字体。
 */
const LEGACY_GLOBAL_FONT =
  'BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif';

/**
 * 该单元格的 `ff` 是否要归一化成 {@link GLOBAL_FONT}（261008 用户报「编辑态与展示态字号/换行不一样」= 本 bug）。
 *
 * 只认三类「不是用户显式选的字体名」的旧值：
 * 1. `null`（从未设置）；
 * 2. 旧的多族串 {@link LEGACY_GLOBAL_FONT}；
 * 3. **数字 / 数字串** —— 那是内核 `fontarray` 的**下标**，而 `fontarray[0] = "Times New Roman"`
 *    ⇒ 粘贴进来的数据常带 `ff: 0`，画布实际按 **Times New Roman** 渲染，与我们（编辑框 13px、行高估算
 *    `estimateWrappedRowHeight` 用 MiSans）完全是两套字体：观感不同、换行点不同 ⇒ 行高也对不上。
 * 用户显式设过的其它字体名一律不动。
 */
function needsGlobalFont(ff: unknown): boolean {
  if (ff == null || ff === LEGACY_GLOBAL_FONT) return true;
  if (typeof ff === "number") return true;
  return /^\d+$/.test(String(ff).trim());
}

/** 内核旧的默认字号（`sheetCtx.defaultFontSize` 原值 10pt）。 */
const LEGACY_DEFAULT_FONT_SIZE = 10;

/**
 * 该格的 `fs` 是否要归一化成当前默认字号 {@link SHEET_DEFAULT_FONT_SIZE}（261008 用户：「表格默认字号加1」）。
 *
 * 只认「等于旧默认」的：粘贴进来的数据几乎每格都显式带 `fs: 10` ⇒ 只改内核默认值对它们**完全无效**
 * （用户实测就是没生效）。显式设过其它字号的格（如 12/14）一律不动。
 */
function needsDefaultFontSize(fs: unknown): boolean {
  if (fs == null) return true;
  const n = Number(fs);
  return Number.isFinite(n) && Math.ceil(n) === LEGACY_DEFAULT_FONT_SIZE;
}
/** FortuneSheet 的自动换行 = `tb:"2"`（overflow:"1" / clip:"0"）；默认给单元格补上。 */
const WRAP = "2";

/** 表格默认字号（pt）。内核默认 10（@fortune-sheet/core 的 sheetCtx.defaultFontSize），
 *  用户 261008 要求 +1 ⇒ 传进 <Workbook defaultFontSize>；行高估算必须用同一常量，
 *  否则「按内容自适应行高」会按 10pt 算窄（estimateWrappedRowHeight 内部按 pt→px 换算）。 */
const SHEET_DEFAULT_FONT_SIZE = 11;
/**
 * 工具栏（260921 第三轮：用户点名加回 4 项 —— format / link / comment / locationCondition，各自放在内核默认顺序的位置）。
 * 相对内核默认 `toolbarItems` 仍然隐藏：数字格式快捷键（currency-format / percentage-format / number-decrease /
 * number-increase）、font（用户要求默认全局字体、不可改）、text-rotation、conditionFormat、dataVerification、
 * splitColumn、screenshot。完整清单与中文名见 HANDOFF §2.17。
 */
const TOOLBAR_ITEMS = [
  "undo", "redo", "|",
  "format-painter", "clear-format", "|",
  "format", "lake-decimals-decrease", "lake-decimals-increase", "|",   // 261008：内核这版没有小数位±的按钮（只有图标）⇒ 自建两个 custom item                        // 单元格格式（数字格式 / 对齐 / 字体 / 边框）
  "font-size", "|",
  "bold", "italic", "strike-through", "underline", "|",
  "lake-text-color", "lake-bg-color", "|",   // 261008：颜色按钮改为宿主自绘（图标+色条+公共选色盘，见 customToolbarItems）
  "horizontal-align", "vertical-align", "text-wrap", "|",
  "border", "merge-cell", "|",
  "filter", "link", "cell-image", "comment", "|",   // cell-image = 单元格图片（浮动图已移除，占原 image 位）
  "freeze", "quick-formula", "locationCondition", "|", "search",
];

/**
 * 只读（锁定 / 回收站 / 被他端删除）时的工具栏：**只留点得动、且不写数据的视图类**（260930 用户要求
 * 「不用都隐藏，只留一部分不影响数据的」）。
 * 排除依据是内核 @fortune-sheet/core 的 `allowEdit` 门禁：加粗/字号/颜色/对齐/边框/合并/填充格式、
 * 排序/筛选/冻结/超链接/快速公式、批注的增删改、增删工作表……在 allowEdit=false 时全部直接 return，
 * 留在工具栏里就是「点了没反应的死按钮」，比不显示更糟。
 * 保留三项：comment（showHideComment，显示/隐藏批注）· locationCondition（定位条件）· search（查找）。
 * `cell-image` 是**插入图片**（写操作），只读下不出现；查看已有单元格图片走"点单元格里的图片"。
 */
const TOOLBAR_ITEMS_READONLY = ["comment", "locationCondition", "|", "search"];

/**
 * 工作表标签右键菜单（261008 用户点名精简）：内核默认 = ["delete","copy","rename","color","hide","|","move"]，
 * 去掉 「move」（向左移 / 向右移）—— 单文档里的工作表顺序就是新建顺序，没有搬来搬去的使用场景。
 * 末位 "|" 一并去掉（否则菜单尾部会多一条分隔线）；其余（删除 / 复制 / 重命名 / 修改颜色 / 隐藏）保持内核原样。
 */
const SHEET_TAB_CONTEXT_MENU = ["delete", "copy", "rename", "color", "hide"];

/**
 * 三个颜色入口的「最近使用」分桶（AGENTS §3#19：不同入口不许混用）。
 * 同时它就是**「上次使用的颜色」的记忆**：颜色按钮点图标即复用最近一条，不另存一份。
 */
const COLOR_BUCKET = { text: "sheet-text-color", bg: "sheet-bg-color", tab: "sheet-tab-color" } as const;

/**
 * 小数位增减（261008，对齐云端「0.0 ±」）。
 * ⚠️ 内核这版**没有** number-decrease / number-increase 的处理（sprite 里有图标、渲染器没分支，与 delete-cell 同类死键）
 * ⇒ 我们自建：按当前数字格式串增减小数位。只认纯数字格式（`0` / `#,##0.00` / `0.0%`），
 * 其余（日期、文本、带货币前缀的复杂格式）保持不动 —— 与内核能力一致，不猜。
 */
const DECIMAL_FORMAT_RE = /^([#0,]+)(\.([0#]+))?(%)?$/;
export function adjustDecimals(format: string, delta: number): string {
  const fa = format || "General";
  if (fa === "General") return delta > 0 ? "0." + "0".repeat(Math.min(delta, 9)) : fa;
  const matched = DECIMAL_FORMAT_RE.exec(fa);
  if (!matched) return fa;
  const decimals = matched[3] ? matched[3].length : 0;
  const next = Math.max(0, Math.min(9, decimals + delta));
  return matched[1] + (next > 0 ? "." + "0".repeat(next) : "") + (matched[4] ?? "");
}

/** 工具栏「小数位 ±」图标 = 内核 sprite 里现成的 number-decrease / number-increase 字形。 */
function DecimalsIcon({ name }: { name: "number-decrease" | "number-increase" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <use xlinkHref={"#" + name} />
    </svg>
  );
}

/**
 * 颜色按钮右侧的下拉三角（261008，对齐 Lake / 内核 combo 的**分体交互**）：
 * 点图标 = 直接用上次的颜色；点三角 = 开公共选色盘。三角用内核 sprite 的 `combo-arrow`（与工具栏其它下拉同一套图标）。
 */
function ColorCaret({ onOpen }: { onOpen: (anchor: HTMLElement | null) => void }) {
  return (
    <span
      className="sheet-color-caret"
      role="button"
      aria-label="选择颜色"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onOpen(event.currentTarget.parentElement); }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <use xlinkHref="#combo-arrow" />
      </svg>
    </span>
  );
}

/**
 * 单元格右键菜单：内核默认基础上只把「插入图片」由浮动图改为**单元格图片**（260921 用户要求
 * 「完全去掉浮动图片」），并**去掉 261008 用户点名的 5 项**（精简）：
 * - \`sort\` 排序选区 / \`orderAZ\` 升序排列 / \`orderZA\` 降序排列 / \`filter\` 筛选选区 —— 4 项近义、低频；
 * - \`link\` 插入链接 —— 工具栏已有同一入口。
 * - 「hide-row」/「hide-column」—— 内核这两个 key 各渲染**两行**（隐藏选中行 + 显示隐藏行 / 隐藏选中列 + 显示隐藏列）
 *   ⇒ 去掉它们 = 去掉这 4 行（261008 用户第二轮点名）。
 * - 'delete-cell' / 'chart' / 'data' / 'cell-format' —— 本版内核的单元格右键渲染器**根本不认**这几个名字
 *   （实测：它只处理 copy / paste / insert-row / insert-column / delete-row / delete-column /
 *   hide-row / hide-column / set-row-height / set-column-width / sort / orderAZ / orderZA / filter / link / image /
 *   clear，共 17 个）⇒ 列了也不渲染，删掉让清单与实际一致。
 * 代价（已知并接受）：自定义排序对话框、以及**隐藏/取消隐藏行列**从此没有菜单入口（要恢复得走 API
 * wb.hideRowOrColumn / wb.showRowOrColumn）；升/降序仍可在工具栏「筛选」下拉里做，筛选/链接仍在工具栏。
 * \`cell-image\` 由 customToolbarItems 提供（同一个 key 两处复用）。
 */
const CELL_CONTEXT_MENU = [
  "copy", "paste", "|",
  "insert-row", "insert-column", "delete-row", "delete-column",
  "set-row-height", "set-column-width", "|",
  "auto-row-height",   // 自定义项（由 customToolbarItems 提供；不在 TOOLBAR_ITEMS 里 ⇒ 只出现在右键菜单）
  "clear", "cell-image",
];

/**
 * 单元格图片（260921 P2）—— 对齐语雀在线表格的「单元格图片」：图片完全落在单元格内、保持比例、
 * 随单元格（列宽/行高）等比缩放、**放大到原图尺寸后不再放大**。
 *
 * 实现要点（不改内核）：
 * - **复用内核浮动图通道渲染**：图片仍存在 `sheets[].images[]`，只是多带 `cell:{r,c}` 锚点；
 *   几何（left/top/width/height）由宿主按单元格矩形一直跟着走。这样滚动跟随、视口裁剪、缩放
 *   （内核渲染时乘 zoomRatio）全部免费拿到，不需要自建 DOM 覆盖层。
 * - 「锁比例 + 不超过原图」交给 CSS `object-fit: scale-down`（见 sheetEditor.css），零数学。
 * - 指针事件关闭：单元格图片是「单元格的内容」，点击应命中单元格而不是浮动图（否则会被拖走/加
 *   缩放手柄，语义错乱）。
 */
const CELL_IMAGE_ID_PREFIX = "cellimg_";

/** 单元格锚点（正文 `images[].cell` 的形态）。 */
interface CellAnchor {
  r: number;
  c: number;
}

/** 读一张图的单元格锚点；非单元格图片返回 null。 */
function cellAnchorOf(image: unknown): CellAnchor | null {
  if (!image || typeof image !== "object") return null;
  const cell = (image as { cell?: unknown }).cell;
  if (!cell || typeof cell !== "object") return null;
  const r = Number((cell as CellAnchor).r);
  const c = Number((cell as CellAnchor).c);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) return null;
  return { r, c };
}

/** 是否同一格（一个单元格只保留一张单元格图片：后插入的替换先插入的）。 */
function sameAnchor(a: CellAnchor, b: CellAnchor): boolean {
  return a.r === b.r && a.c === b.c;
}

/** 读选区焦点格（row_focus/column_focus 优先，缺省取 row[0]/column[0]）；无有效焦点返回 null。 */
function selectionFocus(selection: unknown): CellAnchor | null {
  if (!selection || typeof selection !== "object") return null;
  const value = selection as { row?: unknown; column?: unknown; row_focus?: unknown; column_focus?: unknown };
  const r = Number.isInteger(value.row_focus) ? Number(value.row_focus) : Array.isArray(value.row) ? Number(value.row[0]) : NaN;
  const c = Number.isInteger(value.column_focus) ? Number(value.column_focus) : Array.isArray(value.column) ? Number(value.column[0]) : NaN;
  if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) return null;
  return { r, c };
}

/**
 * 安全读选区：内核 `getSelection()` 在 `luckysheet_select_save` 非数组时会抛 `map is not a function`
 * （实测会触发 SheetEditorErrorBoundary 卸载整个编辑器）⇒ 一律兜底空数组，绝不把异常抛给调用处。
 */
function safeGetSelection(wb: WorkbookInstance | null): Array<{ row?: number[]; column?: number[] }> {
  try {
    const sel = wb?.getSelection?.();
    return Array.isArray(sel) ? (sel as Array<{ row?: number[]; column?: number[] }>) : [];
  } catch {
    return [];
  }
}

/** 某格锚定的单元格图片（一个格子只保留一张）；没有返回 null。 */
function cellImageAt(sheet: SheetWorksheet | null, r: number, c: number): Record<string, unknown> | null {
  const raw = (sheet as { images?: unknown } | null)?.images;
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    const anchor = cellAnchorOf(item);
    if (anchor && sameAnchor(anchor, { r, c })) return item as Record<string, unknown>;
  }
  return null;
}

/** 单元格图片 id（前缀供 CSS 识别；不用内核的 `img_` 前缀以免混进浮动图规则）。 */
function nextCellImageId(): string {
  return `${CELL_IMAGE_ID_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 锚点 → 实际覆盖范围：合并单元格取整块（与内核 `insertImage` 用 `mergeBorder` 对齐左上角的取舍一致，
 * 只是这里连尺寸一起按整块给，图片才会正好铺在合并后的格子里）。
 */
function anchorRange(wb: WorkbookInstance | null, anchor: CellAnchor): { r1: number; c1: number; r2: number; c2: number } {
  const mc = wb?.getCellValue(anchor.r, anchor.c, { type: "mc" } as never) as
    | { r?: number; c?: number; rs?: number; cs?: number }
    | null
    | undefined;
  if (mc && Number.isInteger(mc.r) && Number.isInteger(mc.c)) {
    const rs = Number.isInteger(mc.rs) && (mc.rs as number) > 0 ? (mc.rs as number) : 1;
    const cs = Number.isInteger(mc.cs) && (mc.cs as number) > 0 ? (mc.cs as number) : 1;
    const r1 = mc.r as number;
    const c1 = mc.c as number;
    return { r1, c1, r2: r1 + rs - 1, c2: c1 + cs - 1 };
  }
  return { r1: anchor.r, c1: anchor.c, r2: anchor.r, c2: anchor.c };
}

/** 退回用：`status===1` 的「活动标记」在多表下并不可靠（见 `activeSheet`）。 */
function activeSheetOf(sheets: SheetWorksheet[]): SheetWorksheet | null {
  return sheets.find((sheet) => (sheet as { status?: unknown }).status === 1) ?? sheets[0] ?? null;
}

/**
 * 当前活动工作表：**优先按内核 `getSheet()` 定位**（它跟 `currentSheetId` 走）。
 * 实测内核切换 sheet 只改 `currentSheetId`、**不更新 `status`** ⇒ 多表下 `status===1` 永远是第一张，
 * 只看 status 会「人在第二张表，插入/几何却作用在第一张」。拿不到 getSheet 才退回 `activeSheetOf`。
 */
function activeSheet(wb: WorkbookInstance | null, sheets: SheetWorksheet[]): SheetWorksheet | null {
  try {
    const current = (wb?.getSheet?.() ?? null) as { id?: unknown } | null;
    const id = current && typeof current.id === "string" ? current.id : "";
    if (id) {
      const found = sheets.find((s) => (s as { id?: unknown }).id === id);
      if (found) return found;
    }
  } catch {
    /* 拿不到就退回 */
  }
  return activeSheetOf(sheets);
}

/**
 * 键盘/粘贴的落点是不是「在网格上操作」（内核的单元格输入框 / sheet overlay / 画布）。
 *
 * 内核的 `.luckysheet-cell-input` **始终聚焦**（它不是「编辑模式」，而是就地输入面），所以不能按
 * 「target 是 input 就当在输入」来判——对话框里的输入框才是要避开的。
 */
function isGridTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.className !== "string") return false;
  const cls = String(el.className);
  if (cls.includes("luckysheet-cell-input") || cls.includes("fortune-sheet-overlay")) return true;
  // 网格本体：canvas / 单元格图片等都在 `.fortune-cell-area` 里（工具栏、弹窗在它外面，不受影响）
  return typeof el.closest === "function" && el.closest(".fortune-cell-area") != null;
}

/** 单元格图片按钮图标（自带 svg，避免与工具栏「插入图片」的图标混淆）。 */
const CELL_IMAGE_ICON = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="2.6" y="2.6" width="14.8" height="14.8" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="7.4" cy="7.6" r="1.5" fill="currentColor" />
    <path d="M4 15.4 8.3 11l2.7 2.7 2.3-2.3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 右键「自动行高」的图标（自带 svg；该菜单项的图标位由 sprite 的 `cm-move-vertical` 提供）。 */
const AUTO_ROW_HEIGHT_ICON = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3.5 4.5h13M3.5 15.5h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M10 7v6M7.6 9.2 10 6.8l2.4 2.4M7.6 10.8 10 13.2l2.4-2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * 离屏测量用的**唯一** canvas / ctx（261008 性能修复）。
 *
 * 原实现每次调用都 `createElement("canvas") + getContext("2d")` —— 表格66（5453 行 / 32718 格）
 * 实测一个来回 **2530ms**（其中 getContext 就占 578ms），拖一次列宽要触发多轮 ⇒ 卡顿数秒。
 * 改为模块级复用：同一份文本只量一次，font 只在变化时设置。实测 32718 格 **4~17ms**（≈150×）。
 */
let measureCtx: CanvasRenderingContext2D | null = null;
let measureFontKey = "";
/** measureText 结果缓存（键 = 字体 + 文本；量与字号无关，列宽变化可复用）。 */
const textWidthCache = new Map<string, number>();
const TEXT_WIDTH_CACHE_MAX = 20000;

function widthOfText(text: string, fontPx: number): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return 0;
  }
  const font = `normal normal ${fontPx}px ${GLOBAL_FONT}`;
  const key = font + "\u0000" + text;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;
  if (measureFontKey !== font) { measureCtx.font = font; measureFontKey = font; }
  const width = measureCtx.measureText(text).width;
  if (textWidthCache.size >= TEXT_WIDTH_CACHE_MAX) textWidthCache.clear();  // 满了整体丢弃（简单、不引 LRU）
  textWidthCache.set(key, width);
  return width;
}

/**
 * 估算「自动换行」后该行需要的高度。FortuneSheet 的行高自适应只在「旧值已存在 + 带 canvas」的
 * 编辑路径里跑，公开 API 触发不到；首次录入空单元格时更不会调（所以第二行会被压住）。
 * 这里按列宽量出行数，再按 defaultRowHeight(19px @10pt) 口径给出行高。
 */
function estimateWrappedRowHeight(text: string, fontSize: number, cellWidth: number): number {
  if (!text) return 0;
  const fontPx = Math.max(1, fontSize) * (96 / 72); // pt → px
  const textWidth = widthOfText(text, fontPx);
  if (!textWidth) return 0;
  const usable = Math.max(8, cellWidth - 4);
  const lines = Math.max(1, Math.ceil(textWidth / usable));
  const lineHeight = Math.round(fontPx * 1.43); // 10pt → ≈19px，与 defaultRowHeight 对齐
  return lines * lineHeight + 3;
}

/** 某行的单元格（优先 dense `data`，退回 sparse `celldata`）。 */
function rowCellsOf(sheet: SheetWorksheet | null, row: number): Array<{ c: number; cell: Record<string, unknown> }> {
  const dense = (sheet as { data?: unknown } | null)?.data;
  if (Array.isArray(dense) && Array.isArray(dense[row])) {
    return (dense[row] as Array<Record<string, unknown> | null>)
      .map((cell, c) => (cell ? { c, cell } : null))
      .filter((item): item is { c: number; cell: Record<string, unknown> } => item != null);
  }
  const sparse = (sheet as { celldata?: unknown } | null)?.celldata;
  if (Array.isArray(sparse)) {
    return (sparse as Array<{ r?: number; c?: number; v?: Record<string, unknown> | null }>)
      .filter((item) => item?.r === row && item.v != null)
      .map((item) => ({ c: Number(item.c) || 0, cell: item.v as Record<string, unknown> }));
  }
  return [];
}

/** 有内容的行号（打开已有文档时用来补一次行高；空表返回空）。 */
function rowsWithCells(sheet: SheetWorksheet | null): number[] {
  const dense = (sheet as { data?: unknown } | null)?.data;
  if (Array.isArray(dense)) {
    return dense.map((row, r) => (Array.isArray(row) && row.some((cell) => cell != null) ? r : -1)).filter((r) => r >= 0);
  }
  const sparse = (sheet as { celldata?: unknown } | null)?.celldata;
  if (Array.isArray(sparse)) {
    const rows = new Set<number>();
    for (const item of sparse as Array<{ r?: number; v?: unknown }>) if (item?.v != null && Number.isInteger(item.r)) rows.add(Number(item.r));
    return [...rows].sort((a, b) => a - b);
  }
  return [];
}

/** 给单元格补默认样式（只补缺省、不覆盖显式设置）：自动换行 + 全局字体。 */
function withCellDefaults(cell: Record<string, unknown>): Record<string, unknown> {
  const next = { ...cell };
  if (next.tb == null) next.tb = WRAP;
  // 旧文档正文里写死的旧字体值/数字索引一并归一化（261008）；只认旧值，用户选的字体不动。
  if (needsGlobalFont(next.ff)) next.ff = GLOBAL_FONT;
  // 旧默认字号（10pt）同样归一化到当前默认（用户 261008：「表格默认字号加1」；显式带 fs:10 的粘贴数据也要受益）。
  if (needsDefaultFontSize(next.fs)) next.fs = SHEET_DEFAULT_FONT_SIZE;
  return next;
}

/** 规范化 sheet：给已有内容的单元格补默认样式（dense `data` 与 sparse `celldata` 两种形态都处理）。 */
function withSheetDefaults(sheet: SheetWorksheet): SheetWorksheet {
  const rest = { ...sheet } as Record<string, unknown>;
  if (Array.isArray(rest.data)) {
    rest.data = (rest.data as Array<Array<Record<string, unknown> | null>>).map((row) =>
      Array.isArray(row) ? row.map((cell) => (cell ? withCellDefaults(cell) : cell)) : row,
    );
  }
  if (Array.isArray(rest.celldata)) {
    rest.celldata = (rest.celldata as Array<{ v?: Record<string, unknown> | null }>).map((item) =>
      item && item.v ? { ...item, v: withCellDefaults(item.v) } : item,
    );
  }
  return rest as SheetWorksheet;
}

export interface SheetEditorProps {
  noteId: string;
  content: string;
  visible: boolean;
  readOnly: boolean;
  onChange: (content: string) => void;
  /** 审计 F15：用户一改动立即通知（早于内部 800ms 防抖），让外层 dirty / 关闭 / 退出及时看到。 */
  onDirty?: () => void;
  /** 审计 F15：注册按需同步序列化（关闭/保存时现取），避免「改完 <800ms 就关」丢最后编辑。 */
  onEditorCapture?: (capture: (() => string | null) | null) => void;
  /** 是否显示内核工具条（默认 true）。历史快照预览传 false ⇒ 只读预览不要"半个编辑器"的观感。 */
  showToolbar?: boolean;
  /** 分屏（261008）：本实例是否为**焦点栏**（决定 data-active；全局唯一）。缺省 = visible（旧行为）。 */
  focused?: boolean;
  /** 分屏里所在栏位（left/right）；未分屏不传。仅用于布局（data-pane）。 */
  pane?: "left" | "right" | null;
}

/** 内核插图产出的内联图片（`FileReader.readAsDataURL` → `data:image/png;base64,…`）。 */
const INLINE_IMAGE_DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

/** 一张工作表里的浮动图（原样透传几何与其它字段，只读 src）。 */
function sheetImageEntries(sheet: SheetWorksheet): Array<{ index: number; src: string }> {
  const raw = (sheet as { images?: unknown }).images;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ index: number; src: string }> = [];
  raw.forEach((item, index) => {
    const src = (item as { src?: unknown } | null | undefined)?.src;
    if (typeof src === "string" && src) out.push({ index, src });
  });
  return out;
}

/**
 * 单元格图片的缩略图档位：按「显示宽度（模型单位 × zoom）× DPR」选档。
 * 显示宽度由单元格矩形决定（离散、稳定，列宽拖到 130 也还是同一个档位），所以不会来回抖动；
 * 返回 null = 用原图（超过最大档位，或宽度非法）。
 */
function cellImageThumbWidth(rectWidth: number, zoom: number): number | null {
  return assetThumbWidthForCss(rectWidth * zoom);
}

/** 磁盘 filename → 渲染 URL（FortuneSheet 直接拿 src 画图；正文不存 URL）。data:/外部 http 原样。 */
function withRenderableImageSrc(sheet: SheetWorksheet, noteId: string): SheetWorksheet {
  const raw = (sheet as { images?: unknown }).images;
  if (!Array.isArray(raw)) return sheet;
  const zoom = sheetZoom(sheet);
  return {
    ...(sheet as Record<string, unknown>),
    images: (raw as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const image = item as Record<string, unknown>;
      const src = typeof image.src === "string" ? image.src : "";
      // 只有单元格图片按档位取缩略图：显示尺寸由单元格矩形决定，离散稳定。
      // 浮动图能被用户任意拖大，档位会随之连续变化，暂不接（见 docs/STORAGE-LAYERS.md）。
      const width = cellAnchorOf(image) ? cellImageThumbWidth(Number(image.width) || 0, zoom) : null;
      return { ...image, src: sheetImageSrc(src, noteId, ASSET_PORT, width) ?? src };
    }),
  } as unknown as SheetWorksheet;
}

/** 保存口径：把本次会话刚提升的 data URL 换成资产 URL（随后由 `sanitizeSheetWorksheet` 落成 filename）。 */
function withPromotedImageSrc(sheets: SheetWorksheet[], promoted: Map<string, string>): SheetWorksheet[] {
  if (promoted.size === 0) return sheets;
  return sheets.map((sheet) => {
    const raw = (sheet as { images?: unknown }).images;
    if (!Array.isArray(raw)) return sheet;
    let changed = false;
    const images = (raw as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const image = item as Record<string, unknown>;
      const url = typeof image.src === "string" ? promoted.get(image.src) : undefined;
      if (!url) return item;
      changed = true;
      return { ...image, src: url };
    });
    return changed ? ({ ...(sheet as Record<string, unknown>), images } as unknown as SheetWorksheet) : sheet;
  });
}

/**
 * 解析初始 sheets；空/非法 → 一张空表（不抛错，避免坏数据打不开）。
 * **缩放 / 当前工作表走本机记忆**（`sheetViewStore`，用户 261006）：只改展示，不进正文、不进 S3。
 */
function initialSheets(content: string, noteId: string): SheetWorksheet[] {
  const parsed = parseSheetBody(content);
  const sheets = parsed ? parsed.sheets : (parseSheetBody(emptySheetBody())?.sheets ?? []);
  const view = readSheetView(noteId);
  const remembered = view.activeSheetId;
  const hasRemembered = remembered != null && sheets.some((sheet) => sheet.id === remembered);
  return sheets
    .map((sheet) => {
      const id = typeof sheet.id === "string" ? sheet.id : "";
      const local = id ? view.zooms[id] : undefined;
      const stored = Number(sheet.zoomRatio);
      // 旧默认（1.1）不算"用户改过" ⇒ 回落新默认 100%
      const rememberedZoom = Number.isFinite(local) && local !== LEGACY_DEFAULT_ZOOM ? local : undefined;
      const zoomRatio = rememberedZoom ?? (Number.isFinite(stored) && stored !== LEGACY_DEFAULT_ZOOM ? stored : DEFAULT_SHEET_ZOOM);
      // 恢复上次停留的工作表（内核初始化认 status===1）；没记忆就保持正文/新建里的标记。
      const status = hasRemembered && id ? { status: id === remembered ? 1 : 0 } : {};
      return withSheetDefaults({ ...sheet, zoomRatio, ...status });
    })
    .map((sheet) => withRenderableImageSrc(sheet, noteId));
}

export function SheetEditor({ noteId, content, visible, readOnly, focused, pane, onChange, onDirty, onEditorCapture, showToolbar = true }: SheetEditorProps) {
  const workbookRef = useRef<WorkbookInstance>(null);
  /** 宿主容器：只用来观察宽度变化（见下方「补发 resize」effect）。 */
  const hostRef = useRef<HTMLDivElement>(null);
  // data 只作初始值：宿主用 key=[noteId]-[reloadKey] 保证换文档时整体重挂。
  const [sheets] = useState<SheetWorksheet[]>(() => initialSheets(content, noteId));
  const latestRef = useRef<SheetWorksheet[]>(sheets);
  // 上一次已落盘的正文（规范化后）：与本次相同则跳过，避免「打开即标脏」与选区 churn 触发保存。
  const lastSerializedRef = useRef<string | null>(sheetsToBody(sheets));
  const timerRef = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  /** 记下「当前工作表 + 缩放」到本机（用户 261006）：只改展示，不进正文、不进 S3。 */
  const viewSigRef = useRef("");
  const rememberSheetView = useCallback(() => {
    const current = activeSheet(workbookRef.current, latestRef.current);
    if (!current) return;
    const id = typeof current.id === "string" ? current.id : "";
    if (!id) return;
    const zoom = Number((current as { zoomRatio?: unknown }).zoomRatio);
    const sig = id + ":" + (Number.isFinite(zoom) ? zoom : "");
    if (sig === viewSigRef.current) return;
    viewSigRef.current = sig;
    writeSheetView(noteId, { activeSheetId: id, zooms: Number.isFinite(zoom) ? { [id]: zoom } : undefined });
  }, [noteId]);
  // keep-alive：首次可见前不挂载（canvas 在隐藏态初始化会量成 0）。
  const [everVisible, setEverVisible] = useState(visible);
  /**
   * 视图铺满所需的最小行/列数（260926 用户报「表格最后留一段空白」）。
   * 根因：FortuneSheet 网格行数 = max(celldata 最大行, sheet.row)，旧文档 row 偏小 ⇒ 下方留白。
   * 挂载前按宿主体量算下限并并进渲染用 sheets（不改已存模型；真正编辑后随 onChange 保存落库）。
   */
  const [fillMin, setFillMin] = useState<{ rows: number; cols: number } | null>(null);
  /** 正在进行的「内联图片 → 资产文件」提升任务数：>0 时**推迟保存**（正文绝不落 base64）。 */
  const promoteInFlightRef = useRef(0);
  /** 本次会话已提升过的 data URL → 资产 URL（保存时按它换写盘口径；同一张图不重复上传）。 */
  const promotedRef = useRef<Map<string, string>>(new Map());
  // 审计 F15：回调放 ref（避免父层内联函数导致重复注册）+ 按需同步序列化。
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onEditorCaptureRef = useRef(onEditorCapture);
  onEditorCaptureRef.current = onEditorCapture;
  const captureContent = useCallback((): string | null => {
    if (readOnlyRef.current) return null;
    if (promoteInFlightRef.current > 0) return null; // 图片提升未落地：不写 data URL 版本
    return sheetsToBody(withPromotedImageSrc(latestRef.current, promotedRef.current));
  }, []);
  useEffect(() => {
    onEditorCaptureRef.current?.(captureContent);
    return () => { onEditorCaptureRef.current?.(null); };
  }, [captureContent]);
  /** 同一张 data URL 的并发提升去重（打开时自愈与首次变更可能同时触发）。 */
  const promoteInflightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  /** 单元格图片（P2）：选择本地图片用的隐藏 input。 */
  const cellImageInputRef = useRef<HTMLInputElement>(null);
  /**
   * 单元格图片工具弹窗（260921）：选区落在带单元格图片的格子上时出现（查看大图 / 下载原图 / 删除）。
   * 位置是相对宿主的 CSS 坐标。
   */
  const [cellImageMenu, setCellImageMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  /** 单元格图片锚点（冻结偏移用；随几何同步刷新）。 */
  const cellAnchorsRef = useRef<Array<{ id: string } & CellAnchor>>([]);
  /** 冻结边界（含）：`sheet.frozen.range.row_focus/column_focus`；null = 该方向没冻结。 */
  const frozenRef = useRef<{ row: number | null; col: number | null }>({ row: null, col: null });
  /** 是否已经给冻结区图片打过 translate 偏移（去掉冻结时要撤销一次，之后走 O(1) 早退）。 */
  const frozenOffsetAppliedRef = useRef(false);
  /** 几何同步的 rAF 句柄（合并突发变更：拖列宽会每帧一个 op）。 */
  const geomRafRef = useRef(0);
  /** 行高自适应节流（粘贴等批量写入用；内核只在单格编辑提交那条路算行高）。 */
  const autoRowTimerRef = useRef<number | null>(null);
  /** 待跑的那一次是否要**整表**重算（全表请求不被后续的选区请求降级，261008）。 */
  const pendingFullRowRef = useRef(false);
  /** 上一次见到的列宽快照（变了就整表重算行高）。 */
  const colWidthsKeyRef = useRef<string>("");
  /** 单元格图片弹窗的有限重试计数（图片 DOM 由 React 提交，可能晚于本次刷新）。 */
  const menuRetryRef = useRef(0);

  useEffect(() => {
    if (visible) setEverVisible(true);
  }, [visible]);

  // 首次可见时按宿主尺寸算「铺满下限」；算出来前不挂 <Workbook>（data 只作初始值，挂载后再改不生效）。
  useLayoutEffect(() => {
    if (!everVisible || fillMin) return;
    const host = hostRef.current;
    if (!host) return;
    const ROW_H = 20;
    const COL_W = 73;
    let raf = 0;
    const measure = () => {
      // keep-alive 下首次可见可能还量到 0 高：重试到有高度为止，避免 Workbook 永远不挂载。
      if (host.clientHeight === 0) { raf = window.requestAnimationFrame(measure); return; }
      setFillMin({
        rows: Math.max(50, Math.ceil(host.clientHeight / ROW_H) + 2),
        cols: Math.max(15, Math.ceil(host.clientWidth / COL_W) + 2),
      });
    };
    measure();
    return () => { if (raf) window.cancelAnimationFrame(raf); };
  }, [everVisible, fillMin]);

  const renderSheets = useMemo(
    () => (fillMin
      ? sheets.map((sheet) => ({
          ...sheet,
          row: Math.max(Number(sheet.row) || 0, fillMin.rows),
          column: Math.max(Number(sheet.column) || 0, fillMin.cols),
        }))
      : sheets),
    [sheets, fillMin],
  );




  /**
   * 宿主宽度变化时补发一次 `window.resize`（用户 260921 报：目录栏「固定 → 悬浮收起」后，表格右侧留一条
   * 等于目录栏宽度的空白）。
   *
   * 根因：FortuneSheet **只在 `window.resize` 时重算容器尺寸**（无 ResizeObserver）⇒ 壳层几何变化
   * （目录栏固定↔悬浮↔收起、拖宽目录栏、激活轨道切换）不会触发它，画布/内容宽停在旧值
   * （实测：容器 1375，而 `.fortune-sheet-overlay` 仍是 1074 = 1375 − 301px 目录栏）。
   * 这里观察自身宽度，变化后 rAF 内合并补发一次；内核重算不会反向改宿主宽度 ⇒ 不会自激。
   * 顺带覆盖「隐藏标签 0 宽 → 显示」这条（隐藏时 clientWidth=0，显示后宽度变化会补发）。
   */
  useEffect(() => {
    if (!everVisible) return;
    const host = hostRef.current;
    if (!host) return;
    let lastWidth = host.clientWidth;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        window.dispatchEvent(new Event("resize"));
      });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [everVisible]);

  /**
   * 主题切换 / 首次可见时让 canvas 重绘（表格暗色模式，261008）。
   * canvas 的网格 / 行列头 / 单元格底色由内核 `defaultStyle` 决定，core patch 在
   * `updateContextWithCanvas` 里按当前主题令牌同步一次；而该函数只在「挂载 / window.resize」
   * 被调用，主题切换不改宿主宽度 ⇒ 这里观察 `data-theme` 变化、并在首次可见后补发一次
   * `window.resize`（与上面「目录栏宽度变化补发」同一机制）。
   * **不用 rAF**：隐藏窗口（CDP 依附）里 rAF 不触发，会漏掉同步；定时器照常触发。
   * 只重绘、不写数据、不进撤销栈。
   */
  useEffect(() => {
    if (!everVisible) return;
    const ping = () => window.dispatchEvent(new Event("resize"));
    const observer = new MutationObserver(ping);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const timer = window.setTimeout(ping, 60);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [everVisible]);

  /** 底部「选区统计」行与文档状态栏共用同一条常驻底栏（260926 用户提议）：
   * 统计行常驻 + 状态栏固定展示，去掉「有无统计项」的收起/展开与随之而来的重算。
   * 统计行右对齐、状态栏钉在同一行最右端 ⇒ 要把状态栏实测宽度让给统计行，否则统计文字被压住
   * （用户截图：「求和/平均值」被盖掉）。宽度随同步文案变 ⇒ 观察状态栏本身体积，不写死。
   */
  useEffect(() => {
    if (!everVisible) return;
    const host = hostRef.current;
    if (!host) return;
    const statusBar = host.closest(".workspace")?.querySelector<HTMLElement>(".document-statusbar");
    if (!statusBar) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      host.style.setProperty("--lake-sheet-status-w", `${Math.round(statusBar.getBoundingClientRect().width) + 20}px`);
    };
    apply();
    const observer = new ResizeObserver(() => { if (!raf) raf = window.requestAnimationFrame(apply); });
    observer.observe(statusBar);
    return () => { observer.disconnect(); if (raf) window.cancelAnimationFrame(raf); };
  }, [everVisible]);

  /**
   * 修「表格底部留白 / 最后几行滚不到」：纵向滚动条高度必须等于**可见单元格区**
   * （扣掉列头与横向滚动条区）。FortuneSheet 给它 `height:100%`（= 整个 sheet 容器），
   * 导致最大滚动量比可见区少 ~40px ⇒ 最底部内容永远滚不出来，看着像一条空白。
   * 这里实测列头 / 横条高度写进 CSS 变量（见 sheetEditor.css 的 .luckysheet-scrollbar-y）。
   */
  useEffect(() => {
    if (!everVisible) return;
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const sheet = host.querySelector<HTMLElement>(".fortune-sheet-container");
      const area = host.querySelector<HTMLElement>(".fortune-cell-area");
      if (!sheet || !area) { raf = window.requestAnimationFrame(apply); return; }
      const head = Math.max(0, Math.round(area.getBoundingClientRect().top - sheet.getBoundingClientRect().top));
      const xbar = host.querySelector<HTMLElement>(".luckysheet-scrollbar-x");
      const xh = xbar ? Math.round(xbar.getBoundingClientRect().height) : 0;
      host.style.setProperty("--lake-sheet-head-h", `${head}px`);
      host.style.setProperty("--lake-sheet-xbar-h", `${xh}px`);
    };
    apply();
    const observer = new ResizeObserver(() => { if (!raf) raf = window.requestAnimationFrame(apply); });
    observer.observe(host);
    return () => { observer.disconnect(); if (raf) window.cancelAnimationFrame(raf); };
  }, [everVisible]);

  // ---------------- 单元格图片（P2） ----------------

  /**
   * 冻结窗格内的单元格图片：内核的 DOM 图**不会**冻结（和内容一起滚），而 canvas 里冻结区是钉住的
   * ⇒ 图片滚走了、格子还在。这里给冻结区内的图补 `translate(scrollLeft, scrollTop)` 把它钉回去。
   * 偏移只写在 DOM 上、不写进正文：它是「当前滚动位置」的产物，不属于文档数据。
   */
  const applyFrozenOffsets = useCallback(() => {
    const host = hostRef.current;
    const anchors = cellAnchorsRef.current;
    if (!host || anchors.length === 0) return;
    const { row, col } = frozenRef.current;
    if (row == null && col == null) {
      // 没冻结：只在「上一次打过偏移」时撤销一次，之后 O(1) 早退（避免每帧 N 次 querySelector）
      if (!frozenOffsetAppliedRef.current) return;
      frozenOffsetAppliedRef.current = false;
      for (const anchor of anchors) {
        const el = host.querySelector<HTMLElement>(`[id="${anchor.id}"]`);
        if (el) el.style.transform = "";
      }
      return;
    }
    const area = host.querySelector<HTMLElement>(".fortune-cell-area");
    if (!area) return;
    const dx = col == null ? 0 : area.scrollLeft;
    const dy = row == null ? 0 : area.scrollTop;
    let applied = false;
    for (const anchor of anchors) {
      const el = host.querySelector<HTMLElement>(`[id="${anchor.id}"]`);
      if (!el) continue;
      const tx = col != null && anchor.c <= col ? dx : 0;
      const ty = row != null && anchor.r <= row ? dy : 0;
      el.style.transform = tx || ty ? `translate(${tx}px, ${ty}px)` : "";
      if (tx || ty) applied = true;
    }
    frozenOffsetAppliedRef.current = applied;
  }, []);

  /**
   * 刷新单元格图片工具弹窗（260921，对齐语雀在线表格）：选区焦点格有单元格图片就贴到图片下方，
   * 否则收起。位置取图片元素的**实测矩形**（合并单元格 / 冻结偏移 / 缩放都不用再算一遍）；
   * 选区变化 / 滚动 / 尺寸变化 / 几何同步时调用，图片滚出可视区则隐藏。
   */
  const refreshCellImageMenu = useCallback((selection?: unknown) => {
    const host = hostRef.current;
    const sheet = activeSheet(workbookRef.current, latestRef.current);
    if (!host || !sheet) {
      setCellImageMenu(null);
      return;
    }
    let focus = selectionFocus(selection);
    if (!focus) {
      const sel = safeGetSelection(workbookRef.current);
      focus = selectionFocus(sel.length > 0 ? sel[sel.length - 1] : null);
    }
    if (!focus) {
      setCellImageMenu(null);
      return;
    }
    const image = cellImageAt(sheet, focus.r, focus.c);
    const id = typeof image?.id === "string" ? image.id : "";
    if (!id) {
      menuRetryRef.current = 0;
      setCellImageMenu(null);
      return;
    }
    const el = host.querySelector<HTMLElement>(`[id="${id}"]`);
    const hostRect = host.getBoundingClientRect();
    const rect = el?.getBoundingClientRect();
    if (!el || !rect || rect.width === 0 || rect.height === 0) {
      // 图片刚插入时 DOM 可能还没提交（本次刷新跑在 React 提交之前）⇒ 有限重试几帧，别丢弹窗
      setCellImageMenu(null);
      if (menuRetryRef.current < 12) {
        menuRetryRef.current += 1;
        window.setTimeout(() => refreshCellImageMenu(selection), 50);
      }
      return;
    }
    const visible = rect.bottom > hostRect.top && rect.top < hostRect.bottom && rect.right > hostRect.left && rect.left < hostRect.right;
    if (!visible) {
      menuRetryRef.current = 0;
      setCellImageMenu(null);
      return;
    }
    menuRetryRef.current = 0;
    const left = rect.left - hostRect.left + rect.width / 2;
    const top = rect.bottom - hostRect.top;
    // 值没变就返回 prev：内核 onChange effect 依赖 onChange 的身份，每次 render 都会再回调一次；
    // 这里若每次都 setState 一个新对象，就会与 rAF 刷新形成 60fps 死循环（实测）。
    setCellImageMenu((prev) => (prev && prev.id === id && prev.left === left && prev.top === top ? prev : { id, left, top }));  }, []);

  /**
   * 把单元格图片的几何对回它锚定的单元格矩形。
   *
   * 触发：`onChange`（模型变了的全能回调）+ `onOp` + 首次可见后一次。列宽/行高/隐藏/合并/冻结都会改矩形，
   * 因此不做精细过滤——先算，值没变就早退（绝大多数回调命中这条）。写回用 `replace` 整数组：幂等，且 `opToPatch`
   * 会把同一份 patch 同时打到 `luckysheetfile[i].images` 与渲染源 `insertedImgs`（两者互为别名，
   * 若用 add 单元素会被打两次）。`applyOp` 内部走 `noHistory`，不污染撤销栈，也绝不回灌 `data`
   * （非受控约束）。
   */
  const syncCellImageGeometry = useCallback(() => {
    const sheet = activeSheet(workbookRef.current, latestRef.current);
    if (!sheet) return;
    const frozen = (sheet as { frozen?: { range?: { row_focus?: number; column_focus?: number } } }).frozen;
    const rowFocus = frozen?.range?.row_focus;
    const colFocus = frozen?.range?.column_focus;
    frozenRef.current = {
      row: Number.isInteger(rowFocus) && (rowFocus as number) >= 0 ? (rowFocus as number) : null,
      col: Number.isInteger(colFocus) && (colFocus as number) >= 0 ? (colFocus as number) : null,
    };
    const raw = (sheet as { images?: unknown }).images;
    const images = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
    const anchors: Array<{ id: string } & CellAnchor> = [];
    const zoom = sheetZoom(sheet);
    let changed = false;
    const next = images.map((image) => {
      const anchor = cellAnchorOf(image);
      if (!anchor) return image;
      const id = typeof image.id === "string" ? image.id : "";
      if (id) anchors.push({ id, r: anchor.r, c: anchor.c });
      const { r1, c1, r2, c2 } = anchorRange(workbookRef.current, anchor);
      const rect = sheetRangeRect(sheet, r1, c1, r2, c2);
      // 缩略图档位跟着矩形走：列宽变了显示宽度就变了，src 必须一起换代——否则要么发虚，
      // 要么继续按旧档位白解码一张根本用不到的尺寸。
      const src = typeof image.src === "string" ? image.src : "";
      const sized = sheetImageSrc(src, noteId, ASSET_PORT, cellImageThumbWidth(rect.width, zoom)) ?? src;
      if (
        image.left === rect.left && image.top === rect.top
        && image.width === rect.width && image.height === rect.height
        && image.src === sized
      ) {
        return image;
      }
      changed = true;
      return { ...image, ...rect, src: sized };
    });
    cellAnchorsRef.current = anchors;
    // 只读态（回收站/锁定/被他端删除）只渲染、不改模型
    if (!changed || readOnlyRef.current) return;
    const sheetId = typeof sheet.id === "string" ? sheet.id : "";
    if (!sheetId) return;
    workbookRef.current?.applyOp([{ op: "replace", id: sheetId, path: ["images"], value: next }]);
  }, [noteId]);

  /**
   * 2A：从 `cell.img` 反推 `images[]`（单元格图片的唯一真相在单元格上）。
   *
   * 内核搬运单元格时会带着 cell 对象一起走（copy/paste、插入删除行列、编辑），但**不会动 `images[]`**
   * ⇒ 每次模型变化后按「格子上有 img」重建 cell 图的渲染条目（浮动图原样保留）。
   * 老数据自愈：`images[].cell` 有锚点但格子没 `img` 的，回填到 `cell.img`；同一 id 被复制到多格时补新 id。
   */
  const reconcileCellImages = useCallback(() => {
    const wb = workbookRef.current;
    if (!wb || readOnlyRef.current) return;
    // 去重必须**跨表全局**：copy/paste 会把 `img.id` 一起复制（含跨 sheet），同 id 多份要给后面的补新 id
    const seen = new Set<string>();
    for (const sheet of latestRef.current) {
      const sheetId = typeof sheet.id === "string" ? sheet.id : "";
      if (!sheetId) continue;
      const data = (sheet as { data?: unknown }).data as Array<Array<Record<string, unknown> | null>> | undefined;
      const rawImages = (sheet as { images?: unknown }).images;
      const images = Array.isArray(rawImages) ? (rawImages as Array<Record<string, unknown>>) : [];
      const expected = new Map<string, { r: number; c: number; src: string }>();
      const backfill: Array<{ r: number; c: number; img: Record<string, unknown> }> = [];
      if (Array.isArray(data)) {
        for (let r = 0; r < data.length; r += 1) {
          const row = data[r];
          if (!Array.isArray(row)) continue;
          for (let c = 0; c < row.length; c += 1) {
            const cell = row[c];
            if (!cell || typeof cell !== "object") continue;
            let img = (cell as { img?: unknown }).img as Record<string, unknown> | undefined;
            if (!img || typeof img !== "object") continue;
            const src = typeof img.src === "string" ? img.src : "";
            let id = typeof img.id === "string" ? img.id : "";
            if (!id || seen.has(id)) {
              id = `cellimg_${Date.now().toString(36)}_${r}_${c}_${Math.random().toString(36).slice(2, 6)}`;
              backfill.push({ r, c, img: { ...img, id, src } });
            }
            seen.add(id);
            expected.set(id, { r, c, src });
          }
        }
      }
      const floating = images.filter((entry) => cellAnchorOf(entry) === null);
      const existing = new Map<string, Record<string, unknown>>();
      for (const entry of images) {
        if (cellAnchorOf(entry) && typeof entry.id === "string") existing.set(entry.id, entry);
      }
      let changed = backfill.length > 0;
      const next: Array<Record<string, unknown>> = floating.slice();
      for (const [id, info] of expected) {
        const prev = existing.get(id);
        const prevAnchor = prev ? cellAnchorOf(prev) : null;
        const prevDisk = prev ? String(sheetImageDiskSrc(prev.src) ?? "") : "";
        if (prev && prevAnchor && sameAnchor(prevAnchor, { r: info.r, c: info.c }) && prevDisk === info.src) {
          next.push(prev);
        } else {
          changed = true;
          next.push({ ...(prev ?? {}), id, src: info.src, cell: { r: info.r, c: info.c } });
        }
      }
      for (const id of existing.keys()) {
        if (!expected.has(id)) { changed = true; break; }
      }
      if (!changed) continue;
      for (const bf of backfill) {
        const cell = Array.isArray(data) ? data[bf.r]?.[bf.c] ?? null : null;
        wb.applyOp([{ op: "replace", id: sheetId, path: ["data", bf.r, bf.c], value: { ...(cell ?? {}), img: bf.img } }]);
      }
      wb.applyOp([{ op: "replace", id: sheetId, path: ["images"], value: next }]);
    }
  }, []);

  /** 合并突发变更后跑一次几何同步（拖列宽会每帧一个 op），顺手重贴冻结偏移。 */
  const scheduleGeometrySync = useCallback(() => {
    if (geomRafRef.current) return;
    const run = () => {
      geomRafRef.current = 0;
      reconcileCellImages();
      syncCellImageGeometry();
      applyFrozenOffsets();
      refreshCellImageMenu();
    };
    geomRafRef.current = window.requestAnimationFrame(run);
    // 兜底：窗口被遮挡时 rAF 会被节流甚至暂停 ⇒ 用定时器保证「单元格图片跟随」不依赖可见性（run 幂等）
    window.setTimeout(run, 120);
  }, [reconcileCellImages, syncCellImageGeometry, applyFrozenOffsets, refreshCellImageMenu]);

  /** 当前选区的行号（粘贴后内核会把选区设成落盘范围，正好用来定位要重算的行）。 */
  const selectionRows = useCallback((): number[] => {
    const rows = new Set<number>();
    for (const range of safeGetSelection(workbookRef.current)) {
      const r = (range as { row?: unknown } | null)?.row;
      if (!Array.isArray(r)) continue;
      const from = Number(r[0]);
      const to = Number(r[1] ?? r[0]);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      for (let i = Math.max(0, Math.min(from, to)); i <= Math.max(from, to); i++) rows.add(i);
    }
    return [...rows];
  }, []);

  /**
   * 按「自动换行」重算行高（**只涨不缩**；只算 `tb==="2"` 且非空的单元格）。
   *
   * 为什么自己算：内核只在 `updateCell`（单格编辑提交）那条路上做自适应，而且要求「列宽 **或** 行高从未显式设置过」
   * ——实测粘贴（批量写入）、改列宽、打开已有文档都不走那条路，于是「自动换行 + 长内容」的行高不撑开、文字被压住。
   * `rows` 省略时取当前选区的行。
   */
  const syncAutoRowHeights = useCallback((rows?: number[], opts?: { refit?: boolean; ignoreCustom?: boolean }) => {
    const wb = workbookRef.current;
    if (!wb || readOnlyRef.current) return;
    const sheet = activeSheet(wb, latestRef.current);
    if (!sheet) return;
    const refit = opts?.refit === true;          // 真·自适应：可涨**可缩**（右键「自动行高」/ 列宽变化）
    const ignoreCustom = opts?.ignoreCustom === true; // 连用户手动调过的行也重算（仅在用户显式点菜单时）
    const targetRows = (rows ?? selectionRows()).filter((r) => Number.isInteger(r) && r >= 0);
    if (targetRows.length === 0) return;
    const cellsByRow = targetRows.map((r) => rowCellsOf(sheet, r));
    const cols = [...new Set(cellsByRow.flat().map((item) => item.c))];
    if (cols.length === 0) return;
    let widths: Record<number, number> = {};
    let heights: Record<number, number> = {};
    try { widths = (wb.getColumnWidth(cols) as Record<number, number>) ?? {}; } catch { widths = {}; }
    try { heights = (wb.getRowHeight(targetRows) as Record<number, number>) ?? {}; } catch { heights = {}; }
    const next: Record<number, number> = {};
    targetRows.forEach((row, index) => {
      // 用户手动调过的行高不参与自适应（与内核 `cfg.customHeight[r]` 的判据一致）
      if (!ignoreCustom && (sheet.config as { customHeight?: Record<number, unknown> } | undefined)?.customHeight?.[row]) return;
      let needed = 0;
      for (const { c, cell } of cellsByRow[index]) {
        // 只处理「自动换行」：本应用默认就是 WRAP（`withCellDefaults` 给缺省单元格补 tb=2），
        // 而**粘贴进来的单元格没有 tb**（内核批量写入不走我们的补默认路径）⇒ tb 缺省按 WRAP 处理，
        // 显式设成 0/1（截断/溢出）的才跳过。
        if (cell.tb != null && String(cell.tb) !== "2") continue;
        const text = typeof cell.m === "string" ? cell.m : cell.v == null ? "" : String(cell.v);
        if (!text) continue;
        const fontSize = Number(cell.fs) || SHEET_DEFAULT_FONT_SIZE;
        const width = Number(widths[c]) || 73;
        needed = Math.max(needed, estimateWrappedRowHeight(text, fontSize, width));
      }
      const current = Number(heights[row]) || 19;
      const target = needed > 0 ? needed : 19; // 没有需要换行的内容 → 回到默认行高
      if (refit ? Math.abs(target - current) > 1 : target > current + 1) next[row] = target;
    });
    if (Object.keys(next).length > 0) {
      try { wb.setRowHeight(next); } catch { /* 忽略 */ }
    }
  }, [selectionRows]);

  /**
   * 行高重算的节流入口（粘贴是异步落盘，等一拍再算）。
   *
   * 261008 用户反馈「拖列宽卡好几秒」，两条口径：
   * ① 列宽拖拽会**连续**改 `columnlen` ⇒ 全表重算等**停手**（400ms 静默）后只跑一次，
   *    不再拖一帧算一次；
   * ② 全表请求**不被后续的选区请求降级**（原来 `scheduleAutoRowHeights(false)` 会把待跑的全表
   *    重算取消掉，行高偶发不刷新）。
   */
  const scheduleAutoRowHeights = useCallback((full = false) => {
    if (full) pendingFullRowRef.current = true;
    if (autoRowTimerRef.current !== null) window.clearTimeout(autoRowTimerRef.current);
    autoRowTimerRef.current = window.setTimeout(() => {
      autoRowTimerRef.current = null;
      const wb = workbookRef.current;
      const sheet = wb ? activeSheet(wb, latestRef.current) : null;
      const useFull = pendingFullRowRef.current;
      pendingFullRowRef.current = false;
      // 列宽变化是显式布局动作 ⇒ 真·自适应（列变宽要能缩回去）；其它批量写入只涨不缩
      syncAutoRowHeights(useFull && sheet ? rowsWithCells(sheet) : undefined, useFull ? { refit: true } : undefined);
    }, pendingFullRowRef.current ? AUTO_ROW_FULL_THROTTLE_MS : AUTO_ROW_THROTTLE_MS);
  }, [syncAutoRowHeights]);


  /** 当前选中的单元格（多选取左上角那格）。 */
  const selectedAnchor = useCallback((): CellAnchor => {
    const selection = safeGetSelection(workbookRef.current);
    const last = selection.length > 0 ? selection[selection.length - 1] : undefined;
    const r = Math.trunc(Number(last?.row?.[0] ?? 0)) || 0;
    const c = Math.trunc(Number(last?.column?.[0] ?? 0)) || 0;
    return { r: Math.max(0, r), c: Math.max(0, c) };
  }, []);

  /**
   * 插入/替换单元格图片：选中格 → 上传资产（复用文档同一条资产管线）→ 写进 `images[]` 并带 `cell` 锚点。
   * 同一格已有单元格图片就替换（旧图不再被正文引用，交给资源 GC 回收）。
   */
  const insertCellImage = useCallback(async (file: File) => {
    const wb = workbookRef.current;
    if (!wb || readOnlyRef.current) return;
    const anchor = selectedAnchor();
    let url: string;
    try {
      url = (await uploadLakeResource(file, noteId)).url;
    } catch (error) {
      console.warn("[sheet] 单元格图片上传失败", error);
      return;
    }
    // 上传是异步的：以回来时的最新数据为准（期间用户可能换了格、改了列宽）
    const sheet = activeSheet(workbookRef.current, latestRef.current);
    const sheetId = typeof sheet?.id === "string" ? sheet.id : "";
    if (!sheet || !sheetId) return;
    // 2A：真相写进**单元格自己**（cell.img）；同时立即写一份渲染条目，不等 rAF（窗口被遮时 rAF 会被节流）。
    const filename = String(sheetImageDiskSrc(url) ?? url);
    const data = (sheet as { data?: unknown }).data as Array<Array<Record<string, unknown> | null>> | undefined;
    const cell = data?.[anchor.r]?.[anchor.c] ?? null;
    const id = nextCellImageId();
    const rawImages = (sheet as { images?: unknown }).images;
    const images = Array.isArray(rawImages) ? (rawImages as Array<Record<string, unknown>>) : [];
    const { r1, c1, r2, c2 } = anchorRange(wb, anchor);
    const rect = sheetRangeRect(sheet, r1, c1, r2, c2);
    const src = sheetImageSrc(filename, noteId, ASSET_PORT, cellImageThumbWidth(rect.width, sheetZoom(sheet))) ?? url;
    const kept = images.filter((image) => {
      const existing = cellAnchorOf(image);
      return !existing || !sameAnchor(existing, anchor);
    });
    kept.push({ id, src, ...rect, cell: { r: anchor.r, c: anchor.c } });
    wb.applyOp([{ op: "replace", id: sheetId, path: ["images"], value: kept }]);
    wb.applyOp([{
      op: "replace",
      id: sheetId,
      path: ["data", anchor.r, anchor.c],
      value: { ...(cell ?? {}), img: { id, src: filename } },
    }]);
    scheduleGeometrySync();
  }, [noteId, scheduleGeometrySync, selectedAnchor]);

  /** 按 id 找单元格图片（可能不在当前表 / 已被删）。 */
  const cellImageById = useCallback((id: string): Record<string, unknown> | null => {
    for (const sheet of latestRef.current) {
      const raw = (sheet as { images?: unknown }).images;
      if (!Array.isArray(raw)) continue;
      for (const item of raw) {
        if (item && typeof item === "object" && (item as { id?: unknown }).id === id) return item as Record<string, unknown>;
      }
    }
    return null;
  }, []);

  /** 单元格图片的原图 URL（查看大图 / 下载都用原图，不借道缩略图）。 */
  const cellImageOriginalUrl = useCallback((id: string): string => {
    const image = cellImageById(id);
    const src = typeof image?.src === "string" ? image.src : "";
    const disk = sheetImageDiskSrc(src);
    return sheetImageSrc(typeof disk === "string" ? disk : "", noteId, ASSET_PORT) ?? "";
  }, [cellImageById, noteId]);

  /** 查看大图（复用共享 Lightbox）。 */
  const openCellImageLightbox = useCallback((id: string) => {
    const url = cellImageOriginalUrl(id);
    if (url) openImagePreview([{ src: url }], 0);
  }, [cellImageOriginalUrl]);

  /** 下载原图（桌面走资产另存为；外部 http 图片退回新标签打开）。 */
  const downloadCellImage = useCallback((id: string) => {
    const image = cellImageById(id);
    const src = typeof image?.src === "string" ? image.src : "";
    const disk = sheetImageDiskSrc(src);
    if (typeof disk !== "string" || !disk) return;
    if (/^https?:/i.test(disk)) { window.open(disk, "_blank", "noopener"); return; }
    if (disk.startsWith("data:")) return;
    void native.saveAssetAs(noteId, disk, disk).catch((error) => reportNativeActionError("下载表格图片", error));
  }, [cellImageById, noteId]);

  /** 删除单元格图片（按 id；删完收起工具条）。 */
  const deleteCellImageById = useCallback((id: string) => {
    const wb = workbookRef.current;
    if (!wb || readOnlyRef.current) return;
    const sheet = activeSheet(workbookRef.current, latestRef.current);
    const sheetId = typeof sheet?.id === "string" ? sheet.id : "";
    if (!sheet || !sheetId) return;
    // 2A：删掉拥有该 img 的格子上的 img（images[] 由 reconciliation 反推移除）
    const data = (sheet as { data?: unknown }).data as Array<Array<Record<string, unknown> | null>> | undefined;
    if (!Array.isArray(data)) return;
    for (let r = 0; r < data.length; r += 1) {
      const row = data[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c += 1) {
        const cell = row[c];
        const img = cell && typeof cell === "object" ? (cell as { img?: unknown }).img : undefined;
        if (!img || typeof img !== "object" || (img as { id?: unknown }).id !== id) continue;
        const next = { ...(cell as Record<string, unknown>) };
        delete next.img;
        wb.applyOp([{ op: "replace", id: sheetId, path: ["data", r, c], value: next }]);
        setCellImageMenu(null);
        scheduleGeometrySync();
        return;
      }
    }
  }, [scheduleGeometrySync]);

  /**
   * 粘贴图片 → 落成单元格图片（真相写进 cell.img）。
   *
   * 挂在 document 捕获阶段：内核在 .fortune-container 的 keydown/paste 里 stopPropagation，
   * 用捕获 + host.contains(target) 把范围限死在本编辑器。文本/表格粘贴仍归内核；
   * Delete/Backspace 由内核 deleteSelectedCellText 把 cell 换成 {}（img 随之消失，reconcile 会移除渲染条目）。
   */
  useEffect(() => {
    if (!everVisible) return;
    const host = hostRef.current;
    if (!host) return;

    const onPaste = (event: globalThis.ClipboardEvent) => {
      if (readOnlyRef.current) return;
      if (!(event.target instanceof Node) || !host.contains(event.target)) return;
      if (!isGridTarget(event.target)) return;
      const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      void insertCellImage(image);
    };

    document.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("paste", onPaste, true);
    };
  }, [everVisible, insertCellImage]);

  /**
   * 颜色入口状态（261008）：文字颜色 / 背景色 / 工作表标签颜色共用一个公共选色盘（components/ColorPalette）。
   * 为什么自己做按钮：内核把这两个按钮的色条画在硬编码的 17×2 inline div 上（bottom:8/left:9），
   * 而云端字形本身已含色条 ⇒ 选完颜色「两层色条 + 位置错位」。自绘后只保留云端那一条，并按当前单元格颜色上色。
   */
  const [colorPick, setColorPick] = useState<{
    kind: "text" | "bg" | "tab";
    anchor: HTMLElement;
    /** 点击那一刻量到的锚点坐标（优先用；菜单项这类锚点随后会卸载）。 */
    at?: { x: number; y: number } | null;
    sheetId?: string;
  } | null>(null);
  /** 当前焦点单元格的颜色（给色条上色；未着色 = undefined）。 */
  const [cellColors, setCellColors] = useState<{ text?: string; bg?: string }>({});
  /** 上次用过的颜色（点图标直接复用）；初值从「最近使用」桶里读，跨会话也记得。 */
  const [lastColors, setLastColors] = useState<{ text?: string; bg?: string }>(() => ({
    text: lastUsedColor(COLOR_BUCKET.text) ?? undefined,
    bg: lastUsedColor(COLOR_BUCKET.bg) ?? undefined,
  }));

  /** 读焦点格的颜色（选区/内容变化后刷新）。 */
  const refreshCellColors = useCallback((selection?: unknown) => {
    const wb = workbookRef.current;
    if (!wb) return;
    const focus = selection ? selectionFocus(selection) : null;
    const pick = (type: "fc" | "bg"): string | undefined => {
      if (!focus) return undefined;
      try {
        const value = wb.getCellValue(focus.r, focus.c, { type } as never);
        return typeof value === "string" && value ? value : undefined;
      } catch { return undefined; }
    };
    setCellColors({ text: pick("fc"), bg: pick("bg") });
  }, []);

  /** 给选区上色（走内核公开 API：一次调用 = 一条历史；null = 恢复默认）。 */
  const applyCellColor = useCallback((kind: "text" | "bg", color: string | null) => {
    const wb = workbookRef.current;
    if (!wb || readOnlyRef.current) return;
    const rangeList = safeGetSelection(wb);
    for (const range of rangeList) {
      try { wb.setCellFormatByRange((kind === "text" ? "fc" : "bg") as never, color, range as never); } catch { /* 忽略 */ }
    }
    const field = kind === "text" ? "text" : "bg";
    if (rangeList.length > 0) setCellColors((prev) => ({ ...prev, [field]: color ?? undefined }));
    if (color) setLastColors((prev) => ({ ...prev, [field]: color }));   // 记住这次用的颜色（供点图标复用）
  }, []);

  /** 工作表标签颜色（颜色写入走补丁加的 WorkbookInstance.setSheetColor，语义与内核 ChangeColor 一致）。 */
  const applySheetTabColor = useCallback((color: string | null, sheetId?: string) => {
    const wb = workbookRef.current as unknown as { setSheetColor?: (value: string | null, id?: string) => void } | null;
    if (!wb || readOnlyRef.current) return;
    try { wb.setSheetColor?.(color, sheetId); } catch { /* 忽略 */ }
  }, []);

  /** 增减小数位（走 setCellFormatByRange，一次调用一条历史）。 */
  const changeDecimals = useCallback((delta: number) => {
    const wb = workbookRef.current;
    if (!wb || readOnlyRef.current) return;
    const ranges = safeGetSelection(wb);
    const focus = selectionFocus(ranges[0]);
    if (!focus || ranges.length === 0) return;
    const ct = (wb.getCellValue(focus.r, focus.c, { type: "ct" } as never) ?? null) as { fa?: string } | null;
    const fa = typeof ct?.fa === "string" && ct.fa ? ct.fa : "General";
    const next = adjustDecimals(fa, delta);
    if (next === fa) return;
    const value = { ...(ct ?? {}), fa: next };
    for (const range of ranges) {
      try { wb.setCellFormatByRange("ct" as never, value, range as never); } catch { /* 忽略 */ }
    }
  }, []);

  /** 打开公共选色盘（锚点 = 触发按钮 / 右键菜单项）。 */
  const openColorPick = useCallback((kind: "text" | "bg" | "tab", anchor: HTMLElement | null, sheetId?: string) => {
    if (readOnlyRef.current || !anchor) return;
    if (kind === "text" || kind === "bg") refreshCellColors(safeGetSelection(workbookRef.current)[0]);
    // **当场**量坐标：工作表标签的入口是右键菜单项，内核 close() 之后它会卸载，
    // 之后再量 rect 全是 0 ⇒ 选色盘会贴到左上角（用户 261008 报）。
    const rect = anchor.getBoundingClientRect();
    setColorPick({ kind, anchor, sheetId, at: { x: rect.left, y: rect.bottom + 2 } });
  }, [refreshCellColors]);

  /** 自定义工具栏项：单元格图片（**插入图片**属写操作，只读态不提供；查看已有图片走单元格内图片的菜单）。 */
  const customToolbarItems = useMemo(
    () =>
      readOnly
        ? []
        : [
            {
              key: "lake-decimals-decrease",
              tooltip: "减少小数位",
              icon: <DecimalsIcon name="number-decrease" />,
              onClick: () => changeDecimals(-1),
            },
            {
              key: "lake-decimals-increase",
              tooltip: "增加小数位",
              icon: <DecimalsIcon name="number-increase" />,
              onClick: () => changeDecimals(1),
            },
            {
              key: "lake-text-color",
              tooltip: "文字颜色",
              icon: <SheetTextColorIcon color={cellColors.text ?? lastColors.text} />,
              onClick: (event: { currentTarget: HTMLElement }) => {
                const last = lastColors.text;
                if (last) applyCellColor("text", last);              // 点图标 = 直接用上次的颜色（对齐 Lake）
                else openColorPick("text", event.currentTarget);     // 还没有记忆就退化成开选色盘
              },
              children: <ColorCaret onOpen={(anchor) => openColorPick("text", anchor)} />,
            },
            {
              key: "lake-bg-color",
              tooltip: "背景颜色",
              icon: <SheetBgColorIcon color={cellColors.bg ?? lastColors.bg} />,
              onClick: (event: { currentTarget: HTMLElement }) => {
                const last = lastColors.bg;
                if (last) applyCellColor("bg", last);
                else openColorPick("bg", event.currentTarget);
              },
              children: <ColorCaret onOpen={(anchor) => openColorPick("bg", anchor)} />,
            },
            { key: "cell-image", tooltip: "插入图片", icon: CELL_IMAGE_ICON, onClick: () => cellImageInputRef.current?.click() },
            {
              // 只在右键菜单出现（没有列进 TOOLBAR_ITEMS）；点它 = 整表重算「自动换行」的行高
              key: "auto-row-height",
              tooltip: "自动行高",
              icon: AUTO_ROW_HEIGHT_ICON,
              onClick: () => {
                const wb = workbookRef.current;
                const sheet = wb ? activeSheet(wb, latestRef.current) : null;
                // 显式动作 = 真·自适应（可涨可缩），并覆盖用户手动调过的行高；
                // 没选中任何东西时退化为整表。用户 261008：「点了自动行高并没有生效」就是只涨不缩导致的。
                const picked = selectionRows();
                syncAutoRowHeights(picked.length > 0 ? picked : sheet ? rowsWithCells(sheet) : undefined, {
                  refit: true,
                  ignoreCustom: true,
                });
              },
            },
          ],
    [readOnly, syncAutoRowHeights, cellColors, lastColors, openColorPick, applyCellColor, changeDecimals],
  );

  const handleOp = useCallback(() => {
    scheduleGeometrySync();
    // 批量写入（粘贴 / 填充 / 撤销）不走内核的单格提交路径 ⇒ 这里按选区行补一次行高（幂等：不涨就不再 set）
    scheduleAutoRowHeights();
  }, [scheduleGeometrySync, scheduleAutoRowHeights]);

  /**
   * 首次可见后：对一次几何（正文里的几何可能是上次会话留下的，中间改过列宽就对不上了），
   * 并挂上滚动监听维护冻结区图片偏移。
   *
   * 监听挂在**宿主容器 + capture**：滚动事件不冒泡，但捕获阶段能拿到后代元素的滚动。不能直接挂
   * `.fortune-cell-area` —— 内核要等自身 context 初始化完（首次 commit 之后）才渲染出它，本 effect
   * 跑在首次 commit 时拿不到该节点（实测：挂不上 ⇒ 冻结区图片不上偏移）。挂宿主则对**将来才出现**的
   * 滚动容器、以及内核换滚动实现都免疫，且不需要重试逻辑。
   */
  useEffect(() => {
    if (!everVisible) return;
    const host = hostRef.current;
    const raf = window.requestAnimationFrame(() => {
      syncCellImageGeometry();
      // 打开已有文档：正文里「自动换行 + 长内容」的行若没存过行高（粘贴进来的），这里补一次
      syncAutoRowHeights(rowsWithCells(activeSheet(workbookRef.current, latestRef.current)));
      applyFrozenOffsets();
      refreshCellImageMenu();
      // 恢复上次停留的工作表（内核初始化只认 status，多表下不可靠 ⇒ 显式 activateSheet）。
      const remembered = readSheetView(noteId).activeSheetId;
      const current = activeSheet(workbookRef.current, latestRef.current);
      const currentId = typeof current?.id === "string" ? current.id : "";
      if (remembered && currentId && currentId !== remembered) workbookRef.current?.activateSheet?.({ id: remembered });
      rememberSheetView();
    });
    const onScroll = () => { applyFrozenOffsets(); refreshCellImageMenu(); };
    // 宿主尺寸变化（目录栏固定/悬浮切换等）会让图片位置变 ⇒ 重贴弹窗
    const onResizeMenu = () => refreshCellImageMenu();
    host?.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResizeMenu);
    return () => {
      window.cancelAnimationFrame(raf);
      host?.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResizeMenu);
    };
  }, [everVisible, syncCellImageGeometry, syncAutoRowHeights, applyFrozenOffsets, refreshCellImageMenu, rememberSheetView, noteId]);

  /** 当前可持久化正文（与 flush 同口径：资产 URL → filename）。 */
  const bodyOf = (next: SheetWorksheet[]) => sheetsToBody(withPromotedImageSrc(next, promotedRef.current));
  const flush = () => {
    // 提升未落地前不保存：否则会把 base64 写进 sheets/*.sheet.json（正文膨胀 + 不走资产管线）。
    // 提升落地会再触发一次变更 → 那时才真正落盘（正文里是资产 URL，序列化时换成 filename）。
    if (promoteInFlightRef.current > 0) {
      scheduleSave();
      return;
    }
    const json = bodyOf(latestRef.current);
    if (json === lastSerializedRef.current) return; // 无实际变化（如仅选区变化）：不标脏
    lastSerializedRef.current = json;
    changeRef.current(json);
  };
  const scheduleSave = () => {
    if (readOnlyRef.current) return;
    // 只有正文真的变了才立即标脏 / 排保存（用户 261006 审计）：点选单元格 / 滚动这类 onChange 不改
    // 持久化正文，此前会把文档推成「待保存」并触发一次无谓的 saveNote；现在先比正文再决定。
    if (bodyOf(latestRef.current) === lastSerializedRef.current) return;
    onDirtyRef.current?.(); // 立即标脏（不等 800ms 内部防抖）
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; flush(); }, AUTOSAVE_DEBOUNCE_MS);
  };

  /**
   * 把工作表里**尚未提升**的内联图片提升为资产文件（`note-assets/{noteId}/`），并在 `promotedRef` 里记下
   * **data URL → 资产 URL** 的映射（保存时按它换写盘口径，sanitize 再把 URL 落成 filename）。
   *
   * 复用内核插图用的同一条通道 `uploadLakeResource`（sharp 归一化 / 图片格式与尺寸护栏 / 并发队列 / 重试）；
   * 单张失败就保持内联形态（**不丢图**），下次变更会再试 —— 与画板（BoardEditor）同口径。
   */
  const promoteInlineImages = (targets: SheetWorksheet[]) => {
    const pending: string[] = [];
    const seen = new Set<string>();
    for (const sheet of targets) {
      for (const entry of sheetImageEntries(sheet)) {
        const src = entry.src;
        if (!INLINE_IMAGE_DATA_URL_RE.test(src)) continue;
        if (seen.has(src) || promotedRef.current.has(src) || promoteInflightRef.current.has(src)) continue;
        seen.add(src);
        pending.push(src);
      }
    }
    if (pending.length === 0) return;
    promoteInFlightRef.current += 1;
    void (async () => {
      try {
        for (const dataUrl of pending) {
          let inflight = promoteInflightRef.current.get(dataUrl);
          if (!inflight) {
            inflight = uploadLakeResource({ type: "base64", data: dataUrl }, noteId)
              .then((out) => { promotedRef.current.set(dataUrl, out.url); return out.url; })
              .catch((error) => {
                console.warn("[sheet] 内联图片提升为资产失败（保持内联形态）", error);
                return null;
              })
              .finally(() => { promoteInflightRef.current.delete(dataUrl); });
            promoteInflightRef.current.set(dataUrl, inflight);
          }
          await inflight;
        }
      } finally {
        promoteInFlightRef.current -= 1;
        // 提升落地后立刻排一次保存（此时序列化出的正文里已是 filename）
        scheduleSave();
      }
    })();
  };

  /**
   * 内核（FortuneSheet）的 onChange effect **依赖 onChange 的身份**：若每次 render 都传新的内联函数，
   * 它会每次 render 都回调一次 onChange → 我们无条件 `scheduleSave()` → `onDirty` → 外层保存状态
   * 变 dirty → render → 内核又回调……形成 dirty↔saving 的死循环（260930 实测：一个隐藏的表格 tab
   * 每 ~1s 触发一次 onDirty，把**全局** saveState 反复推脏，当前文档的状态栏就一直闪）。
   * 这里给内核传**稳定身份**的包装函数，真正的逻辑走 ref（始终指向最新闭包），既不丢功能也断开循环。
   */
  const workbookChangeRef = useRef<(next: SheetWorksheet[]) => void>(() => {});
  workbookChangeRef.current = (next) => {
    latestRef.current = next;
    // 几何同步的**主触发点**：列宽/行高/隐藏/合并都写在 `luckysheetfile` 里，只要模型变了
    // 一定回调这里。不能只靠 `onOp`——实测拖列宽有时只落一次 op、甚至不落（内核在 mouseup
    // 直接改 config），漏一次几何就永久停在旧值。两处都挂，rAF 内合并，值没变就早退。
    scheduleGeometrySync();
    // 列宽变了 ⇒ **整表**（所有有内容的行）重算行高（用户 261008：「需要全都算」）：
    // 列宽直接决定自动换行的行数，只重算选区那几行会漏掉同列其它行。
    const sheet = activeSheet(workbookRef.current, next);
    const colKey = JSON.stringify((sheet?.config as { columnlen?: unknown } | undefined)?.columnlen ?? {});
    if (colKey !== colWidthsKeyRef.current) {
      colWidthsKeyRef.current = colKey;
      scheduleAutoRowHeights(true);
    }
    scheduleSave();
    rememberSheetView();
    // 有内联图片就立刻提升（不等 800ms 防抖，尽量在第一次保存前完成）；只读态不碰资源
    if (!readOnlyRef.current) promoteInlineImages(latestRef.current);
  };
  const handleWorkbookChange = useCallback((next: SheetWorksheet[]) => workbookChangeRef.current(next), []);

  useEffect(() => () => {
    // 卸载/切走前把未落盘的改动补齐（不丢最后一次编辑）
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (autoRowTimerRef.current !== null) { window.clearTimeout(autoRowTimerRef.current); autoRowTimerRef.current = null; }
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开已有表格：把正文里遗留的内联图片自愈成资产（老正文 / 上次提升失败留下的 base64），
  // 不写任何「旧数据兼容」代码（AGENTS §3 #7）。
  useEffect(() => {
    if (readOnlyRef.current) return;
    promoteInlineImages(latestRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新编辑/输入的单元格补默认样式（自动换行 + 全局字体）；只补缺省、不覆盖显式设置。
  const hooks = useMemo(() => ({
    // 选区变化 → 刷新单元格图片工具弹窗（对齐云端：选中带图格子就弹工具条）
    afterSelectionChange: (_sheetId: string, selection: unknown) => {
      refreshCellImageMenu(selection);
      refreshCellColors(selection);   // 261008：色条跟着焦点格的颜色走
    },
    /** 工作表标签右键「更改颜色」→ 打开公共选色盘（内核那个不能用的 ChangeColor 面板已由补丁旁路）。 */
    onSheetTabColor: (sheetId: string, anchor: HTMLElement | null) => openColorPick("tab", anchor, sheetId),
    afterUpdateCell: (row: number, column: number) => {
      const wb = workbookRef.current;
      if (!wb) return;
      try {
        // 默认自动换行 + 全局字体（只补缺省）
        if (wb.getCellValue(row, column, { type: "tb" } as never) == null) wb.setCellFormat(row, column, "tb", WRAP);
        if (needsGlobalFont(wb.getCellValue(row, column, { type: "ff" } as never))) wb.setCellFormat(row, column, "ff", GLOBAL_FONT);
        if (needsDefaultFontSize(wb.getCellValue(row, column, { type: "fs" } as never))) wb.setCellFormat(row, column, "fs", SHEET_DEFAULT_FONT_SIZE);
        // 行高自适应（内核那段 canvas 计算只在单格提交且列宽/行高未被显式设置过时才跑）：按整行重算
        syncAutoRowHeights([row]);
      } catch { /* 忽略 */ }
    },
  }), [refreshCellImageMenu, syncAutoRowHeights, refreshCellColors, openColorPick]);

  return (
    <div
      ref={hostRef}
      className="sheet-editor"
      data-active={(focused ?? visible) ? "true" : undefined}
      data-pane-visible={visible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      {/* 单元格图片（P2）：选择本地图片（隐藏 input，由自定义工具栏按钮触发）。 */}
      <input
        ref={cellImageInputRef}
        type="file"
        accept="image/*"
        className="fn__none"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertCellImage(file);
        }}
      />
      {everVisible && fillMin && sheets.length > 0 && (
        <Workbook
          ref={workbookRef}
          data={renderSheets as never}
          allowEdit={!readOnly}
          defaultFontSize={SHEET_DEFAULT_FONT_SIZE}
          showToolbar={showToolbar}
          showFormulaBar={false}
          showSheetTabs
          toolbarItems={readOnly ? TOOLBAR_ITEMS_READONLY : TOOLBAR_ITEMS}
          cellContextMenu={CELL_CONTEXT_MENU}
          sheetTabContextMenu={SHEET_TAB_CONTEXT_MENU}
          customToolbarItems={customToolbarItems as never}
          hooks={hooks}
          onOp={handleOp}
          onChange={handleWorkbookChange}
        />
      )}
      {/* 公共选色盘（261008）：文字颜色 / 背景色 / 工作表标签颜色共用 */}
      {colorPick && (
        <ColorPalette
          anchor={colorPick.anchor}
          at={colorPick.at}
          value={colorPick.kind === "tab"
            ? (latestRef.current.find((sheet) => (sheet as { id?: string }).id === colorPick.sheetId) as { color?: string } | undefined)?.color
            : colorPick.kind === "text" ? cellColors.text : cellColors.bg}
          recentKey={COLOR_BUCKET[colorPick.kind]}
          defaultLabel={colorPick.kind === "text" ? "默认色" : colorPick.kind === "bg" ? "无背景色" : "无颜色"}
          defaultKind={colorPick.kind === "text" ? "text" : "background"}
          onPick={(color) => {
            if (colorPick.kind === "tab") applySheetTabColor(color, colorPick.sheetId);
            else applyCellColor(colorPick.kind, color);
          }}
          onDefault={() => {
            if (colorPick.kind === "tab") applySheetTabColor(null, colorPick.sheetId);
            else applyCellColor(colorPick.kind, null);
          }}
          onClose={() => setColorPick(null)}
          closeOnPick
        />
      )}
      {cellImageMenu && (
        <div
          className="sheet-cell-image-menu"
          style={{ left: cellImageMenu.left, top: cellImageMenu.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" title="查看大图" aria-label="查看大图" onClick={() => openCellImageLightbox(cellImageMenu.id)}>
            <Maximize2 size={14} />
          </button>
          <button type="button" title="下载原图" aria-label="下载原图" onClick={() => downloadCellImage(cellImageMenu.id)}>
            <Download size={14} />
          </button>
          {!readOnly && (
            <button type="button" title="删除" aria-label="删除" onClick={() => deleteCellImageById(cellImageMenu.id)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
