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
import { createUniver, LocaleType, mergeLocales, ICommandService, CommandType, type FUniver } from "@univerjs/presets";
import { UniverSheetsCorePreset, IMenuManagerService } from "@univerjs/preset-sheets-core";
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

type RibbonSchema = { key: string; order: number; contextual?: boolean; item?: { id?: string; commandId?: string; title?: string; icon?: unknown } };
type MenuManagerLike = { getFlatMenuByPositionKey: (key: string) => RibbonSchema[] };
type FacadeLike = {
  createMenu: (item: { id: string; title: string; action: string; order?: number; icon?: string }) => { appendTo: (path: string) => void };
  updateMenuConfig: (config: Record<string, unknown>) => void;
};

/** 单行工具栏里**要隐藏的原有项**（261009 定稿精简）。
 *  注：append 进来的项用 updateMenuConfig({ hidden:true }) 无效（实测）⇒ 精简它们 = 以下白名单里不列。 */
const RIBBON_TRIM_IDS: Record<string, unknown> = {
  "ui.operation.activate-format-painter": { hidden: true }, // 格式刷
  "ui.command.clear-formatting": { hidden: true },          // 清除格式
  "sheet.command.set-range-font-family": { hidden: true },  // 字体：统一走 --lake-font-family（MiSans），禁止自定义
  "sheet.command.add-range-protection-from-toolbar": { hidden: true }, // 保护
  "base-ui.operation.toggle-shortcut-panel": { hidden: true },         // 快捷键面板
};

/** 单行工具栏**保留**的「塞入项」白名单（其余 insert/公式/视图 项不 append）。 */
const RIBBON_APPEND_ALLOW = new Set<string>([
  "sheet.command.insert-cell-image",              // 图片（单元格）
  "sheet.command.insert-float-image",             // 图片（浮动）
  "sheet.command.add-worksheet-background-image", // 背景图片
  "sheet.toolbar.sheet-frozen",                   // 冻结
  "sheet.command.toggle-gridlines",               // 切换网格线
  "base-ui.operation.toggle-fullscreen",          // 全屏
  "formula-ui.operation.insert-function.common",  // 函数
]);

/** 应用字体令牌（`--lake-font-family`，即 MiSans 栈）；表格一律用它，**禁止自定义字体**。 */
function lakeFontFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--lake-font-family").trim();
  return value && !value.includes("var(") ? value : "MiSans, sans-serif";
}

/** 把 workbook 的默认样式与所有命名样式的 ff 钉到应用字体（打开、落盘、canonical 各过一遍）。 */
function applyFontPolicy(workbook: UsheetWorkbook, fontStack: string): void {
  const wb = workbook as unknown as { defaultStyle?: unknown; styles?: Record<string, unknown> };
  const base = wb.defaultStyle && typeof wb.defaultStyle === "object" ? wb.defaultStyle as Record<string, unknown> : {};
  wb.defaultStyle = { ...base, ff: fontStack };
  if (wb.styles) {
    for (const style of Object.values(wb.styles)) {
      if (style && typeof style === "object") (style as Record<string, unknown>).ff = fontStack;
    }
  }
}

/**
 * 单行工具栏：把 插入/公式/数据/视图 的项全部 append 到「开始」行（ribbon.start.others），
 * 再按 RIBBON_TRIM_IDS 隐藏。先塞全 → 之后按需精简。依赖 `ribbonType: "simple"`（只留「开始」这一行）。
 * @returns append 的条数（便于验证）
 */
