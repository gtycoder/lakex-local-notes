/**
 * Univer 表格编辑器（kind="usheet"）——当前**唯一**的表格实现。
 *
 * 约束 / 取舍（"先做到能用"）：
 * - **一个编辑器一个 Univer 实例**（未做"单实例多 workbook"共享；那是后续优化，先保证不串台）。
 * - **首次可见后才挂载**：隐藏标签页里容器 0 尺寸，canvas 系引擎会渲染成空。
 * - **隐藏不销毁（keep-alive，261010 实测结论）**：原先隐藏即 dispose、显示再重建，切一次标签就有
 *   0.7s（打包 scheme）/1.8s（dev）的空窗；改为**隐藏只补落盘、实例常驻**，只在卸载（关标签 / 换文档）时 dispose。
 *   代价是每个打开的表格标签常驻一个 Univer 实例（实测净增约 6–15MB/实例；标签数受设置里的
 *   maxOpenTabs 限制，默认 8 ⇒ 上界约 +100MB；隐藏态无空转：3s 内 rAF 调用 0）。
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
import { imageFilesFromClipboard, isPureImageClipboard, pasteImageTarget } from "./usheetImagePaste";
import { registerUsheetActiveSheet } from "./usheetActiveSheet";
import {
  UNIVER_COMMAND_IDS,
  UNIVER_CONTEXT_MENU_INSERT_PATH,
  USHEET_FOOTER_CONFIG,
  USHEET_HIDDEN_TOOLBAR_ITEMS,
} from "./usheetKernelContract";
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
 *  ⚠️ 必须用**渲染单元（render unit）**的 engine：`defaultEngine.resize()` 实测是 no-op。
 *  依赖 `@univerjs/engine-render`（已在 package.json **显式声明并锁 1.0.3**＝ presets 的 pin：
 *  出现两份会让 `injector.get(IRenderManagerService)` 拿不到同一 token，重排会静默失效）。 */
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

