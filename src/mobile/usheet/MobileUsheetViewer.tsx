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
import { ChevronDown, Eraser, MoreHorizontal, Paintbrush, Plus, Redo2, Undo2 } from "lucide-react";
import { createUniver, DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, LocaleType, mergeLocales, type FUniver, type IPresetPlugin } from "@univerjs/presets";
import { DocSelectionRenderService, IRenderManagerService } from "@univerjs/preset-sheets-core";
import type { FRange, FWorkbook, FWorksheet } from "@univerjs/sheets/facade";
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
import { editorCaretPoint } from "../../features/usheet/usheetCellEdit";
import { emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody, usheetToBody } from "../../core/usheetDoc.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { SheetPopCard } from "./SheetPopCard";
import { SheetMoreCard } from "./SheetMoreCard";
import { MobileSheetFooter } from "./MobileSheetFooter";
import { MobileSheetReadingBar } from "./MobileSheetReadingBar";
import {
  SHEET_CARD_META,
  SHEET_TOOLBAR_GROUPS,
  buildInsertMenu,
  buildMoreRows,
  buildNumfmtMenu,
  numfmtLabelOf,
} from "./usheetChromeModel";
import { showToast } from "../ui/toastBus";
import { createMobileSheetsCorePreset, createMobileSheetsDrawingPreset, createMobileSheetsHyperLinkPreset } from "./mobileUniverPreset";
import { UniverSheetsCrosshairHighlightMobileUIPlugin } from "@univerjs/sheets-crosshair-highlight";
import { enableUsheetCrosshair, USHEET_CROSSHAIR_COMMANDS } from "../../features/usheet/usheetCrosshair";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import { createMobileSortFilterPlugins } from "./mobileSortFilter";
import "./usheet-chrome.css";
import { USHEET_LAYOUT_ACTIONS, applyUsheetLayoutAction } from "./usheetLayoutActions";
import { USHEET_NUMFMT_IDS, applyUsheetNumberFormat } from "./usheetNumfmt";
import { USHEET_QUICK_FORMULA_IDS, planUsheetQuickFormula } from "./usheetFormulaQuick";
import { decimalStepMessage, stepNumberFormatDecimals } from "./usheetDecimals";
import { USHEET_BORDER_IDS, applyUsheetBorder } from "./usheetBorders";
import { blockFailureMessage, planSortRange, resolveSheetBlock, type SortFilterSheet } from "./usheetSortPlan";
import { useSheetCardState } from "./useSheetCardState";
import { useSheetReadFilter, type SheetReadFilterTarget } from "./useSheetReadFilter";
import { useSheetChromeState } from "./useSheetChromeState";

/**
 * 移动端公式栏的点击落点（261021）：Univer 的移动公式栏把输入面做成 canvas + 隐藏 contenteditable，
 * 并且 FormulaEditor 显式传了 `disableSelectionOnClick: true` ⇒ 点文字中间不会更新选区，光标只能停在末尾。
 * 这里在 pointerup 后按点击坐标调用文档渲染单元的 setCursorManually，恢复「点哪落哪」。
 * 只作用在公式栏编辑器内（不碰表格 canvas / 按钮），失败静默退回原行为。
 */
