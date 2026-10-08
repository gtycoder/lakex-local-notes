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
import drawingZhCN from "@univerjs/preset-sheets-drawing/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import { buildUniverTheme } from "./univerTheme";
import "./usheetEditor.css";
import { emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody, usheetToBody, type UsheetWorkbook } from "../../core/usheetDoc.js";
import { localAssetHttpUrl, parseLocalAssetUrl } from "../../core/assetUrl.js";
import { ASSET_PORT } from "../../lib/assetPort";
import { uploadLakeResource } from "../editor/resourceUpload";
import type { ResourceUploadOutput } from "../../lib/types";
import type { SheetEditorProps } from "../sheet/SheetEditor";

/** 自动保存防抖：合并连续命令，停顿后落一次。 */
const AUTOSAVE_DEBOUNCE_MS = 800;

/** 只用到 Univer workbook 的这两个方法；不直接 import FWorkbook（避免依赖 facade 的导出形状）。 */
type UniverBook = { save: () => unknown; setEditable: (value: boolean) => unknown };

/** 内联图（刚插入的 base64 / 本地文件产生的 blob URL）：必须在保存前提升为资产。 */
const INLINE_SOURCE_RE = /^(data:image\/|blob:)/i;
/** 是否带 URL scheme（data:/blob:/http(s): 一律原样；裸文件名才是我们的资产）。 */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function deepCloneWorkbook(workbook: UsheetWorkbook): UsheetWorkbook {
  return JSON.parse(JSON.stringify(workbook)) as UsheetWorkbook;
}

/** 磁盘 filename → 可渲染 URL（打开时喂给 createWorkbook）。 */
function renderSource(src: string, noteId: string): string {
  if (HAS_SCHEME_RE.test(src)) return src;
  return localAssetHttpUrl(noteId, src, { port: ASSET_PORT });
}

/** 本地资产 URL → 磁盘 filename（落盘时写回正文）。非本地资产原样。 */
function diskSource(src: string): string {
  const ref = parseLocalAssetUrl(src);
  return ref && ref.space === "note" && !ref.staging ? ref.filename : src;
}

/** 把 data:/blob:/外部 http 图片走 uploadLakeResource 提升成资产，返回 filename。 */
async function promoteInlineSource(src: string, noteId: string): Promise<string | null> {
  let out: ResourceUploadOutput | null = null;
  if (src.startsWith("data:")) {
    out = await uploadLakeResource({ type: "base64", data: src }, noteId);
  } else if (src.startsWith("blob:")) {
    const blob = await (await fetch(src)).blob();
    const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/gif" ? "gif" : blob.type === "image/webp" ? "webp" : blob.type === "image/svg+xml" ? "svg" : "png";
    out = await uploadLakeResource(new File([blob], "image." + ext, { type: blob.type || "image/png" }), noteId);
  } else if (src.startsWith("http://") || src.startsWith("https://")) {
    if (parseLocalAssetUrl(src)) return null; // 已是本地资产：磁盘口径直接换 filename
    out = await uploadLakeResource(src, noteId); // 外部网络图：主进程受控下载
  } else {
    return null;
  }
  const ref = parseLocalAssetUrl(out.url);
  return ref ? ref.filename : null;
}

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
  /** data:/blob: 源 → 资产 filename（同一会话内缓存，避免每次 flush 重复上传同一张图）。 */
  const promotedRef = useRef(new Map<string, string>());
  const flushInflightRef = useRef(false);
  const flushPendingRef = useRef(false);

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

  const doFlush = async () => {
    const state = instanceRef.current;
    if (!state || readOnlyRef.current) return;
    if (flushInflightRef.current) { flushPendingRef.current = true; return; }
    flushInflightRef.current = true;
    try {
      const snapshot = deepCloneWorkbook(state.book.save() as unknown as UsheetWorkbook);
      // 1) 收集尚未提升的内联图（data:/blob:），提升成资产文件并记住映射。
      const inline: string[] = [];
      mapUsheetImageSources(snapshot, (src) => { if (INLINE_SOURCE_RE.test(src) && !promotedRef.current.has(src)) inline.push(src); return src; });
      for (const src of new Set(inline)) {
        try {
          const filename = await promoteInlineSource(src, noteId);
          if (filename) promotedRef.current.set(src, filename);
        } catch (error) {
          console.warn("[usheet] 内联图片提升为资产失败（保持内联形态）", error);
        }
      }
      // 2) 落盘口径：已提升 → filename；本地资产 URL → filename；其余原样。
      mapUsheetImageSources(snapshot, (src) => promotedRef.current.get(src) ?? diskSource(src));
      const body = usheetToBody(snapshot);
      if (body !== state.last) { state.last = body; changeRef.current(body); }
    } finally {
      flushInflightRef.current = false;
      if (flushPendingRef.current) { flushPendingRef.current = false; void doFlush(); }
    }
  };
  const flush = () => { void doFlush(); };
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
    // 打开：正文里的 filename → 资产服务器 URL（Univer 直接把 source 当图渲染）。
    mapUsheetImageSources(workbook, (src) => renderSource(src, noteId));
    let created: { univer: { dispose: () => void }; univerAPI: FUniver; book: UniverBook } | null = null;
    let disposable: { dispose: () => void } | null = null;
    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never, drawingZhCN as never) },
        theme: buildUniverTheme() as never,
        presets: [
          UniverSheetsCorePreset({ container: "univer-sheet-" + noteId, disableAutoFocus: true, toolbar: showToolbar, formulaBar: showToolbar }),
          UniverSheetsDrawingPreset(),
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never);
      book.setEditable(!readOnlyRef.current);
      created = { univer, univerAPI, book };
      // last = 规范化后的**磁盘形态**正文；避免打开即被判为"有改动"或把 URL 写回正文。
      const canonical = deepCloneWorkbook(book.save() as unknown as UsheetWorkbook);
      mapUsheetImageSources(canonical, (src) => promotedRef.current.get(src) ?? diskSource(src));
      instanceRef.current = { ...created, last: usheetToBody(canonical) };
      disposable = univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => scheduleFlush());
      captureRef.current?.(() => instanceRef.current?.last ?? null);
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