/** File → data URL：粘贴时上传失败的兜底（至少把图保住；落盘时 promoteInlineSource 会把它提升成资产）。 */
function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
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
  /** 挂载失败：上面 catch 掉的异常外层 ErrorBoundary 看不到 ⇒ 必须自己给可见出口（不许静默空白）。 */
  const [mountFailed, setMountFailed] = useState(false);
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
            // 工作表标签「＋」新建的工作表默认 50 行 × 16 列（用户 261010）。内核默认是 1000×20，
            // 只有这个入口能配（footer.addSheetButtonConfig），所以显式给全 footer 的四个开关避免覆盖掉默认值。
            // ⚠️ 两处口径必须一致：空表在 src/core/usheetDoc.ts 的 emptyUsheetWorkbook（同一组 50×16）。
            footer: USHEET_FOOTER_CONFIG,
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
      // 导出 CSV 要知道「用户正看着哪张工作表」（本机视图：不写正文、不进 S3）。
      // 只登记可编辑的实例：历史快照预览也是 usheet，但它的工作表选择不属于当前文档。
      if (!readOnlyRef.current) {
        disposables.push({
          dispose: registerUsheetActiveSheet(noteId, () => {
            const state = instanceRef.current;
            if (!state) return null;
            try {
              return (state.book as unknown as { getActiveSheet: () => { getSheetId: () => string } }).getActiveSheet().getSheetId();
            } catch {
              return null;
            }
          }),
        });
      }
      disposables.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => scheduleFlush()));
      // 插图入口换成「先上传成资产、再插入资产 URL」——从源头消灭 blob（Univer 默认走 URL.createObjectURL）。
      const commandService = univer.__getInjector().get(ICommandService) as unknown as {
        registerCommand: (command: { id: string; type: CommandType; handler: () => Promise<boolean> }) => { dispose: () => void };
      };
      const activeSheet = () => (book as unknown as {
        getActiveSheet: () => {
          insertImage: (u: string) => unknown;
          getActiveRange: () => { insertCellImageAsync: (u: string) => unknown } | null;
          getRange: (a1: string) => { insertCellImageAsync: (u: string) => unknown };
        };
      }).getActiveSheet();
      const registerUpload = (id: string, insert: (url: string) => unknown) => commandService.registerCommand({
        id,
        type: CommandType.COMMAND,
        handler: async () => {
          const file = await pickImageFile();
          if (!file) return false;
          // 上传失败要有出口（日志），不能静默什么都不发生 —— 粘贴那条路径另有"退回 data URL 绝不丢图"的兜底。
          let url: string | null = null;
          try {
            url = await uploadPickedFile(file, noteId);
          } catch (error) {
            console.warn("[usheet] 插图上传失败", error);
            return false;
          }
          if (!url) return false;
          await insert(url);
          scheduleFlush();
          return true;
        },
      });
      disposables.push(registerUpload(UNIVER_COMMAND_IDS.ourInsertFloatImage, (url) => activeSheet().insertImage(url)));
      disposables.push(registerUpload(UNIVER_COMMAND_IDS.ourInsertCellImage, (url) => {
        const ws = activeSheet();
        return (ws.getActiveRange() ?? ws.getRange("A1")).insertCellImageAsync(url);
      }));
      // 粘贴图片收口（用户 261010 定稿）：**默认落「单元格图片」**；没有选中单元格、或一次多图时，
      // 一律放行给内核默认（浮动图）——多图硬塞单元格会静默丢图（AGENTS §3#16）。
      // 为什么只能在 DOM 层拦（内核钩子/命令都改不动），见 usheetImagePaste.ts 头注释。
      // 绑 **window 捕获阶段** ⇒ 早于内核任何 document / 元素监听；只拦「纯图片」粘贴，其余一律放行。
      const onPaste = (event: ClipboardEvent) => {
        if (readOnlyRef.current) return; // 只读（锁定 / 回收站 / 历史快照预览）必须封死所有写入口
        const host = hostRef.current;
        if (!host) return;
        // 只接管「落在本表格里」的粘贴：事件目标或当前焦点在这个宿主内（Univer 的网格焦点元素在宿主里）
        const isInsideHost = (node: unknown): boolean => node instanceof Node && host.contains(node);
        if (!isInsideHost(event.target) && !isInsideHost(document.activeElement)) return;
        const dt = event.clipboardData;
        if (!dt) return;
        const files = imageFilesFromClipboard(dt);
        if (files.length === 0) return;
        if (!isPureImageClipboard((type) => dt.getData(type))) return;
        // 落点判据：单图 + 有活动单元格 ⇒ 我们自己插「单元格图片」；其余（无选中 / 多图）放行给内核默认
        const range = activeSheet().getActiveRange();
        if (pasteImageTarget(files, Boolean(range)) !== "cell" || !range) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void (async () => {
          let url: string | null = null;
          try {
            url = await uploadPickedFile(files[0], noteId);
          } catch (error) {
            console.warn("[usheet] 粘贴图片上传失败，退回内联 data URL", error);
          }
          // 兜底：上传失败也**绝不丢图** —— 内联 data URL 先插进去，落盘时 promoteInlineSource 会提升成资产
          if (!url) url = await fileToDataUrl(files[0]);
          if (!url) {
            console.warn("[usheet] 粘贴图片失败：上传与 data URL 兜底都不可用");
            return;
          }
          await range.insertCellImageAsync(url);
          scheduleFlush();
        })();
      };
      window.addEventListener("paste", onPaste, true);
      disposables.push({ dispose: () => window.removeEventListener("paste", onPaste, true) });
      // 单元格右键 →「插入」子菜单里补一项「插入单元格图片」（用户 261010）。走内核公开 facade：
      // `createMenu({ action: <命令 id> })` 的 action 传字符串 = **直接复用已注册的命令**（不会新建），
      // 所以这里指到我们自己的 usheet.insert-cell-image（文件选择器 → 上传成资产 → 单元格图片）。
      try {
        // ⚠️ 必须**作为方法调用**（不能把 createMenu 解构出来）：facade 内部要用 this._injector，
        //    解构后 this 丢失会报 "Cannot read properties of undefined (reading '_injector')"（实测踩到）。
        const menuApi = univerAPI as unknown as {
          createMenu: (item: { id: string; title: string; icon?: string; action: string; order?: number }) => {
            appendTo: (path: string | string[]) => void;
          };
        };
        menuApi.createMenu({
          id: "usheet.menu.insert-cell-image",
          title: "插入单元格图片",
          icon: "AddImageIcon",
          action: UNIVER_COMMAND_IDS.ourInsertCellImage,
          order: 4, // 内核「插入」子菜单现有 4 项（0..3）之后
        }).appendTo(UNIVER_CONTEXT_MENU_INSERT_PATH);
      } catch (error) {
        console.warn("[usheet] 右键菜单「插入单元格图片」注册失败", error);
      }
      (univerAPI as unknown as { updateMenuConfig: (config: Record<string, unknown>) => void }).updateMenuConfig({
        [UNIVER_COMMAND_IDS.insertFloatImage]: { commandId: UNIVER_COMMAND_IDS.ourInsertFloatImage },
        [UNIVER_COMMAND_IDS.insertCellImage]: { commandId: UNIVER_COMMAND_IDS.ourInsertCellImage },
        ...USHEET_HIDDEN_TOOLBAR_ITEMS,
      });
      captureRef.current?.(() => instanceRef.current?.last ?? null);
    } catch (error) {
      console.error("Univer 表格挂载失败", error);
      created = null;
      setMountFailed(true);
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

  /**
   * 底部「计算条」（Sheet 标签 / 选区统计 / 缩放）是这套表格最底下的一条；文档状态栏要塞进它**正上方**
   * （用户 261009 口径：不盖住那条复合底栏）。它的上沿不是常数 —— 内核版本、我们在 usheetEditor.css 里的
   * 压缩、横向滚动条都会改变它，所以在 CSS 里猜高度必然错位。这里实测一次写进 CSS 变量交给 chrome.css 消费，
   * 姿势与 BitableEditor 的 `--lake-bitable-status-bottom` 完全一致。
   */
  useEffect(() => {
    if (!visible || !ready) return;
    const host = hostRef.current;
    if (!host) return;
    const workspace = host.closest<HTMLElement>(".workspace");
    if (!workspace) return;
    const apply = () => {
      const bar = host.querySelector<HTMLElement>('[data-u-comp="slide-tab-bar"]');
      if (!bar) { workspace.style.removeProperty("--usheet-status-bottom"); return; }
      const above = Math.round(window.innerHeight - bar.getBoundingClientRect().top) + 4;
      workspace.style.setProperty("--usheet-status-bottom", above + "px");
    };
    // ⚠️ 计算条是**实例挂载后**才出现在 DOM 里的：effect 首次跑时它还不在，且宿主的尺寸此后不一定再变
    //   （ResizeObserver 不会触发）⇒ 按本文件既有姿势用 setTimeout 补几次（CDP/隐藏窗口里 rAF 不触发）。
    const timers = [0, 160, 600].map((ms) => window.setTimeout(apply, ms));
    window.addEventListener("resize", apply);
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("resize", apply);
      observer.disconnect();
      workspace.style.removeProperty("--usheet-status-bottom");
    };
  }, [visible, ready]);

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

  // 隐藏 = 只补齐未落盘改动（不再销毁实例）。实测（261010，隔离实例 + CDP）：
  // 原「隐藏即 dispose、显示重建」每次切回都要付 createUniver + createWorkbook 的钱 —— 点击→画布
  // 0.69s（scheme）/ 1.83s（dev，含模块图）；keep-alive 后切回不再重建。
  useEffect(() => {
    if (visible || !instanceRef.current) return;
    void doFlush();
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
      {mountFailed ? (
        <div className="empty-workspace-hint" role="alert">
          表格打开失败：编辑器内核初始化异常（详情见日志）。可切换标签或重新打开本文档重试。
        </div>
      ) : null}
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
