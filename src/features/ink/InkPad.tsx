import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { EditorCaptureHandler } from "../../core/editorCapture";
import { ChevronLeft, ChevronRight, Eraser, FileText, Highlighter, ImagePlus, LayoutGrid, Minus, Pen, Plus, Redo2, SquarePlus, Undo2 } from "lucide-react";
import { INK_DEFAULT_COLOR, INK_STROKE_COLORS } from "./inkPalette.js";
import {
  createInkPage,
  inkToBody,
  parseInkBody,
  type InkBackground,
  type InkBackgroundImage,
  type InkDoc,
  type InkPage,
  type InkPoint,
  type InkStroke,
  type InkTool,
} from "../../core/inkDoc.js";
import { canonicalDocBody } from "../../core/docBaseline.js";
import { readInkNavPage, writeInkNavPage } from "./inkNav.js";
import { hitTestStroke, strokeToSvgPath } from "./inkGeometry.js";
import { inkStrokeStyle } from "./inkStrokeStyle.js";
import { InkExportMenu, type InkPageExportFormat } from "./InkExportMenu.js";
import { InkOutlinePanel } from "./InkOutlinePanel.js";
import { notedPageIds } from "./inkOutline.js";
import { inkPerfDebugEnabled, installInkPerfHooks, recordInkPerf } from "./inkPerfStats";
import { inkImageImportNotice, inkPdfImportNotice } from "./inkImportNotice";
import { installInkInputDiagnostics, installPointerInputDebugHooks } from "../board/boardInputDiagnostics";
import { createStrokePathCache, renderedStrokesForPage, type RenderedStrokePath } from "./inkRenderCache.js";
import {
  applyInkPatch,
  inkOrderDelta,
  inkPageDelta,
  inkPagePatch,
  pushBoundedHistory,
  type InkHistoryEntry,
  type InkPatch,
} from "./history.js";
import { InkPaper } from "./InkPaper.js";
import InkPageStrip from "./InkPageStrip.js";
import { newInkId } from "./ids.js";
import type { InkImageImportOutcome } from "./inkImageImport.js";
import { INK_PDF_MAX_PAGES, planPdfPageInsert, type PdfImportOutcome, type PdfImportPhase } from "./pdfImport.js";

export type InkPadMode = InkTool | "eraser";

export interface InkPadProps {
  content: string;
  readOnly?: boolean;
  variant: "desktop" | "mobile";
  /**
   * 当前文档 id：v3 只用它做**设备本地导航键**（lakex-local-notes-v3.ink-nav.<noteId>，见 features/ink/inkNav.ts）。
   * 不传也能用（导航退化为内存态），但翻页记忆不会持久化。
   */
  noteId?: string;
  active?: boolean;
  paneVisible?: boolean;
  pane?: "left" | "right" | null;
  onChange?: (content: string) => void;
  onDirty?: () => void;
  onEditorCapture?: EditorCaptureHandler;
  /**
   * v2 图片页导入（两端各自注入：选图 + 上传资产）。
   * 返回 null = 用户取消；pages 会被追加成新页并切到第一张新页（只能在编辑态调用）。
   */
  onImportImages?: () => Promise<InkImageImportOutcome | null>;
  /**
   * v2 PDF 页导入（两端各自注入：选 PDF + 落原文件 + 逐页栅格化 + 上传）。
   * onProgress 用于「第 n/N 页」；signal 用于「取消」（abort 后实现方应尽快停止）。
   */
  onImportPdf?: (options: {
    /** P7：phase = raster（渲染第 n/N 页）/ upload（写资产第 n 页）。 */
    onProgress: (done: number, total: number, phase?: PdfImportPhase) => void;
    /** 边导边用：每批已完成页交付一次（宿主立刻合并进正文，用户能马上开始标注）。 */
    onPagesReady?: (pages: InkPage[]) => void;
    signal: AbortSignal;
  }) => Promise<PdfImportOutcome | null>;
  /**
   * 单页导出（桌面注入；移动端不传 ⇒ 不出现导出入口）：宿主负责选目录与落盘。
   * format：pdf（A4 一页）/ png（2× 栅格）/ svg（自包含矢量）。
   * 返回 null = 用户取消（选目录时点了取消）。
   */
  onExportPage?: (input: { pageIds: string[]; format: InkPageExportFormat }) => Promise<{ exportPath: string } | null>;
}

const SAVE_DEBOUNCE_MS = 500;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
// 色板单一来源 = inkPalette.ts（261103 三批：6 → 14 色，手机/平板/桌面同一份）
/** 笔宽档位（逻辑 px）。两种工具**不能共用一组**：高亮是宽面马克笔，套 1.5~6 就是一条细线。 */
const PEN_WIDTHS = [1.5, 2.5, 4, 6] as const;
const HIGHLIGHTER_WIDTHS = [10, 18, 26, 34] as const;

function widthPresets(mode: InkPadMode): readonly number[] {
  return mode === "highlighter" ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
}
const BACKGROUNDS: ReadonlyArray<{ value: InkBackground; label: string }> = [
  { value: "blank", label: "空白" },
  { value: "lined", label: "横线" },
  { value: "grid", label: "网格" },
  { value: "dot", label: "点阵" },
];

/**
 * 笔宽档位里的视觉点直径（44 盒内）。两种工具的量纲差一个数量级，缩放系数也不同：
 * 笔 ×2（1.5→3 … 6→12），高亮 ×0.8 且封顶 26（10→8 … 34→26）；
 * 两边都夹在 4~26 内，保证不撑破 44 盒。
 */
function widthDotSize(width: number, mode: InkPadMode = "pen"): number {
  const scale = mode === "highlighter" ? 0.8 : 2;
  return Math.min(mode === "highlighter" ? 26 : 20, Math.max(4, Math.round(width * scale)));
}

/**
 * PDF 导入页：页图铺满整页 ⇒ 纸张底纹永远看不见。
 * 用户实测：PDF 页上切「横线/网格」画面毫无变化，却把文档标脏并触发保存（tab 上多一个未保存点）——
 * 无效操作 + 假脏，直接禁掉（不改数据，不写盘）。
 */
function isPdfPageBackground(page: InkPage): boolean {
  const image = page.backgroundImage;
  if (!image) return false;
  return image.source === "pdf-page" || image.pdf !== undefined;
}

/**
 * 导入进度文案。分母 = 真实要导入的页数（min(总页数, 上限)）；旧实现拿「已入队数」当分母 ⇒ UI 上两个数一起涨（298/298）。
 * 分子：栅格化阶段看「已渲染页数」，栅格化完成后剩下的就是写入，改看「已写入页数」。
 * 两阶段跟随的对象不同，切换瞬间最多回退「上传池宽」（3 页）；换来的是尾段读数真实（不会是 300/300 卡住不动）。
 */
function pdfProgressText(progress: { raster: number; uploaded: number; total: number } | null): string | null {
  if (!progress || progress.total <= 0) return null;
  const { raster, uploaded, total } = progress;
  const writing = raster >= total;
  const done = Math.min(total, writing ? uploaded : raster);
  return (writing ? "正在写入页面：第 " : "正在导入 PDF：第 ") + done + " / " + total + " 页";
}

/** 背景图片 → SVG preserveAspectRatio（contain 整图可见 / cover 裁切铺满 / stretch 拉伸）。 */
function backgroundImageAspect(image: InkBackgroundImage): string {
  if (image.fit === "cover") return "xMidYMid slice";
  if (image.fit === "stretch") return "none";
  return "xMidYMid meet";
}

