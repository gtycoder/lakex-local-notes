/**
 * 移动端表格查看/编辑器（kind=usheet）。
 *
 * 与桌面 `src/features/usheet/UniverSheetEditor.tsx` 同一套 Univer 内核。移动端有两种状态：
 * - 阅读态：`setEditable(false)`，不拉起输入法；浏览器焦点落到内部编辑器时直接 blur。
 * - 编辑态：`setEditable(true)`，单元格编辑/粘贴/公式都交给列移动 UI 插件；自动保存走父级
 *   `useAutoSave`（800ms 合并命令），“完成”时通过 onCapture 再同步取一次最新正文，避免最后编辑丢失。
 *
 * 正文仍是内部 JSON（`core/usheetDoc.ts`），绝不喂给 Lake 编辑器；本组件只负责 Univer ↔ JSON。
 * 分包、首次可见才挂载、图片 URL、主题跟随的约束与只读版保持一致。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales, type FUniver, type IPresetPlugin } from "@univerjs/presets";


import type { FWorksheet } from "@univerjs/sheets/facade";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import drawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import sortZhCN from "@univerjs/sheets-sort-ui/locale/zh-CN";
import filterZhCN from "@univerjs/sheets-filter-ui/locale/zh-CN";
import findZhCN from "@univerjs/preset-sheets-find-replace/locales/zh-CN";
import hyperLinkZhCN from "@univerjs/preset-sheets-hyper-link/locales/zh-CN";
import crosshairZhCN from "@univerjs/sheets-crosshair-highlight/locale/zh-CN";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/sheets-crosshair-highlight/lib/index.css";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/sheets-sort-ui/lib/index.css";
import "@univerjs/sheets-filter-ui/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import { UniverFindReplaceMobileUIPlugin } from "@univerjs/find-replace";
import { UniverSheetsFindReplaceMobileUIPlugin } from "@univerjs/sheets-find-replace";
import "@univerjs/sheets-find-replace/facade";
import { buildMobileUniverTheme } from "./mobileUniverTheme";
import { emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody, usheetToBody } from "../../core/usheetDoc.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { SheetPopCard } from "./SheetPopCard";
import { MobileSheetReadingBar } from "./MobileSheetReadingBar";
import { SheetTopBar } from "./SheetTopBar";
import { SheetDock } from "./SheetDock";
import { SheetDockPanel } from "./SheetDockPanel";
import { useKeyboard } from "../hooks/useKeyboard";
import { capturePanelHeight, dockKbOffset } from "../editor/editSurfaceModel";
import { showToast } from "../ui/toastBus";
import { SHEET_PANEL_MIN_HEIGHT, SHEET_ZOOM_LEVELS, sheetPanelNeedsFade, type SheetDockId, type SheetMoreId } from "./usheetChromeModel";
import { createMobileSheetsCorePreset, createMobileSheetsDrawingPreset, createMobileSheetsHyperLinkPreset } from "./mobileUniverPreset";
import { UniverSheetsCrosshairHighlightMobileUIPlugin } from "@univerjs/sheets-crosshair-highlight";
import { setUsheetCrosshair } from "../../features/usheet/usheetCrosshair";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import { createMobileSortFilterPlugins } from "./mobileSortFilter";
import "./usheet-chrome.css";
import { blockFailureMessage, resolveSheetBlock, type SortFilterSheet } from "./usheetSortPlan";
import { useSheetReadFilter, type SheetReadFilterTarget } from "./useSheetReadFilter";
import { useSheetChromeState } from "./useSheetChromeState";
import { useSheetCommandActions } from "./useSheetCommandActions";
import { useNativeSheetFormulaBar } from "./useNativeSheetFormulaBar";

/** 是否带 URL scheme（data:/blob:/http(s): 原样；裸文件名才是我们的资产）。 */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

const AUTOSAVE_DEBOUNCE_MS = 600;

type UniverBook = {
  save: () => unknown;
  setEditable: (value: boolean) => unknown;
};

/** 正文里的图片 source（资产 filename）→ 本机 AssetServer canonical URL（带 token）；已是 URL 的原样。 */
export function usheetImageSrc(src: string, noteId: string): string {
  if (HAS_SCHEME_RE.test(src)) return src;
  return withAssetAccessToken(localAssetHttpUrl(noteId, src));
}

export interface MobileUsheetViewerProps {
  noteId: string;
  content: string;
  /** 该 tab 是否为当前活动 tab（未活动过就不建实例）。 */
  active: boolean;
  /** 阅读 / 编辑。 */
  editing: boolean;
  /** 编辑命令防抖后的正文变化。 */
  onChange: (content: string) => void;
  /** “完成”/关标签前同步取最新正文；null 表示该实例已卸载。 */
  onCapture?: (capture: (() => string | null) | null) => void;
}

