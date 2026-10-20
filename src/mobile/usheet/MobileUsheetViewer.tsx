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
import {
  Bold, ChevronDown, Italic, MoreHorizontal, Plus,
  Redo2, Strikethrough, Type, Underline, Undo2,
} from "lucide-react";
import { createUniver, LocaleType, mergeLocales, type FUniver } from "@univerjs/presets";
import type { FRange, FWorkbook, FWorksheet } from "@univerjs/sheets/facade";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import drawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import { buildUniverTheme } from "../../features/usheet/univerTheme";
import { emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody, usheetToBody } from "../../core/usheetDoc.js";
import { localAssetHttpUrl } from "../../core/assetUrl.js";
import { withAssetAccessToken } from "../../lib/assetPort";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { showToast } from "../ui/toastBus";
import { createMobileSheetsCorePreset, createMobileSheetsDrawingPreset } from "./mobileUniverPreset";
import { COLUMN_WIDTH_STEP, ROW_HEIGHT_STEP, USHEET_LAYOUT_ACTIONS, applyUsheetLayoutAction } from "./usheetLayoutActions";
import { USHEET_NUMFMT_IDS, USHEET_NUMFMT_OPTIONS, applyUsheetNumberFormat } from "./usheetNumfmt";

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

  /** 顶部工具条弹出的原生面板：插入 / 文字格式 / 更多。 */
  const [menu, setMenu] = useState<"insert" | "format" | "more" | null>(null);
  /** 当前选区文字状态（只用于工具条按钮高亮，选区变化时刷新）。 */
  const [cellFmt, setCellFmt] = useState<{ bold: boolean; italic: boolean; underline: boolean; strike: boolean; align: "left" | "center" | "normal" | "general" }>({
    bold: false, italic: false, underline: false, strike: false, align: "general",
  });
  /** 语雀式公式栏：当前选区地址 + 显示值（移动 UI 插件不渲染内置公式栏）。 */
  const [cellInfo, setCellInfo] = useState({ address: "A1", value: "" });

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

  /** 读当前选区样式（Univer facade 的 IStyleData：bl/it/ul/st + 对齐）。 */
  const refreshCellFmt = useCallback(() => {
    const state = instanceRef.current;
    if (!state) return;
    try {
      const range = state.univerAPI.getActiveWorkbook()?.getActiveRange();
      if (!range) return;
      const style = range.getCellStyleData() as { bl?: number; it?: number; ul?: { s?: number }; st?: { s?: number } } | null;
      const align = range.getHorizontalAlignment();
      const nextFmt = {
        bold: style?.bl === 1,
        italic: style?.it === 1,
        underline: style?.ul?.s === 1,
        strike: style?.st?.s === 1,
        align: (align === "left" || align === "center" || align === "normal" ? align : "general") as "left" | "center" | "normal" | "general",
      };
      setCellFmt((prev) => prev.bold === nextFmt.bold && prev.italic === nextFmt.italic && prev.underline === nextFmt.underline
        && prev.strike === nextFmt.strike && prev.align === nextFmt.align ? prev : nextFmt);
      const address = range.getA1Notation();
      const value = range.getDisplayValue() ?? "";
      setCellInfo((prev) => prev.address === address && prev.value === value ? prev : { address, value });
    } catch { /* 选区内没有可读样式时保持原状态 */ }
  }, []);

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
        locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never, drawingZhCN as never) },
        theme: buildUniverTheme() as never,
        presets: [
          // 只读与编辑都使用移动 UI 插件族（单指横滑 = 滚动画布）；公式栏/工作表栏/缩放保留，
          // 顶部的自有工具条由本组件渲染（Yuque 式常驻操作栏），官方底部动作面板仍可从浮动按钮打开。
          createMobileSheetsCorePreset({ container: containerId, disableAutoFocus: true, toolbar: false, formulaBar: true }),
          createMobileSheetsDrawingPreset(),
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never) as unknown as UniverBook;
      book.setEditable(editingRef.current);
      const last = usheetToBody(book.save() as never);
      created = { univer, univerAPI, book };
      instanceRef.current = { ...created, last };
      disposables.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => { scheduleFlush(); refreshCellFmt(); }));
      host.addEventListener("pointerup", refreshCellFmt);
      refreshCellFmt();
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
  }, [ready, noteId, scheduleFlush, refreshCellFmt]);

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

  // 切走 tab / 退出编辑：弹出层不能留在别的页面上。
  useEffect(() => {
    if (!editing || !active) setMenu(null);
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

  const C = { red: "#e5484d", orange: "#f76b15", yellow: "#ffb224", green: "#30a46c", blue: "#0091ff", purple: "#8e4ec6", gray: "#8b8d98", black: "#11181c" };
  const colorChildren = (prefix: string): MobileSheetItem[] => Object.entries(C).map(([name, value]) => ({ id: prefix + value, label: name === "black" ? "黑色" : name === "gray" ? "灰色" : name === "red" ? "红色" : name === "orange" ? "橙色" : name === "yellow" ? "黄色" : name === "green" ? "绿色" : name === "blue" ? "蓝色" : "紫色", note: value }));

  const insertMenu: MobileSheetItem[] = [
    { id: "row-above", label: "在上方插入行" },
    { id: "row-below", label: "在下方插入行" },
    { id: "col-left", label: "在左侧插入列" },
    { id: "col-right", label: "在右侧插入列" },
    { id: "merge", label: "合并选中单元格" },
  ];
  const formatMenu: MobileSheetItem[] = [
    { id: "bold", label: "加粗", note: cellFmt.bold ? "已开启" : undefined },
    { id: "italic", label: "斜体", note: cellFmt.italic ? "已开启" : undefined },
    { id: "underline", label: "下划线", note: cellFmt.underline ? "已开启" : undefined },
    { id: "strike", label: "删除线", note: cellFmt.strike ? "已开启" : undefined },
    { id: "align-left", label: "左对齐", note: cellFmt.align === "left" ? "当前" : undefined },
    { id: "align-center", label: "居中对齐", note: cellFmt.align === "center" ? "当前" : undefined },
    { id: "align-right", label: "右对齐", note: cellFmt.align === "normal" ? "当前" : undefined },
    { id: "font-color", label: "字体颜色", children: colorChildren("font-") },
    { id: "fill-color", label: "填充颜色", children: colorChildren("fill-") },
    { id: "clear-text", label: "清除文字格式" },
  ];
  const moreMenu: MobileSheetItem[] = [
    // 261020 P1：冻结 / 行高 / 列宽（布局类动作，README 的「冻结窗格 + 行高列宽调优」两项）
    { id: "freeze", label: "冻结窗格", note: "行列冻结", children: [
      { id: "freeze-row", label: "冻结至当前行" },
      { id: "freeze-col", label: "冻结至当前列" },
      { id: "freeze-none", label: "取消冻结" },
    ] },
    { id: "row-height", label: "行高", children: [
      { id: "row-height-up", label: "增高（+" + ROW_HEIGHT_STEP + "px）" },
      { id: "row-height-down", label: "降低（-" + ROW_HEIGHT_STEP + "px）" },
      { id: "row-height-auto", label: "自动行高（按内容）" },
    ] },
    { id: "col-width", label: "列宽", children: [
      { id: "col-width-up", label: "加宽（+" + COLUMN_WIDTH_STEP + "px）" },
      { id: "col-width-down", label: "收窄（-" + COLUMN_WIDTH_STEP + "px）" },
    ] },
    // 数字格式（261020 P1 第二批）：选项表与调用在 usheetNumfmt（单一来源）
    { id: "numfmt", label: "数字格式", children: USHEET_NUMFMT_OPTIONS.map((option) => ({ id: option.id, label: option.label })) },
    { id: "delete-row", label: "删除当前行", danger: true },
    { id: "delete-col", label: "删除当前列", danger: true },
    { id: "more-tools", label: "更多表格工具", note: "插入 / 样式 / 操作" },
  ];

  const onMenuSelect = (item: MobileSheetItem) => {
    const id = item.id;
    setMenu(null);
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
    // 数字格式：运行时若没装 numfmt mixin 要明确提示（不静默失败）
    else if (USHEET_NUMFMT_IDS.has(id)) {
      withActiveRange((range) => {
        const applied = applyUsheetNumberFormat(range as unknown as { setNumberFormat?: (pattern: string) => unknown }, id);
        if (!applied) showToast("当前表格内核不支持数字格式", { type: "error" });
      });
    }
  };

  return (
    <div className={"mobile-usheet" + (editing ? " is-editing" : " is-readonly")} ref={hostRef} data-prevent-swipe>
      {editing && (
        <div className="mobile-usheet-toolbar" data-prevent-swipe role="toolbar" aria-label="表格工具">
          <div className="mobile-usheet-toolbar__scroll">
            <button type="button" className="mobile-usheet-toolbar__btn" aria-label="插入" title="插入" onClick={() => setMenu("insert")}><Plus size={19} /><ChevronDown size={11} /></button>
            <button type="button" className="mobile-usheet-toolbar__btn" aria-label="撤销" title="撤销" onClick={() => runHistory("undo")}><Undo2 size={19} /></button>
            <button type="button" className="mobile-usheet-toolbar__btn" aria-label="重做" title="重做" onClick={() => runHistory("redo")}><Redo2 size={19} /></button>
            <span className="mobile-usheet-toolbar__sep" />
            <button type="button" className={"mobile-usheet-toolbar__btn" + (cellFmt.bold ? " is-active" : "")} aria-label="加粗" title="加粗" onClick={() => onMenuSelect({ id: "bold", label: "加粗" })}><Bold size={18} /></button>
            <button type="button" className={"mobile-usheet-toolbar__btn" + (cellFmt.italic ? " is-active" : "")} aria-label="斜体" title="斜体" onClick={() => onMenuSelect({ id: "italic", label: "斜体" })}><Italic size={18} /></button>
            <button type="button" className={"mobile-usheet-toolbar__btn" + (cellFmt.underline ? " is-active" : "")} aria-label="下划线" title="下划线" onClick={() => onMenuSelect({ id: "underline", label: "下划线" })}><Underline size={18} /></button>
            <button type="button" className={"mobile-usheet-toolbar__btn" + (cellFmt.strike ? " is-active" : "")} aria-label="删除线" title="删除线" onClick={() => onMenuSelect({ id: "strike", label: "删除线" })}><Strikethrough size={18} /></button>
            <button type="button" className="mobile-usheet-toolbar__btn" aria-label="文字格式" title="文字格式" onClick={() => setMenu("format")}><Type size={19} /><ChevronDown size={11} /></button>
            <button type="button" className="mobile-usheet-toolbar__btn" aria-label="更多表格操作" title="更多表格操作" onClick={() => setMenu("more")}><MoreHorizontal size={19} /></button>
          </div>
          <span className="mobile-usheet-toolbar__saved" aria-label="自动保存已开启" title="自动保存已开启"><i /></span>
        </div>
      )}
      {editing && (
        <div className="mobile-usheet-formula" data-prevent-swipe aria-label="公式栏">
          <span className="mobile-usheet-formula__ref">{cellInfo.address}</span>
          <span className="mobile-usheet-formula__value">{cellInfo.value}</span>
        </div>
      )}
      {ready ? <div id={containerId} className="mobile-usheet-root" /> : <div className="mb-empty">正在加载表格…</div>}
      <MobileSheetMenu open={menu === "insert"} items={insertMenu} onClose={() => setMenu(null)} onSelect={onMenuSelect} />
      <MobileSheetMenu open={menu === "format"} items={formatMenu} onClose={() => setMenu(null)} onSelect={onMenuSelect} />
      <MobileSheetMenu open={menu === "more"} items={moreMenu} onClose={() => setMenu(null)} onSelect={onMenuSelect} />
    </div>
  );
}

export default MobileUsheetViewer;