function pointFromClient(clientX: number, clientY: number, pointerType: string, pressure: number, rect: DOMRect, page: InkPage): InkPoint {
  const x = rect.width > 0 ? ((clientX - rect.left) / rect.width) * page.width : 0;
  const y = rect.height > 0 ? ((clientY - rect.top) / rect.height) * page.height : 0;
  const rawPressure = pointerType === "pen" ? pressure : 0.5;
  return {
    x: Math.min(page.width, Math.max(0, x)),
    y: Math.min(page.height, Math.max(0, y)),
    pressure: Number.isFinite(rawPressure) && rawPressure > 0 ? Math.min(1, rawPressure) : 0.5,
  };
}

function replacePage(doc: InkDoc, page: InkPage): InkDoc {
  return { ...doc, pages: doc.pages.map((item) => (item.id === page.id ? page : item)) };
}

/** 静态笔迹层：只在页面内容变化时重渲染；正在书写时不会 reconcile 全部历史路径。 */
const StaticStrokeLayer = memo(function StaticStrokeLayer({ strokes }: { strokes: RenderedStrokePath[] }) {
  return (
    <>
      {strokes.map((stroke) => {
        const style = inkStrokeStyle(stroke.highlighter ? "highlighter" : "pen");
        return (
          <path
            key={stroke.id}
            d={stroke.d}
            fill={stroke.color}
            opacity={style.opacity}
            style={style.blend ? { mixBlendMode: style.blend } : undefined}
          />
        );
      })}
    </>
  );
});

