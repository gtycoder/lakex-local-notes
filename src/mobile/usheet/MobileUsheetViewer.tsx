/**
 * 移动端表格查看/编辑器（kind=usheet）—— chrome 已按 261020 设计定稿重做。
 *
 * 与桌面 UniverSheetEditor 同一套 Univer 内核；本组件只负责 Univer <-> JSON 与"我们的 chrome"：
 * - 顶部 21px 公式栏（地址 + 显示值）常驻；
 * - 底部 32px 页签/缩放栏（编辑态）+ 56px dock（与文档/小记同一套尺寸与交互）；
 * - 二级动作全部走底部面板（复用文档 dock 的 med-f-* 原语），见 UsheetChrome；
 * - 阅读态：公式栏 + 一条 40px 轻工具条（工作表入口 + 缩放），不显示 dock；
 * - Univer 自带的移动 footer / 浮动按钮由 CSS 隐藏（页签与缩放由我们接管）。
 *
 * 正文仍是内部 JSON（core/usheetDoc.ts），绝不喂给 Lake 编辑器；自动保存/捕获管线不变。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Plus, Redo2, Undo2 } from "lucide-react";
import { createUniver, DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, LocaleType, mergeLocales, type FUniver } from "@univerjs/presets";
import { DocSelectionRenderService, IRenderManagerService } from "@univerjs/preset-sheets-core";
import type { FRange, FWorkbook, FWorksheet } from "@univerjs/sheets/facade";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import drawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "./usheet-chrome.css";
import { buildUniverTheme } from "../../features/usheet/univerTheme";
import { editorCaretPoint } from "../../features/usheet/usheetCellEdit";
import { emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody, usheetToBody } from "../../core/usheetDoc.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { SheetPopCard } from "./SheetPopCard";
import { SheetMoreCard } from "./SheetMoreCard";
import { MobileSheetFooter, type MobileSheetTab } from "./MobileSheetFooter";
import { MobileSheetReadingBar } from "./MobileSheetReadingBar";
import {
  SHEET_CARD_META,
  SHEET_TOOLBAR_GROUPS,
  buildInsertMenu,
  buildMoreRows,
  buildNumfmtMenu,
  numfmtLabelOf,
  type SheetCardId,
} from "./usheetChromeModel";
import { showToast } from "../ui/toastBus";
import { createMobileSheetsCorePreset, createMobileSheetsDrawingPreset } from "./mobileUniverPreset";
import "./usheet-chrome.css";
import { USHEET_LAYOUT_ACTIONS, applyUsheetLayoutAction } from "./usheetLayoutActions";
import { USHEET_NUMFMT_IDS, applyUsheetNumberFormat } from "./usheetNumfmt";
import { USHEET_QUICK_FORMULA_IDS, planUsheetQuickFormula } from "./usheetFormulaQuick";

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

/** createUniver 返回的 Univer 实例：只用它的注入器问「这个工作簿还能不能撤销/重做」。
 *  注入器的 get 带泛型重载，这里只按 unknown 收窄（内部再用一次断言）。 */
type UniverCore = {
  dispose: () => void;
  __getInjector?: () => unknown;
};

/** IUndoRedoService 的最小形状（只读状态，不碰 undo 栈本身）。 */
type HistoryService = { getUndoRedoStatus: (unitId: string) => { undos: number; redos: number } };

/** sheets-ui facade 给 FWorkbook 追加的编辑态入口（facade 类型不在这里合并 ⇒ 按需收窄）。 */
type EditableWorkbook = {
  startEditing?: () => boolean;
  endEditingAsync?: (save?: boolean) => Promise<boolean>;
};

/** 正文里的图片 source（资产 filename）-> 本机 AssetServer canonical URL（带 token）；已是 URL 的原样。 */
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

interface CellFmt {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: "left" | "center" | "right" | "general";
  fontSize: number | null;
  numfmt: string;
}

const EMPTY_FMT: CellFmt = { bold: false, italic: false, underline: false, strike: false, align: "general", fontSize: null, numfmt: "" };

/** 数字格式 mixin（@univerjs/sheets-numfmt 在运行时给 FRange 追加；类型面按需断言）。 */
type NumfmtRange = FRange & { setNumberFormat?: (pattern: string) => unknown; getNumberFormat?: () => string };