export function MobileUsheetViewer({ noteId, content, active, editing, onChange, onCapture }: MobileUsheetViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [everActive, setEverActive] = useState(active);
  const [ready, setReady] = useState(false);
  const containerId = "mobile-usheet-" + noteId;
  const instanceRef = useRef<{ univer: { dispose: () => void }; univerAPI: FUniver; book: UniverBook; last: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const captureCallbackRef = useRef(onCapture);
  captureCallbackRef.current = onCapture;
  const getUniverAPI = useCallback(() => instanceRef.current?.univerAPI ?? null, []);
  /** 十字高亮（⋯ 卡开关）：内核 operation 的纯本机视图状态，默认关、不持久化（重开表格回到关）。 */
  const [crosshairOn, setCrosshairOn] = useState(false);
  const toggleCrosshair = useCallback(() => {
    const api = getUniverAPI();
    if (!api) return;
    const next = !crosshairOn;
    if (setUsheetCrosshair(api, next)) setCrosshairOn(next);
  }, [crosshairOn, getUniverAPI]);

  /** 编辑态 dock 面板状态机（照文档 EditorDock：open/closing/closingHold/panelHeight，覆盖键盘区、滑入滑出）。 */
  const [dockPanel, setDockPanel] = useState<SheetDockId | null>(null);
  const [renderedPanel, setRenderedPanel] = useState<SheetDockId | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelClosing, setPanelClosing] = useState(false);
  const [panelClosingHold, setPanelClosingHold] = useState(false);
  const [panelHeight, setPanelHeight] = useState(300);
  const panelCloseTimerRef = useRef(0);
  const panelFallbackTimerRef = useRef(0);
  /** 更多面板内的下钻（数字格式 / 边框 / 公式）。 */
  const [dockSub, setDockSub] = useState<"numfmt" | "border" | "formula" | null>(null);
  const [sheetListAnchor, setSheetListAnchor] = useState<HTMLElement | null>(null);
  /** 面板内容是否溢出：只由 DOM 实测（滚动余量）驱动，用于底部渐隐提示；放得下/已贴底时不提示。 */
  const panelInnerRef = useRef<HTMLDivElement | null>(null);
  const [panelFade, setPanelFade] = useState(false);
  const { base: shellHeight, innerHeight, offset: edgeToEdgeOffset, height: keyboardHeight, keyboardOpen } = useKeyboard();
  /** 历史最大键盘高：打开面板时若键盘已收起（height=0），也用它捕获面板高度，避免与真键盘高度差出「工具栏跳一下」。 */
  const keyboardHeightRef = useRef(0);
  if (keyboardHeight > keyboardHeightRef.current) keyboardHeightRef.current = keyboardHeight;
  /** 视图：冻结行列的本机状态（cycle：none → 首行 → 首列）。 */
  const [freezeState, setFreezeState] = useState<"none" | "row" | "col">("none");
  /** 撤销/重做可用态（内核没有公开的 canUndo，这里按命令流维护近似深度）。 */
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  /** 撤销/重做回放期间抑制「新编辑」计数（内核回放的是原命令 id，会把 undo 误当新编辑）。 */
  const historySuppressUntilRef = useRef(0);
  const {
    cellFormat: cellFmt,
    sheets,
    activeSheetId,
    zoomPercent,
    setPainterStatus,
    refreshCellFormat: refreshCellFmt,
    refreshSheetChrome,
    selectSheet,
    zoomBy,
  } = useSheetChromeState(getUniverAPI);
  const { nativeEditing, nativeExpanded, caretRef, openNativeEditor, closeNativeEditor } = useNativeSheetFormulaBar({
    editing,
    hostRef,
    address: cellFmt.address,
    getUniverAPI,
  });
  const {
    toggleFormatPainter,
    openFindDialog,
    dispatchMenu,
  } = useSheetCommandActions({
    editing,
    getUniverAPI,
    refreshCellFormat: refreshCellFmt,
  });
  /** 排序/筛选共用的「数据块」读取口（只读值，不改任何东西）。 */
  const sheetAccessor = useCallback((sheet: FWorksheet): SortFilterSheet => ({
    maxRows: sheet.getMaxRows(),
    maxColumns: sheet.getMaxColumns(),
    getValue: (row, column) => sheet.getRange(row, column).getValue(),
  }), []);
  const getReadFilterTarget = useCallback((): { ok: true; target: SheetReadFilterTarget } | { ok: false; reason?: string } => {
    const state = instanceRef.current;
    const workbook = state?.univerAPI.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange();
    if (!state || !workbook || !sheet || !range) return { ok: false };
    const resolved = resolveSheetBlock(
      { startRow: range.getRow(), endRow: range.getLastRow(), startColumn: range.getColumn(), endColumn: range.getLastColumn() },
      sheetAccessor(sheet),
    );
    if (!resolved.ok) return { ok: false, reason: blockFailureMessage(resolved.reason) };
    return {
      ok: true,
      target: {
        api: state.univerAPI as unknown as SheetReadFilterTarget["api"],
        unitId: workbook.getId(),
        subUnitId: sheet.getSheetId(),
        column: range.getColumn(),
        block: resolved.block,
      },
    };
  }, [sheetAccessor]);
  const {
    active: readFilterActive,
    availability: readFilterAvailable,
    apply: applyReadFilter,
    restore: restoreReadFilter,
  } = useSheetReadFilter({ content, getTarget: getReadFilterTarget });

  /** 同步取最新正文；只有真的变更才通知外层。 */
  const capture = useCallback((): string | null => {
    // 读态本机筛选绝不落盘：先把运行时筛选摘掉，再取正文（见 usheetReadFilter.ts）。
    restoreReadFilter();
    const state = instanceRef.current;
    if (!state) return null;
    try {
      const body = usheetToBody(state.book.save() as never);
      if (body !== state.last) {
        state.last = body;
        changeRef.current(body);
      }
      return body;
    } catch {
      return null;
    }
  }, [restoreReadFilter]);

  const scheduleFlush = useCallback(() => {
    if (!editingRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      capture();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [capture]);

  /** 内核命令后的 chrome 刷新：用 rAF 合并（一次交互可能连发多条命令，别每条都跑一遍 facade 读取）。 */
  const chromeRafRef = useRef(0);
  const scheduleChromeRefresh = useCallback(() => {
    if (chromeRafRef.current) return;
    chromeRafRef.current = window.requestAnimationFrame(() => {
      chromeRafRef.current = 0;
      refreshCellFmt();
      refreshSheetChrome();
    });
  }, [refreshCellFmt, refreshSheetChrome]);

  /** 收起/放回输入法：面板占键盘区期间加 inputmode=none + blur/focus（与文档 dock 同一实测口径）。 */
  const setImeSuppressed = useCallback((on: boolean) => {
    const host = hostRef.current;
    if (!host) return;
    if (on) {
      const active = document.activeElement as HTMLElement | null;
      if (active && host.contains(active)) {
        // 只加 inputmode=none + blur：**不回焦**（回焦会触发公式栏 onFocus，反过来把刚打开的面板关掉）。
        active.setAttribute("inputmode", "none");
        try { active.blur(); } catch { /* 忽略 */ }
      }
    } else {
      host.querySelectorAll<HTMLElement>('[inputmode="none"]').forEach((el) => el.removeAttribute("inputmode"));
    }
  }, []);


  const finishPanelClose = useCallback(() => {
    if (panelCloseTimerRef.current) { window.clearTimeout(panelCloseTimerRef.current); panelCloseTimerRef.current = 0; }
    if (panelFallbackTimerRef.current) { window.clearTimeout(panelFallbackTimerRef.current); panelFallbackTimerRef.current = 0; }
    setPanelClosing(false);
    setPanelClosingHold(false);
    setRenderedPanel(null);
  }, []);

  /** 收面板：restore = 放回键盘（用户定稿：一级 ✕ 就是恢复键盘）。内容保持到键盘盖住（closingHold）再撤。 */
  const closeDockPanel = useCallback((restoreKeyboard: boolean) => {
    setDockPanel(null);
    setDockSub(null);
    setPanelOpen(false);
    setImeSuppressed(false);
    if (!restoreKeyboard) { finishPanelClose(); return; }
    setPanelClosing(true);
    setPanelClosingHold(true);
    openNativeEditor();
    if (panelFallbackTimerRef.current) window.clearTimeout(panelFallbackTimerRef.current);
    panelFallbackTimerRef.current = window.setTimeout(finishPanelClose, 1800);
  }, [setImeSuppressed, openNativeEditor, finishPanelClose]);

  const openDockPanel = useCallback((id: SheetDockId) => {
    if (panelCloseTimerRef.current) { window.clearTimeout(panelCloseTimerRef.current); panelCloseTimerRef.current = 0; }
    if (panelFallbackTimerRef.current) { window.clearTimeout(panelFallbackTimerRef.current); panelFallbackTimerRef.current = 0; }
    setDockPanel(id);
    setDockSub(null);
    setRenderedPanel(id);
    setPanelOpen(true);
    setPanelClosing(false);
    setPanelClosingHold(false);
    setImeSuppressed(true);
    closeNativeEditor();
    // 面板高度 = 打开时捕获的键盘区高度（照文档 capturePanelHeight；优先用历史实测键盘高）。
    // 表格面板下限用 SHEET_PANEL_MIN_HEIGHT（280 放不下「更多」7 行 / T 面板 ⇒ 阅读→编辑→直接开面板会被裁）。
    setPanelHeight(capturePanelHeight(Math.max(keyboardHeight, keyboardHeightRef.current), SHEET_PANEL_MIN_HEIGHT));
  }, [setImeSuppressed, closeNativeEditor, keyboardOpen, keyboardHeight]);

  const toggleDockPanel = useCallback((id: SheetDockId) => {
    if (dockPanel === id) { closeDockPanel(true); return; }
    openDockPanel(id);
  }, [dockPanel, closeDockPanel, openDockPanel]);

  /** 量一次面板的滚动余量（面板高度 = 键盘区，随设备/键盘高度变化）。 */
  const measurePanelFade = useCallback(() => {
    const inner = panelInnerRef.current;
    if (!inner) return;
    const next = sheetPanelNeedsFade({ scrollTop: inner.scrollTop, clientHeight: inner.clientHeight, scrollHeight: inner.scrollHeight });
    setPanelFade((prev) => (prev === next ? prev : next));
  }, []);

  // 换面板 / 下钻时回到顶部并重新量；两帧 + 220ms 兜底覆盖「面板展开过渡」。放得下就不提示。
  useLayoutEffect(() => {
    if (!renderedPanel) {
      setPanelFade(false);
      return;
    }
    const inner = panelInnerRef.current;
    if (inner) inner.scrollTop = 0;
    const raf = window.requestAnimationFrame(measurePanelFade);
    const timer = window.setTimeout(measurePanelFade, 220);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [renderedPanel, dockSub, panelOpen, measurePanelFade]);

  /** 键盘键：面板开着 = 收面板并放回键盘；键盘开着 = 收起；否则 = 展开。 */
  const onDockKeyboard = useCallback(() => {
    if (dockPanel) { closeDockPanel(true); return; }
    if (keyboardOpen) {
      try { (document.activeElement as HTMLElement | null)?.blur(); } catch { /* 忽略 */ }
      return;
    }
    setImeSuppressed(false);
    openNativeEditor();
  }, [dockPanel, keyboardOpen, closeDockPanel, setImeSuppressed, openNativeEditor]);

  /** 撤销/重做：无历史时给提示（撤销/重做按钮的可用态由 undoDepth/redoDepth 控制）。 */
  const handleUndo = useCallback(() => {
    if (undoDepth <= 0) { showToast("没有可撤销的操作"); return; }
    // 乐观计数：内核没有公开 canUndo；回放期间的命令用抑制窗口过滤。
    historySuppressUntilRef.current = Date.now() + 400;
    setUndoDepth((value) => Math.max(0, value - 1));
    setRedoDepth((value) => value + 1);
    try { getUniverAPI()?.getActiveWorkbook()?.undo(); } catch { /* 忽略 */ }
  }, [undoDepth, getUniverAPI]);

  const handleRedo = useCallback(() => {
    if (redoDepth <= 0) { showToast("没有可重做的操作"); return; }
    historySuppressUntilRef.current = Date.now() + 400;
    setUndoDepth((value) => value + 1);
    setRedoDepth((value) => Math.max(0, value - 1));
    try { getUniverAPI()?.getActiveWorkbook()?.redo(); } catch { /* 忽略 */ }
  }, [redoDepth, getUniverAPI]);

  /** 新建工作表（顶部行 ＋）：插入一张新表并切过去。 */
  const onAddSheet = useCallback(() => {
    const workbook = getUniverAPI()?.getActiveWorkbook();
    if (!workbook) return;
    try {
      // 命名沿用 SheetN（默认 insertSheet() 会按 locale 叫「工作表N」，与已有 Sheet1 不一致）。
      const names = workbook.getSheets().map((sheet) => sheet.getSheetName());
      const maxIndex = names.reduce((max, name) => {
        const match = /^Sheet(\d+)$/.exec(name);
        return match ? Math.max(max, Number(match[1])) : max;
      }, names.length);
      const created = workbook.insertSheet("Sheet" + (maxIndex + 1));
      selectSheet(created.getSheetId());
    } catch (error) {
      console.warn("[mobile-usheet] 新建工作表失败", error);
      showToast("新建工作表失败");
    }
  }, [getUniverAPI, selectSheet]);

  const onCycleZoom = useCallback(() => {
    const levels = SHEET_ZOOM_LEVELS.map((level) => level.value * 100);
    const next = levels.find((level) => level > zoomPercent + 0.5) ?? levels[0];
    zoomBy((next - zoomPercent) / 100);
  }, [zoomPercent, zoomBy]);

  const handleInsert = useCallback((id: string) => {
    if (id === "row-above" || id === "row-below" || id === "col-left" || id === "col-right" || id === "link") {
      dispatchMenu(id);
      return;
    }
    if (id === "date") {
      const workbook = getUniverAPI()?.getActiveWorkbook();
      const range = workbook?.getActiveRange();
      if (!workbook || !range) return;
      try {
        // 同上：只写活动单元格，避免多选时整片被日期覆盖。
        workbook.getActiveSheet().getRange(range.getRow(), range.getColumn()).setValue(new Date().toLocaleDateString("zh-CN"));
        refreshCellFmt();
        scheduleFlush();
      } catch { /* 忽略 */ }
      return;
    }
    const label = id === "image" ? "单元格图片" : id === "sign" ? "手写签名" : id === "attachment" ? "附件" : id === "chart" ? "图表" : "批注";
    showToast("移动端暂未支持：" + label);
  }, [dispatchMenu, getUniverAPI, refreshCellFmt, scheduleFlush]);

  const handleData = useCallback((id: string) => {
    if (id === "sort-asc" || id === "sort-desc" || id === "filter") { dispatchMenu(id); return; }
    if (id === "find") { openFindDialog(); return; }
    showToast("移动端暂未支持：" + (id === "validation" ? "数据验证" : "分列"));
  }, [dispatchMenu, openFindDialog]);

  const handleView = useCallback((id: string) => {
    if (id !== "freeze") { showToast("移动端暂未支持：" + (id === "formview" ? "表单视图" : "图表视图")); return; }
    const next = freezeState === "none" ? "row" : freezeState === "row" ? "col" : "none";
    setFreezeState(next);
    const sheet = getUniverAPI()?.getActiveWorkbook()?.getActiveSheet();
    if (!sheet) return;
    try {
      const target = sheet as unknown as { setFrozenRows?: (n: number) => unknown; setFrozenColumns?: (n: number) => unknown };
      target.setFrozenRows?.(next === "row" ? 1 : 0);
      target.setFrozenColumns?.(next === "col" ? 1 : 0);
      refreshSheetChrome();
    } catch { /* 忽略 */ }
  }, [freezeState, getUniverAPI, refreshSheetChrome]);

  const handleZoomLevel = useCallback((value: number) => {
    const delta = value - zoomPercent / 100;
    if (Math.abs(delta) < 0.001) return;
    zoomBy(delta);
  }, [zoomPercent, zoomBy]);

  const handleMore = useCallback((id: SheetMoreId) => {
    if (id === "numfmt" || id === "border" || id === "formula") { setDockSub(id); return; }
    if (id === "merge") { dispatchMenu("merge"); return; }
    if (id === "painter") { toggleFormatPainter(); return; }
    if (id === "clear") { dispatchMenu("clear-style"); return; }
    showToast("移动端暂未支持：条件格式");
  }, [dispatchMenu, toggleFormatPainter]);

  const handleMoreSub = useCallback((id: string) => {
    dispatchMenu(id);
  }, [dispatchMenu]);

  // 键盘盖住面板区后，再把面板内容撤掉（文档 dock 的 closingHold 同款；避免「面板先消失、键盘还没升」的闪烁）。
  useEffect(() => {
    if (!panelClosing) return;
    if (!keyboardOpen) return;
    if (panelCloseTimerRef.current) window.clearTimeout(panelCloseTimerRef.current);
    panelCloseTimerRef.current = window.setTimeout(finishPanelClose, 240);
    return () => { if (panelCloseTimerRef.current) { window.clearTimeout(panelCloseTimerRef.current); panelCloseTimerRef.current = 0; } };
  }, [panelClosing, keyboardOpen, finishPanelClose]);

  // 编辑态**双击单元格** → 自动把焦点放到公式栏输入框（光标在末尾），接着打字就进公式栏。
  // 自实现双击（触屏 WebView 对 canvas 的 dblclick 不可靠）：320ms / 28px 内两次 **pointerdown** 视为双击。
  // 第二下 pointerdown 直接 preventDefault + stopPropagation：不让内核起 in-cell 编辑器抢焦点，并在同一手势里聚焦公式栏（键盘随之弹起）。
  useEffect(() => {
    if (!editing) return;
    const host = hostRef.current;
    if (!host) return;
    let lastTap = { at: 0, x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(".mobile-usheet-root")) return;
      const now = Date.now();
      if (now - lastTap.at < 320 && Math.abs(event.clientX - lastTap.x) < 28 && Math.abs(event.clientY - lastTap.y) < 28) {
        lastTap = { at: 0, x: 0, y: 0 };
        event.preventDefault();
        event.stopPropagation();
        openNativeEditor();
        return;
      }
      lastTap = { at: now, x: event.clientX, y: event.clientY };
    };
    host.addEventListener("pointerdown", onPointerDown, true);
    return () => host.removeEventListener("pointerdown", onPointerDown, true);
  }, [editing, openNativeEditor]);

  // 退出编辑态：收起面板（避免面板挂在阅读态上）。
  useEffect(() => {
    if (editing) return;
    setDockPanel(null);
    setDockSub(null);
    setPanelOpen(false);
    setPanelClosing(false);
    setPanelClosingHold(false);
    setRenderedPanel(null);
  }, [editing]);

  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);


  // 首次可见 + 容器有高度后才挂载（隐藏容器 0 尺寸 ⇒ canvas 引擎渲不出来）
  useEffect(() => {
    if (!everActive || ready || !active) return;
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const measure = () => {
      if (host.clientHeight === 0) { raf = window.requestAnimationFrame(measure); return; }
      setReady(true);
    };
    measure();
    return () => { if (raf) window.cancelAnimationFrame(raf); };
  }, [everActive, ready, active]);

  // 一个 tab 一个实例；只读/编辑通过 setEditable 切换，不重建实例。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const host = hostRef.current;
    if (!ready || !host) return;
    const workbook = parseUsheetBody(content)?.workbook ?? emptyUsheetWorkbook();
    mapUsheetImageSources(workbook, (src) => usheetImageSrc(src, noteId));
    let created: { univer: { dispose: () => void }; univerAPI: FUniver; book: UniverBook } | null = null;
    const disposables: Array<{ dispose: () => void }> = [];
    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: {
          [LocaleType.ZH_CN]: mergeLocales(zhCN as never, drawingZhCN as never, sortZhCN as never, filterZhCN as never, findZhCN as never, hyperLinkZhCN as never, crosshairZhCN as never),
        },
        // 移动端专用画布主题：共用主题 + 语雀对齐覆盖（桌面那份不动，见 mobileUniverTheme.ts）。
        theme: buildMobileUniverTheme() as never,
        presets: [
          // 只读与编辑都使用移动 UI 插件族（单指横滑 = 滚动画布）；公式栏/工作表栏/缩放保留，
          // 顶部的自有工具条由本组件渲染（Yuque 式常驻操作栏），官方底部动作面板仍可从浮动按钮打开。
          // formulaBar:false —— 桌面公式栏不挂；移动端原生公式栏由 UniverSheetsMobileUIPlugin 单独挂（261025 起作为编辑输入面）。
          createMobileSheetsCorePreset({ container: containerId, disableAutoFocus: true, toolbar: false, formulaBar: false }),
          createMobileSheetsDrawingPreset(),
          // 261021 P5：排序 / 筛选（数据插件双端一致；UI 取移动变体，入口是我们自己画的 ⋯ 卡）。
          { plugins: createMobileSortFilterPlugins() },
          // 261021 P5：查找替换 —— 移动端只装移动变体（sheets 适配器也取 Mobile 版，依赖 UniverSheetsMobileUIPlugin）。
          { plugins: [[UniverFindReplaceMobileUIPlugin], [UniverSheetsFindReplaceMobileUIPlugin]] as unknown as IPresetPlugin[] },
          // 261022 P1：超链接（移动 UI 变体；链接点击 → window.open，由系统浏览器接管）。
          createMobileSheetsHyperLinkPreset({ urlHandler: { navigateToOtherWebsite: (url) => { window.open(url, "_blank", "noopener"); } } }),
          // 备注（桌面专属 UI）：移动端**必须**装数据插件，否则保存时会把桌面写入的 note plugin resource 丢掉。
          // 顺序与桌面保持一致（hyperlink → note → crosshair），避免两端 resources 数组顺序不同造成假冲突。
          { plugins: [UniverSheetsNotePlugin] as unknown as IPresetPlugin[] },
          // 261022 晚：十字高亮插件仍装（开关可用），但**默认关闭**（内核初始即关，不再自动开启）。
          { plugins: [UniverSheetsCrosshairHighlightMobileUIPlugin] as unknown as IPresetPlugin[] },
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never) as unknown as UniverBook;
      book.setEditable(editingRef.current);
      // 261022 晚：十字高亮**默认关闭**（内核初始即关；需要时点 ⋯ →「十字高亮」开，纯本机视图）。
      const last = usheetToBody(book.save() as never);
      created = { univer, univerAPI, book };
      instanceRef.current = { ...created, last };
      disposables.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
        // 格式刷状态由内核 operation 回填（点目标套用后会自动回 0）——不靠前端猜，也不自建第二套状态。
        if (event?.id === "sheet.operation.set-format-painter") {
          setPainterStatus((event.params as { status?: number } | undefined)?.status ?? 0);
        }
        // 撤销/重做可用态：undo/redo 自身反向计数，其余「非视图类命令」记一次可撤销。
        // 撤销/重做回放期间不记「新编辑」（回放的是原命令 id）。
        const commandId = String(event?.id ?? "");
        if (Date.now() >= historySuppressUntilRef.current && commandId && !/selection|zoom|crosshair|format-painter|scroll|frozen/i.test(commandId)) {
          setUndoDepth((value) => value + 1);
          setRedoDepth(0);
        }
        scheduleFlush();
        scheduleChromeRefresh();
      }));
      // 选中单元格（点 canvas / 方向键）后刷新公式栏地址与值：CommandExecuted 已经覆盖，这里补一次初始同步。
      refreshCellFmt();
      refreshSheetChrome();
    } catch (error) {
      console.error("移动端表格挂载失败", error);
    }
    const observer = new MutationObserver(() => {
      try { created?.univerAPI.setTheme(buildMobileUniverTheme() as never); } catch { /* ignore */ }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      if (chromeRafRef.current) { window.cancelAnimationFrame(chromeRafRef.current); chromeRafRef.current = 0; }
      capture();
      for (const item of disposables) { try { item.dispose(); } catch { /* ignore */ } }
      observer.disconnect();
      try { created?.univer.dispose(); } catch { /* ignore */ }
      instanceRef.current = null;
      captureCallbackRef.current?.(null);
    };
  }, [ready, noteId, scheduleFlush, refreshCellFmt, refreshSheetChrome]);

  // 编辑/阅读切换；从编辑切回阅读时同步落一次，避免防抖窗口内点“完成”丢最后修改。
  useEffect(() => {
    const state = instanceRef.current;
    // 读态本机筛选绝不能被"切回编辑态"带走：先还原，再切换可编辑性。
    if (editing) restoreReadFilter();
    if (state) {
      try { state.book.setEditable(editing); } catch { /* ignore */ }
    }
    if (!editing) {
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      capture();
    }
  }, [editing, capture, restoreReadFilter]);

  // 切走 tab 时落一次；不要求关掉编辑态（编辑态可随 tab 保留）。
  useEffect(() => {
    if (!active) capture();
  }, [active, capture]);

  // 把同步 capture 交给父级：“完成”/关标签时现取，不依赖 600ms 防抖。
  useEffect(() => {
    captureCallbackRef.current?.(capture);
    return () => captureCallbackRef.current?.(null);
  }, [capture]);

  // 阅读态挡焦点：Univer 内部 `div[contenteditable]` 会自己拿焦点并拉起输入法。
  useEffect(() => {
    if (!ready || editing) return;
    const host = hostRef.current;
    if (!host) return;
    const block = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target !== host && target.closest?.("[contenteditable='true']")) target.blur();
    };
    host.addEventListener("focusin", block);
    const current = document.activeElement as HTMLElement | null;
    if (current && host.contains(current)) current.blur();
    return () => host.removeEventListener("focusin", block);
  }, [ready, editing]);



  // 底部几何（照文档 dock：kbOffset 给 fixed 工具条与面板定位；与键盘/面板过渡同步，不跳）。
  const kbOffset = dockKbOffset({
    panelOpen: !!dockPanel,
    closing: panelClosing,
    innerHeight,
    shellHeight,
    panelHeight,
    edgeToEdgeOffset,
  });
  /**
   * 面板⇄键盘过渡的一帧补丁：useKeyboard 的 React 状态会比 WebView 视口晚一帧，
   * 这一帧里 spacer 已按新视口收窄、--mb-usheet-kb-offset 还是旧值 ⇒ 根高 342→30→342、
   * 公式栏/dock 瞬移（真机实测 ~50ms 的跳动闪烁）。用实时 innerHeight 直接写变量兜住这一帧。
   */
  const geometryRef = useRef({ panelOpen: false, closing: false, panelHeight: 0, shellHeight: 0, edge: 0 });
  geometryRef.current = {
    panelOpen: !!dockPanel,
    closing: panelClosing,
    panelHeight,
    shellHeight,
    edge: edgeToEdgeOffset,
  };
  const applyGeometry = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const g = geometryRef.current;
    const offset = dockKbOffset({
      panelOpen: g.panelOpen,
      closing: g.closing,
      innerHeight: window.innerHeight,
      shellHeight: g.shellHeight,
      panelHeight: g.panelHeight,
      edgeToEdgeOffset: g.edge,
    });
    host.style.setProperty("--mb-usheet-kb-offset", offset + "px");
  }, []);
  // 每次渲染后（layout 阶段、paint 前）都用**实时** innerHeight 覆写变量：
  // 不再由 React 内联 style 写旧值（那正是慢一帧、把刚写对的值又覆盖回去的来源）。
  useLayoutEffect(() => {
    if (editing) applyGeometry();
  });
  useLayoutEffect(() => {
    if (!editing) return;
    const onResize = () => applyGeometry();
    window.addEventListener("resize", onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [editing, applyGeometry]);
  /**
   * 选中区域被键盘/展开的工具栏盖住时才滚动，且只滚到"刚好露出来"：
   * 用内核的 scroll-to-cell（目标已在视口内 = no-op；在视口外才最小滚动）。
   * 不用 facade 的 scrollToCell —— 它把目标钉到视口左上角（用户反馈"不是固定在左上角"）。
   */
  const ensureActiveCellVisible = useCallback(() => {
    const api = getUniverAPI();
    const workbook = api?.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange();
    if (!api || !workbook || !sheet || !range) return;
    try {
      void api.executeCommand("sheet.command.scroll-to-cell", {
        unitId: workbook.getId(),
        range: {
          startRow: range.getRow(),
          endRow: range.getLastRow(),
          startColumn: range.getColumn(),
          endColumn: range.getLastColumn(),
        },
        forceTop: false,
        forceLeft: false,
      });
    } catch { /* 忽略 */ }
  }, [getUniverAPI]);

  // 几何变化（展开多行 / 面板开合 / 键盘）后让内核按**真实可视区**重算：
  // Univer 挂载时把自己的根 div 写成固定 px 高（654），键盘弹起后它不会跟随容器缩到 342；
  // 必须把它改回 100%，否则内核以为视口还很高（选中格判定"已可见"、实际被工具栏盖住）。
  useEffect(() => {
    if (!ready) return;
    const fitUniverViewport = () => {
      const wrapper = hostRef.current?.querySelector<HTMLElement>(".mobile-usheet-root > .univer-relative");
      if (wrapper) wrapper.style.height = "100%";
    };
    fitUniverViewport();
    let settle = 0;
    const raf = window.requestAnimationFrame(() => {
      fitUniverViewport();
      window.dispatchEvent(new Event("resize"));
      settle = window.setTimeout(ensureActiveCellVisible, 120);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (settle) window.clearTimeout(settle);
    };
  }, [ready, kbOffset, keyboardOpen, innerHeight, ensureActiveCellVisible]);

  // 选区变化（点格/命令改选区）后把活动格滚进可视区；只在地址变化时滚，不打断用户自由滚动。
  useEffect(() => {
    if (!ready || !editing) return;
    const raf = window.requestAnimationFrame(ensureActiveCellVisible);
    return () => window.cancelAnimationFrame(raf);
  }, [ready, editing, cellFmt.address, ensureActiveCellVisible]);

  // 退出编辑态时收起面板（避免面板挂在阅读态上）。
  useEffect(() => {
    if (editing) return;
    setDockPanel(null);
    setDockSub(null);
    setPanelOpen(false);
    setPanelClosing(false);
    setPanelClosingHold(false);
    setRenderedPanel(null);
  }, [editing]);
  return (
    <div
      className={"mobile-usheet" + (editing ? " is-editing" : " is-readonly")}
      ref={hostRef}
      data-prevent-swipe
    >
      {ready && (
        <SheetTopBar
          sheets={sheets}
          activeId={activeSheetId}
          zoom={zoomPercent}
          crosshairOn={crosshairOn}
          onSelect={selectSheet}
          onOpenList={(anchor) => setSheetListAnchor(anchor)}
          onCycleZoom={onCycleZoom}
          onToggleCrosshair={toggleCrosshair}
          onAddSheet={onAddSheet}
        />
      )}
      {!editing && ready && (
        <MobileSheetReadingBar
          filterEnabled={readFilterAvailable.enabled}
          filterDisabledReason={readFilterAvailable.reason}
          filterActive={readFilterActive}
          onFilter={applyReadFilter}
          onSearch={openFindDialog}
        />
      )}
      {ready ? <div id={containerId} className="mobile-usheet-root" /> : <div className="mb-empty">正在加载表格…</div>}
      {editing && ready && <div className="mb-usheet-chrome-spacer" aria-hidden="true" />}
      {editing && <span ref={caretRef} className="mb-usheet-caret" aria-hidden="true" />}
      {editing && ready && (
        <>
          {!nativeEditing && !nativeExpanded && !dockPanel && (
            <button type="button" className="mb-usheet-fbar" aria-label="编辑单元格" onClick={() => openNativeEditor()}>
              <span className="mb-usheet-fbar__addr">{cellFmt.address}</span>
              <span className="mb-usheet-fbar__value">{cellFmt.value}</span>
            </button>
          )}
          <SheetDock
            open={dockPanel}
            keyboardOpen={keyboardOpen}
            canUndo={undoDepth > 0}
            canRedo={redoDepth > 0}
            onToggle={toggleDockPanel}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onKeyboard={onDockKeyboard}
          />
          {renderedPanel && (
            <div
              className="mb-usheet-panel"
              data-kind={renderedPanel}
              data-open={panelOpen || panelClosingHold ? "1" : "0"}
              data-closing={panelClosing ? "1" : undefined}
              data-scrollable={panelFade ? "1" : undefined}
              style={{ ["--mb-usheet-panel-h" as string]: panelHeight + "px" }}
              aria-hidden={!panelOpen}
            >
              <div className="mb-usheet-panel__inner" ref={panelInnerRef} onScroll={measurePanelFade}>
                <SheetDockPanel
              open={renderedPanel}
              fmt={cellFmt}
              filterOn={false}
              freeze={freezeState}
              zoom={zoomPercent}
              sub={dockSub}
              onInsert={handleInsert}
              onFormat={(id) => dispatchMenu(id)}
              onAlignH={(value) => dispatchMenu("align-" + value)}
              onAlignV={(value) => dispatchMenu("valign-" + value)}
              onFontColor={(value) => dispatchMenu(value ? "font-" + value : "font-default")}
              onFill={(value) => dispatchMenu(value ? "fill-" + value : "fill-none")}
              onFontSize={(size) => dispatchMenu("fontsize-" + size)}
              onClearFormat={() => dispatchMenu("clear-style")}
              onData={handleData}
              onView={handleView}
              onZoom={handleZoomLevel}
              onMore={handleMore}
                  onMoreSub={handleMoreSub}
                  onSubBack={() => setDockSub(null)}
                />
              </div>
            </div>
          )}
        </>
      )}
      {ready && sheetListAnchor && (
        <SheetPopCard
          host={hostRef.current}
          anchor={sheetListAnchor}
          placement="below"
          width={172}
          ariaLabel="工作表列表"
          items={sheets.map((sheet) => ({ id: sheet.id, label: sheet.name, note: sheet.id === activeSheetId ? "当前" : undefined }))}
          onSelect={(id) => { setSheetListAnchor(null); selectSheet(id); }}
          onClose={() => setSheetListAnchor(null)}
        />
      )}
    </div>
  );
}

export default MobileUsheetViewer;