function flattenRibbonIntoStart(injector: { get: (token: unknown) => unknown }, facade: FacadeLike, tabs: string[]): number {
  const menuManager = injector.get(IMenuManagerService) as MenuManagerLike;
  const seen = new Set<string>();
  for (const schema of menuManager.getFlatMenuByPositionKey("ribbon.start")) {
    const id = schema.item?.commandId ?? schema.item?.id;
    if (id) seen.add(id);
  }
  let added = 0;
  for (const tab of tabs) {
    for (const schema of menuManager.getFlatMenuByPositionKey(tab)) {
      const item = schema.item;
      const commandId = item?.commandId ?? item?.id;
      if (!item || !commandId || seen.has(commandId)) continue;
      // 只搬**表格**的项：contextual 的（如 doc.* 富文本工具）与 doc/docs 前缀一律不要（261009 实测发现混入）。
      if (schema.contextual || /^(doc|docs)\./.test(commandId)) continue;
      if (!RIBBON_APPEND_ALLOW.has(commandId)) continue;
      seen.add(commandId);
      const entry: { id: string; title: string; action: string; order?: number; icon?: string } = {
        id: "usheet.merge." + commandId,
        title: item.title ?? commandId,
        action: commandId,
        order: schema.order,
      };
      if (typeof item.icon === "string") entry.icon = item.icon;
      try { facade.createMenu(entry).appendTo("ribbon.start.others"); added += 1; } catch { /* 单条失败不影响其它 */ }
    }
  }
  facade.updateMenuConfig(RIBBON_TRIM_IDS);
  return added;
}

/** 自建文件选择器选图（**不经过 Univer 的 blob 流程**）；用户取消返回 null。 */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-10000px";
    document.body.appendChild(input);
    const done = (file: File | null) => { input.remove(); resolve(file); };
    input.addEventListener("change", () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => done(null), { once: true });
    input.click();
  });
}

