/**
 * Univer 表格编辑器（kind="usheet"）——**与 FortuneSheet 版（kind="sheet"）并存**，先在应用里跑通。
 *
 * 约束 / 取舍（"先做到能用"）：
 * - **一个编辑器一个 Univer 实例**（未做"单实例多 workbook"共享；那是后续优化，先保证不串台）。
 * - **首次可见后才挂载**：隐藏标签页里容器 0 尺寸，canvas 系引擎会渲染成空。
 * - **主题**：`--lake-*` → Univer Theme，跟随 `data-theme`（MutationObserver）。
 * - **自动保存**：订阅 `Event.CommandExecuted` 防抖 + 正文 diff，只有真的变了才 `onChange`（选区/滚动不落盘）。
 * - **只读**：`setEditable(false)`；`disableAutoFocus` 避免一打开就拉软键盘（移动端实测坑）。
 * - **图片**：注册 drawing preset（单元格图 + 浮动图都由 Univer 原生支持）。
 * - 正文 = `usheets/{id}.usheet.json`（Univer IWorkbookData 快照），见 `core/usheetDoc.ts`。
 */
import { useEffect, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales, type FUniver } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import { buildUniverTheme } from "./univerTheme";
import "./usheetEditor.css";
import { emptyUsheetWorkbook, parseUsheetBody, usheetToBody } from "../../core/usheetDoc.js";
import type { SheetEditorProps } from "../sheet/SheetEditor";

/** 自动保存防抖：合并连续命令，停顿后落一次。 */
const AUTOSAVE_DEBOUNCE_MS = 800;

/** 只用到 Univer workbook 的这两个方法；不直接 import FWorkbook（避免依赖 facade 的导出形状）。 */
type UniverBook = { save: () => unknown; setEditable: (value: boolean) => unknown };

export function UniverSheetEditor({ noteId, content, visible, readOnly, onChange, onDirty, onEditorCapture, showToolbar = true, focused, pane }: SheetEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [everVisible, setEverVisible] = useState(visible);
  const [ready, setReady] = useState(false);
  const instanceRef = useRef<{ univer: { dispose: () => void }; univerAPI: FUniver; book: UniverBook; last: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const dirtyRef = useRef(onDirty); dirtyRef.current = onDirty;
  const captureRef = useRef(onEditorCapture); captureRef.current = onEditorCapture;
  const readOnlyRef = useRef(readOnly); readOnlyRef.current = readOnly;

  useEffect(() => { if (visible) setEverVisible(true); }, [visible]);

  // 首次可见后量高度：隐藏容器会量到 0，retry 到有高度为止（避免 Univer 挂在 0 尺寸容器里）。
  useEffect(() => {
    if (!everVisible || ready) return;
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const measure = () => {
      if (host.clientHeight === 0) { raf = window.requestAnimationFrame(measure); return; }
      setReady(true);
    };
    measure();
    return () => { if (raf) window.cancelAnimationFrame(raf); };
  }, [everVisible, ready]);

  const snapshot = (): string | null => {
    const state = instanceRef.current;
    if (!state) return null;
    try { return usheetToBody(state.book.save() as never); } catch { return null; }
  };
  const flush = () => {
    const state = instanceRef.current;
    if (!state || readOnlyRef.current) return;
    const body = snapshot();
    if (body && body !== state.last) { state.last = body; changeRef.current(body); }
  };
  const scheduleFlush = () => {
    if (readOnlyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; flush(); }, AUTOSAVE_DEBOUNCE_MS);
  };

  // 挂载 Univer（首次可见 + 有高度后一次）。key 由宿主按 noteId/reloadKey 给，切文档整棵重挂。
  useEffect(() => {
    if (!ready || instanceRef.current) return;
    const parsed = parseUsheetBody(content);
    const workbook = parsed?.workbook ?? emptyUsheetWorkbook();
    let created: { univer: { dispose: () => void }; univerAPI: FUniver; book: UniverBook } | null = null;
    let disposable: { dispose: () => void } | null = null;
    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never) },
        theme: buildUniverTheme() as never,
        presets: [
          UniverSheetsCorePreset({ container: "univer-sheet-" + noteId, disableAutoFocus: true, toolbar: showToolbar, formulaBar: showToolbar }),
          UniverSheetsDrawingPreset(),
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never);
      book.setEditable(!readOnlyRef.current);
      created = { univer, univerAPI, book };
      instanceRef.current = { ...created, last: usheetToBody(book.save() as never) };
      disposable = univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => scheduleFlush());
      captureRef.current?.(() => snapshot());
    } catch (error) {
      console.error("Univer 表格挂载失败", error);
      created = null;
    }
    return () => {
      try { disposable?.dispose(); } catch { /* ignore */ }
      try { created?.univer.dispose(); } catch { /* ignore */ }
      instanceRef.current = null;
      captureRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, noteId]);

  // 只读切换
  useEffect(() => {
    const state = instanceRef.current;
    if (!state) return;
    try { state.book.setEditable(!readOnly); } catch { /* ignore */ }
  }, [readOnly, ready]);

  // 主题跟随 data-theme
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const state = instanceRef.current;
      if (!state) return;
      try { state.univerAPI.setTheme(buildUniverTheme() as never); } catch { /* ignore */ }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [ready]);

  // 切走 / 卸载前补齐未落盘的改动
  useEffect(() => { if (!visible) flush(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [visible]);
  useEffect(() => () => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className="sheet-editor usheet-editor"
      data-active={(focused ?? visible) ? "true" : undefined}
      data-pane-visible={visible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      <div id={"univer-sheet-" + noteId} className="usheet-univer-root" />
    </div>
  );
}
