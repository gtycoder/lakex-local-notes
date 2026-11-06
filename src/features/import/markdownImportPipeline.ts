/**
 * 261106 Markdown 导入**共享管线**（renderer 侧；桌面与移动端共用）：md → lake 正文。
 *
 * 内核配方（261106 task-83 已验证）：
 *   editor.setDocument("text/markdown", md) → 等一次渲染 → editor.getDocument("text/lake")
 * 产物带 data-lake-id、可直接落盘。**不要**用 readData/writeData 配方（产物无 id，会被内核重写）。
 * 硬约束（踩过）：
 * - 容器**不能 display:none**（量不到尺寸 ⇒ 表格列宽/图片塌成 0），宽度固定 750–800（本模块用 800）；
 * - 图片必须先物化为资产再重写 md（内核不会替你上传本地图片路径）；
 * - 大文件（200KB+）在隐藏窗口可能卡死 ⇒ 需可见文档流里的容器 + 超时保护（本模块 15s 总超时）。
 *
 * 本模块**不静态 import 内核**（桌面内核只能从 lazy 边界进入，见 desktopKernelLazy.test.ts）：
 * 缺省用 `await import("../editor/lakeRuntime")` 懒加载，测试/移动端可注入 `createKernel`。
 */
import type { LakeEditorInstance } from "../editor/lakeRuntime";

/** 单文件正文上限（与主进程 electron/markdownImportScan.ts 同口径；调用方也可先判）。 */
export const MAX_MARKDOWN_IMPORT_BYTES = 20 * 1024 * 1024;
/** 单文件转换总超时（含图片物化 + 渲染）。 */
export const MARKDOWN_CONVERT_TIMEOUT_MS = 15_000;
/** setDocument 之后等渲染稳定的上限（超过即视为失败，不落半成品）。 */
export const MARKDOWN_RENDER_TIMEOUT_MS = 8_000;
/** 渲染稳定轮询间隔。 */
const RENDER_POLL_MS = 100;
/** 离屏容器宽度：内核按容器宽度写表格列宽，固定 800（750–800 区间内）。 */
export const MARKDOWN_IMPORT_CONTAINER_WIDTH = 800;

export type MarkdownImportErrorCode =
  | "too-large"
  | "render-timeout"
  | "no-lake-id"
  | "convert-failed"
  | "aborted"
  | "busy";

export class MarkdownImportError extends Error {
  readonly code: MarkdownImportErrorCode;
  constructor(code: MarkdownImportErrorCode, message: string) {
    super(message);
    this.name = "MarkdownImportError";
    this.code = code;
  }
}

/** 本模块要用到的内核面（结构化类型 ⇒ 测试可传 stub，不需要真内核）。 */
export interface MarkdownKernelLike {
  setDocument(type: string, content: string): void;
  getDocument(type: string): string;
  on?(event: string, listener: () => void): void;
  off?(event: string, listener: () => void): void;
  destroy?(): void;
  destory?(): void;
  renderer?: { on?(event: string, listener: () => void): unknown; off?(event: string, listener: () => void): unknown };
}

/** 临时内核（容器用完即销毁）；`existingKernel` 复用时 dispose 为空操作。 */
export interface MarkdownKernelHandle {
  kernel: MarkdownKernelLike;
  dispose(): void;
}

