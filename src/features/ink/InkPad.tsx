/**
 * 手写板双端共享控制器（组合根；261125 D-06 拆分后只做组合与接线，不再内联域逻辑）。
 *
 * 结构：正文状态 = useInkDocState；四个域 hook = useInkHistory（撤销/重做 + commit）/
 * useInkPageNav（翻页·页面增删排序·页签·纸张）/ useInkPageItems（贴图/文字块）/ useInkTools（工具态 + 落笔指针管线）；
 * 外壳 = InkToolbarDesktop + InkFooterDesktop（桌面）、InkNavMobile + InkFooterMobile（移动端）。
 *
 * 红线（改这里先读）：
 *  1. 正文格式 = inkDoc v4（**读 1|2|3|4 写 4**）：读写口径单一来源 = docs/INK-PAD.md + core/inkDoc.ts；
 *     页签 page.note / 页内贴图 / 页内文字块都进导出与全文搜索；activePageId 是设备本地视图（inkNav.ts），**不写回正文**。
 *  2. **落笔/翻页/撤销不得整篇序列化**（P5 热路径）：整篇 inkToBody 只发生在保存防抖到点 / capture（useInkDocState.serializeDoc）。
 *  3. 「打开 = 只读」（CORE-03）：与磁盘原文等价 ⇒ 不写盘、capture 交磁盘原文（inkPadModel.captureInkBody）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { EditorCaptureHandler } from "../../core/editorCapture";
import { INK_STROKE_COLORS } from "./inkPalette.js";
import {
  type InkDoc,
  type InkPage,
  type InkTool,
} from "../../core/inkDoc.js";
import { captureInkBody } from "./inkPadModel.js";
/** 261125 D-06：笔/工具域（工具态 + 落笔指针管线）抽到 useInkTools.ts（纯搬移）。 */
import { pointFromClient, useInkTools, widthDotSize, widthPresets } from "./useInkTools.js";
/** 261125 D-06：贴图/文字块域抽到 useInkPageItems.ts（纯搬移）。 */
import { useInkPageItems } from "./useInkPageItems.js";
import { useInkDocState } from "./useInkDocState";
/** 261125 D-06：页导航域抽到 useInkPageNav.ts（纯搬移）；纸张预设与 PDF 页判据也从那里导出。 */
import { BACKGROUNDS, isPdfPageBackground, useInkPageNav } from "./useInkPageNav.js";
import { InkFooterDesktop, InkToolbarDesktop } from "./InkToolbarDesktop";
/** 261125 D-06：移动端外壳两块（页面条 / 底栏）抽成子组件（纯搬移）。 */
import { InkNavMobile } from "./InkNavMobile.js";
import { InkFooterMobile } from "./InkFooterMobile.js";
import { InkCanvas } from "./InkCanvas";
import { InkPagesPanel } from "./InkPagesPanel.js";
import type { InkPageExportFormat } from "./InkExportMenu.js";
import { tabPageIds } from "./inkOutline.js";
import { installInkPerfHooks } from "./inkPerfStats";
import { inkImageImportNotice, inkPdfImportNotice } from "./inkImportNotice";
import { installInkInputDiagnostics, installPointerInputDebugHooks } from "../board/boardInputDiagnostics";
import { inkOrderDelta, inkPageDelta, type InkPatch } from "./history.js";
/** 261125 D-06：撤销/重做域抽到 useInkHistory.ts（纯搬移）；提交入口 commit 从那里取。 */
import { useInkHistory } from "./useInkHistory.js";
import InkPageStrip from "./InkPageStrip.js";
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
  /**
   * 插入页内贴图（桌面注入；移动端暂不提供）：宿主负责选图 + 上传资产，返回 URL 与原图尺寸。
   * 返回 null = 用户取消。落点由 InkPad 决定（页宽 40%、居中，用户 261104 定稿）。
   */
  onInsertPageImage?: () => Promise<{ url: string; naturalWidth?: number; naturalHeight?: number } | null>;
  /**
   * 瞬时提示通道（导入失败 / 导入完成 / 单页导出完成）。
   * 移动端注入 = toast 气泡（不占编辑空间，用户 261104 反馈「报错不要占用编辑空间」）；
   * 不注入 = 板内横幅 role=alert（桌面口径：空间足够、可回看）。
   * 只有「瞬时动作结果」走这里；保存失败 / 正文坏这类需要常驻的状态仍用板内横幅。
   */
  onTransientMessage?: (text: string, kind: "info" | "error") => void;
  /**
   * 移动端「页签」入口（宿主注入）：InkPad 只给当前页数据与两个动作，UI（按钮 + 底部 Sheet）由移动层决定
   * —— 共享层不发 `mb-*` 类名（跨端样式护栏要求共享组件类名两端都有样式）。
   */
  renderPageTab?: (state: {
    pageNumber: number;
    readOnly: boolean;
    note: string | undefined;
    onSave: (text: string) => void;
    onClear: () => void;
  }) => ReactNode;
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
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



