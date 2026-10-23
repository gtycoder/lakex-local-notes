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
import { ChevronDown, MoreHorizontal, Plus, Redo2, Undo2 } from "lucide-react";
import { createUniver, DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, LocaleType, mergeLocales, type FUniver, type IPresetPlugin } from "@univerjs/presets";
import { DocSelectionRenderService, IRenderManagerService } from "@univerjs/preset-sheets-core";
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
  SHEET_TOOLBAR_ROWS,
  SHEET_FREEZE_MENU,
  SHEET_FORMULA_MENU,
  SHEET_SORT_MENU,
  buildInsertMenu,
  buildMoreRows,
  buildNumfmtMenu,
  numfmtLabelOf,
} from "./usheetChromeModel";
import { SheetFormatCard } from "./SheetFormatCard";
import { SheetIcon } from "./SheetIcon";
import { createMobileSheetsCorePreset, createMobileSheetsDrawingPreset, createMobileSheetsHyperLinkPreset } from "./mobileUniverPreset";
import { UniverSheetsCrosshairHighlightMobileUIPlugin } from "@univerjs/sheets-crosshair-highlight";
import { setUsheetCrosshair } from "../../features/usheet/usheetCrosshair";
import { UniverSheetsNotePlugin } from "@univerjs/sheets-note";
import { createMobileSortFilterPlugins } from "./mobileSortFilter";
import "./usheet-chrome.css";
import { blockFailureMessage, resolveSheetBlock, type SortFilterSheet } from "./usheetSortPlan";
import { useSheetCardState } from "./useSheetCardState";
import { useSheetReadFilter, type SheetReadFilterTarget } from "./useSheetReadFilter";
import { useSheetChromeState } from "./useSheetChromeState";
import { useSheetCommandActions } from "./useSheetCommandActions";

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
  /** 十字高亮（⋯ 卡开关）：内核 operation 的纯本机视图状态，默认关、不持久化（重开表格回到关）。 */
  const [crosshairOn, setCrosshairOn] = useState(false);
  const toggleCrosshair = useCallback(() => {
    const api = getUniverAPI();
    if (!api) return;
    const next = !crosshairOn;
    if (setUsheetCrosshair(api, next)) setCrosshairOn(next);
  }, [crosshairOn, getUniverAPI]);

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


  // 卡片内容全部来自 usheetChromeModel（单一来源）；组件只按 id 分派动作。
  const insertItems = buildInsertMenu();
  const numfmtItems = buildNumfmtMenu(cellFmt.numfmt);
  const moreRows = buildMoreRows();

  const handleCardSelect = (id: string) => {
    closeCard();
    dispatchMenu(id);
  };

  // 退出编辑态时收起卡片（避免卡片挂在阅读态上）。
  return (
    <div className={"mobile-usheet" + (editing ? " is-editing" : " is-readonly")} ref={hostRef} data-prevent-swipe>
      {editing && (
        <div className="mb-usheet-toolbar" data-prevent-swipe role="toolbar" aria-label="表格工具">
          {/* 第一行：常用（+ / 撤销 重做 / T / 常规▾ / ⋯） */}
          <div className="mb-usheet-toolbar__row">
            <div className="mb-usheet-toolbar__scroll">
              {SHEET_TOOLBAR_ROWS[0].map((group, groupIndex) => (
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
                    if (item.id === "format") {
                      return (
                        <button key={item.id} type="button"
                          className={"mb-usheet-btn mb-usheet-btn--format" + (openCard === "format" ? " is-active" : "")}
                          aria-label="文字格式" title="文字格式（B / I / S / U / 字色）"
                          onClick={(event) => toggleCard("format", event.currentTarget)}>
                          <span aria-hidden="true">T</span>
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
          {/* 第二行：次常用（格式刷 清除格式 / 筛选 排序 冻结 查找 / 链接 公式），可横滑 */}
          <div className="mb-usheet-toolbar__row mb-usheet-toolbar__row--secondary">
            <div className="mb-usheet-toolbar__scroll">
              {SHEET_TOOLBAR_ROWS[1].map((group, groupIndex) => (
                <div className="mb-usheet-toolbar__group" key={groupIndex}>
                  {group.map((item) => {
                    if (item.id === "format-painter") {
                      return (
                        <button key={item.id} type="button"
                          className={"mb-usheet-btn" + (painterStatus !== 0 ? " is-active" : "")}
                          aria-label={item.label} title={item.label} aria-pressed={painterStatus !== 0}
                          onClick={toggleFormatPainter}>
                          <SheetIcon name="format-painter" />
                        </button>
                      );
                    }
                    if (item.id === "clear-style") {
                      return (
                        <button key={item.id} type="button" className="mb-usheet-btn"
                          aria-label={item.label} title={item.label}
                          onClick={() => dispatchMenu("clear-style")}>
                          <SheetIcon name="clear-style" />
                        </button>
                      );
                    }
                    if (item.id === "sort" || item.id === "freeze" || item.id === "formula") {
                      return (
                        <button key={item.id} type="button"
                          className={"mb-usheet-btn" + (openCard === item.id ? " is-active" : "")}
                          aria-label={item.label} title={item.label}
                          onClick={(event) => toggleCard(item.id as "sort", event.currentTarget)}>
                          <SheetIcon name={item.id === "formula" ? "sigma" : item.id} />
                        </button>
                      );
                    }
                    return (
                      <button key={item.id} type="button" className="mb-usheet-btn"
                        aria-label={item.label} title={item.label}
                        onClick={() => dispatchMenu(item.id)}>
                        <SheetIcon name={item.id === "find" ? "search" : item.id} />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
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
          crosshairOn={crosshairOn}
          onToggleCrosshair={toggleCrosshair}
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
      {editing && openCard === "format" && (
        <SheetFormatCard
          host={hostRef.current}
          anchor={cardAnchor}
          width={SHEET_CARD_META.format.width}
          ariaLabel={SHEET_CARD_META.format.ariaLabel}
          fmt={cellFmt}
          onToggle={(id) => dispatchMenu(id)}
          onSelect={(id) => dispatchMenu(id)}
          onClose={closeCard}
        />
      )}
      {editing && (openCard === "sort" || openCard === "freeze" || openCard === "formula") && (
        <SheetPopCard
          host={hostRef.current}
          anchor={cardAnchor}
          width={SHEET_CARD_META[openCard].width}
          ariaLabel={SHEET_CARD_META[openCard].ariaLabel}
          items={openCard === "sort" ? SHEET_SORT_MENU : openCard === "freeze" ? SHEET_FREEZE_MENU : SHEET_FORMULA_MENU}
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