export interface MarkdownConvertOptions {
  /** 原始 Markdown 文本。 */
  markdown: string;
  /** 本地图片的解析基准目录（通常是该 md 文件所在目录，绝对路径）。 */
  baseDir?: string;
  /**
   * 把一张本地图片物化为可用 URL（通常是 `{ bytes, filename }` → `uploadResource` → url）。
   * 返回 null/抛错 = 该图物化失败（降级为链接 + warning）。
   */
  assetUploader?: (absolutePath: string) => Promise<string | null>;
  /** 复用现成内核（调用方保证不在用户正在编辑的文档上调它）；缺省 = 临时创建离屏内核。 */
  existingKernel?: MarkdownKernelLike | null;
  /** 注入内核工厂（测试 / 平台自定义）；缺省 = 懒加载 lakeRuntime 临时创建。 */
  createKernel?: (container: HTMLElement) => Promise<MarkdownKernelHandle> | MarkdownKernelHandle;
  convertTimeoutMs?: number;
  renderTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface MarkdownConvertResult {
  /** lake 正文（含 data-lake-id，可直接 saveNote）。 */
  body: string;
  /** 预处理/物化阶段的告警（frontmatter 丢弃、远程图降级、图片失败…）。 */
  warnings: string[];
  /** 成功物化的图片数。 */
  imageCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// 路径小工具（renderer 没有 node:path；只做导入需要的相对路径归一化）
// ---------------------------------------------------------------------------

/** 去掉开头 `./`、把反斜杠统一为 `/`。 */
export function normalizeImportPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** 文件所在目录（保留末尾的盘符/根斜杠）。 */
export function dirnameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  if (index === 0) return "/";
  return normalized.slice(0, index);
}

/**
 * 把 md 里的图片引用解析成本地绝对路径（相对 baseDir；已绝对的原样返回）。
 * 支持 `../` 回退与 URL 编码（`%20`）。无法解析（越界/空）返回 null。
 */
export function resolveLocalImagePath(baseDir: string | undefined, src: string): string | null {
  const decoded = (() => { try { return decodeURIComponent(src); } catch { return src; } })();
  const cleaned = normalizeImportPath(decoded).replace(/[?#].*$/, "");
  if (!cleaned) return null;
  if (/^[a-zA-Z]:\//.test(cleaned) || cleaned.startsWith("/")) return cleaned; // 已是绝对路径
  if (!baseDir) return null;
  const base = baseDir.replace(/\\/g, "/");
  const stack = base.split("/").filter((part) => part.length > 0);
  for (const part of cleaned.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (stack.length === 0) return null; stack.pop(); continue; }
    stack.push(part);
  }
  return (base.startsWith("/") ? "/" : "") + stack.join("/");
}

// ---------------------------------------------------------------------------
// Markdown 预处理
// ---------------------------------------------------------------------------

/** 去掉 YAML frontmatter（只认文首 `---\n…\n---`，避免误伤正文的 --- 分隔线）。 */
export function stripFrontmatter(markdown: string, warnings: string[]): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return markdown;
  // 保险：内容里必须像 YAML（空行或 key: value），否则当正文分割线处理
  const body = match[1];
  const looksYaml = body.trim() === "" || /^[ \t]*[\w.-]+[ \t]*:/m.test(body);
  if (!looksYaml) return markdown;
  const lines = body.split(/\r?\n/).filter((line) => line.trim()).length;
  warnings.push("已忽略 YAML frontmatter（" + lines + " 行元数据）");
  return markdown.slice(match[0].length);
}

const LOCAL_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const HTML_IMAGE_RE = /<img\b[^>]*\bsrc\s*=\s*("[^"]*"|'[^']*')[^>]*>/gi;
const FOOTNOTE_RE = /\[\^[^\]]+\]/;

function unquoteSrc(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed.slice(1, -1).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function isRemoteImage(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src);
}

function isInlineData(src: string): boolean {
  return /^data:/i.test(src);
}

/**
 * 重写 md 里的图片引用：本地图 → 物化为资产 URL；远程图 v1 不下载 → 降级为链接；内嵌 data: → 丢弃。
 * 返回重写后的 md 与告警。
 */
export async function rewriteMarkdownImages(
  markdown: string,
  options: { baseDir?: string; assetUploader?: (absolutePath: string) => Promise<string | null> },
  warnings: string[],
  stats: { imageCount: number },
): Promise<string> {
  const remoteFailed: string[] = [];
  const localFailed: string[] = [];
  const inlineDropped: string[] = [];

  /** 串行处理（图片不多；顺序稳定便于断言与日志）。 */
  const replacements: Array<{ from: string; to: string }> = [];
  const altText = (alt: string | undefined, src: string): string => (alt && alt.trim() ? alt.trim() : src);

  // 1) Markdown 语法 ![alt](src)
  for (const match of markdown.matchAll(LOCAL_IMAGE_RE)) {
    const alt = match[1] ?? "";
    const src = unquoteSrc(match[2] ?? "");
    if (!src) continue;
    if (isRemoteImage(src)) {
      remoteFailed.push(src);
      replacements.push({ from: match[0], to: "[" + altText(alt, src) + "](" + src + ")" });
      continue;
    }
    if (isInlineData(src)) {
      inlineDropped.push(alt || "内嵌图片");
      replacements.push({ from: match[0], to: altText(alt, "（内嵌图片已跳过）") });
      continue;
    }
    const absolute = resolveLocalImagePath(options.baseDir, src);
    const url = absolute && options.assetUploader ? await options.assetUploader(absolute).catch(() => null) : null;
    if (url) {
      stats.imageCount += 1;
      replacements.push({ from: match[0], to: "![" + alt + "](" + url + ")" });
    } else {
      localFailed.push(src);
      replacements.push({ from: match[0], to: "[" + altText(alt, src) + "](" + src + ")" });
    }
  }
  // 2) 内嵌 HTML <img src="…">（保留 alt 文字，避免整段消失）
  for (const match of markdown.matchAll(HTML_IMAGE_RE)) {
    const src = unquoteSrc(match[1] ?? "");
    if (!src) continue;
    if (isRemoteImage(src)) remoteFailed.push(src);
    else if (isInlineData(src)) inlineDropped.push("内嵌图片");
    else localFailed.push(src);
    replacements.push({ from: match[0], to: "（图片：" + src + "）" });
  }

  let output = markdown;
  for (const { from, to } of replacements) {
    if (!from) continue;
    output = output.split(from).join(to);
  }
  if (remoteFailed.length > 0) warnings.push("远程图片未下载（v1 不支持），已降级为链接：" + summarizeList(remoteFailed));
  if (inlineDropped.length > 0) warnings.push("内嵌 data: 图片已跳过：" + summarizeList(inlineDropped));
  if (localFailed.length > 0) warnings.push("本地图片未能物化（已降级为链接）：" + summarizeList(localFailed));
  if (FOOTNOTE_RE.test(output)) warnings.push("脚注语法（[^n]）未支持，已按普通文本保留");
  return output;
}

function summarizeList(items: string[], max = 3): string {
  const head = items.slice(0, max).join("、");
  return items.length > max ? head + " 等 " + items.length + " 项" : head;
}

// ---------------------------------------------------------------------------
// 内核转换
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 离屏容器：**不能 display:none**（否则内核量不到尺寸、表格列宽/图片全塌）；用「移出视口 + visibility」隐藏。 */
export function createMarkdownImportContainer(doc: Document = document): HTMLDivElement {
  const container = doc.createElement("div");
  container.setAttribute("data-markdown-import-host", "1");
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = MARKDOWN_IMPORT_CONTAINER_WIDTH + "px";
  container.style.minHeight = "200px";
  // 关键：不是 display:none，也不整体 opacity:0（部分内核会跳过不可见区域的测量）
  container.style.visibility = "hidden";
  container.style.pointerEvents = "none";
  container.style.zIndex = "-1";
  (doc.body ?? doc.documentElement).appendChild(container);
  return container;
}

/** 缺省内核工厂：懒加载内核运行时后临时建一个编辑器（不静态 import，保桌面首屏）。 */
async function createTemporaryLakeKernel(container: HTMLElement): Promise<MarkdownKernelHandle> {
  const runtime = await import("../editor/lakeRuntime");
  const mount = container.ownerDocument.createElement("div");
  container.appendChild(mount);
  const editor: LakeEditorInstance = runtime.createLakeDocument(
    mount,
    "editor",
    () => undefined,
    false,
    "markdown-import",
    null,
    { disableVirtualRendering: true, showToolbar: false, disableNativeToc: true, blockHandle: false, floatingToolbar: false },
  );
  return {
    kernel: editor as unknown as MarkdownKernelLike,
    dispose: () => { try { runtime.destroyLakeEditor(editor); } catch { /* 销毁失败不影响导入结果 */ } },
  };
}

/**
 * setDocument 之后等渲染稳定：以 `getDocument("text/lake")` 连续两次相同且含 data-lake-id 为准。
 * （内核 tile 分批渲染；不等就取会丢内容 —— 与保存路径同一判据。）
 */
export async function waitForLakeDocument(
  kernel: MarkdownKernelLike,
  options: { renderTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const timeoutMs = Math.max(200, options.renderTimeoutMs ?? MARKDOWN_RENDER_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;
  await nextFrame();
  let last = "";
  let stableTicks = 0;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new MarkdownImportError("aborted", "Markdown 转换已取消");
    let current = "";
    try { current = String(kernel.getDocument("text/lake") ?? ""); } catch { current = ""; }
    if (current && current === last) stableTicks += 1;
    else stableTicks = 0;
    last = current;
    if (stableTicks >= 1 && current.includes("data-lake-id")) return current;
    await sleep(RENDER_POLL_MS);
  }
  if (last.includes("data-lake-id")) return last;
  // 有产物但缺 data-lake-id = 内核没按 lake 方言序列化（不能用）；完全没有产物 = 渲染超时。
  if (last) throw new MarkdownImportError("no-lake-id", "转换产物缺少 data-lake-id（拒绝落半成品）：" + last.slice(0, 80));
  throw new MarkdownImportError("render-timeout", "Markdown 渲染超时（" + timeoutMs + "ms 内未产出可保存正文）");
}

// ---------------------------------------------------------------------------
// 串行队列（同一时刻只跑一个转换：避免多内核并存的内存峰值）
// ---------------------------------------------------------------------------

let queueTail: Promise<unknown> = Promise.resolve();
/** 当前在途转换数（测试断言串行用）。 */
let inFlight = 0;

export function markdownConvertInFlight(): number {
  return inFlight;
}

/** 测试用：清空队列状态（不中断在途转换）。 */
export function resetMarkdownConvertQueueForTest(): void {
  queueTail = Promise.resolve();
  inFlight = 0;
}

function enqueueConversion<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    inFlight += 1;
    try { return await task(); } finally { inFlight -= 1; }
  }, async () => {
    inFlight += 1;
    try { return await task(); } finally { inFlight -= 1; }
  });
  queueTail = run.then(() => undefined, () => undefined);
  return run;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new MarkdownImportError("render-timeout", "Markdown 转换超时（超过 " + timeoutMs + "ms）"));
    }, timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * 把 Markdown 转成可落盘的 lake 正文（串行）。
 * 抛错 = MarkdownImportError（调用方据此给失败原因），绝不以"半成品正文"返回。
 */
