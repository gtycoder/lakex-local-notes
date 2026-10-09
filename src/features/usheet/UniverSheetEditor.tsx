/**
 * Univer 表格编辑器（kind="usheet"）——当前**唯一**的表格实现。
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
import { ChevronDown, ChevronUp } from "lucide-react";
import { IRenderManagerService } from "@univerjs/engine-render";

/** 自动保存防抖：合并连续命令，停顿后落一次。 */
const AUTOSAVE_DEBOUNCE_MS = 800;

/** 工具栏「收起 / 展开」偏好（设备本地；遵 AGENTS §4，不进正文 / S3 / 历史）。 */
const RIBBON_COLLAPSED_KEY = "lake-notes-v3.usheet.ribbon-collapsed";

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

/** 把「收起 / 展开」按钮对齐到工具行：不同 ribbonType / 收起状态下工具行 top 会变，量出来写进 CSS 变量。 */
function syncRibbonToggleTop(host: HTMLElement | null): void {
  if (!host) return;
  const toolbar = host.querySelector('[data-u-comp="ribbon-toolbar"]');
  if (!toolbar) return;
  // 相对宿主**内容盒**（绝对定位原点）算：扣掉宿主上边框（.sheet-editor 有 1px border-top），保留小数不取整。
  const top = toolbar.getBoundingClientRect().top - host.getBoundingClientRect().top - host.clientTop;
  if (top > 0) host.style.setProperty("--usheet-ribbon-toggle-top", `${top}px`);
}

/** 收起 / 展开工具栏后让 Univer 引擎重排画布：藏掉页签行改变了可用高度，而引擎不会自己重排（实测）。
 *  ⚠️ 必须用**渲染单元（render unit）**的 engine：`defaultEngine.resize()` 实测是 no-op。 */
function resizeUniverRender(instance: unknown): void {
  try {
    const rec = instance as { univer?: { __getInjector?: () => { get: (token: unknown) => unknown } } } | null;
    const injector = rec?.univer?.__getInjector?.();
    if (!injector) return;
    const renderManager = injector.get(IRenderManagerService) as {
      defaultEngine?: { resize?: () => void };
      getRenderAll?: () => Map<string, { engine?: { resize?: () => void } }>;
    } | null;
    let resized = 0;
    for (const unit of renderManager?.getRenderAll?.().values() ?? []) {
      if (unit?.engine?.resize) { unit.engine.resize(); resized += 1; }
    }
    if (resized === 0) renderManager?.defaultEngine?.resize?.();
  } catch { /* 重排失败不影响收起动作本身 */ }
}

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

export interface UsheetEditorProps {
  noteId: string;
  content: string;
  visible: boolean;
  readOnly: boolean;
  onChange: (content: string) => void;
  /** 审计 F15：用户一改动立即通知（早于内部 800ms 防抖），让外层 dirty / 关闭 / 退出及时看到。 */
  onDirty?: () => void;
  /** 审计 F15：注册按需同步序列化（关闭/保存时现取），避免「改完 <800ms 就关」丢最后编辑。 */
  onEditorCapture?: (capture: (() => string | null) | null) => void;
  /** 是否显示内核工具条（默认 true）。历史快照预览传 false ⇒ 只读预览不要"半个编辑器"的观感。 */
  showToolbar?: boolean;
  /** 分屏（261008）：本实例是否为**焦点栏**（决定 data-active；全局唯一）。缺省 = visible（旧行为）。 */
  focused?: boolean;
  /** 分屏里所在栏位（left/right）；未分屏不传。仅用于布局（data-pane）。 */
  pane?: "left" | "right" | null;
}

export function UniverSheetEditor({ noteId, content, visible, readOnly, onChange, onDirty, onEditorCapture, showToolbar = true, focused, pane }: UsheetEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [everVisible, setEverVisible] = useState(visible);
  const [ready, setReady] = useState(false);
  const [ribbonCollapsed, setRibbonCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(RIBBON_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  const toggleRibbonCollapsed = () => {
    setRibbonCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(RIBBON_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
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
            // 字体策略（非工具栏工程）：字体表收窄成唯一一项 = 应用字体令牌 MiSans。
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

  // 收起 / 展开工具栏后让引擎重排画布（藏页签行改变可用高度；引擎不会自己重排）。
  // ⚠️ 用 setTimeout 而非 requestAnimationFrame：CDP 依附 / 隐藏窗口里 rAF 不触发（本项目已知坑）。
  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      resizeUniverRender(instanceRef.current);
      syncRibbonToggleTop(hostRef.current);
    };
    const timers = [window.setTimeout(sync, 0), window.setTimeout(sync, 160)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [ribbonCollapsed, ready]);

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
      className={"sheet-editor usheet-editor" + (ribbonCollapsed ? " is-ribbon-collapsed" : "")}
      data-active={(focused ?? visible) ? "true" : undefined}
      data-pane-visible={visible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      <div id={"univer-sheet-" + noteId} className="usheet-univer-root" />
      {showToolbar ? (
        <button
          type="button"
          className="usheet-ribbon-toggle"
          aria-label={ribbonCollapsed ? "展开工具栏" : "收起工具栏"}
          aria-expanded={!ribbonCollapsed}
          title={ribbonCollapsed ? "展开工具栏" : "收起工具栏"}
          onClick={toggleRibbonCollapsed}
        >
          {ribbonCollapsed ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
        </button>
      ) : null}
    </div>
  );
}
