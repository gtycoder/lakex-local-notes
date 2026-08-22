/**
 * 资源（图片）上传/下载仓储（V5 Phase 2）：
 * 不再直接依赖 electron net —— 下载经注入的 HttpFetcher（默认 createPinnedHttpFetcher：
 * node:http/https + 连接层钉死已校验 DNS 地址，SSRF TOCTOU 修复）。
 * SSRF 逐跳校验由 fetcher 在连接层执行；此处保留体积/尺寸/格式校验与错误映射。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ResourceUploadOutput } from "./storeTypes.js";
import { AppError } from "../src/core/storeErrors.js";
import { SsrfError } from "./ssrf.js";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../src/core/storeLimits.js";
import { readImageDimensions, sniffImageFormat } from "../src/core/imageUtils.js";
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

  upload(input: { bytes: number[]; filename: string }, noteId: string): ResourceUploadOutput {
    const bytes = Buffer.from(input.bytes);
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

function imageOutput(bytes: Buffer, _requestedFilename: string, assetsDir: string, makeUrl: (filename: string) => string): ResourceUploadOutput {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new AppError("InvalidInput", "图片为空或超过 25 MiB");
  const format = sniffImageFormat(bytes);
  if (!format) throw new AppError("InvalidInput", "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
  const filename = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${format.extension}`;
  fs.mkdirSync(assetsDir, { recursive: true });
  const destination = path.join(assetsDir, filename);
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  const url = makeUrl(filename);
  return { resourceRef: url, url, filename, mimeType: format.mimeType, size: bytes.length };
}