export function convertMarkdownToLake(options: MarkdownConvertOptions): Promise<MarkdownConvertResult> {
  if (typeof options?.markdown !== "string") {
    return Promise.reject(new MarkdownImportError("convert-failed", "Markdown 内容无效"));
  }
  if (options.markdown.length > MAX_MARKDOWN_IMPORT_BYTES) {
    return Promise.reject(new MarkdownImportError("too-large", "Markdown 超过 " + Math.round(MAX_MARKDOWN_IMPORT_BYTES / 1024 / 1024) + "MB 上限"));
  }
  const timeoutMs = options.convertTimeoutMs ?? MARKDOWN_CONVERT_TIMEOUT_MS;
  return enqueueConversion(() => withTimeout(convertMarkdownNow(options), timeoutMs));
}

async function convertMarkdownNow(options: MarkdownConvertOptions): Promise<MarkdownConvertResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const stats = { imageCount: 0 };
  if (options.signal?.aborted) throw new MarkdownImportError("aborted", "Markdown 转换已取消");

  // 1) 预处理：BOM/换行/frontmatter
  let markdown = options.markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  markdown = stripFrontmatter(markdown, warnings);
  // 2) 图片物化 + 改写
  markdown = await rewriteMarkdownImages(markdown, { baseDir: options.baseDir, assetUploader: options.assetUploader }, warnings, stats);

  // 3) 空内容：不启内核（空 md 让内核渲染没有意义，也不会产出 data-lake-id）
  if (markdown.trim() === "") {
    warnings.push("Markdown 内容为空，已生成空文档");
    return { body: "", warnings, imageCount: stats.imageCount, durationMs: Date.now() - startedAt };
  }

  let handle: MarkdownKernelHandle | null = null;
  let container: HTMLDivElement | null = null;
  try {
    if (options.existingKernel) {
      handle = { kernel: options.existingKernel, dispose: () => undefined };
    } else {
      container = createMarkdownImportContainer();
      const factory = options.createKernel ?? ((host: HTMLElement) => createTemporaryLakeKernel(host));
      handle = await factory(container);
    }
    const kernel = handle.kernel;
    // 4) setDocument('text/markdown') → 等渲染稳定 → getDocument('text/lake')
    kernel.setDocument("text/markdown", markdown);
    const lake = await waitForLakeDocument(kernel, { renderTimeoutMs: options.renderTimeoutMs, signal: options.signal });
    if (!lake.includes("data-lake-id")) {
      throw new MarkdownImportError("no-lake-id", "转换产物缺少 data-lake-id（内核未完成渲染，拒绝落半成品）");
    }
    return { body: lake, warnings, imageCount: stats.imageCount, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof MarkdownImportError) throw error;
    throw new MarkdownImportError("convert-failed", "Markdown 转换失败：" + (error instanceof Error ? error.message : String(error)));
  } finally {
    try { handle?.dispose(); } catch { /* 清理失败不改变结果 */ }
    try { container?.remove(); } catch { /* 同 */ }
  }
}