export function MobileUsheetViewer({ noteId, content, active, editing, onChange, onCapture }: MobileUsheetViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [everActive, setEverActive] = useState(active);
  const [ready, setReady] = useState(false);
  const containerId = "mobile-usheet-" + noteId;
  const instanceRef = useRef<{ univer: UniverCore; univerAPI: FUniver; book: UniverBook; last: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const captureCallbackRef = useRef(onCapture);
  captureCallbackRef.current = onCapture;

  /** 顶部工具条弹出的原生面板：插入 / 文字格式 / 更多。 */
  /** 当前打开的锚定卡片（null = 无）；anchor = 触发按钮（卡片锚在它下方）。 */
  const [openCard, setOpenCard] = useState<SheetCardId | null>(null);
  const [cardAnchor, setCardAnchor] = useState<HTMLElement | null>(null);
  /** 当前选区文字状态（只用于工具条按钮高亮，选区变化时刷新）。 */
  const [cellFmt, setCellFmt] = useState<{ bold: boolean; italic: boolean; underline: boolean; strike: boolean; align: "left" | "center" | "normal" | "general"; numfmt: string }>({
    bold: false, italic: false, underline: false, strike: false, align: "general", numfmt: "",
  });
  /** 语雀式公式栏：当前选区地址 + 显示值（移动 UI 插件不渲染内置公式栏）。 */
  const [cellInfo, setCellInfo] = useState({ address: "A1", value: "" });
  /** 底栏：工作表页签 / 当前表 / 缩放；实例创建后由 facade 刷新。 */
  const [sheets, setSheets] = useState<MobileSheetTab[]>([]);
  const [activeSheetId, setActiveSheetId] = useState("");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [sheetListAnchor, setSheetListAnchor] = useState<HTMLElement | null>(null);

  /** 同步取最新正文；只有真的变更才通知外层。 */
  const capture = useCallback((): string | null => {
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
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!editingRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      capture();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [capture]);

  /** 从 workbook 同步页签列表 + 当前活动表（facade 的 getSheets/setActiveSheet）。 */
  const refreshSheets = useCallback(() => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      const workbook = state.univerAPI.getActiveWorkbook();
      if (!workbook) return;
      const list = workbook.getSheets().map((sheet) => ({ id: sheet.getSheetId(), name: sheet.getSheetName() }));
      const currentId = workbook.getActiveSheet()?.getSheetId() ?? null;
      setSheets((prev) => (prev.length === list.length && prev.every((item, index) => item.id === list[index].id && item.name === list[index].name) ? prev : list));
      setActiveSheetId((prev) => (prev === currentId ? prev : currentId));
    } catch { /* 实例尚未就绪时忽略 */ }
  }, []);

  /** 问内核「这个工作簿还能不能撤销/重做」，驱动 dock 两枚按钮的置灰。 */
  const refreshHistory = useCallback(() => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      const injector = state.univer.__getInjector?.() as { get: (token: unknown) => unknown } | undefined;
      const service = injector?.get(IUndoRedoService) as HistoryService | null | undefined;
      const unitId = state.univerAPI.getActiveWorkbook()?.getId();
      if (!service || typeof service.getUndoRedoStatus !== "function" || !unitId) {
        // 服务缺席（内核裁剪/升级改名）时退回旧口径：按钮保持可用，避免把功能锁死
        setHistory((prev) => (prev.canUndo && prev.canRedo ? prev : { canUndo: true, canRedo: true }));
        return;
      }
      const status = service.getUndoRedoStatus(unitId);
      const next = { canUndo: (status?.undos ?? 0) > 0, canRedo: (status?.redos ?? 0) > 0 };
      setHistory((prev) => (prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next));
    } catch { /* 读状态失败不影响编辑 */ }
  }, []);

  /** 读当前选区样式 + 公式栏信息（选区变化 / 命令后刷新）。 */
  const refreshCellFmt = useCallback(() => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      const range = state.univerAPI.getActiveWorkbook()?.getActiveRange() as NumfmtRange | undefined;
      if (!range) return;
      const style = range.getCellStyleData() as { bl?: number; it?: number; ul?: { s?: number }; st?: { s?: number } } | null;
      const align = range.getHorizontalAlignment();
      const numfmt = (range as unknown as { getNumberFormat?: () => string | undefined }).getNumberFormat?.() ?? "";
      const nextFmt = {
        bold: style?.bl === 1,
        italic: style?.it === 1,
        underline: style?.ul?.s === 1,
        strike: style?.st?.s === 1,
        align: (align === "left" || align === "center" || align === "normal" ? align : "general") as "left" | "center" | "normal" | "general",
        numfmt,
      };
      setCellFmt((prev) => prev.bold === nextFmt.bold && prev.italic === nextFmt.italic && prev.underline === nextFmt.underline
        && prev.strike === nextFmt.strike && prev.align === nextFmt.align && prev.numfmt === nextFmt.numfmt ? prev : nextFmt);
      const address = range.getA1Notation();
      const value = range.getDisplayValue() ?? "";
      setCellInfo((prev) => (prev.address === address && prev.value === value ? prev : { address, value }));
    } catch { /* 选区内没有可读样式时保持原状态 */ }
  }, []);

  /** 刷新底栏（工作表页签/当前表）。与 refreshCellFmt 分开：CommandExecuted 时两者都要刷。 */
  const refreshSheetChrome = useCallback(() => {
    const workbook = instanceRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook) return;
    try {
      const next = workbook.getSheets().map((sheet) => ({ id: sheet.getSheetId(), name: sheet.getSheetName() }));
      setSheets((prev) => (prev.length === next.length && prev.every((item, index) => item.id === next[index].id && item.name === next[index].name) ? prev : next));
      setActiveSheetId(workbook.getActiveSheet()?.getSheetId() ?? "");
    } catch { /* 实例销毁中忽略 */ }
  }, []);

  /** 切工作表（底栏页签 / 工作表列表）；只动视图与当前表，不写正文。 */
  const selectSheet = (sheetId: string) => {
    const workbook = instanceRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook) return;
    try {
      workbook.setActiveSheet(sheetId);
      refreshSheetChrome();
      refreshCellFmt();
    } catch (error) {
      console.warn("[mobile-usheet] 切换工作表失败", error);
    }
  };

  /** 缩放：走 Univer 官方 ChangeZoomRatioCommand（与内核底部缩放同一命令），只改本机视图。 */
  const zoomBy = (delta: number) => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      void state.univerAPI.executeCommand("sheet.command.change-zoom-ratio", { delta });
      setZoomPercent((prev) => Math.min(400, Math.max(10, Math.round(prev + delta * 100))));
    } catch (error) {
      console.warn("[mobile-usheet] 缩放失败", error);
    }
  };

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

  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  // 首次可见 + 网格容器有高度后才挂载（隐藏容器 0 尺寸 => canvas 引擎渲不出来）
  useEffect(() => {
    if (!everActive || ready || !active) return;
    const host = editorRef.current;
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
    const host = editorRef.current;
    if (!ready || !host) return;
    const workbook = parseUsheetBody(content)?.workbook ?? emptyUsheetWorkbook();
    mapUsheetImageSources(workbook, (src) => usheetImageSrc(src, noteId));
    let created: { univer: { dispose: () => void }; univerAPI: FUniver; book: UniverBook } | null = null;
    let onPointerUp: ((event: PointerEvent) => void) | null = null;
    const disposables: Array<{ dispose: () => void }> = [];
    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never, drawingZhCN as never) },
        theme: buildUniverTheme() as never,
        presets: [
          // 只读与编辑都使用移动 UI 插件族（单指横滑 = 滚动画布）；Univer 自带 toolbar/footer 由我们接管
          // （toolbar:false；footer 的 DOM 在 usheet-chrome.css 里隐藏）。
          createMobileSheetsCorePreset({ container: containerId, disableAutoFocus: true, toolbar: false, formulaBar: true }),
          createMobileSheetsDrawingPreset(),
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never) as unknown as UniverBook;
      book.setEditable(editingRef.current);
      const last = usheetToBody(book.save() as never);
      created = { univer, univerAPI, book };
      instanceRef.current = { ...created, last };
      disposables.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => { scheduleFlush(); refreshCellFmt(); refreshSheetChrome(); }));
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
      try { created?.univerAPI.setTheme(buildUniverTheme() as never); } catch { /* ignore */ }
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
    if (state) {
      try { state.book.setEditable(editing); } catch { /* ignore */ }
    }
    if (!editing) {
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      capture();
    }
  }, [editing, capture]);

  // 退出编辑 / 切走 tab：面板与工作表菜单不能留在别的页面上（收起过渡也一并收掉）。
  useEffect(() => {
    if (editing && active) return;
    setOpenCard(null);
    setCardAnchor(null);
  }, [editing, active]);

  // 切走 tab 时落一次；不要求关掉编辑态（编辑态可随 tab 保留）。
  useEffect(() => {
    if (!active) capture();
  }, [active, capture]);

  // 把同步 capture 交给父级：“完成”/关标签时现取，不依赖 600ms 防抖。
  useEffect(() => {
    captureCallbackRef.current?.(capture);
    return () => captureCallbackRef.current?.(null);
  }, [capture]);

  // 阅读态挡焦点：Univer 内部 div[contenteditable] 会自己拿焦点并拉起输入法。
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

  /** 进入单元格编辑（= 弹键盘）。优先走 sheets-ui facade 的 startEditing()；老内核没有该 API 时退回
   *  代点 Univer 隐藏的「开始编辑」浮动钮。 */
  const startCellEdit = useCallback(() => {
    try {
      const workbook = instanceRef.current?.univerAPI.getActiveWorkbook() as unknown as EditableWorkbook | null | undefined;
      if (workbook?.startEditing?.()) return;
    } catch { /* 退回隐藏钮 */ }
    hostRef.current?.querySelector<HTMLButtonElement>('button[aria-label="开始编辑（选区切换到编辑器）"]')?.click();
  }, []);

  /** 结束单元格编辑（= 收键盘并提交）。**不能只 blur**：blur 后 Univer 仍停在编辑态、
   *  移动 footer 变成「取消/确定/公式」，再也找不到「开始编辑」入口 ⇒ ⌨ / × 都弹不回键盘（261020 实测）。 */
  const endCellEdit = useCallback(() => {
    try {
      const workbook = instanceRef.current?.univerAPI.getActiveWorkbook() as unknown as EditableWorkbook | null | undefined;
      void workbook?.endEditingAsync?.(true);
    } catch { /* ignore */ }
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && activeEl !== document.body && hostRef.current?.contains(activeEl)) activeEl.blur();
  }, []);

  /** 退场期继续用上一次的面板渲染（否则一关就"啪"地少一块）。 */
  useEffect(() => { if (panel) setRenderedPanel(panel); }, [panel]);

  /** 清掉过渡占位（键盘已接管 / 兜底到点）。 */
  const finishPanelClose = useCallback(() => {
    if (closingTimerRef.current !== null) { window.clearTimeout(closingTimerRef.current); closingTimerRef.current = null; }
    setClosing(false);
    setClosingHold(false);
  }, []);
  useEffect(() => () => { if (closingTimerRef.current !== null) window.clearTimeout(closingTimerRef.current); }, []);

  /**
   * 收起面板的**唯一出口**（对齐文档 dock 的 closePanel 两档语义）：
   * · restore：× ⇒ 面板让位、把键盘放回来（继续输入）；
   * · hide：⌨ / 点网格 ⇒ 只收面板，不主动拉键盘。
   * 两档都先进 closing：内容先留着，等输入法真的回来再卸载（否则键盘还在上升、面板先空一块 = 闪烁）。
   */
  const closePanel = useCallback((mode: "restore" | "hide" = "restore") => {
    if (!panel) return;
    setPanel(null);
    setClosing(true);
    setClosingHold(mode === "restore");          // restore = 键盘从面板上方滑上来 ⇒ 内容保持到被盖住
    if (mode === "restore") startCellEdit();
    if (closingTimerRef.current !== null) window.clearTimeout(closingTimerRef.current);
    closingTimerRef.current = window.setTimeout(finishPanelClose, 2500);   // 兜底：键盘不来也不能永远占着
  }, [panel, startCellEdit, finishPanelClose]);

  // **等输入法真的回来**再清占位（固定延时会在键盘还没上来时先让出区域 ⇒ 面板先跳变）。
  useEffect(() => {
    if (!closing || !keyboardOpen) return;
    const t = window.setTimeout(finishPanelClose, 150);
    return () => window.clearTimeout(t);
  }, [closing, keyboardOpen, finishPanelClose]);
  // restore 档迟迟等不到键盘（硬件键盘 / 焦点失败）⇒ 1800ms 后放行内容滑出（与文档 dock 同口径）
  useEffect(() => {
    if (!closing || !closingHold || keyboardOpen) return;
    const t = window.setTimeout(() => setClosingHold(false), 1800);
    return () => window.clearTimeout(t);
  }, [closing, closingHold, keyboardOpen]);

  /** 打开/切换面板：捕获键盘区高度（只从"关→开"时捕获），并把键盘收走让位。 */
  const openPanel = useCallback((next: UsheetPanelId) => {
    if (panel === next) { closePanel("restore"); return; }   // 同一个按钮（此时已是 ×）= 关面板 + 放回键盘
    setClosing(false);                                       // 退场中又点开：撤掉过渡，直接进新面板
    setClosingHold(false);
    setPanelHeight((height) => Math.max(height, capturePanelHeight(keyboardHeightRef.current)));
    setPanel(next);
    endCellEdit();                                           // 面板占键盘区：结束格内编辑（键盘随之收起）
  }, [panel, closePanel, endCellEdit]);

  const toggleKeyboard = useCallback(() => {
    if (panel) { closePanel("hide"); return; }
    // 键盘开着 => 收起；键盘没开 => 进入单元格编辑（Univer 的「开始编辑」浮动钮是唯一入口）。
    // 判据用视口收缩，不用焦点：关闭键盘后焦点仍留在 Univer 的编辑面里，用焦点判断会卡在「只能收」。
    if (keyboardOpen) { endCellEdit(); return; }
    startCellEdit();
  }, [panel, keyboardOpen, closePanel, endCellEdit, startCellEdit]);

  // 面板开着时点网格 = 要操作表格 ⇒ 收面板（hide 档：不替用户拉键盘，正常选中/编辑照常进行）。
  useEffect(() => {
    if (!editing || !panel) return;
    const host = hostRef.current;
    if (!host) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest(".ush-panel, .ush-dock, .ush-footer")) return;
      if (!target.closest(".ush-editor")) return;
      closePanel("hide");
    };
    host.addEventListener("pointerdown", onDown, true);
    return () => host.removeEventListener("pointerdown", onDown, true);
  }, [editing, panel, closePanel]);

  const runHistory = (kind: "undo" | "redo") => {
    const workbook = instanceRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook) return;
    try {
      if (kind === "undo") workbook.undo(); else workbook.redo();
      refreshCellFmt();
      refreshSheets();
      refreshHistory();
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

  const closeCard = () => { setOpenCard(null); setCardAnchor(null); };
  const toggleCard = (card: SheetCardId, el: HTMLElement) => {
    if (openCard === card) { closeCard(); return; }
    setOpenCard(card);
    setCardAnchor(el);
  };
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
    else if (id === "clear-text") withActiveRange((range) => { range.clearFormat(); });
  };

  // 退出编辑态时收起卡片（避免卡片挂在阅读态上）。
  return (
    <div className={"mobile-usheet" + (editing ? " is-editing" : " is-readonly")} ref={hostRef} data-prevent-swipe>
      <UsheetFormulaBar address={cellInfo.address} value={cellInfo.value} />
      {!editing && (
        <UsheetReadingBar
          sheetName={activeSheet?.name ?? "Sheet1"}
          zoomRatio={zoomRatio}
          onOpenSheetMenu={() => setSheetMenuOpen(true)}
          onZoom={changeZoom}
        />
      )}
      <div className="ush-editor" ref={editorRef}>
        {ready ? <div id={containerId} className="mobile-usheet-root" /> : <div className="mb-empty">正在加载表格…</div>}
      </div>
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
      {editing && (
        <UsheetDock
          activePanel={panel}
          keyboardOpen={keyboardOpen}
          boldActive={cellFmt.bold}
          numfmtLabel={numfmtLabelOf(cellFmt.numfmt)}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onPanel={openPanel}
          onBold={() => runAction("bold")}
          onUndo={() => runHistory("undo")}
          onRedo={() => runHistory("redo")}
          onKeyboard={toggleKeyboard}
        />
      )}
      {!editing && ready && <MobileSheetReadingBar />}
      {ready ? <div id={containerId} className="mobile-usheet-root" /> : <div className="mb-empty">正在加载表格…</div>}
      {ready && (
        <MobileSheetFooter
          sheets={sheets}
          activeId={activeSheetId}
          zoom={zoomPercent}
          onSelect={selectSheet}
          onZoom={zoomBy}
          onOpenList={(anchor) => setSheetListAnchor(anchor)}
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
          onSelect={(id) => { setSheetListAnchor(null); selectSheet(id); }}
          onClose={() => setSheetListAnchor(null)}
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
