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
import { useCallback, useEffect, useRef, useState } from "react";
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
import { SheetFormulaBar } from "./SheetFormulaBar";
import { SheetDock } from "./SheetDock";
import { SheetDockPanel } from "./SheetDockPanel";
import { useSheetKeyboardOpen } from "./useSheetKeyboardOpen";
import { showToast } from "../ui/toastBus";
import { SHEET_ZOOM_LEVELS, type SheetDockId, type SheetMoreId } from "./usheetChromeModel";
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

  /** 编辑态 dock 面板（null = 收起）；面板**占住键盘区域**展开（与文档 dock 一致）。 */
  const [dockPanel, setDockPanel] = useState<SheetDockId | null>(null);
  /** 更多面板内的下钻（数字格式 / 边框 / 公式）。 */
  const [dockSub, setDockSub] = useState<"numfmt" | "border" | "formula" | null>(null);
  const [sheetListAnchor, setSheetListAnchor] = useState<HTMLElement | null>(null);
  /** 公式栏（主输入位）：受控文本（值在获焦/失焦时与单元格同步）。 */
  const [formulaValue, setFormulaValue] = useState("");
  const formulaValueRef = useRef("");
  formulaValueRef.current = formulaValue;
  const formulaInputFocusedRef = useRef(false);
  const keyboardOpen = useSheetKeyboardOpen();
  /** 视图：冻结行列的本机状态（cycle：none → 首行 → 首列）。 */
  const [freezeState, setFreezeState] = useState<"none" | "row" | "col">("none");
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
  const {
    toggleFormatPainter,
    openFindDialog,
    runHistory,
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

  /** 把焦点放回公式栏 → 软键盘随之弹出（用户 261023：点一级 ✕ 就是「恢复键盘」）。 */
  const focusFormulaInput = useCallback(() => {
    window.setTimeout(() => {
      hostRef.current?.querySelector<HTMLInputElement>(".mb-usheet-formula__input")?.focus();
    }, 20);
  }, []);

  const closeDockPanel = useCallback((restoreKeyboard: boolean) => {
    setDockPanel(null);
    setDockSub(null);
    if (restoreKeyboard) {
      setImeSuppressed(false);
      focusFormulaInput();
    }
  }, [setImeSuppressed, focusFormulaInput]);

  const openDockPanel = useCallback((id: SheetDockId) => {
    setDockPanel(id);
    setDockSub(null);
    setImeSuppressed(true);
  }, [setImeSuppressed]);

  const toggleDockPanel = useCallback((id: SheetDockId) => {
    if (dockPanel === id) { closeDockPanel(true); return; }
    openDockPanel(id);
  }, [dockPanel, closeDockPanel, openDockPanel]);

  /** 公式栏提交：写回当前活动单元格（= 公式 / 数字 / 文本），刷新 chrome 并触发自动保存。 */
  const commitFormula = useCallback(() => {
    const api = getUniverAPI();
    const workbook = api?.getActiveWorkbook();
    const range = workbook?.getActiveRange();
    if (!workbook || !range) return;
    const text = formulaValueRef.current;
    try {
      if (text.startsWith("=")) range.setFormula(text);
      else if (text.trim() !== "" && /^-?\d+(\.\d+)?$/.test(text.trim())) range.setValue(Number(text.trim()));
      else range.setValue(text);
      refreshCellFmt();
      scheduleFlush();
    } catch (error) {
      console.warn("[mobile-usheet] 公式栏提交失败", error);
    }
    // ✓ = 确认并收起键盘（原内核公式栏同语义）。
    try { (document.activeElement as HTMLElement | null)?.blur(); } catch { /* 忽略 */ }
  }, [getUniverAPI, refreshCellFmt, scheduleFlush]);

  /** ✕ = 放弃本次输入（恢复单元格原值），并收起键盘。 */
  const cancelFormula = useCallback(() => {
    setFormulaValue(cellFmt.value);
    formulaValueRef.current = cellFmt.value;
    try { (document.activeElement as HTMLElement | null)?.blur(); } catch { /* 忽略 */ }
  }, [cellFmt.value]);

  /** ▲ = 只收起键盘（不提交、不改值）。 */
  const collapseFormulaKeyboard = useCallback(() => {
    try { (document.activeElement as HTMLElement | null)?.blur(); } catch { /* 忽略 */ }
  }, []);

  const onFormulaFocus = useCallback(() => {
    formulaInputFocusedRef.current = true;
    if (dockPanel) closeDockPanel(false);
  }, [dockPanel, closeDockPanel]);

  /** 键盘键：面板开着 = 收面板并放回键盘；键盘开着 = 收起；否则 = 展开。 */
  const onDockKeyboard = useCallback(() => {
    if (dockPanel) { closeDockPanel(true); return; }
    if (keyboardOpen) {
      try { (document.activeElement as HTMLElement | null)?.blur(); } catch { /* 忽略 */ }
      return;
    }
    setImeSuppressed(false);
    focusFormulaInput();
  }, [dockPanel, keyboardOpen, closeDockPanel, setImeSuppressed, focusFormulaInput]);

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
      const range = getUniverAPI()?.getActiveWorkbook()?.getActiveRange();
      if (!range) return;
      try {
        range.setValue(new Date().toLocaleDateString("zh-CN"));
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

  // 选区变化（含点单元格）时同步公式栏；正在输入时不覆盖用户已键入的内容。
  useEffect(() => {
    if (formulaInputFocusedRef.current) return;
    setFormulaValue(cellFmt.value);
  }, [cellFmt.address, cellFmt.value]);

  // 退出编辑态：收起面板（避免面板挂在阅读态上）。
  useEffect(() => {
    if (editing) return;
    setDockPanel(null);
    setDockSub(null);
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
          // formulaBar:false —— 261023 起编辑态用**我们自己的公式栏**（SheetFormulaBar，dock 上方），内核移动公式栏不再挂载。
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



  // 退出编辑态时收起面板（避免面板挂在阅读态上）。
  return (
    <div className={"mobile-usheet" + (editing ? " is-editing" : " is-readonly")} ref={hostRef} data-prevent-swipe>
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
          onAddSheet={() => showToast("移动端暂未支持：新建工作表")}
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
      {editing && ready && (
        <>
          <SheetFormulaBar
            value={formulaValue}
            onChange={setFormulaValue}
            onConfirm={commitFormula}
            onCancel={cancelFormula}
            onCollapse={collapseFormulaKeyboard}
            onFocusInput={onFormulaFocus}
            onBlurInput={() => { formulaInputFocusedRef.current = false; }}
          />
          <SheetDock
            open={dockPanel}
            keyboardOpen={keyboardOpen}
            canUndo
            canRedo
            onToggle={toggleDockPanel}
            onUndo={() => runHistory("undo")}
            onRedo={() => runHistory("redo")}
            onKeyboard={onDockKeyboard}
          />
          {dockPanel && (
            <SheetDockPanel
              open={dockPanel}
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
              onData={handleData}
              onView={handleView}
              onZoom={handleZoomLevel}
              onMore={handleMore}
              onMoreSub={handleMoreSub}
              onSubBack={() => setDockSub(null)}
            />
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
