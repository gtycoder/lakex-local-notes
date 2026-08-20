import { net } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ResourceUploadOutput } from "./storeTypes.js";
import { AppError } from "./storeErrors.js";
import { assertSafeRemoteHost, SsrfError } from "./ssrf.js";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "./storeLimits.js";
import { readImageDimensions, sniffImageFormat } from "./imageUtils.js";

const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_MAX_REDIRECTS = 5;
const DOWNLOAD_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type ControlledResponse = NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> };

interface ResourceRepositoryDeps {
  noteAssetsDirFor(noteId: string): string;
  assetUrl(noteId: string, filename: string): string;
  registerOrphan(noteId: string, filename: string, size: number, mimeType: string): void;
}

/** Owns image upload/download I/O while Store keeps the public compatibility wrapper. */
export class ResourceRepository {
  constructor(private readonly deps: ResourceRepositoryDeps) {}

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
        const { request, response, status } = await this.fetchControlled(normalized);
        try {
          if (status < 200 || status >= 300) {
            request.abort();
            throw new AppError("Internal", `下载失败: HTTP ${status}`);
          }
          const declared = response.headers["content-length"];
          const declaredLength = Number(Array.isArray(declared) ? declared[0] : declared || 0);
          if (declaredLength > MAX_IMAGE_BYTES) {
            request.abort();
            throw new AppError("InvalidInput", "图片超过 25 MiB");
          }
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of response) {
            total += chunk.length;
            if (total > MAX_IMAGE_BYTES) {
              request.abort();
              throw new AppError("InvalidInput", "图片超过 25 MiB");
            }
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const bytes = Buffer.concat(chunks);
          assertImageDimensions(bytes);
          const output = imageOutput(bytes, path.basename(new URL(normalized).pathname) || "image", assetsDir, (filename) => this.deps.assetUrl(noteId, filename));
          this.deps.registerOrphan(noteId, output.filename, output.size, output.mimeType);
          return output;
        } finally {
          request.abort();
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

  private async fetchControlled(url: string): Promise<{ request: Electron.ClientRequest; response: ControlledResponse; status: number }> {
    let current = url;
    for (let hop = 0; ; hop++) {
      const parsed = new URL(current);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new AppError("InvalidInput", "重定向目标仅支持 HTTP 或 HTTPS");
      }
      await assertSafeRemoteHost(parsed.hostname);
      const outcome = await new Promise<
        | { kind: "redirect"; url: string }
        | { kind: "response"; status: number; response: ControlledResponse; request: Electron.ClientRequest }
      >((resolve, reject) => {
        const request = net.request({ url: current, followRedirect: false } as Electron.ClientRequestConstructorOptions & { followRedirect?: boolean });
        request.setHeader("User-Agent", DOWNLOAD_USER_AGENT);
        request.setHeader("Referer", current);
        const timer = setTimeout(() => { request.abort(); reject(new Error("AbortError")); }, DOWNLOAD_TIMEOUT_MS);
        let settled = false;
        request.on("redirect", (_statusCode: number, _method: string, redirectUrl: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request.abort();
          resolve({ kind: "redirect", url: redirectUrl });
        });
        request.on("response", (response: Electron.IncomingMessage) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "response", status: response.statusCode, response: response as never, request });
        });
        request.on("error", (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        request.end();
      });
      if (outcome.kind === "redirect") {
        if (hop >= DOWNLOAD_MAX_REDIRECTS) throw new AppError("Internal", `重定向次数过多: ${current}`);
        current = outcome.url;
        continue;
      }
      return { request: outcome.request, response: outcome.response, status: outcome.status };
    }
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