/** 选中的图 → 资产 URL：先落盘（uploadLakeResource），正文与活跃模型都只出现资产 URL，**永不产生 blob:**。 */
async function uploadPickedFile(file: File, noteId: string): Promise<string | null> {
  const out = await uploadLakeResource(file, noteId);
  const ref = parseLocalAssetUrl(out.url);
  return ref ? localAssetHttpUrl(noteId, ref.filename, { port: ASSET_PORT }) : out.url;
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
  /** 最近一次的**磁盘形态**正文（正文真相）：隐藏释放实例后，显示时按它重建。 */
  const lastBodyRef = useRef<string>(content);
  /** data:/blob: 源 → 资产 filename（同一会话内缓存，避免每次 flush 重复上传同一张图）。 */
  const promotedRef = useRef(new Map<string, string>());
  const flushInflightRef = useRef(false);
  const flushPendingRef = useRef(false);

  useEffect(() => { if (visible) setEverVisible(true); }, [visible]);

  // 首次可见后量高度：隐藏容器会量到 0，retry 到有高度为止（避免 Univer 挂在 0 尺寸容器里）。
  useEffect(() => {
    if (!everVisible || ready || !visible) return;
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const measure = () => {
      if (host.clientHeight === 0) { raf = window.requestAnimationFrame(measure); return; }
      setReady(true);
    };
    measure();
    return () => { if (raf) window.cancelAnimationFrame(raf); };
  }, [everVisible, ready, visible]);

  const doFlush = async () => {
    const state = instanceRef.current;
    if (!state || readOnlyRef.current) return;
    if (flushInflightRef.current) { flushPendingRef.current = true; return; }
    flushInflightRef.current = true;
    try {
      const snapshot = deepCloneWorkbook(state.book.save() as unknown as UsheetWorkbook);
      applyFontPolicy(snapshot, lakeFontFamily());
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
      if (body !== state.last) { state.last = body; lastBodyRef.current = body; changeRef.current(body); }
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
    const parsed = parseUsheetBody(lastBodyRef.current);
    const workbook = parsed?.workbook ?? emptyUsheetWorkbook();
    // 图表一律用应用字体令牌（MiSans），禁止自定义字体：默认样式 + 所有命名样式都钉死。
    applyFontPolicy(workbook, lakeFontFamily());
    // 打开：正文里的 filename → 资产服务器 URL（Univer 直接把 source 当图渲染）。
    mapUsheetImageSources(workbook, (src) => renderSource(src, noteId));
    let created: { univer: { dispose: () => void }; univerAPI: FUniver; book: UniverBook } | null = null;
    const disposables: Array<{ dispose: () => void }> = [];
    try {
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN as never, drawingZhCN as never) },
        theme: buildUniverTheme() as never,
        presets: [
          UniverSheetsCorePreset({
            container: "univer-sheet-" + noteId,
            disableAutoFocus: true,
            toolbar: showToolbar,
            formulaBar: showToolbar,
            ribbonType: "simple",
            // 字体表收窄成唯一一项 = 应用字体令牌 ⇒ 不存在"自定义字体"这个选项（配合隐藏字体选择器）。
            customFontFamily: { override: true, list: [{ value: lakeFontFamily(), label: "MiSans" }] },
          }),
          UniverSheetsDrawingPreset(),
        ],
      });
      const book = univerAPI.createWorkbook(workbook as never);
      book.setEditable(!readOnlyRef.current);
      created = { univer, univerAPI, book };
      // last = 规范化后的**磁盘形态**正文；避免打开即被判为"有改动"或把 URL 写回正文。
      const canonical = deepCloneWorkbook(book.save() as unknown as UsheetWorkbook);
      applyFontPolicy(canonical, lakeFontFamily());
      mapUsheetImageSources(canonical, (src) => promotedRef.current.get(src) ?? diskSource(src));
      const canonicalBody = usheetToBody(canonical);
      lastBodyRef.current = canonicalBody;
      instanceRef.current = { ...created, last: canonicalBody };
      disposables.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => scheduleFlush()));
      // 插图入口换成「先上传成资产、再插入资产 URL」——从源头消灭 blob（Univer 默认走 URL.createObjectURL）。
      const commandService = univer.__getInjector().get(ICommandService) as unknown as {
        registerCommand: (command: { id: string; type: CommandType; handler: () => Promise<boolean> }) => { dispose: () => void };
      };
      const registerUpload = (id: string, insert: (url: string) => unknown) => commandService.registerCommand({
        id,
        type: CommandType.COMMAND,
        handler: async () => {
          const file = await pickImageFile();
          if (!file) return false;
          const url = await uploadPickedFile(file, noteId);
          if (!url) return false;
          await insert(url);
          scheduleFlush();
          return true;
        },
      });
      disposables.push(registerUpload("usheet.insert-float-image", (url) =>
        (book as unknown as { getActiveSheet: () => { insertImage: (u: string) => unknown } }).getActiveSheet().insertImage(url)));
      disposables.push(registerUpload("usheet.insert-cell-image", (url) => {
        const ws = (book as unknown as {
          getActiveSheet: () => {
            getActiveRange: () => { insertCellImageAsync: (u: string) => unknown } | null;
            getRange: (a1: string) => { insertCellImageAsync: (u: string) => unknown };
          };
        }).getActiveSheet();
        return (ws.getActiveRange() ?? ws.getRange("A1")).insertCellImageAsync(url);
      }));
      (univerAPI as unknown as { updateMenuConfig: (config: Record<string, unknown>) => void }).updateMenuConfig({
        "sheet.command.insert-float-image": { commandId: "usheet.insert-float-image" },
        "sheet.command.insert-cell-image": { commandId: "usheet.insert-cell-image" },
      });
      // 261009：单行工具栏 —— 先把 插入/公式/数据/视图 的项全塞进「开始」行，再按 RIBBON_TRIM_IDS 隐藏。
      try {
        const injector = univer.__getInjector() as unknown as { get: (token: unknown) => unknown };
        const added = flattenRibbonIntoStart(injector, univerAPI as unknown as FacadeLike, ["ribbon.insert", "ribbon.formulas", "ribbon.data", "ribbon.view"]);
        console.log("[usheet] ribbon 合并：append", added, "项");
      } catch (error) { console.warn("[usheet] ribbon 合并失败", error); }
      captureRef.current?.(() => instanceRef.current?.last ?? null);
    } catch (error) {
      console.error("Univer 表格挂载失败", error);
      created = null;
    }
    return () => {
      for (const item of disposables) { try { item.dispose(); } catch { /* ignore */ } }
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

  // 隐藏 = 先把未落盘改动补齐，再释放 Univer 实例（canvas/模型/DOM）；显示时按 lastBodyRef 重建。
  // 目的：多标签 keep-alive 下不把每个 usheet 实例常驻在内存里（Univer 实例不轻）。
  useEffect(() => {
    if (visible || !instanceRef.current) return;
    void (async () => {
      await doFlush();
      setReady(false); // 触发挂载 effect 的 cleanup → univer.dispose()
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
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
