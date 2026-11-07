/**
 * 261108 Word(.docx) → lake 导入管线（桌面专用，避免进入移动端入口包）。
 *
 * 复用 Markdown 导入的离屏容器/临时内核/渲染稳定等待；这里只做 Word 专属部分：
 * mammoth HTML 的 data 图片 → 上传资产 URL → 内核 setDocument("text/html") → getDocument("text/lake")。
 * 与 Markdown 管线一样串行执行，绝不返回半成品。
 */
import {
  createMarkdownImportContainer,
  createTemporaryLakeKernel,
  MARKDOWN_CONVERT_TIMEOUT_MS,
  MarkdownImportError,
  waitForLakeDocument,
  type MarkdownConvertResult,
  type MarkdownKernelHandle,
  type MarkdownKernelLike,
} from "./markdownImportPipeline";

export interface HtmlImportImage {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface HtmlConvertOptions {
  html: string;
  uploadDataImage?: (image: HtmlImportImage) => Promise<string | null>;
  warnings?: string[];
  existingKernel?: MarkdownKernelLike | null;
  createKernel?: (container: HTMLElement) => Promise<MarkdownKernelHandle> | MarkdownKernelHandle;
  convertTimeoutMs?: number;
  renderTimeoutMs?: number;
  signal?: AbortSignal;
}

let queueTail: Promise<unknown> = Promise.resolve();

function enqueueConversion<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => task(), async () => task());
  queueTail = run.then(() => undefined, () => undefined);
  return run;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MarkdownImportError("render-timeout", "Word 转换超时（超过 " + timeoutMs + "ms）")), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

const DATA_IMAGE_TAG_RE = /<img\b[^>]*>/gi;
const DATA_IMAGE_SRC_RE = /\bsrc\s*=\s*(["'])(data:image\/([a-z0-9.+-]+));base64,([^"']*)\1/i;
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function rewriteHtmlDataImages(
  html: string,
  upload: HtmlConvertOptions["uploadDataImage"],
  warnings: string[],
  stats: { imageCount: number },
): Promise<string> {
  let output = html;
  let index = 0;
  for (const match of [...html.matchAll(DATA_IMAGE_TAG_RE)]) {
    const tag = match[0];
    const src = DATA_IMAGE_SRC_RE.exec(tag);
    if (!src) continue;
    index += 1;
    const mimeType = "image/" + src[3].toLowerCase();
    const extension = IMAGE_EXT_BY_MIME[mimeType];
    let replacement: string;
    if (!extension || !upload) {
      warnings.push("第 " + index + " 张 Word 图片格式不支持，已跳过");
      replacement = "<span>（图片未导入）</span>";
    } else {
      try {
        const url = await upload({ bytes: decodeBase64(src[4]), mimeType, filename: "word-image-" + index + "." + extension });
        if (url) {
          stats.imageCount += 1;
          replacement = tag.replace(DATA_IMAGE_SRC_RE, 'src="' + url + '"');
        } else {
          warnings.push("第 " + index + " 张 Word 图片上传失败，已跳过");
          replacement = "<span>（图片未导入）</span>";
        }
      } catch {
        warnings.push("第 " + index + " 张 Word 图片上传失败，已跳过");
        replacement = "<span>（图片未导入）</span>";
      }
    }
    output = output.replace(tag, replacement);
  }
  return output;
}

async function convertHtmlNow(options: HtmlConvertOptions): Promise<MarkdownConvertResult> {
  const startedAt = Date.now();
  const warnings = [...(options.warnings ?? [])];
  const stats = { imageCount: 0 };
  if (options.signal?.aborted) throw new MarkdownImportError("aborted", "Word 转换已取消");
  const html = await rewriteHtmlDataImages(options.html.replace(/^\uFEFF/, ""), options.uploadDataImage, warnings, stats);
  if (!html.trim() || html.replace(/<[^>]*>/g, "").trim() === "") {
    warnings.push("Word 内容为空，已生成空文档");
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
    kernel.setDocument("text/html", html);
    const lake = await waitForLakeDocument(kernel, { renderTimeoutMs: options.renderTimeoutMs, signal: options.signal });
    if (!lake.includes("data-lake-id")) {
      throw new MarkdownImportError("no-lake-id", "转换产物缺少 data-lake-id（内核未完成渲染，拒绝落半成品）");
    }
    return { body: lake, warnings, imageCount: stats.imageCount, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof MarkdownImportError) throw error;
    throw new MarkdownImportError("convert-failed", "Word 转换失败：" + (error instanceof Error ? error.message : String(error)));
  } finally {
    try { handle?.dispose(); } catch { /* 清理失败不改变结果 */ }
    try { container?.remove(); } catch { /* 同 */ }
  }
}

/** Word HTML → 可落盘 lake 正文（串行，禁止半成品）。 */
export function convertHtmlToLake(options: HtmlConvertOptions): Promise<MarkdownConvertResult> {
  if (typeof options?.html !== "string") {
    return Promise.reject(new MarkdownImportError("convert-failed", "Word 内容无效"));
  }
  const timeoutMs = options.convertTimeoutMs ?? MARKDOWN_CONVERT_TIMEOUT_MS;
  return enqueueConversion(() => withTimeout(convertHtmlNow(options), timeoutMs));
}
