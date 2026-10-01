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
import { emptySheetBody, parseSheetBody, sheetImageDiskSrc, sheetImageSrc, sheetsToBody, type SheetWorksheet } from "../../core/sheetDoc.js";
import { sheetRangeRect, sheetZoom } from "../../core/sheetGeometry.js";
import { uploadLakeResource } from "../editor/resourceUpload";
import { openImagePreview } from "../editor/imagePreview";
import { native } from "../../lib/native";
import { ASSET_PORT, assetThumbWidthForCss } from "../../lib/assetPort";
import { Download, Maximize2, Trash2 } from "lucide-react";

/** 自动保存防抖：FortuneSheet 每次变更都回调，必须合并。 */
const AUTOSAVE_DEBOUNCE_MS = 800;
/** 默认缩放（260919 用户要求「整体偏小，默认 110%」）。已有 zoomRatio 的 sheet 不覆盖（尊重用户改过的缩放）。 */
const DEFAULT_SHEET_ZOOM = 1.1;
/** 全局字体（与 app 的 --b3-font-family 对齐）。用户要求「默认用全局字体、不支持修改」⇒ 不放「字体」工具栏项。 */
const GLOBAL_FONT = 'BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif';
/** FortuneSheet 的自动换行 = `tb:"2"`（overflow:"1" / clip:"0"）；默认给单元格补上。 */
const WRAP = "2";
/**
 * 工具栏（260921 第三轮：用户点名加回 4 项 —— format / link / comment / locationCondition，各自放在内核默认顺序的位置）。
 * 相对内核默认 `toolbarItems` 仍然隐藏：数字格式快捷键（currency-format / percentage-format / number-decrease /
 * number-increase）、font（用户要求默认全局字体、不可改）、text-rotation、conditionFormat、dataVerification、
 * splitColumn、screenshot。完整清单与中文名见 HANDOFF §2.17。
 */
const TOOLBAR_ITEMS = [
  "undo", "redo", "|",
  "format-painter", "clear-format", "|",
  "format", "|",                        // 单元格格式（数字格式 / 对齐 / 字体 / 边框）
  "font-size", "|",
  "bold", "italic", "strike-through", "underline", "|",
  "font-color", "background", "|",
  "horizontal-align", "vertical-align", "text-wrap", "|",
  "border", "merge-cell", "|",
  "filter", "link", "cell-image", "comment", "|",   // cell-image = 单元格图片（浮动图已移除，占原 image 位）
  "freeze", "quick-formula", "locationCondition", "|", "search",
];

/**
 * 单元格右键菜单：与内核默认一致，只把「插入图片」由浮动图改为**单元格图片**（260921 用户要求
 * 「完全去掉浮动图片」）。`cell-image` 由 customToolbarItems 提供（同一个 key 两处复用）。
 */