export function InkPad({ content, readOnly = false, variant, noteId, active, paneVisible, pane, onChange, onDirty, onEditorCapture, onImportImages, onImportPdf, onExportPage, onInsertPageImage, onTransientMessage, renderPageTab }: InkPadProps) {
  // 正文状态 + 保存管线（261112 R2-S10 阶段②：已搬到 useInkDocState，纯搬移）
  const {
    doc, setDoc, docRef, page,
    latestContentRef, diskBodyRef, sameAsDisk, serializeDoc,
    scheduleSave, flushSave, saveError,
  } = useInkDocState({ content, noteId, onChange, onDirty });

  // 撤销/重做域（261125 D-06：commit/undo/redo 抽到 useInkHistory.ts，纯搬移）：
  // commit 是唯一正文提交入口（patch=null = 本次改动不进撤销栈）；热路径不序列化整篇。
  const { commit, undo, redo, canUndo, canRedo } = useInkHistory({ docRef, setDoc, scheduleSave, readOnly });

  // 页导航域（261125 D-06：翻页/页面增删排序/页签/纸张/滑动翻页抽到 useInkPageNav.ts，纯搬移）。
  const {
    pagesOpen, setPagesOpen, pagesView, setPagesView,
    pendingDeletePageId, setPendingDeletePageId,
    selectPage, switchPage, movePage, movePageTo, addPage,
    requestDeletePage, confirmDeletePage, savePageNote, clearPageNote,
    setBackground, onStageTouchStart, onStageTouchEnd, clearStageSwipe,
  } = useInkPageNav({ doc, page, docRef, setDoc, commit, readOnly, noteId });

  // 笔/工具域（261125 D-06：工具态 + 落笔指针管线抽到 useInkTools.ts，纯搬移）。
  const {
    mode, setMode, color, setColor, penWidth, setPenWidth, highlighterWidth, setHighlighterWidth,
    selectedImageId, setSelectedImageId, selectedTextId, setSelectedTextId,
    activeStroke, activePath, renderedStrokes,
    onPointerDown, onPointerMove, finishPointer, cancelPointer,
  } = useInkTools({ docRef, setDoc, page, readOnly, commit });

  const [zoom, setZoom] = useState(1);
  // 移动端编辑工具坞的悬浮面板（当前色板 / 当前笔宽 / 插入菜单）；桌面不渲染它们。
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [widthsOpen, setWidthsOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  /** 桌面底部「导出」按钮的悬浮菜单（只有一个按钮：点开再选格式，不铺三个按钮）。 */
  const [exportOpen, setExportOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** 261103 九批：手写板落笔诊断的宿主根节点（默认关，见 boardInputDiagnostics.ts 头注释）。 */
  const inkRootRef = useRef<HTMLDivElement | null>(null);
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);
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
  const onEditorCaptureRef = useRef(onEditorCapture);
  onEditorCaptureRef.current = onEditorCapture;
  const onImportImagesRef = useRef(onImportImages);
  onImportImagesRef.current = onImportImages;
  const onImportPdfRef = useRef(onImportPdf);
  onImportPdfRef.current = onImportPdf;
  /** 阅读态：翻页/缩放只改本地视图，capture 绝不可交出可写正文（桌面锁定文档的保存管线会按需 capture）。 */
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  /** 宿主注入的瞬时提示通道（移动端 = toast）；用 ref 保证回调身份变化不牵动下面一堆 useCallback 依赖。 */
  const transientMessageRef = useRef(onTransientMessage);
  transientMessageRef.current = onTransientMessage;
  /**
   * 瞬时失败（导入失败 / 导出失败 / 插入贴图失败）：
   * 注入 toast 就只弹气泡（绝不占版面 ⇒ 不会挤动页面尺寸）；否则退回板内横幅，可累加多条。
   */
  const notifyError = useCallback((text: string, options: { append?: boolean } = {}) => {
    if (!text) return;
    const toast = transientMessageRef.current;
    if (toast) { toast(text, "error"); return; }
    setImportError((previous) => (options.append && previous ? previous + "；" + text : text));
  }, []);
  /** 261103 十三批 P2：导入完成提示（6s 后自动消失；不打断编辑）。注入 toast 时交给 toast（同样 6s）。 */
  const showImportNotice = useCallback((text: string) => {
    if (!text) return;
    const toast = transientMessageRef.current;
    if (toast) { toast(text, "info"); return; }
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

  // 页内对象域（261125 D-06：贴图/文字块的插入/删除/缩放/文字编辑抽到 useInkPageItems.ts，纯搬移）。
  const {
    textEditing, setTextEditing,
    insertPageImage, deleteSelectedImage, startImageResize,
    insertPageText, startTextEditing, commitPageText, removeText, startTextResize,
    bumpTextFontSize,
  } = useInkPageItems({
    docRef, setDoc, commit, page, readOnly, color,
    selectedImageId, setSelectedImageId, selectedTextId, setSelectedTextId,
    onInsertPageImage, notifyError,
  });
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

  const fitStageRef = useRef<{ width: number; height: number } | null>(null);
  /** 编辑文字期间（IME 会压矮可视区）：页面尺寸冻结，不跟着键盘缩 —— 否则「点开编辑器整页缩一半，提交又长回去」。 */
  const textEditingRef = useRef(false);
  textEditingRef.current = textEditing !== null;
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
      const previousRect = fitStageRef.current;
      fitStageRef.current = { width: availWidth, height: availHeight };
      // 移动端文字编辑态：宽度不变、只变矮 ⇒ 判为 IME 弹起，保持页面尺寸（stage 自己滚动）。
      if (variant === "mobile" && textEditingRef.current && previousRect && Math.abs(availWidth - previousRect.width) <= 2 && availHeight < previousRect.height - 20) return;
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
  }, [pageHeight, pageWidth, variant]);
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
    if (!paletteOpen && !widthsOpen && !insertOpen && !exportOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-overlay="palette"], [data-overlay="widths"], [data-overlay="insert"], [data-popover-trigger], [data-ink-export], [data-ink-pages-panel]')) return;
      closeSwatches();
      setExportOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [closeSwatches, exportOpen, insertOpen, paletteOpen, widthsOpen]);
  // 退回阅读态时工具坞整体卸载：把面板状态一起收掉，下次进编辑态不会凭空弹开。
  useEffect(() => {
    if (readOnly) {
      closeSwatches();
      setExportOpen(false);
      setPagesOpen(false);
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


  useEffect(() => {
    onEditorCaptureRef.current?.(() => {
      // 阅读态一律交父层最新正文（阅读态下 = 盘上正文）：只读翻页/页面管理切换后 activePageId
      // 变的是本地视图，不是正文改动。（桌面锁定/已删除文档同样会被保存管线 capture，这条判据
      // 保证不会因此写盘；也不能交挂载时的 diskBodyRef —— 那是「打开时」的旧原文，会覆盖刚保存的正文。）
      // 决策矩阵（只读 / 序列化失败 / 等价 / 有改动）在 inkPadModel.captureInkBody，行为测试见 inkPadModel.test.ts。
      return captureInkBody({
        readOnly: readOnlyRef.current,
        latestContent: latestContentRef.current,
        serialize: serializeDoc,
        isSameAsDisk: sameAsDisk,
        diskBody: diskBodyRef.current,
      });
    });
    return () => {
      onEditorCaptureRef.current?.(null);
      flushSave();
    };
  }, [flushSave, sameAsDisk, serializeDoc]);

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
      if (outcome.errors.length > 0) notifyError("导入图片失败：" + outcome.errors.join("；"));
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
      notifyError("导入图片失败：" + (reason instanceof Error ? reason.message : String(reason)));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [commit, notifyError, readOnly, showImportNotice]);

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
        notifyError(delivered > 0
          ? `已取消 PDF 导入：已导入 ${delivered} 页，可以继续标注`
          : "已取消 PDF 导入");
        return;
      }
      if (outcome.errors.length > 0) notifyError(outcome.errors.join("；"));
      if (outcome.truncated) {
        const truncatedHint = `PDF 共 ${outcome.pageCount} 页，本次只导入前 ${outcome.importedPageCount} 页（上限 ${INK_PDF_MAX_PAGES} 页）`;
        notifyError(truncatedHint, { append: true });
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
      notifyError(reason instanceof Error ? reason.message : "导入 PDF 失败");
    } finally {
      pdfImportingRef.current = false;
      pdfAbortRef.current = null;
      setPdfImporting(false);
      setPdfProgress(null);
    }
  }, [commit, notifyError, readOnly, showImportNotice]);

  /** 单页导出（宿主注入；移动端不传 ⇒ 没有入口）。 */
  const runExportPage = useCallback(async (format: InkPageExportFormat) => {
    if (!onExportPage || !page) return;
    setExportOpen(false);
    try {
      const result = await onExportPage({ pageIds: [page.id], format });
      if (result?.exportPath) showImportNotice(`已导出第 ${pageIndex + 1} 页：${result.exportPath}`);
    } catch (reason) {
      notifyError("导出失败：" + (reason instanceof Error ? reason.message : String(reason)));
    }
  }, [notifyError, onExportPage, page, pageIndex, showImportNotice]);

  const cancelPdfImport = useCallback(() => {
    pdfAbortRef.current?.abort();
  }, []);

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
      data-note-id={noteId}
      data-readonly={readOnly ? "true" : undefined}
      data-prevent-swipe
      data-active={active ? "true" : undefined}
      data-pane-visible={paneVisible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      {variant === "desktop" ? (
        <InkToolbarDesktop
          mode={mode} setMode={setMode} color={color} setColor={setColor} setHighlighterWidth={setHighlighterWidth} setPenWidth={setPenWidth} variant={variant} readOnly={readOnly} activeWidth={activeWidth}
          onInsertPageImage={onInsertPageImage} insertPageImage={insertPageImage} insertPageText={insertPageText}
          undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
          zoom={zoom} setZoom={setZoom} zoomIn={zoomIn} zoomOut={zoomOut}
          strokeColors={INK_STROKE_COLORS} widthPresets={widthPresets} widthDotSize={widthDotSize}
          zoomMin={ZOOM_MIN} zoomMax={ZOOM_MAX}
        />
      ) : (
        // 移动端顶部「页面条」（261125 D-06 抽成 InkNavMobile.tsx，纯搬移）：翻页 | 缩放 | 全局预览 | 页签注入点。
        <InkNavMobile
          doc={doc} page={page} pageIndex={pageIndex} readOnly={readOnly}
          switchPage={switchPage} addPage={addPage}
          zoom={zoom} setZoom={setZoom} zoomIn={zoomIn} zoomOut={zoomOut} zoomMin={ZOOM_MIN} zoomMax={ZOOM_MAX}
          pagesOpen={pagesOpen} setPagesOpen={setPagesOpen} setPendingDeletePageId={setPendingDeletePageId} closeSwatches={closeSwatches}
          renderPageTab={renderPageTab} savePageNote={savePageNote} clearPageNote={clearPageNote}
        />
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

      {variant === "desktop" ? (
        // 桌面：「页面」悬浮面板（缩略图 / 大纲两个视图；单一入口、不可固定）
        <InkPagesPanel
          open={pagesOpen}
          view={pagesView}
          onViewChange={setPagesView}
          pages={doc.pages}
          currentPageId={doc.activePageId}
          readOnly={readOnly}
          pendingDeleteId={pendingDeletePageId}
          onJump={selectPage}
          onAdd={addPage}
          onReorder={movePageTo}
          onRequestDelete={requestDeletePage}
          onConfirmDelete={confirmDeletePage}
          onCancelDelete={() => setPendingDeletePageId(null)}
          onClose={() => { setPagesOpen(false); setPendingDeletePageId(null); }}
        />
      ) : pagesOpen ? (
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
            tabPageIds={tabPageIds(doc.pages)}
            onCancelDelete={() => setPendingDeletePageId(null)}
            onClose={() => { setPagesOpen(false); setPendingDeletePageId(null); }}
            readOnly={readOnly}
          />
        </div>
      ) : null}

      <InkCanvas
        page={page} pageIndex={pageIndex} readOnly={readOnly} zoom={zoom} fitSize={fitSize} stageRef={stageRef}
        onStageTouchStart={onStageTouchStart} onStageTouchEnd={onStageTouchEnd} clearStageSwipe={clearStageSwipe}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} finishPointer={finishPointer} cancelPointer={cancelPointer}
        textEditing={textEditing} setTextEditing={setTextEditing} selectedTextId={selectedTextId} selectedImageId={selectedImageId}
        renderedStrokes={renderedStrokes} activeStroke={activeStroke} activePath={activePath} pointFromClient={pointFromClient}
        startTextEditing={startTextEditing} commitPageText={commitPageText} startTextResize={startTextResize}
        bumpTextFontSize={bumpTextFontSize} removeText={removeText} deleteSelectedImage={deleteSelectedImage} startImageResize={startImageResize}
      />

      {variant === "desktop" ? (
        <InkFooterDesktop
          doc={doc} page={page} pageIndex={pageIndex} readOnly={readOnly}
          pagesOpen={pagesOpen} setPagesOpen={setPagesOpen} setPendingDeletePageId={setPendingDeletePageId}
          closeSwatches={closeSwatches} switchPage={switchPage} addPage={addPage}
          savePageNote={savePageNote} clearPageNote={clearPageNote}
          onExportPage={onExportPage} exportOpen={exportOpen} setExportOpen={setExportOpen} runExportPage={runExportPage}
          backgrounds={BACKGROUNDS} setBackground={setBackground} isPdfPageBackground={isPdfPageBackground}
          importing={importing} pdfImporting={pdfImporting}
          onImportImages={onImportImages} importImages={importImages} onImportPdf={onImportPdf} importPdf={importPdf}
        />
      ) : !readOnly ? (
        // 移动端底栏（261125 D-06 抽成 InkFooterMobile.tsx，纯搬移）：仅编辑态挂载（阅读态整块不渲染）。
        <InkFooterMobile
          insertOpen={insertOpen} setInsertOpen={setInsertOpen} paletteOpen={paletteOpen} setPaletteOpen={setPaletteOpen} widthsOpen={widthsOpen} setWidthsOpen={setWidthsOpen}
          mode={mode} setMode={setMode} color={color} setColor={setColor} setPenWidth={setPenWidth} setHighlighterWidth={setHighlighterWidth} activeWidth={activeWidth}
          widthPresets={widthPresets} widthDotSize={widthDotSize}
          undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
          page={page} setBackground={setBackground}
          importing={importing} pdfImporting={pdfImporting}
          onImportImages={onImportImages} importImages={importImages} onImportPdf={onImportPdf} importPdf={importPdf}
          insertPageText={insertPageText} insertPageImage={insertPageImage} onInsertPageImage={onInsertPageImage}
        />
      ) : null}

      {readOnly && variant === "desktop" && <div className="ink-readonly-hint">只读</div>}
    </div>
  );
}

export default InkPad;