export function InkPad({ content, readOnly = false, variant, noteId, active, paneVisible, pane, onChange, onDirty, onEditorCapture, onImportImages, onImportPdf, onExportPage }: InkPadProps) {
  // 正文只在挂载时解析；父层保存会更新 content，但编辑器不应因此反复解析整份大 JSON。
  // 外部真正需要换正文时由宿主 bump reloadKey 重挂载。
  // v3：当前页是设备本地视图（core/inkNav.ts），优先用它；没有记录才回退 v1/v2 正文里的旧 activePageId。
  const [doc, setDoc] = useState<InkDoc | null>(() => {
    // 261103 十一批：量一下「打开大文档」的解析成本（默认只记数，debug 才打日志）。
    const parseStartedAt = typeof performance !== "undefined" ? performance.now() : 0;
    const parsed = parseInkBody(content);
    if (!parsed) return null;
    if (typeof performance !== "undefined") {
      recordInkPerf({
        kind: "load",
        ms: performance.now() - parseStartedAt,
        bytes: typeof content === "string" ? content.length : 0,
        pages: parsed.pages.length,
        ...(inkPerfDebugEnabled()
          ? { strokes: parsed.pages.reduce((n, p) => n + p.strokes.length, 0), points: 0 }
          : {}),
      });
    }
    const savedPageId = readInkNavPage(noteId);
    if (savedPageId && parsed.pages.some((page) => page.id === savedPageId)) {
      return { ...parsed, activePageId: savedPageId };
    }
    return parsed;
  });
  const docRef = useRef<InkDoc | null>(doc);
  const [mode, setMode] = useState<InkPadMode>("pen");
  const [color, setColor] = useState(INK_DEFAULT_COLOR);
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1]);
  const [highlighterWidth, setHighlighterWidth] = useState<number>(18);
  const [zoom, setZoom] = useState(1);
  const [pagesOpen, setPagesOpen] = useState(false);
  // 移动端编辑工具坞的悬浮面板（当前色板 / 当前笔宽 / 插入菜单）；桌面不渲染它们。
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [widthsOpen, setWidthsOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  /** 桌面底部「导出」按钮的悬浮菜单（只有一个按钮：点开再选格式，不铺三个按钮）。 */
  const [exportOpen, setExportOpen] = useState(false);
  /** 大纲面板开合（页备注本身是正文数据，不需要额外状态）。 */
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pendingDeletePageId, setPendingDeletePageId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** 261103 九批：手写板落笔诊断的宿主根节点（默认关，见 boardInputDiagnostics.ts 头注释）。 */
  const inkRootRef = useRef<HTMLDivElement | null>(null);
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // v2 图片页导入：进行中标记 + 可见错误（失败/超限要能看见）
  const [importing, setImporting] = useState(false);
  const [pdfImporting, setPdfImporting] = useState(false);
  // 导入进度：栅格化与上传重叠跑 ⇒ 两个计数都留着，显示时取较大值 + 真实总页数当分母（见 pdfProgressText）。
  const [pdfProgress, setPdfProgress] = useState<{ raster: number; uploaded: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** 261103 十三批：导入完成提示（页数 + 资产体积，说明首次同步要传多少），6s 自动消失。 */
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importNoticeTimerRef = useRef<number | null>(null);
  const importingRef = useRef(false);
  const pdfImportingRef = useRef(false);
  const pdfAbortRef = useRef<AbortController | null>(null);
  // 撤销/重做只存页级补丁；整篇正文序列化只用于保存。
  const undoRef = useRef<InkHistoryEntry[]>([]);
  const redoRef = useRef<InkHistoryEntry[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  /** P5：正文是否还有未落盘的改动（序列化已移出热路径，保存时才现算）。 */
  const dirtyRef = useRef(false);
  const activePointerRef = useRef<{ id: number; type: string } | null>(null);
  /** 中断收口函数的前向引用（onPointerDown 定义在其前面，避免声明顺序依赖）。 */
  const finalizeInterruptedRef = useRef<(reason: string) => void>(() => {});
  const penDownRef = useRef(false);
  const activeStrokeRef = useRef<InkStroke | null>(null);
  const eraseBeforeRef = useRef<InkPage | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const lastPointRef = useRef<InkPoint | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onEditorCaptureRef = useRef(onEditorCapture);
  onEditorCaptureRef.current = onEditorCapture;
  const onImportImagesRef = useRef(onImportImages);
  onImportImagesRef.current = onImportImages;
  const onImportPdfRef = useRef(onImportPdf);
  onImportPdfRef.current = onImportPdf;
  /** 阅读态：翻页/缩放只改本地视图，capture 绝不可交出可写正文（桌面锁定文档的保存管线会按需 capture）。 */
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  /**
   * 父层最新的正文（= 阅读态下盘上正文）。阅读态 capture 交它，而不是挂载时的 diskBodyRef：
   * 编辑过一轮再点「完成」后 diskBodyRef 还是**打开时**的旧原文，交出去会把刚保存的正文覆盖回旧版。
   */
  const latestContentRef = useRef(content);
  latestContentRef.current = content;

  /** 打开时的磁盘原文（CORE-03 基线）：保存/捕获在「与磁盘等价」时原样返回它，不写盘。 */
  const diskBodyRef = useRef(content);
  /** 磁盘原文的规范形态：惰性算一次。 */
  const diskCanonicalRef = useRef<string | null | undefined>(undefined);
  /**
   * 当前正文与磁盘原文是否等价（CORE-03：打开后未动 / 撤销回原样）。
   * body 一律由 inkToBody 产出（同一规范形态）⇒ 与磁盘原文的规范形态逐字节相等即 core 判据的结论；
   * 盘上原文非规范（缺 activePageId / 坐标被 clamp 过）时同样判等价，不为一处格式差异写盘。
   * 缓存磁盘侧的规范形态：正文可达 10 MiB，不能每次保存都把两侧整篇解析一遍（CORE-07）。
   */
  const sameAsDisk = useCallback((body: string): boolean => {
    if (diskCanonicalRef.current === undefined) {
      diskCanonicalRef.current = canonicalDocBody("ink", diskBodyRef.current);
    }
    return diskCanonicalRef.current !== null && diskCanonicalRef.current === body;
  }, []);

  /** 261103 十三批 P2：导入完成提示（6s 后自动消失；不打断编辑）。 */
  const showImportNotice = useCallback((text: string) => {
    if (!text) return;
    setImportNotice(text);
    if (importNoticeTimerRef.current !== null) window.clearTimeout(importNoticeTimerRef.current);
    importNoticeTimerRef.current = window.setTimeout(() => {
      importNoticeTimerRef.current = null;
      setImportNotice(null);
    }, 6000);
  }, []);
  useEffect(() => () => {
    if (importNoticeTimerRef.current !== null) window.clearTimeout(importNoticeTimerRef.current);
  }, []);
  const page = useMemo(() => {
    if (!doc) return null;
    return doc.pages.find((item) => item.id === doc.activePageId) ?? doc.pages[0] ?? null;
  }, [doc]);
  // 261103 十三批：相邻页背景图「预解码」已实测否决（A/B：未预取 30.4ms vs 预取后 32.0ms 翻页，
  // 说明 30ms 级成本在 SVG/React 重渲染而不是图片 decode）⇒ 不留这段代码，避免无收益的复杂度。
  // 翻页/建页/删页/导入都会改内存 activePageId：同步到设备本地导航（不写正文、不标脏、不进 S3）。
  useEffect(() => {
    if (!noteId || !doc?.activePageId) return;
    writeInkNavPage(noteId, doc.activePageId);
  }, [doc?.activePageId, noteId]);
  /** 261103 十一批：性能观测取数钩子（默认只记录，不打日志；见 inkPerfStats.ts）。 */
  useEffect(() => {
    installInkPerfHooks();
  }, []);
  /** 261103 九批：手写板落笔诊断（默认关；开启方式见 boardInputDiagnostics.ts 头注释的 ink key）。 */
  useEffect(() => {
    installPointerInputDebugHooks();
    return installInkInputDiagnostics(inkRootRef.current);
  }, []);
  const pageIndex = doc && page ? doc.pages.findIndex((item) => item.id === page.id) : -1;
  const pageWidth = page?.width ?? 0;
  const pageHeight = page?.height ?? 0;

  useLayoutEffect(() => {
    if (pageWidth <= 0 || pageHeight <= 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const style = getComputedStyle(stage);
      const padX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const padY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
      const availWidth = Math.max(1, stage.clientWidth - padX);
      const availHeight = Math.max(1, stage.clientHeight - padY);
      const ratio = pageWidth / pageHeight;
      const height = Math.min(availHeight, availWidth / ratio);
      setFitSize((previous) => {
        const width = height * ratio;
        if (previous && Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5) return previous;
        return { width, height };
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [pageHeight, pageWidth]);
  const canUndo = historyVersion >= 0 && undoRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoRef.current.length > 0;
  const activeWidth = mode === "highlighter" ? highlighterWidth : penWidth;
  const zoomIn = useCallback(() => setZoom((value) => Math.min(ZOOM_MAX, Math.round((value + ZOOM_STEP) * 100) / 100)), []);
  const zoomOut = useCallback(() => setZoom((value) => Math.max(ZOOM_MIN, Math.round((value - ZOOM_STEP) * 100) / 100)), []);
  const closeSwatches = useCallback(() => {
    setPaletteOpen(false);
    setWidthsOpen(false);
    setInsertOpen(false);
  }, []);
  /** 坞上面板（色板/笔宽/插入）：点「面板本体 / 触发按钮」之外的任意处关闭（捕获 pointerdown，不误吞画布手势）。 */
  useEffect(() => {
    if (!paletteOpen && !widthsOpen && !insertOpen && !exportOpen && !outlineOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-overlay="palette"], [data-overlay="widths"], [data-overlay="insert"], [data-popover-trigger], [data-ink-export], [data-ink-outline]')) return;
      closeSwatches();
      setExportOpen(false);
      setOutlineOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeSwatches, exportOpen, insertOpen, outlineOpen, paletteOpen, widthsOpen]);
  // 退回阅读态时工具坞整体卸载：把面板状态一起收掉，下次进编辑态不会凭空弹开。
  useEffect(() => {
    if (readOnly) {
      closeSwatches();
      setExportOpen(false);
      setOutlineOpen(false);
    }
  }, [closeSwatches, readOnly]);
  /** 移动端全局预览是悬浮覆盖：点「预览面板本体 / 触发按钮」之外的任意处关闭（桌面流内面板不变）。 */
  useEffect(() => {
    if (variant !== "mobile" || !pagesOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-overlay="preview"], [data-popover-trigger="preview"]')) return;
      setPagesOpen(false);
      setPendingDeletePageId(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [pagesOpen, variant]);

  /**
   * 现算整篇正文：**只在保存 / capture 时调用**。
   * 热路径（落笔、擦除、翻页、撤销）不再序列化整篇 —— 实测 300 页批注文档一次 inkToBody 26.7ms，
   * 每落一笔都会撞一帧预算（P5）。序列化失败（容量上限）时保留内存正文，只给可见横幅。
   */
  const serializeDoc = useCallback((): string | null => {
    const current = docRef.current;
    if (!current) return null;
    try {
      // 261103 十一批：保存路径耗时/字节观测（判断是否该做页粒度增量保存）。
      const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
      const body = inkToBody(current);
      if (typeof performance !== "undefined") {
        recordInkPerf({
          kind: "save",
          ms: performance.now() - startedAt,
          bytes: body.length,
          pages: current.pages.length,
          ...(inkPerfDebugEnabled()
            ? {
                strokes: current.pages.reduce((n, p) => n + p.strokes.length, 0),
                points: current.pages.reduce((n, p) => n + p.strokes.reduce((m, s) => m + s.points.length, 0), 0),
              }
            : {}),
        });
      }
      setSaveError(null);
      return body;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "手写板正文无法保存");
      return null;
    }
  }, []);

  /** 真正落一次保存：与磁盘等价 ⇒ 不写；序列化失败保留 dirty（下次编辑/退出再试，正文不丢）。 */
  const savePending = useCallback(() => {
    if (!dirtyRef.current) return;
    const body = serializeDoc();
    if (body === null) return;
    dirtyRef.current = false;
    if (sameAsDisk(body)) return;
    onChangeRef.current?.(body);
  }, [sameAsDisk, serializeDoc]);

  /** 标脏 + 500ms 防抖保存（所有正文改动都走这里；序列化只在保存时发生）。 */
  const scheduleSave = useCallback(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      onDirtyRef.current?.();
    }
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      savePending();
    }, SAVE_DEBOUNCE_MS);
  }, [savePending]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    savePending();
  }, [savePending]);

  /** patch=null 表示这次改动不进入撤销栈（没有历史语义）。 */
  const commit = useCallback((next: InkDoc, patch: InkPatch | null) => {
    if (readOnly || !docRef.current) return;
    if (patch) {
      pushBoundedHistory(undoRef.current, patch);
      redoRef.current = [];
    }
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [readOnly, scheduleSave]);

  const undo = useCallback(() => {
    const entry = undoRef.current[undoRef.current.length - 1];
    if (!entry || !docRef.current) return;
    const next = applyInkPatch(docRef.current, entry.patch, "undo");
    undoRef.current.pop();
    pushBoundedHistory(redoRef.current, entry.patch);
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const entry = redoRef.current[redoRef.current.length - 1];
    if (!entry || !docRef.current) return;
    const next = applyInkPatch(docRef.current, entry.patch, "redo");
    redoRef.current.pop();
    pushBoundedHistory(undoRef.current, entry.patch);
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    onEditorCaptureRef.current?.(() => {
      // 阅读态一律交父层最新正文（阅读态下 = 盘上正文）：只读翻页/页面管理切换后 activePageId
      // 变的是本地视图，不是正文改动。（桌面锁定/已删除文档同样会被保存管线 capture，这条判据
      // 保证不会因此写盘；也不能交挂载时的 diskBodyRef —— 那是「打开时」的旧原文，会覆盖刚保存的正文。）
      if (readOnlyRef.current) return latestContentRef.current;
      const body = serializeDoc();
      if (body === null) return null;
      // CORE-03：与磁盘原文等价 ⇒ 返回磁盘原文（打开后没动 / 改过又改回原样都不产生写盘）。
      return sameAsDisk(body) ? diskBodyRef.current : body;
    });
    return () => {
      onEditorCaptureRef.current?.(null);
      flushSave();
    };
  }, [flushSave, sameAsDisk, serializeDoc]);

  useEffect(() => {
    if (!doc || !page) return;
    if (doc.activePageId !== page.id) {
      const next = { ...doc, activePageId: page.id };
      docRef.current = next;
      setDoc(next);
    }
  }, [doc, page]);

  const addPage = useCallback(() => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const nextPage = createInkPage(newInkId("page"), "blank");
    const next = { ...current, pages: [...current.pages, nextPage], activePageId: nextPage.id };
    const patch: InkPatch = inkPagePatch(null, nextPage);
    const order = inkOrderDelta(current.pages, next.pages);
    if (order) patch.order = order;
    commit(next, patch);
  }, [commit, readOnly]);

  /**
   * v2：导入图片页（编辑态）。宿主负责选图/上传（桌面 IPC、移动端 bridge），
   * 这里只负责「追加成页 + 切到第一张新页 + 一次可撤销提交」；失败给可见错误。
   */
  const importImages = useCallback(async () => {
    const importer = onImportImagesRef.current;
    if (!importer || readOnly || importingRef.current || pdfImportingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    setImportError(null);
    try {
      const outcome = await importer();
      if (!outcome) return; // 用户取消
      if (outcome.errors.length > 0) setImportError("导入图片失败：" + outcome.errors.join("；"));
      const current = docRef.current;
      if (!current || outcome.pages.length === 0) return;
      const added = outcome.pages;
      const next: InkDoc = { ...current, pages: [...current.pages, ...added], activePageId: added[0].id };
      const patch: InkPatch = { pages: added.map((page) => inkPageDelta(null, page)) };
      const order = inkOrderDelta(current.pages, next.pages);
      if (order) patch.order = order;
      commit(next, patch);
      // 261103 十三批 P2：告诉用户这次导入产生多少资产（首次同步要传的量）。
      showImportNotice(inkImageImportNotice(added.length, outcome.uploadedBytes ?? 0));
      // 导入后直接落在第一张新图上继续批注
      setPagesOpen(false);
      setPendingDeletePageId(null);
    } catch (reason) {
      setImportError("导入图片失败：" + (reason instanceof Error ? reason.message : String(reason)));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [commit, readOnly, showImportNotice]);

  /**
   * v2：导入 PDF（编辑态）。宿主负责选 PDF / 落原文件 / 逐页栅格化 / 上传；
   * 这里管进度、取消、成页（空白单页文档用第一页替换）与可见错误。
   */
  const importPdf = useCallback(async () => {
    const importer = onImportPdfRef.current;
    if (!importer || readOnly || importingRef.current || pdfImportingRef.current) return;
    pdfImportingRef.current = true;
    setPdfImporting(true);
    setPdfProgress({ raster: 0, uploaded: 0, total: 0 });
    setImportError(null);
    const controller = new AbortController();
    pdfAbortRef.current = controller;
    /** 已交付进正文的页数（边导边用）：决定「还要不要抢当前页」以及取消时的文案。 */
    let delivered = 0;
    try {
      const outcome = await importer({
        // 边导边用（261104 十六批）：不再等整本导完。第一批立刻替换空白首页并切到第 1 页，
        // 用户可以在后台继续栅格化/上传的同时开始标注；之后每批只追加，绝不抢当前页。
        onPagesReady: (pages) => {
          const current = docRef.current;
          if (!current || pages.length === 0) return;
          const plan = planPdfPageInsert(current, pages, undefined, { keepActivePage: delivered > 0 });
          if (!plan) return;
          commit(plan.next, plan.patch);
          delivered += pages.length;
        },
        onProgress: (done, total, phase) => setPdfProgress((previous) => {
          const base = previous ?? { raster: 0, uploaded: 0, total: 0 };
          // 分母只认宿主报的总页数（移动端是 PDF 真实页数，桌面已按上限夹过），此处再夹一次上限；
          // 早到的 0 不会把已拿到的总数冲掉。
          const nextTotal = total > 0 ? Math.min(total, INK_PDF_MAX_PAGES) : base.total;
          return phase === "upload"
            ? { ...base, uploaded: done, total: nextTotal }
            : { ...base, raster: done, total: nextTotal };
        }),
        signal: controller.signal,
      });
      if (!outcome) return; // 用户取消选文件
      if (outcome.cancelled) {
        // 已交付的页留在正文里（能继续标注），没交付的页连资产一起清掉。
        setImportError(delivered > 0
          ? `已取消 PDF 导入：已导入 ${delivered} 页，可以继续标注`
          : "已取消 PDF 导入");
        return;
      }
      if (outcome.errors.length > 0) setImportError(outcome.errors.join("；"));
      if (outcome.truncated) {
        const truncatedHint = `PDF 共 ${outcome.pageCount} 页，本次只导入前 ${outcome.importedPageCount} 页（上限 ${INK_PDF_MAX_PAGES} 页）`;
        setImportError((previous) => (previous ? previous + "；" + truncatedHint : truncatedHint));
      }
      // 收尾：outcome.pages 是「没能边交付的尾巴」（正常为空）；sourcePdf 是整篇元信息，最后补一次。
      const current = docRef.current;
      if (!current) return;
      let next: InkDoc = current;
      let trailingPatch: InkPatch | null = null;
      if (outcome.pages.length > 0) {
        const plan = planPdfPageInsert(current, outcome.pages, undefined, { keepActivePage: delivered > 0 });
        if (plan) {
          next = plan.next;
          trailingPatch = plan.patch;
          delivered += outcome.pages.length;
        }
      }
      if (outcome.sourcePdf && !next.sourcePdf) next = { ...next, sourcePdf: outcome.sourcePdf };
      if (next !== current) commit(next, trailingPatch);
      if (delivered > 0) {
        showImportNotice(inkPdfImportNotice(outcome.importedPageCount, outcome.pageCount, outcome.uploadedBytes ?? 0, outcome.truncated));
        // 第一张 PDF 页已经在第一批切过去了；这里只收拾面板状态。
        setPagesOpen(false);
        setPendingDeletePageId(null);
      }
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "导入 PDF 失败");
    } finally {
      pdfImportingRef.current = false;
      pdfAbortRef.current = null;
      setPdfImporting(false);
      setPdfProgress(null);
    }
  }, [commit, readOnly, showImportNotice]);

  /** 单页导出（宿主注入；移动端不传 ⇒ 没有入口）。 */
  const runExportPage = useCallback(async (format: InkPageExportFormat) => {
    if (!onExportPage || !page) return;
    setExportOpen(false);
    try {
      const result = await onExportPage({ pageIds: [page.id], format });
      if (result?.exportPath) showImportNotice(`已导出第 ${pageIndex + 1} 页：${result.exportPath}`);
    } catch (reason) {
      setImportError("导出失败：" + (reason instanceof Error ? reason.message : String(reason)));
    }
  }, [onExportPage, page, pageIndex, showImportNotice]);

  const cancelPdfImport = useCallback(() => {
    pdfAbortRef.current?.abort();
  }, []);

  const selectPage = useCallback((id: string) => {
    const current = docRef.current;
    if (!current || !current.pages.some((item) => item.id === id)) return;
    // 切页是纯视图（P5）：只更新内存 activePageId，不序列化、不标脏、不排保存。
    // 后续真实编辑保存时 activePageId 随正文一起写回；v3 起该字段移出正文（设备本地导航）。
    const updated = { ...current, activePageId: id };
    docRef.current = updated;
    setDoc(updated);
  }, []);

  const movePage = useCallback((id: string, delta: -1 | 1) => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const index = current.pages.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.pages.length) return;
    const pages = [...current.pages];
    const [moved] = pages.splice(index, 1);
    pages.splice(target, 0, moved);
    const order = inkOrderDelta(current.pages, pages);
    commit({ ...current, pages }, order ? { pages: [], order } : null);
  }, [commit, readOnly]);

  /** 保存当前页备注（v4 正文数据：进撤销栈、标脏、随同步走；空串 = 删除备注）。 */
  const savePageNote = useCallback((text: string) => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const before = current.pages.find((item) => item.id === current.activePageId);
    if (!before) return;
    const trimmed = text.trim();
    if ((before.note ?? "") === trimmed) return;
    const nextPage = { ...before };
    if (trimmed) nextPage.note = trimmed;
    else delete nextPage.note;
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, readOnly]);

  const requestDeletePage = useCallback((id: string) => {
    if (readOnly) return;
    setPendingDeletePageId(id);
  }, [readOnly]);

  const confirmDeletePage = useCallback(() => {
    const current = docRef.current;
    const id = pendingDeletePageId;
    if (!current || !id || readOnly || current.pages.length <= 1) return;
    const index = current.pages.findIndex((item) => item.id === id);
    if (index < 0) { setPendingDeletePageId(null); return; }
    const removed = current.pages[index];
    const pages = current.pages.filter((item) => item.id !== id);
    const activePageId = current.activePageId === id
      ? pages[Math.max(0, index - 1)]?.id ?? pages[0]?.id
      : current.activePageId;
    setPendingDeletePageId(null);
    const patch: InkPatch = inkPagePatch(removed, null);
    const order = inkOrderDelta(current.pages, pages);
    if (order) patch.order = order;
    commit({ ...current, pages, activePageId }, patch);
  }, [commit, pendingDeletePageId, readOnly]);

  const switchPage = useCallback((delta: number) => {
    const current = docRef.current;
    if (!current) return;
    const index = current.pages.findIndex((item) => item.id === current.activePageId);
    const next = current.pages[Math.max(0, Math.min(current.pages.length - 1, index + delta))];
    if (!next || next.id === current.activePageId) return;
    selectPage(next.id);
  }, [selectPage]);

  const setBackground = useCallback((background: InkBackground) => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before) return;
    // PDF 页：底纹看不见 ⇒ 切换是无效操作，禁止标脏/写盘（按钮同时置灰）。
    if (isPdfPageBackground(before)) return;
    const nextPage = { ...before, background };
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page, readOnly]);

  const finishStroke = useCallback(() => {
    const stroke = activeStrokeRef.current;
    const current = docRef.current;
    if (!stroke || !current || !page) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before) return;
    const nextPage = { ...before, strokes: [...before.strokes, stroke] };
    activeStrokeRef.current = null;
    setActiveStroke(null);
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page]);

  /**
   * 擦到某点：只更新 docRef + erasedIdsRef，**不 setState**（261103 九批）。
   * 一次 pointermove 的多个 coalesced 点、以及快速擦除，都会在批末统一 setDoc 一次；
   * 中间结果用 erasedIdsRef 累积，来源页面仍是本批开始时的 page（已擦 id 都在 set 里，结果一致）。
   * @returns 是否真的擦掉了东西
   */
  const eraseAt = useCallback((point: InkPoint): boolean => {
    const current = docRef.current;
    if (!current || !page) return false;
    const hits = page.strokes.filter((stroke) => !erasedIdsRef.current.has(stroke.id) && hitTestStroke(stroke, point));
    if (hits.length === 0) return false;
    for (const stroke of hits) erasedIdsRef.current.add(stroke.id);
    const nextPage = { ...page, strokes: page.strokes.filter((stroke) => !erasedIdsRef.current.has(stroke.id)) };
    docRef.current = replacePage(current, nextPage);
    return true;
  }, [page]);

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || !docRef.current || !page) return;
    if (event.button !== 0) return;
    if (event.pointerType === "pen") {
      penDownRef.current = true;
    } else if (penDownRef.current) {
      return; // 掌托/手指在笔落下期间不参与书写
    }
    // 上一次 pointerup 丢失（或丢了 pointercancel/lostcapture）时，activePointer 会残留 ⇒ 以前整块画布
    // 从此画不上（用户报的「偶发不生效」）。这里先把残留那笔收口（能提交就提交），再开始新的一笔。
    if (activePointerRef.current) finalizeInterruptedRef.current("missing-pointerup");
    activePointerRef.current = { id: event.pointerId, type: event.pointerType };
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromClient(event.clientX, event.clientY, event.pointerType, event.pressure, event.currentTarget.getBoundingClientRect(), page);
    lastPointRef.current = point;
    if (mode === "eraser") {
      eraseBeforeRef.current = page;
      erasedIdsRef.current = new Set();
      if (eraseAt(point) && docRef.current) setDoc(docRef.current);
      return;
    }
    const stroke: InkStroke = {
      id: newInkId("stroke"),
      tool: mode,
      color,
      width: mode === "highlighter" ? highlighterWidth : penWidth,
      points: [point],
    };
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }, [color, eraseAt, highlighterWidth, mode, page, penWidth, readOnly]);

  /**
   * 往当前笔迹追加一个点。**只改 ref、不 setState**（261103 九批）：
   * 一次 pointermove 可能带多个 coalesced 事件，以前每个点都 setState ⇒ 每个事件 N 次重渲染，
   * 快速落笔时 React 渲染 / perfect-freehand 重算帧率被压垮（用户报「画快了不生效」）。
   * 现在由 onPointerMove 在**一批点追加完**后统一 setState 一次；落笔数据始终在 ref 里，不受渲染节流影响。
   * @returns 是否真的追加了点（调用方据此决定要不要重渲染）
   */
  const appendPoint = useCallback((point: InkPoint): boolean => {
    const current = activeStrokeRef.current;
    if (!current) return false;
    const previous = lastPointRef.current;
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35) return false;
    lastPointRef.current = point;
    const next: InkStroke = { ...current, points: [...current.points, point] };
    activeStrokeRef.current = next;
    return true;
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!page || activePointerRef.current?.id !== event.pointerId) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const source = events.length > 0 ? events : [event.nativeEvent];
    const rect = event.currentTarget.getBoundingClientRect();
    if (mode === "eraser") {
      let erased = false;
      for (const sourceEvent of source) {
        if (eraseAt(pointFromClient(sourceEvent.clientX, sourceEvent.clientY, event.pointerType, sourceEvent.pressure, rect, page))) erased = true;
      }
      // 一批擦除点只重渲染一次（快速擦除是主要热路径）。
      if (erased && docRef.current) setDoc(docRef.current);
      return;
    }
    let appended = false;
    for (const sourceEvent of source) {
      if (appendPoint(pointFromClient(sourceEvent.clientX, sourceEvent.clientY, event.pointerType, sourceEvent.pressure, rect, page))) appended = true;
    }
    // 一批合并点只重渲染一次（快速落笔时这里是主要热路径）。
    if (appended) setActiveStroke(activeStrokeRef.current);
  }, [appendPoint, eraseAt, mode, page]);

  /**
   * 261103 十批：落笔被**异常中断**（pointercancel / lostpointercapture / 丢失 up）时的收口。
   * 以前一律丢弃 ⇒ 已经画出来的笔迹会「偶发消失」（快速滑动时更容易撞上，用户 261103 实机报）。
   * 现在的口径：
   *   · 画笔/高亮笔：已经积累 ≥2 个点 ⇒ **按已完成部分提交**（宁可留一笔，不可静默丢）；
   *   · 橡皮：保留原有语义（回滚到本笔开始前 + 不进历史栈）。
   * 返回 true 表示已处理（调用方不要再重复 finalize）。
   */
  const finalizeInterrupted = useCallback((reason: string): void => {
    if (!activePointerRef.current) return;
    activePointerRef.current = null;
    if (mode === "eraser") {
      const eraseBase = eraseBeforeRef.current;
      const current = docRef.current;
      eraseBeforeRef.current = null;
      erasedIdsRef.current = new Set();
      if (eraseBase && current && current.pages.some((item) => item.id === eraseBase.id)) {
        const restored = replacePage(current, eraseBase);
        docRef.current = restored;
        setDoc(restored);
      }
      return;
    }
    const stroke = activeStrokeRef.current;
    if (stroke && stroke.points.length >= 2) {
      // 丢 up 的那一笔照样落盘（同时保留历史栈里的一次增量）。
      console.warn("[ink] 落笔被中断（" + reason + "），已按已完成部分提交", { points: stroke.points.length });
      finishStroke();
      return;
    }
    activeStrokeRef.current = null;
    setActiveStroke(null);
  }, [finishStroke, mode]);
  finalizeInterruptedRef.current = finalizeInterrupted;

  const finishPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (activePointerRef.current?.id !== event.pointerId) return;
    activePointerRef.current = null;
    if (mode === "eraser") {
      const before = eraseBeforeRef.current;
      const current = docRef.current;
      const erased = erasedIdsRef.current.size > 0;
      eraseBeforeRef.current = null;
      erasedIdsRef.current = new Set();
      const erasedPage = before && current ? current.pages.find((item) => item.id === before.id) : undefined;
      if (before && current && erasedPage && erased) {
        commit(current, inkPagePatch(before, erasedPage));
      }
    } else {
      finishStroke();
    }
    if (event.pointerType === "pen") penDownRef.current = false;
  }, [commit, finishStroke, mode]);

  const cancelPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (activePointerRef.current?.id !== event.pointerId) return;
    if (event.pointerType === "pen") penDownRef.current = false;
    finalizeInterrupted(event.type === "pointercancel" ? "pointercancel" : "lostpointercapture");
  }, [finalizeInterrupted]);

  const activePath = useMemo(() => activeStroke ? strokeToSvgPath(activeStroke, false) : null, [activeStroke]);
  /** 笔迹 id → SVG 轮廓缓存（P5）：落一笔/擦一条只算新笔迹，不再整页重算 perfect-freehand。 */
  const strokePathCacheRef = useRef(createStrokePathCache());
  const renderedStrokes = useMemo<RenderedStrokePath[]>(() => {
    if (!page) return [];
    return renderedStrokesForPage(page, strokePathCacheRef.current);
  }, [page]);

  if (!doc || !page) {
    return (
      <div className={"ink-pad ink-pad--invalid"} data-readonly="true">
        <div className="ink-invalid-banner">手写板正文无法解析，已进入只读保护。请从历史版本恢复或重命名/导出后重建。</div>
      </div>
    );
  }

  return (
    <div
      ref={inkRootRef}
      className={"ink-pad ink-pad--" + variant}
      data-readonly={readOnly ? "true" : undefined}
      data-prevent-swipe
      data-active={active ? "true" : undefined}
      data-pane-visible={paneVisible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      {variant === "desktop" ? (
        <div className="ink-toolbar" role="toolbar" aria-label="手写工具">
          <button className={["ink-tool", mode === "pen" ? "is-active" : ""].join(" ")} onClick={() => setMode("pen")} aria-label="画笔" title="画笔" disabled={readOnly}><Pen size={16} /></button>
          <button className={["ink-tool", mode === "highlighter" ? "is-active" : ""].join(" ")} onClick={() => setMode("highlighter")} aria-label="高亮笔" title="高亮笔" disabled={readOnly}><Highlighter size={16} /></button>
          <button className={["ink-tool", mode === "eraser" ? "is-active" : ""].join(" ")} onClick={() => setMode("eraser")} aria-label="整笔橡皮" title="整笔橡皮" disabled={readOnly}><Eraser size={16} /></button>
          <span className="ink-toolbar__sep" />
          {INK_STROKE_COLORS.map((value) => (
            <button
              key={value}
              className={["ink-color", color === value ? "is-active" : ""].join(" ")}
              style={{ backgroundColor: value }}
              onClick={() => { setColor(value); if (mode === "eraser") setMode("pen"); }}
              aria-label={`颜色 ${value}`}
              title={`颜色 ${value}`}
              disabled={readOnly}
            />
          ))}
          <span className="ink-toolbar__sep" />
          {widthPresets(mode).map((value) => (
            <button
              key={value}
              className={["ink-width", activeWidth === value ? "is-active" : ""].join(" ")}
              onClick={() => mode === "highlighter" ? setHighlighterWidth(value) : setPenWidth(value)}
              aria-label={`笔宽 ${value}`}
              title={`笔宽 ${value}`}
              disabled={readOnly}
            ><span style={{ width: widthDotSize(value, mode), height: widthDotSize(value, mode) }} /></button>
          ))}
          <span className="ink-toolbar__sep" />
          <button className="ink-tool" onClick={undo} aria-label="撤销" title="撤销" disabled={readOnly || !canUndo}><Undo2 size={16} /></button>
          <button className="ink-tool" onClick={redo} aria-label="重做" title="重做" disabled={readOnly || !canRedo}><Redo2 size={16} /></button>
          {(onImportImages || onImportPdf) && (
            <>
              <span className="ink-toolbar__sep" />
              {onImportImages && (
                <button className="ink-tool" onClick={() => void importImages()} aria-label="导入图片" title="导入图片" disabled={readOnly || importing || pdfImporting}><ImagePlus size={16} /></button>
              )}
              {onImportPdf && (
                <button className="ink-tool" onClick={() => void importPdf()} aria-label="导入 PDF" title="导入 PDF" disabled={readOnly || importing || pdfImporting}><FileText size={16} /></button>
              )}
            </>
          )}
          {variant === "desktop" && (
            <>
              <span className="ink-toolbar__sep" />
              <div className="ink-zoom" role="group" aria-label="缩放">
                <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="缩小"><Minus size={16} /></button>
                <button className="ink-zoom__value" onClick={() => setZoom(1)} title="恢复为适应页面" aria-label="恢复为适应页面">{Math.round(zoom * 100)}%</button>
                <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="放大"><Plus size={16} /></button>
              </div>
            </>
          )}
        </div>
      ) : (
        // 移动端顶部固定条（阅读态 + 编辑态同一条）：翻页 | 缩放 | 全局预览。
        // 三者都是纯视图操作，阅读态也可用；纸张是正文数据，只出现在编辑态底部工具坞。
        <div className="ink-toolbar" role="toolbar" aria-label="手写板导航" data-overlay="nav">
          <div className="ink-pages">
            <button onClick={() => switchPage(-1)} disabled={pageIndex <= 0} aria-label="上一页"><ChevronLeft size={16} /></button>
            <span>第 {pageIndex + 1} / {doc.pages.length} 页</span>
            <button onClick={() => switchPage(1)} disabled={pageIndex >= doc.pages.length - 1} aria-label="下一页"><ChevronRight size={16} /></button>
          </div>
          <span className="ink-toolbar__sep" />
          <div className="ink-zoom" role="group" aria-label="缩放">
            <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="缩小"><Minus size={16} /></button>
            <button className="ink-zoom__value" onClick={() => setZoom(1)} title="恢复为适应页面" aria-label="恢复为适应页面">{Math.round(zoom * 100)}%</button>
            <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="放大"><Plus size={16} /></button>
          </div>
          <span className="ink-toolbar__sep" />
          <button
            className="ink-tool"
            data-popover-trigger="preview"
            onClick={() => { setPagesOpen((open) => !open); setPendingDeletePageId(null); closeSwatches(); }}
            aria-label="全局预览"
            title="全局预览"
            aria-expanded={pagesOpen}
          ><LayoutGrid size={16} /></button>
        </div>
      )}

      {saveError && <div className="ink-invalid-banner" role="alert">{saveError}；本次修改未写入。</div>}
      {doc.droppedPages ? (
        <div className="ink-invalid-banner" role="alert">
          有 {doc.droppedPages} 页数据无法解析，已跳过；继续编辑并保存会丢弃这些页（原文件在首次保存前不改动）。
        </div>
      ) : null}
      {importError && <div className="ink-invalid-banner" role="alert">{importError}</div>}
      {importNotice && <div className="ink-invalid-banner" role="status" data-ink-notice>{importNotice}</div>}
      {pdfImporting && (
        <div className="ink-invalid-banner" role="status" data-ink-pdf-progress>
          <span>{pdfProgressText(pdfProgress) ?? "正在导入 PDF：准备中…"}</span>
          <button className="ink-tool" onClick={cancelPdfImport} aria-label="取消 PDF 导入" title="取消 PDF 导入">取消</button>
        </div>
      )}

      {pagesOpen && (variant === "desktop" ? (
        <InkPageStrip
          pages={doc.pages}
          activePageId={doc.activePageId}
          pendingDeleteId={pendingDeletePageId}
          onSelect={selectPage}
          onMove={movePage}
          onAdd={addPage}
          onRequestDelete={requestDeletePage}
          onConfirmDelete={confirmDeletePage}
          notedPageIds={notedPageIds(doc.pages)}
          onCancelDelete={() => setPendingDeletePageId(null)}
          onClose={() => { setPagesOpen(false); setPendingDeletePageId(null); }}
          readOnly={readOnly}
        />
      ) : (
        // 移动端：全局预览 = 悬浮覆盖（不再把画布往下推；桌面仍是流内面板，结构不变）
        <div data-overlay="preview">
          <InkPageStrip
            pages={doc.pages}
            activePageId={doc.activePageId}
            pendingDeleteId={pendingDeletePageId}
            onSelect={selectPage}
            onMove={movePage}
            onAdd={addPage}
            onRequestDelete={requestDeletePage}
            onConfirmDelete={confirmDeletePage}
            notedPageIds={notedPageIds(doc.pages)}
            onCancelDelete={() => setPendingDeletePageId(null)}
            onClose={() => { setPagesOpen(false); setPendingDeletePageId(null); }}
            readOnly={readOnly}
          />
        </div>
      ))}

      <div className="ink-page-stage" ref={stageRef}>
        <div
          className="ink-page-frame"
          data-background={page.background}
          style={fitSize ? ({ width: fitSize.width * zoom, height: fitSize.height * zoom } as CSSProperties) : undefined}
        >
          <svg
            className="ink-page-svg"
            viewBox={`0 0 ${page.width} ${page.height}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={cancelPointer}
            onLostPointerCapture={cancelPointer}
            aria-label={`手写板第 ${pageIndex + 1} 页`}
          >
            {/* 纸张底纹永远在最底层：纯矢量页直接可见；图片页在图片未铺满整页时从留白处透出
                （261103 十五批：此前「有图就不画底纹」⇒ 用户切网格/点阵毫无反应，图片页只能永远是白纸）。 */}
            <InkPaper width={page.width} height={page.height} background={page.background} />
            {/* v2 图片页：背景图按页面逻辑坐标铺在笔迹层下面 */}
            {page.backgroundImage ? (
              <image
                href={page.backgroundImage.url}
                x={0}
                y={0}
                width={page.width}
                height={page.height}
                preserveAspectRatio={backgroundImageAspect(page.backgroundImage)}
                opacity={page.backgroundImage.opacity ?? 1}
                pointerEvents="none"
              />
            ) : null}
            {/* v4 页内贴图：按页逻辑坐标画（rotation 绕自身中心）；笔迹永远在最上层 */}
            {(page.images ?? []).map((image) => (
              <image
                key={image.id}
                href={image.url}
                x={image.x}
                y={image.y}
                width={image.width}
                height={image.height}
                transform={image.rotation
                  ? `rotate(${image.rotation} ${image.x + image.width / 2} ${image.y + image.height / 2})`
                  : undefined}
                pointerEvents="none"
              />
            ))}
            <StaticStrokeLayer strokes={renderedStrokes} />
            {activeStroke && activePath && (
              <path
                d={activePath}
                fill={activeStroke.color}
                opacity={inkStrokeStyle(activeStroke.tool).opacity}
                style={inkStrokeStyle(activeStroke.tool).blend ? { mixBlendMode: inkStrokeStyle(activeStroke.tool).blend } : undefined}
              />
            )}
          </svg>
        </div>
      </div>

      {variant === "desktop" ? (
        <div className="ink-footer">
          <div className="ink-pages">
            <button onClick={() => switchPage(-1)} disabled={pageIndex <= 0} aria-label="上一页"><ChevronLeft size={16} /></button>
            <span>第 {pageIndex + 1} / {doc.pages.length} 页</span>
            <button onClick={() => switchPage(1)} disabled={pageIndex >= doc.pages.length - 1} aria-label="下一页"><ChevronRight size={16} /></button>
            <button onClick={addPage} disabled={readOnly} aria-label="新建页"><Plus size={16} /></button>
            <button onClick={() => { setPagesOpen((open) => !open); setPendingDeletePageId(null); }} aria-label="页面管理" title="页面管理"><LayoutGrid size={16} /></button>
          </div>
          <div className="ink-footer__right">
            {/* 大纲 / 书签（桌面专用控件；移动端本轮没有入口） */}
            <InkOutlinePanel
              open={outlineOpen}
              onToggle={() => { setOutlineOpen((open) => !open); closeSwatches(); }}
              pages={doc.pages}
              currentPageId={doc.activePageId}
              onJump={selectPage}
              onSaveNote={savePageNote}
            />
            {/* 只放一个按钮：点开再选格式（用户定稿：不要三个按钮占满工具条）；菜单本体在 InkExportMenu（桌面专用） */}
            {onExportPage && (
              <InkExportMenu
                open={exportOpen}
                onToggle={() => { setExportOpen((open) => !open); closeSwatches(); }}
                onPick={(format) => void runExportPage(format)}
              />
            )}
            <div className="ink-backgrounds">
              {BACKGROUNDS.map((item) => (
                <button key={item.value} className={page.background === item.value ? "is-active" : ""} onClick={() => setBackground(item.value)} disabled={readOnly || isPdfPageBackground(page)} title={isPdfPageBackground(page) ? "PDF 页已铺满整页，纸张不可见" : undefined}>{item.label}</button>
              ))}
            </div>
          </div>
        </div>
      ) : !readOnly ? (
        // 移动端底部工具坞（仅编辑态）：上排画笔工具（横向滚动，含颜色/笔宽/撤销重做），
        // 下排纸张。编辑态工作区胶囊已由工作区隐藏，工具坞贴底并自己接系统安全区。
        <div className="ink-footer" role="toolbar" aria-label="手写工具" data-overlay="dock">
          <div className="ink-toolbar" role="group" aria-label="画笔工具">
            {/* 插入（＋）放第一位：图片/PDF 入口在坞内悬浮菜单里 */}
            {(onImportImages || onImportPdf) && (
              <>
                <button
                  className={["ink-tool", insertOpen ? "is-active" : ""].join(" ")}
                  data-popover-trigger="insert"
                  onClick={() => { setInsertOpen((open) => !open); setPaletteOpen(false); setWidthsOpen(false); }}
                  aria-label="插入"
                  title="插入"
                  aria-expanded={insertOpen}
                ><SquarePlus size={18} /></button>
                <span className="ink-toolbar__sep" />
              </>
            )}
            <button className={["ink-tool", mode === "pen" ? "is-active" : ""].join(" ")} onClick={() => setMode("pen")} aria-label="画笔" title="画笔"><Pen size={18} /></button>
            <button className={["ink-tool", mode === "highlighter" ? "is-active" : ""].join(" ")} onClick={() => setMode("highlighter")} aria-label="高亮笔" title="高亮笔"><Highlighter size={18} /></button>
            <button className={["ink-tool", mode === "eraser" ? "is-active" : ""].join(" ")} onClick={() => setMode("eraser")} aria-label="整笔橡皮" title="整笔橡皮"><Eraser size={18} /></button>
            <span className="ink-toolbar__sep" />
            {/* 颜色/笔宽都收成「当前值按钮」（平板与手机一致，261102 晚点单）：点开坞上方悬浮面板 */}
            <button
              className={["ink-color", paletteOpen ? "is-active" : ""].join(" ")}
              data-popover-trigger="color"
              onClick={() => { setPaletteOpen((open) => !open); setWidthsOpen(false); setInsertOpen(false); }}
              aria-label="选择颜色"
              title="选择颜色"
              aria-expanded={paletteOpen}
            ><span style={{ backgroundColor: color }} /></button>
            <span className="ink-toolbar__sep" />
            <button
              className={["ink-width", widthsOpen ? "is-active" : ""].join(" ")}
              data-popover-trigger="width"
              onClick={() => { setWidthsOpen((open) => !open); setPaletteOpen(false); setInsertOpen(false); }}
              aria-label="选择笔宽"
              title="选择笔宽"
              aria-expanded={widthsOpen}
            ><span style={{ width: widthDotSize(activeWidth, mode), height: widthDotSize(activeWidth, mode) }} /></button>
            <span className="ink-toolbar__sep" />
            <button className="ink-tool" onClick={undo} aria-label="撤销" title="撤销" disabled={!canUndo}><Undo2 size={18} /></button>
            <button className="ink-tool" onClick={redo} aria-label="重做" title="重做" disabled={!canRedo}><Redo2 size={18} /></button>
          </div>
          <div className="ink-backgrounds" role="group" aria-label="纸张">
            {BACKGROUNDS.map((item) => (
              <button key={item.value} className={page.background === item.value ? "is-active" : ""} onClick={() => setBackground(item.value)} disabled={isPdfPageBackground(page)}>{item.label}</button>
            ))}
          </div>
          {paletteOpen && (
            <div role="group" aria-label="选择颜色" data-overlay="palette">
              {INK_STROKE_COLORS.map((value) => (
                <button
                  key={value}
                  className={["ink-color", color === value ? "is-active" : ""].join(" ")}
                  onClick={() => { setColor(value); if (mode === "eraser") setMode("pen"); setPaletteOpen(false); }}
                  aria-label={`颜色 ${value}`}
                  title={`颜色 ${value}`}
                ><span style={{ backgroundColor: value }} /></button>
              ))}
            </div>
          )}
          {widthsOpen && (
            <div role="group" aria-label="选择笔宽" data-overlay="widths">
              {widthPresets(mode).map((value) => (
                <button
                  key={value}
                  className={["ink-width", activeWidth === value ? "is-active" : ""].join(" ")}
                  onClick={() => { if (mode === "highlighter") setHighlighterWidth(value); else setPenWidth(value); setWidthsOpen(false); }}
                  aria-label={`笔宽 ${value}`}
                  title={`笔宽 ${value}`}
                ><span style={{ width: widthDotSize(value, mode), height: widthDotSize(value, mode) }} /></button>
              ))}
            </div>
          )}
          {insertOpen && (
            <div role="group" aria-label="插入" data-overlay="insert">
              {onImportImages && (
                <button
                  className="ink-tool"
                  onClick={() => { setInsertOpen(false); void importImages(); }}
                  aria-label="导入图片"
                  title="导入图片"
                  disabled={importing || pdfImporting}
                ><ImagePlus size={18} /><span>导入图片</span></button>
              )}
              {onImportPdf && (
                <button
                  className="ink-tool"
                  onClick={() => { setInsertOpen(false); void importPdf(); }}
                  aria-label="导入 PDF"
                  title="导入 PDF"
                  disabled={importing || pdfImporting}
                ><FileText size={18} /><span>导入 PDF</span></button>
              )}
            </div>
          )}
        </div>
      ) : null}

      {readOnly && variant === "desktop" && <div className="ink-readonly-hint">只读</div>}
    </div>
  );
}

export default InkPad;
