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
import { createUniver, IUndoRedoService, LocaleType, mergeLocales, type FUniver } from "@univerjs/presets";
// IUndoRedoService 从 @univerjs/presets 转发（它 `export * from "@univerjs/core"`）⇒ 不新增依赖、不直连 core 包。
// 用途：dock 的撤销/重做置灰（facade 只给 undo()/redo()，没有可用态查询）。
import type { FRange, FWorkbook, FWorksheet } from "@univerjs/sheets/facade";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import drawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "./usheet-chrome.css";
import { buildUniverTheme } from "../../features/usheet/univerTheme";
import { emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody, usheetToBody } from "../../core/usheetDoc.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { showToast } from "../ui/toastBus";
import { createMobileSheetsCorePreset, createMobileSheetsDrawingPreset } from "./mobileUniverPreset";
import { USHEET_LAYOUT_ACTIONS, applyUsheetLayoutAction } from "./usheetLayoutActions";
import { USHEET_NUMFMT_IDS, applyUsheetNumberFormat } from "./usheetNumfmt";
import { USHEET_QUICK_FORMULA_IDS, planUsheetQuickFormula } from "./usheetFormulaQuick";
import { UsheetDock, UsheetFooter, UsheetFormulaBar, UsheetPanel, UsheetReadingBar, type UsheetSheetTab } from "./UsheetChrome";
import { alignOf, lineFlagOf, numfmtLabelOf, type UsheetPanelId } from "./usheetChromeModel";
import { MOBILE_USHEET_GRID } from "./mobileSheetGrid";
import { capturePanelHeight } from "../editor/editSurfaceModel";

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

  /** 当前打开的二级面板（同一 dock 按钮再点 = 关闭）。 */
  const [panel, setPanel] = useState<UsheetPanelId | null>(null);
  /** 当前选区状态（dock 高亮 + 公式栏 + 面板回显）。 */
  const [cellFmt, setCellFmt] = useState<CellFmt>(EMPTY_FMT);
  /** 公式栏：当前选区地址 + 显示值。 */
  const [cellInfo, setCellInfo] = useState({ address: "A1", value: "" });
  /** 底部页签 / 当前工作表 / 缩放（页码与缩放都是本机 UI 状态）。 */
  const [sheets, setSheets] = useState<UsheetSheetTab[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [zoomRatio, setZoomRatio] = useState(1);
  const [sheetMenuOpen, setSheetMenuOpen] = useState(false);
  /** 软键盘态（innerHeight 收缩 >200px = 键盘弹起；AGENTS §7.17 的判据，取样基准 = 见过的最大视口高）。 */
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  /** 撤销/重做可用态（来自内核 IUndoRedoService；服务不可用时保持可用，不锁死按钮）。 */
  const [history, setHistory] = useState({ canUndo: true, canRedo: true });
  /** 面板占位高度 = **键盘区高度**（与文档编辑同口径：打开面板时捕获、之后不再随内容变）。
   *  内容多了在面板内滚，内容少了下方留白 —— 工具栏位置与内容视口恒定（用户 261020 点单）。 */
  const [panelHeight, setPanelHeight] = useState(0);
  /** 收起过渡：面板已关但**先别卸载**（键盘从它上面滑上来；restore 档内容保持到被盖住，见文档 dock 同款逻辑）。 */
  const [closing, setClosing] = useState(false);
  const [closingHold, setClosingHold] = useState(false);
  const [renderedPanel, setRenderedPanel] = useState<UsheetPanelId>("font");
  const keyboardHeightRef = useRef(0);
  const closingTimerRef = useRef<number | null>(null);
  const baseHeightRef = useRef(0);

  // 键盘态判据：只认视口收缩（focus 在宿主内 ≠ 键盘开着 —— 实测关闭后 Univer 会把焦点留在编辑器 div，
  // 用"焦点是否在宿主内"判断会让 ⌨ 永远只走「收起」分支、再也弹不出来）。
  useEffect(() => {
    const update = () => {
      const height = window.innerHeight;
      baseHeightRef.current = Math.max(baseHeightRef.current, height);
      const shrink = baseHeightRef.current - height;
      const open = shrink > 200;
      if (open) keyboardHeightRef.current = Math.max(keyboardHeightRef.current, shrink);
      setKeyboardOpen(open);
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

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
      const rawFontSize = range.getFontSize();
      const fontSize = typeof rawFontSize === "number" ? rawFontSize : null;
      let numfmt = "";
      try { numfmt = typeof range.getNumberFormat === "function" ? (range.getNumberFormat() ?? "") : ""; } catch { numfmt = ""; }
      const next: CellFmt = {
        bold: style?.bl === 1,
        italic: style?.it === 1,
        underline: lineFlagOf(style?.ul),
        strike: lineFlagOf(style?.st),
        align: alignOf(align),
        fontSize,
        numfmt,
      };
      setCellFmt((prev) => (prev.bold === next.bold && prev.italic === next.italic && prev.underline === next.underline
        && prev.strike === next.strike && prev.align === next.align && prev.fontSize === next.fontSize && prev.numfmt === next.numfmt ? prev : next));
      const address = range.getA1Notation();
      const value = range.getDisplayValue() ?? "";
      setCellInfo((prev) => (prev.address === address && prev.value === value ? prev : { address, value }));
    } catch { /* 选区内没有可读样式时保持原状态 */ }
  }, []);

  /** 所有工具条/面板动作都走同一个入口：拿当前 workbook / sheet / range，执行后刷新按钮态。 */
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
    let created: { univer: UniverCore; univerAPI: FUniver; book: UniverBook } | null = null;
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
      disposables.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => { scheduleFlush(); refreshCellFmt(); refreshSheets(); refreshHistory(); }));
      host.addEventListener("pointerup", refreshCellFmt);
      refreshCellFmt();
      refreshSheets();
      refreshHistory();
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
      host.removeEventListener("pointerup", refreshCellFmt);
      try { created?.univer.dispose(); } catch { /* ignore */ }
      instanceRef.current = null;
      captureCallbackRef.current?.(null);
    };
  }, [ready, noteId, scheduleFlush, refreshCellFmt, refreshSheets, refreshHistory]);

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
    if (!editing || !active) { setPanel(null); setSheetMenuOpen(false); setClosing(false); setClosingHold(false); }
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

  const changeZoom = (delta: number) => {
    const state = instanceRef.current;
    if (!state) return;
    const next = delta === 0 ? 1 : Math.max(0.5, Math.min(2, Math.round((zoomRatio + delta) * 10) / 10));
    try {
      void state.univerAPI.executeCommand("sheet.command.change-zoom-ratio", { delta: delta === 0 ? 0 : next - zoomRatio });
      setZoomRatio(next);
    } catch { /* 缩放是纯 UI，不可用时保持原值 */ }
  };

  const selectSheet = (sheetId: string) => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      const workbook = state.univerAPI.getActiveWorkbook();
      if (!workbook) return;
      workbook.setActiveSheet(sheetId);
      setSheetMenuOpen(false);
      refreshSheets();
      refreshCellFmt();
    } catch (error) {
      console.warn("[mobile-usheet] 切换工作表失败", error);
    }
  };

  const addSheet = () => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      const workbook = state.univerAPI.getActiveWorkbook();
      if (!workbook) return;
      const prefix = "Sheet";
      let index = workbook.getSheets().length + 1;
      while (workbook.getSheetByName(prefix + index)) index += 1;
      // 同一篇表格里所有工作表共用移动端网格（否则「＋新建工作表」会按内核默认 88 宽出来，和第一张不一致）
      workbook.insertSheet(prefix + index, { sheet: { ...MOBILE_USHEET_GRID } });
      setSheetMenuOpen(false);
      refreshSheets();
      refreshCellFmt();
    } catch (error) {
      showToast("新建工作表失败", { type: "error" });
      console.warn("[mobile-usheet] 新建工作表失败", error);
    }
  };

  /** 面板/dock 的统一动作入口（id 与 usheetChromeModel 清单一致）。 */
  const runAction = (id: string) => {
    // 数字格式（numfmt mixin）：单一来源在 usheetNumfmt
    if (USHEET_NUMFMT_IDS.has(id)) {
      withActiveRange((range) => {
        const applied = applyUsheetNumberFormat(range as unknown as { setNumberFormat?: (pattern: string) => unknown }, id);
        if (!applied) showToast("当前表格内核不支持数字格式", { type: "error" });
      });
      return;
    }
    // 小数位（内核 numfmt 命令）
    if (id === "decimal-inc" || id === "decimal-dec") {
      const state = instanceRef.current;
      if (!state) return;
      const cmd = id === "decimal-inc" ? "sheet.command.numfmt.add.decimal.command" : "sheet.command.numfmt.subtract.decimal.command";
      try {
        void state.univerAPI.executeCommand(cmd, {});
        scheduleFlush();
        refreshCellFmt();
      } catch { showToast("小数位调整失败", { type: "error" }); }
      return;
    }
    // 常用公式（单格 + 上方连续数值）
    if (USHEET_QUICK_FORMULA_IDS.has(id)) {
      withActiveRange((range, sheet) => {
        const single = range.getRow() === range.getLastRow() && range.getColumn() === range.getLastColumn();
        if (!single) { showToast("请先只选中一个单元格（公式要写在这个格里）", { type: "error" }); return; }
        const plan = planUsheetQuickFormula(id, { row: range.getRow(), col: range.getColumn() },
          (row, col) => sheet.getRange(row, col).getValue());
        if (!plan) { showToast("这个单元格上方没有可统计的连续数值", { type: "error" }); return; }
        sheet.getRange(plan.targetRow, plan.targetColumn).setFormula(plan.formula);
      });
      return;
    }
    // 布局动作（冻结 / 行高 / 列宽）
    if (USHEET_LAYOUT_ACTIONS.has(id)) {
      withActiveRange((range, sheet) => { applyUsheetLayoutAction(id, range, sheet); });
      return;
    }
    // 字号
    if (id.startsWith("fontsize-")) {
      const size = Number(id.slice("fontsize-".length));
      if (Number.isFinite(size)) withActiveRange((range) => range.setFontSize(size));
      return;
    }
    // 颜色 / 底纹 / 清除格式（facade 的类型只收 string；"默认/无填充"在运行时传 null）
    const applyColor = (range: FRange, kind: "font" | "fill", color: string | null) => {
      if (kind === "font") (range.setFontColor as unknown as (value: string | null) => FRange)(color);
      else (range.setBackgroundColor as unknown as (value: string | null) => FRange)(color);
    };
    if (id === "font-default") { withActiveRange((range) => applyColor(range, "font", null)); return; }
    if (id.startsWith("font-")) { withActiveRange((range) => applyColor(range, "font", id.slice("font-".length))); return; }
    if (id === "fill-none") { withActiveRange((range) => applyColor(range, "fill", null)); return; }
    if (id.startsWith("fill-")) { withActiveRange((range) => applyColor(range, "fill", id.slice("fill-".length))); return; }

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

  const sheetMenuItems: MobileSheetItem[] = [
    ...sheets.map((sheet) => ({ id: "sheet-" + sheet.id, label: sheet.name, note: sheet.id === activeSheetId ? "当前" : undefined })),
    { id: "sheet-add", label: "新建工作表" },
  ];

  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId);

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
        <UsheetFooter
          sheets={sheets}
          activeSheetId={activeSheetId}
          zoomRatio={zoomRatio}
          onSelectSheet={selectSheet}
          onOpenSheetMenu={() => setSheetMenuOpen(true)}
          onZoom={changeZoom}
        />
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
      {/* 二级面板在 dock **之后**：与文档编辑一致 —— 面板向下占住键盘区、dock 停在面板上沿，
          而不是把 dock 顶到屏幕最底、面板压在上面（用户 261020 报）。 */}
      {editing && (panel || closing) && (
        <UsheetPanel
          panel={renderedPanel}
          height={panelHeight}
          open={!!panel || closingHold}
          closing={closing}
          boldActive={cellFmt.bold}
          italicActive={cellFmt.italic}
          underlineActive={cellFmt.underline}
          strikeActive={cellFmt.strike}
          align={cellFmt.align}
          fontSize={cellFmt.fontSize}
          numfmtPattern={cellFmt.numfmt}
          onAction={runAction}
        />
      )}
      <MobileSheetMenu
        open={sheetMenuOpen}
        items={sheetMenuItems}
        onClose={() => setSheetMenuOpen(false)}
        onSelect={(item) => {
          if (item.id === "sheet-add") { addSheet(); return; }
          if (item.id.startsWith("sheet-")) selectSheet(item.id.slice("sheet-".length));
        }}
      />
    </div>
  );
}

export default MobileUsheetViewer;
