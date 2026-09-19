/**
 * 资源（图片）上传/下载仓储（V5 Phase 2）：
 * 不再直接依赖 electron net —— 下载经注入的 HttpFetcher（默认 createPinnedHttpFetcher：
 * node:http/https + 连接层钉死已校验 DNS 地址，SSRF TOCTOU 修复）。
 * SSRF 逐跳校验由 fetcher 在连接层执行；此处保留体积/尺寸/格式校验与错误映射。
 */
import fs from "node:fs";
import path from "node:path";
import type { ResourceUploadOutput } from "./storeTypes.js";
import { AppError } from "../src/core/storeErrors.js";
import { SsrfError } from "./ssrf.js";
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../src/core/storeLimits.js";
import { readImageDimensions, sniffImageFormat } from "../src/core/imageUtils.js";
import { buildAssetFilename, mimeTypeForFilename } from "../src/core/assetNaming.js";
import type { HttpFetcher } from "../src/core/httpFetcher.js";
import { createPinnedHttpFetcher } from "./httpFetcher.js";

const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_MAX_REDIRECTS = 5;
const DOWNLOAD_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface ResourceRepositoryDeps {
  noteAssetsDirFor(noteId: string): string;
  assetUrl(noteId: string, filename: string): string;
  registerOrphan(noteId: string, filename: string, size: number, mimeType: string): void;
  /** V5 Phase 2：HTTP 注入点；缺省 = createPinnedHttpFetcher()。 */
  fetcher?: HttpFetcher;
}

/** Owns image upload/download I/O while Store keeps the public compatibility wrapper. */
export class ResourceRepository {
  private readonly fetcher: HttpFetcher;

  constructor(private readonly deps: ResourceRepositoryDeps) {
    this.fetcher = deps.fetcher ?? createPinnedHttpFetcher();
  }

  upload(input: { bytes: Uint8Array; filename: string }, noteId: string): ResourceUploadOutput {
    const bytes = Buffer.from(input.bytes);
    // 附件（非图片格式字节）走附件落盘：不校验像素/图片格式，直接写文件。
    // 判定以字节嗅探为准（扩展名可伪造）；嗅探到图片格式仍走图片路径（像素护栏）。
    if (sniffImageFormat(bytes) == null) {
      const output = attachmentOutput(bytes, input.filename, this.deps.noteAssetsDirFor(noteId), (filename) => this.deps.assetUrl(noteId, filename));
      // 附件 filename 字段 = 原始文件名（展示用）；孤儿登记必须用磁盘名（URL 末段）
      const storedName = output.url.split("/").pop() ?? output.filename;
      this.deps.registerOrphan(noteId, storedName, output.size, output.mimeType);
      return output;
    }
    assertImageDimensions(bytes);
    const output = imageOutput(bytes, input.filename, this.deps.noteAssetsDirFor(noteId), (filename) => this.deps.assetUrl(noteId, filename));
    this.deps.registerOrphan(noteId, output.filename, output.size, output.mimeType);
    return output;
  }

  async downloadRemote(url: string, noteId: string): Promise<ResourceUploadOutput> {
    const assetsDir = this.deps.noteAssetsDirFor(noteId);
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AppError("InvalidInput", "图片地址仅支持 HTTP 或 HTTPS");
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetcher.fetch(normalized, {
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          maxRedirects: DOWNLOAD_MAX_REDIRECTS,
          userAgent: DOWNLOAD_USER_AGENT,
          referer: normalized,
        });
        try {
          if (response.status < 200 || response.status >= 300) {
            response.abort();
            throw new AppError("Internal", `下载失败: HTTP ${response.status}`);
          }
          const declared = response.headers["content-length"];
          const declaredLength = Number(Array.isArray(declared) ? declared[0] : declared || 0);
          if (declaredLength > MAX_IMAGE_BYTES) {
            response.abort();
            throw new AppError("InvalidInput", "图片超过 25 MiB");
          }
          const chunks: Uint8Array[] = [];
          let total = 0;
          for await (const chunk of response.body) {
            total += chunk.length;
            if (total > MAX_IMAGE_BYTES) {
              response.abort();
              throw new AppError("InvalidInput", "图片超过 25 MiB");
            }
            chunks.push(chunk);
          }
          const bytes = Buffer.concat(chunks as Buffer[]);
          assertImageDimensions(bytes);
          const output = imageOutput(bytes, path.basename(new URL(normalized).pathname) || "image", assetsDir, (filename) => this.deps.assetUrl(noteId, filename));
          this.deps.registerOrphan(noteId, output.filename, output.size, output.mimeType);
          return output;
        } finally {
          response.abort();
        }
      } catch (error) {
        if (error instanceof AppError && error.kind === "InvalidInput") throw error;
        if (error instanceof SsrfError) throw new AppError("InvalidInput", error.message);
        lastError = error instanceof Error && error.name === "AbortError"
          ? new AppError("Internal", `下载超时（${DOWNLOAD_TIMEOUT_MS / 1000}s）`)
          : new AppError("Internal", `网络错误: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (attempt < DOWNLOAD_MAX_ATTEMPTS) await sleep(attempt * 500);
    }
    throw lastError instanceof AppError ? lastError : new AppError("Internal", `下载失败: ${String(lastError)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertImageDimensions(bytes: Buffer): void {
  const dimensions = readImageDimensions(bytes);
  if (dimensions && dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new AppError("InvalidInput", `图片尺寸过大（${dimensions.width}x${dimensions.height}），上限 ${MAX_IMAGE_PIXELS} 像素`);
  }
}

function writeAssetBytes(bytes: Buffer, filename: string, assetsDir: string): string {
  fs.mkdirSync(assetsDir, { recursive: true });
  const destination = path.join(assetsDir, filename);
  const temporary = `${destination}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  return destination;
}

function imageOutput(bytes: Buffer, _requestedFilename: string, assetsDir: string, makeUrl: (filename: string) => string): ResourceUploadOutput {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new AppError("InvalidInput", "图片为空或超过 25 MiB");
  const format = sniffImageFormat(bytes);
  if (!format) throw new AppError("InvalidInput", "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
  const filename = buildAssetFilename(`image.${format.extension}`);
  writeAssetBytes(bytes, filename, assetsDir);
  const url = makeUrl(filename);
  return { resourceRef: url, url, filename, mimeType: format.mimeType, size: bytes.length };
}

/** 附件落盘：磁盘名用 buildAssetFilename（{13ts}_{8hex}.{ext}，跨端/同步/引用提取统一）；
 * 返回的 filename 字段 = **原始文件名**（用户上传时名字，Lake file 卡片 name 展示用），
 * URL 里才是磁盘名（打开/同步走 URL 解析）。 */
function attachmentOutput(bytes: Buffer, requestedFilename: string, assetsDir: string, makeUrl: (filename: string) => string): ResourceUploadOutput {
  if (bytes.length === 0) throw new AppError("InvalidInput", "附件为空");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AppError("InvalidInput", `附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB 协议上限`);
  const stored = buildAssetFilename(requestedFilename);
  writeAssetBytes(bytes, stored, assetsDir);
  const url = makeUrl(stored);
  const mimeType = mimeTypeForFilename(stored);
  const displayName = sanitizeDisplayName(requestedFilename);
  return { resourceRef: url, url, filename: displayName, mimeType, size: bytes.length };
}

/** 展示名清洗：去掉路径分隔/控制字符（展示用；磁盘名独立生成不受影响）。 */
export function sanitizeDisplayName(name: string): string {
  const cleaned = name.replace(/[\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned || "附件";
}