function placeFormulaBarCaret(
  state: { univer: { dispose: () => void } },
  clientX: number,
  clientY: number,
): void {
  try {
    const univer = state.univer as unknown as { __getInjector?: () => { get: (token: unknown) => unknown } };
    const injector = univer.__getInjector?.();
    const renderManager = injector?.get(IRenderManagerService) as
      | { getRenderUnitById: (id: string) => unknown }
      | undefined;
    const renderUnit = renderManager?.getRenderUnitById(DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY) as
      | { with: (token: unknown) => unknown }
      | undefined;
    const selection = renderUnit?.with(DocSelectionRenderService) as
      | {
          focus: () => void;
          setCursorManually: (x: number, y: number, a: boolean, b: boolean, o: { strict: boolean }) => void;
        }
      | undefined;
    const editorEl = document.querySelector<HTMLElement>(
      '[data-u-comp="mobile-formula-bar"] [data-u-comp="formula-editor"]',
    );
    const rect = editorEl?.getBoundingClientRect();
    if (!selection || !editorEl || !rect || rect.width <= 0 || rect.height <= 0) return;
    const canvas = editorEl.querySelector<HTMLCanvasElement>("canvas");
    const cssWidth = Number.parseFloat(canvas?.style.width ?? "") || rect.width;
    const cssHeight = Number.parseFloat(canvas?.style.height ?? "") || rect.height;
    const point = editorCaretPoint(clientX, clientY, rect, cssWidth, cssHeight);
    selection.focus();
    selection.setCursorManually(point.x, point.y, true, true, { strict: false });
  } catch { /* 内核结构变化时静默退回 */ }
}

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

  /** 顶部工具条弹出的原生面板：插入 / 文字格式 / 更多。 */
  /** 当前打开的锚定卡片（null = 无）；anchor = 触发按钮（卡片锚在它下方）。 */
  const {
    openCard,
    cardAnchor,
    sheetListAnchor,
    closeCard,
    toggleCard,
    openSheetList,
    closeSheetList,
  } = useSheetCardState({ active, editing });
  const {
    cellFormat: cellFmt,
    sheets,
    activeSheetId,
    zoomPercent,
    painterStatus,
    setPainterStatus,
    refreshCellFormat: refreshCellFmt,
    refreshSheetChrome,
    selectSheet,
    zoomBy,
  } = useSheetChromeState(getUniverAPI);
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

  /** 所有工具条动作都走同一个入口：拿当前 workbook / sheet / range，执行后刷新按钮态。 */
  const withActiveRange = useCallback((fn: (range: FRange, sheet: FWorksheet, workbook: FWorkbook) => void) => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      const workbook = state.univerAPI.getActiveWorkbook();
      if (!workbook) return;
      const sheet = workbook.getActiveSheet();
      const range = workbook.getActiveRange();
      if (!sheet || !range) return;
      fn(range, sheet, workbook);
      refreshCellFmt();
    } catch (error) {
      console.warn("[mobile-usheet] 工具条动作失败", error);
    }
  }, [refreshCellFmt]);

  /** 小数位 ±1：走 numfmt mixin（缺失/不支持时明确提示，不静默失败）。 */
  const stepDecimals = useCallback((delta: 1 | -1) => {
    withActiveRange((range) => {
      const target = range as unknown as {
        getNumberFormat?: () => string | undefined;
        setNumberFormat?: (pattern: string) => unknown;
      };
      if (typeof target.setNumberFormat !== "function") {
        showToast("当前表格内核不支持数字格式", { type: "error" });
        return;
      }
      const step = stepNumberFormatDecimals(target.getNumberFormat?.() ?? "", delta);
      if (!step.ok) {
        showToast(decimalStepMessage(step.reason), { type: "error" });
        return;
      }
      target.setNumberFormat(step.pattern);
    });
  }, [withActiveRange]);

  /** 格式刷：一次性模式（语雀 toolbar-formatPainter 的语义）；内核会自己按 operation 回填激活态。 */
  const toggleFormatPainter = useCallback(() => {
    const state = instanceRef.current;
    if (!state) return;
    void state.univerAPI.executeCommand("sheet.command.set-once-format-painter");
    refreshCellFmt();
  }, [refreshCellFmt]);

  /** 排序：自己算数据区 + 数据层命令 `sheet.command.sort-range`
   *  （不用 `sort-range-asc` 那类 UI 包装命令：它会弹内核的桌面对话框，移动端实测不可接受）。 */
  const runSheetSort = useCallback((direction: "asc" | "desc") => {
    const state = instanceRef.current;
    if (!state) return;
    const workbook = state.univerAPI.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange();
    if (!workbook || !sheet || !range) return;
    const resolved = planSortRange(
      { startRow: range.getRow(), endRow: range.getLastRow(), startColumn: range.getColumn(), endColumn: range.getLastColumn() },
      sheetAccessor(sheet),
      direction,
    );
    if (!resolved.ok) {
      showToast(blockFailureMessage(resolved.reason), { type: "error" });
      return;
    }
    void state.univerAPI.executeCommand("sheet.command.sort-range", {
      unitId: workbook.getId(),
      subUnitId: sheet.getSheetId(),
      range: resolved.plan.range,
      orderRules: resolved.plan.orderRules,
      hasTitle: resolved.plan.hasTitle,
    }).then((ok) => {
      if (!ok) showToast("排序失败：这个区域无法排序", { type: "error" });
    });
  }, [sheetAccessor]);

  /** 筛选：按数据块建筛选范围（已存在时命令返回 false 属正常），再开内核的**移动**筛选面板。 */
  const openSheetFilter = useCallback(() => {
    const state = instanceRef.current;
    if (!state) return;
    const workbook = state.univerAPI.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange();
    if (!workbook || !sheet || !range) return;
    const resolved = resolveSheetBlock(
      { startRow: range.getRow(), endRow: range.getLastRow(), startColumn: range.getColumn(), endColumn: range.getLastColumn() },
      sheetAccessor(sheet),
    );
    if (!resolved.ok) {
      showToast(blockFailureMessage(resolved.reason), { type: "error" });
      return;
    }
    const { block } = resolved;
    const unitId = workbook.getId();
    const subUnitId = sheet.getSheetId();
    const column = range.getColumn();
    void (async () => {
      await state.univerAPI.executeCommand("sheet.command.set-filter-range", {
        unitId,
        subUnitId,
        range: { startRow: block.startRow, startColumn: block.startColumn, endRow: block.endRow, endColumn: block.endColumn },
      });
      const opened = await state.univerAPI.executeCommand("sheet.operation.open-filter-panel", { unitId, subUnitId, col: column });
      if (!opened) showToast("筛选面板打不开：这个区域可能不足两行", { type: "error" });
    })();
  }, [sheetAccessor]);

  /**
   * 打开查找替换：**编辑态**用 open-replace-dialog（移动 bar 才会展开替换行；改写走内核命令
   * 并触发 CommandExecuted ⇒ scheduleFlush ⇒ capture 落正文）；**阅读态**只开 find-only，
   * 绝不展开替换行（读态语义 = 只浏览/跳转、不写正文，与读态筛选同一口径）。
   */
  const openFindDialog = useCallback(() => {
    const state = instanceRef.current;
    if (!state) return;
    const commandId = editing ? "ui.operation.open-replace-dialog" : "ui.operation.open-find-dialog";
    void state.univerAPI.executeCommand(commandId);
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
    let onPointerUp: ((event: PointerEvent) => void) | null = null;
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
          createMobileSheetsCorePreset({ container: containerId, disableAutoFocus: true, toolbar: false, formulaBar: true }),
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
          // 261022：十字高亮（移动插件；默认开启见下方 enableUsheetCrosshair）。
          { plugins: [UniverSheetsCrosshairHighlightMobileUIPlugin] as unknown as IPresetPlugin[] },
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never) as unknown as UniverBook;
      book.setEditable(editingRef.current);
      // 261022：十字高亮默认开启（纯本机视图，不写正文）。
      enableUsheetCrosshair(univerAPI);
      const last = usheetToBody(book.save() as never);
      created = { univer, univerAPI, book };
      instanceRef.current = { ...created, last };
      disposables.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
        // 格式刷状态由内核 operation 回填（点目标套用后会自动回 0）——不靠前端猜，也不自建第二套状态。
        if (event?.id === "sheet.operation.set-format-painter") {
          setPainterStatus((event.params as { status?: number } | undefined)?.status ?? 0);
        }
        scheduleFlush();
        refreshCellFmt();
        refreshSheetChrome();
      }));
      // 点按底部公式栏文字 = 落光标（移动公式栏默认 disableSelectionOnClick，见 placeFormulaBarCaret）。
      onPointerUp = (event: PointerEvent) => {
        refreshCellFmt();
        if (!editingRef.current) return;
        const target = event.target as HTMLElement | null;
        if (!target?.closest?.('[data-u-comp="mobile-formula-bar"]')) return;
        if (!target.closest('[data-u-comp="formula-editor"]')) return;
        const state = instanceRef.current;
        if (!state) return;
        const clientX = event.clientX;
        const clientY = event.clientY;
        window.requestAnimationFrame(() => placeFormulaBarCaret(state, clientX, clientY));
      };
      host.addEventListener("pointerup", onPointerUp);
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
      capture();
      for (const item of disposables) { try { item.dispose(); } catch { /* ignore */ } }
      observer.disconnect();
      if (onPointerUp) host.removeEventListener("pointerup", onPointerUp);
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


  // ---- Yuque 式常驻工具条（261019 用户点单）----
  // 只在编辑态显示；阅读态保持干净（编辑入口仍在工作区顶栏）。
  const runHistory = (kind: "undo" | "redo") => {
    const workbook = instanceRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook) return;
    try {
      if (kind === "undo") workbook.undo(); else workbook.redo();
      refreshCellFmt();
    } catch (error) {
      console.warn("[mobile-usheet] 撤销/重做失败", error);
    }
  };

  // 卡片内容全部来自 usheetChromeModel（单一来源）；组件只按 id 分派动作。
  const insertItems = buildInsertMenu();
  const numfmtItems = buildNumfmtMenu(cellFmt.numfmt);
  const moreRows = buildMoreRows({
    bold: cellFmt.bold,
    italic: cellFmt.italic,
    underline: cellFmt.underline,
    strike: cellFmt.strike,
    align: cellFmt.align,
    numfmt: cellFmt.numfmt,
  });

  const handleCardSelect = (id: string) => {
    closeCard();
    onMenuSelect(id);
  };

  const onMenuSelect = (id: string) => {
    if (id === "row-above") withActiveRange((range, sheet) => sheet.insertRowsBefore(range.getRow(), 1));
    else if (id === "row-below") withActiveRange((range, sheet) => sheet.insertRowsAfter(range.getRow(), 1));
    else if (id === "col-left") withActiveRange((range, sheet) => sheet.insertColumnsBefore(range.getColumn(), 1));
    else if (id === "col-right") withActiveRange((range, sheet) => sheet.insertColumnsAfter(range.getColumn(), 1));
    else if (id === "merge") withActiveRange((range) => range.merge({ defaultMerge: true }));
    else if (id === "bold") withActiveRange((range) => {
      const style = range.getCellStyleData() as { bl?: number } | null;
      range.setFontWeight(style?.bl === 1 ? "normal" : "bold");
    });
    else if (id === "italic") withActiveRange((range) => {
      const style = range.getCellStyleData() as { it?: number } | null;
      range.setFontStyle(style?.it === 1 ? "normal" : "italic");
    });
    else if (id === "underline") withActiveRange((range) => {
      const style = range.getCellStyleData() as { ul?: { s?: number } } | null;
      range.setFontLine(style?.ul?.s === 1 ? "none" : "underline");
    });
    else if (id === "strike") withActiveRange((range) => {
      const style = range.getCellStyleData() as { st?: { s?: number } } | null;
      range.setFontLine(style?.st?.s === 1 ? "none" : "line-through");
    });
    else if (id === "align-left") withActiveRange((range) => range.setHorizontalAlignment("left"));
    else if (id === "align-center") withActiveRange((range) => range.setHorizontalAlignment("center"));
    else if (id === "align-right") withActiveRange((range) => range.setHorizontalAlignment("normal"));
    else if (id.startsWith("font-")) withActiveRange((range) => range.setFontColor(id.slice("font-".length)));
    else if (id.startsWith("fill-")) withActiveRange((range) => range.setBackgroundColor(id.slice("fill-".length)));
    // 261021 P5：查找替换（官方 mobile bar；sheets 适配器已在 preset 里，这里只派发操作）。
    else if (id === "find") openFindDialog();
    // 261021 P5：边框（FRange.setBorder；线型从 univerAPI.Enum 取，不写死数字）。
    else if (USHEET_BORDER_IDS.has(id)) {
      withActiveRange((range) => {
        const style = instanceRef.current?.univerAPI.Enum.BorderStyleTypes.THIN;
        const applied = applyUsheetBorder(range as unknown as { setBorder?: (type: string, style: number, color?: string) => unknown }, id, style ?? 1);
        if (!applied) showToast("当前表格内核不支持边框", { type: "error" });
      });
    }
    // 261021 P5：排序 / 筛选（Univer 独立包）。数据区由 usheetSortPlan 判定，失败一律 toast，不静默。
    else if (id === "sort-asc") runSheetSort("asc");
    else if (id === "sort-desc") runSheetSort("desc");
    else if (id === "filter") openSheetFilter();
    // 261022 P1：超链接 / 十字高亮（内核 1.0.3 独立包；链接走移动版弹层，高亮是纯视图 operation）。
    else if (id === "link") { void instanceRef.current?.univerAPI.executeCommand("sheet.operation.insert-hyper-link"); }
    else if (id === "crosshair") { instanceRef.current?.univerAPI.executeCommand(USHEET_CROSSHAIR_COMMANDS.toggle); }
    // 261021 P4：一级「格式刷 / 清除格式 / 小数位」三项（语雀同级位；保存位按用户定稿不重复）
    else if (id === "clear-style") withActiveRange((range) => { range.clearFormat(); });
    else if (id === "decimals") stepDecimals(1);
    else if (id === "decimal-down") stepDecimals(-1);
    else if (id === "clear-text") withActiveRange((range) => {
      range.setFontWeight(null).setFontStyle(null).setFontLine(null).setFontColor(null);
    });
    else if (id === "delete-row") withActiveRange((range, sheet) => { sheet.deleteRow(range.getRow()); });
    else if (id === "delete-col") withActiveRange((range, sheet) => { sheet.deleteColumn(range.getColumn()); });
    else if (id === "more-tools") hostRef.current?.querySelector<HTMLButtonElement>('button[aria-label="打开表格工具"]')?.click();
    // 布局类（冻结 / 行高 / 列宽）：动作清单与实现都在 usheetLayoutActions（单一来源，可单测）
    else if (USHEET_LAYOUT_ACTIONS.has(id)) {
      withActiveRange((range, sheet) => { applyUsheetLayoutAction(id, range, sheet); });
    }
    // 常用公式：只认「单个单元格 + 上方连续数值」，条件不满足就明说，绝不乱写
    else if (USHEET_QUICK_FORMULA_IDS.has(id)) {
      withActiveRange((range, sheet) => {
        const single = range.getRow() === range.getLastRow() && range.getColumn() === range.getLastColumn();
        if (!single) { showToast("请先只选中一个单元格（公式要写在这个格里）", { type: "error" }); return; }
        const plan = planUsheetQuickFormula(id, { row: range.getRow(), col: range.getColumn() },
          (row, col) => sheet.getRange(row, col).getValue());
        if (!plan) { showToast("这个单元格上方没有可统计的连续数值", { type: "error" }); return; }
        sheet.getRange(plan.targetRow, plan.targetColumn).setFormula(plan.formula);
      });
    }
    // 数字格式：运行时若没装 numfmt mixin 要明确提示（不静默失败）
    else if (USHEET_NUMFMT_IDS.has(id)) {
      withActiveRange((range) => {
        const applied = applyUsheetNumberFormat(range as unknown as { setNumberFormat?: (pattern: string) => unknown }, id);
        if (!applied) showToast("当前表格内核不支持数字格式", { type: "error" });
      });
    }
  };

  // 退出编辑态时收起卡片（避免卡片挂在阅读态上）。
  return (
    <div className={"mobile-usheet" + (editing ? " is-editing" : " is-readonly")} ref={hostRef} data-prevent-swipe>
      {editing && (
        <div className="mb-usheet-toolbar" data-prevent-swipe role="toolbar" aria-label="表格工具">
          <div className="mb-usheet-toolbar__scroll">
            {SHEET_TOOLBAR_GROUPS.map((group, groupIndex) => (
              <div className="mb-usheet-toolbar__group" key={groupIndex}>
                {group.map((item) => {
                  if (item.id === "insert") {
                    return (
                      <button key={item.id} type="button" className="mb-usheet-btn" aria-label="插入" title="插入"
                        onClick={(event) => toggleCard("insert", event.currentTarget)}>
                        <span className="mb-usheet-add"><Plus size={13} /></span>
                      </button>
                    );
                  }
                  if (item.id === "undo" || item.id === "redo") {
                    return (
                      <button key={item.id} type="button" className="mb-usheet-btn" aria-label={item.label} title={item.label}
                        onClick={() => runHistory(item.id === "undo" ? "undo" : "redo")}>
                        {item.id === "undo" ? <Undo2 size={18} /> : <Redo2 size={18} />}
                      </button>
                    );
                  }
                  if (item.id === "format-painter") {
                    return (
                      <button key={item.id} type="button"
                        className={"mb-usheet-btn" + (painterStatus !== 0 ? " is-active" : "")}
                        aria-label={item.label} title={item.label} aria-pressed={painterStatus !== 0}
                        onClick={toggleFormatPainter}>
                        <Paintbrush size={18} strokeWidth={1.75} />
                      </button>
                    );
                  }
                  if (item.id === "clear-style") {
                    return (
                      <button key={item.id} type="button" className="mb-usheet-btn"
                        aria-label={item.label} title={item.label}
                        onClick={() => onMenuSelect("clear-style")}>
                        <Eraser size={18} strokeWidth={1.75} />
                      </button>
                    );
                  }
                  if (item.id === "decimals") {
                    return (
                      <button key={item.id} type="button" className="mb-usheet-btn mb-usheet-btn--numdot"
                        aria-label={item.label} title={item.label}
                        onClick={() => onMenuSelect("decimals")}>
                        <span>.00</span>
                        <Plus size={11} strokeWidth={2} />
                      </button>
                    );
                  }
                  if (item.id === "numfmt") {
                    return (
                      <button key={item.id} type="button"
                        className={"mb-usheet-btn mb-usheet-btn--text" + (openCard === "numfmt" ? " is-active" : "")}
                        aria-label={item.label} title={item.label}
                        onClick={(event) => toggleCard("numfmt", event.currentTarget)}>
                        <span>{numfmtLabelOf(cellFmt.numfmt)}</span>
                        <ChevronDown size={12} />
                      </button>
                    );
                  }
                  return (
                    <button key={item.id} type="button"
                      className={"mb-usheet-btn" + (openCard === "more" ? " is-active" : "")}
                      aria-label={item.label} title={item.label}
                      onClick={(event) => toggleCard("more", event.currentTarget)}>
                      <MoreHorizontal size={18} />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
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
      {ready && (
        <MobileSheetFooter
          sheets={sheets}
          activeId={activeSheetId}
          zoom={zoomPercent}
          onSelect={selectSheet}
          onZoom={zoomBy}
          onOpenList={openSheetList}
        />
      )}
      {ready && sheetListAnchor && (
        <SheetPopCard
          host={hostRef.current}
          anchor={sheetListAnchor}
          placement="above"
          width={172}
          ariaLabel="工作表列表"
          items={sheets.map((sheet) => ({ id: sheet.id, label: sheet.name, note: sheet.id === activeSheetId ? "当前" : undefined }))}
          onSelect={(id) => { closeSheetList(); selectSheet(id); }}
          onClose={closeSheetList}
        />
      )}
      {editing && openCard === "more" && (
        <SheetMoreCard
          host={hostRef.current}
          anchor={cardAnchor}
          width={SHEET_CARD_META.more.width}
          ariaLabel={SHEET_CARD_META.more.ariaLabel}
          rows={moreRows}
          onSelect={handleCardSelect}
          onClose={closeCard}
        />
      )}
      {editing && (openCard === "insert" || openCard === "numfmt") && (
        <SheetPopCard
          host={hostRef.current}
          anchor={cardAnchor}
          width={SHEET_CARD_META[openCard].width}
          ariaLabel={SHEET_CARD_META[openCard].ariaLabel}
          items={openCard === "insert" ? insertItems : numfmtItems}
          onSelect={handleCardSelect}
          onClose={closeCard}
        />
      )}
    </div>
  );
}

export default MobileUsheetViewer;