const CELL_CONTEXT_MENU = [
  "copy", "paste", "|",
  "insert-row", "insert-column", "delete-row", "delete-column", "delete-cell",
  "hide-row", "hide-column", "set-row-height", "set-column-width", "|",
  "clear", "sort", "orderAZ", "orderZA", "filter", "chart", "cell-image", "link", "data", "cell-format",
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

/**
 * 估算「自动换行」后该行需要的高度。FortuneSheet 的行高自适应只在「旧值已存在 + 带 canvas」的
 * 编辑路径里跑，公开 API 触发不到；首次录入空单元格时更不会调（所以第二行会被压住）。
 * 这里用离屏 canvas 按列宽量出行数，再按 defaultRowHeight(19px @10pt) 口径给出行高。
 */
function estimateWrappedRowHeight(text: string, fontSize: number, cellWidth: number): number {
  if (!text) return 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const fontPx = Math.max(1, fontSize) * (96 / 72); // pt → px
  ctx.font = `normal normal ${fontPx}px ${GLOBAL_FONT}`;
  const usable = Math.max(8, cellWidth - 4);
  const lines = Math.max(1, Math.ceil(ctx.measureText(text).width / usable));
  const lineHeight = Math.round(fontPx * 1.43); // 10pt → ≈19px，与 defaultRowHeight 对齐
  return lines * lineHeight + 3;
}

/** 给单元格补默认样式（只补缺省、不覆盖显式设置）：自动换行 + 全局字体。 */
function withCellDefaults(cell: Record<string, unknown>): Record<string, unknown> {
  const next = { ...cell };
  if (next.tb == null) next.tb = WRAP;
  if (next.ff == null) next.ff = GLOBAL_FONT;
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

/** 解析初始 sheets；空/非法 → 一张空表（不抛错，避免坏数据打不开）。缺省加上默认缩放。 */
function initialSheets(content: string, noteId: string): SheetWorksheet[] {
  const parsed = parseSheetBody(content);
  const sheets = parsed ? parsed.sheets : (parseSheetBody(emptySheetBody())?.sheets ?? []);
  return sheets
    .map((sheet) => withSheetDefaults(sheet.zoomRatio == null ? { ...sheet, zoomRatio: DEFAULT_SHEET_ZOOM } : sheet))
    .map((sheet) => withRenderableImageSrc(sheet, noteId));
}

export function SheetEditor({ noteId, content, visible, readOnly, onChange, onDirty, onEditorCapture, showToolbar = true }: SheetEditorProps) {
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

  /** 自定义工具栏项：单元格图片（只读态不给）。 */
  const customToolbarItems = useMemo(
    () =>
      readOnly
        ? []
        : [{ key: "cell-image", tooltip: "插入图片", icon: CELL_IMAGE_ICON, onClick: () => cellImageInputRef.current?.click() }],
    [readOnly],
  );

  const handleOp = useCallback(() => {
    scheduleGeometrySync();
  }, [scheduleGeometrySync]);

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
      applyFrozenOffsets();
      refreshCellImageMenu();
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
  }, [everVisible, syncCellImageGeometry, applyFrozenOffsets, refreshCellImageMenu]);

  const flush = () => {
    // 提升未落地前不保存：否则会把 base64 写进 sheets/*.sheet.json（正文膨胀 + 不走资产管线）。
    // 提升落地会再触发一次变更 → 那时才真正落盘（正文里是资产 URL，序列化时换成 filename）。
    if (promoteInFlightRef.current > 0) {
      scheduleSave();
      return;
    }
    const json = sheetsToBody(withPromotedImageSrc(latestRef.current, promotedRef.current));
    if (json === lastSerializedRef.current) return; // 无实际变化（如仅选区变化）：不标脏
    lastSerializedRef.current = json;
    changeRef.current(json);
  };
  const scheduleSave = () => {
    if (readOnlyRef.current) return;
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
    scheduleSave();
    // 有内联图片就立刻提升（不等 800ms 防抖，尽量在第一次保存前完成）；只读态不碰资源
    if (!readOnlyRef.current) promoteInlineImages(latestRef.current);
  };
  const handleWorkbookChange = useCallback((next: SheetWorksheet[]) => workbookChangeRef.current(next), []);

  useEffect(() => () => {
    // 卸载/切走前把未落盘的改动补齐（不丢最后一次编辑）
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
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
    },
    afterUpdateCell: (row: number, column: number) => {
      const wb = workbookRef.current;
      if (!wb) return;
      try {
        // 默认自动换行 + 全局字体（只补缺省）
        if (wb.getCellValue(row, column, { type: "tb" } as never) == null) wb.setCellFormat(row, column, "tb", WRAP);
        if (wb.getCellValue(row, column, { type: "ff" } as never) == null) wb.setCellFormat(row, column, "ff", GLOBAL_FONT);
        // 行高自适应（公开 API 触发不到内核那段 canvas 计算）：自己按列宽估算后 setRowHeight
        const value = wb.getCellValue(row, column);
        if (value == null || value === "") return;
        const fontSize = Number(wb.getCellValue(row, column, { type: "fs" } as never)) || 10;
        const colWidths = wb.getColumnWidth([column]) as Record<number, number> | undefined;
        const cellWidth = Number(colWidths?.[column]) || 73;
        const needed = estimateWrappedRowHeight(String(value), fontSize, cellWidth);
        const rowHeights = wb.getRowHeight([row]) as Record<number, number> | undefined;
        const current = Number(rowHeights?.[row]) || 19;
        if (needed > current + 1) wb.setRowHeight({ [row]: needed });
      } catch { /* 忽略 */ }
    },
  }), [refreshCellImageMenu]);

  return (
    <div
      ref={hostRef}
      className={visible ? "sheet-editor" : "sheet-editor fn__none"}
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
          showToolbar={showToolbar}
          showFormulaBar={false}
          showSheetTabs
          toolbarItems={TOOLBAR_ITEMS}
          cellContextMenu={CELL_CONTEXT_MENU}
          customToolbarItems={customToolbarItems as never}
          hooks={hooks}
          onOp={handleOp}
          onChange={handleWorkbookChange}
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
