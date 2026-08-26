import { isDesktop, native } from "../../lib/native";
import type { ResourceUploadInput, ResourceUploadOutput } from "../../lib/types";
import { MAX_IMAGE_BYTES, MAX_ATTACHMENT_BYTES } from "../../core/storeLimits";
import { loadSettings } from "../../lib/settings";
import { mimeTypeForFilename } from "../../core/assetNaming";
import { imageDataUrl, normalizeImageInput } from "./imageFormat";
import { createConcurrencyQueue } from "../../core/concurrency";
import { withRetry } from "../../core/retry";

interface LakeUploadRequest {
  type?: "url" | "file" | "base64";
  data?: File | string;
  file?: File | string;
}

const uploadQueue = createConcurrencyQueue(6);

/** 当前附件上传上限（MiB 配置项；协议硬上限见 MAX_ATTACHMENT_BYTES）。 */
function configuredMaxAttachmentBytes(): number {
  try {
    return loadSettings().maxAttachmentBytes;
  } catch {
    return MAX_ATTACHMENT_BYTES;
  }
}

/** base64 文本长度 → 解码字节数（在 atob/数组转换前预检，防止先复制多份内存再拒） */
function decodedBase64Length(encoded: string): number {
  const len = encoded.replace(/=+$/, "").length;
  return Math.floor(len / 4) * 3 + (len % 4 === 2 ? 1 : len % 4 === 3 ? 2 : 0);
}

export async function uploadLakeResource(request: unknown, noteId: string): Promise<ResourceUploadOutput> {
  return uploadQueue.add(() =>
    withRetry(() => performUpload(request, noteId), {
      maxRetries: 2,
      delayMs: 1000,
      backoffMultiplier: 2,
    })
  );
}

/** Check if a MIME type or filename looks like an image */
function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico", "tiff", "tif"].includes(ext);
}

/** MIME 兜底：按扩展名猜（共享 mimeTypeForFilename，单一事实源），猜不到用 octet-stream。 */
function mimeForExtension(filename: string, declared: string): string {
  return declared || mimeTypeForFilename(filename);
}

/** 非图片附件：作为资产落盘（note-assets/{noteId}/{file}），返回 canonical URL —— 不再 base64 内嵌正文。
 * 上传上限取用户配置（maxAttachmentBytes，默认 25MiB，可到 100MiB）。 */
async function uploadAttachmentFile(file: File, noteId: string): Promise<ResourceUploadOutput> {
  const maxBytes = configuredMaxAttachmentBytes();
  if (file.size > maxBytes) {
    throw new Error(`附件超过 ${maxBytes / 1024 / 1024} MiB 上限（可在设置中调整）`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = mimeForExtension(file.name, file.type);
  return native.uploadResource({ bytes, filename: file.name }, noteId);
}

async function performUpload(request: unknown, noteId: string): Promise<ResourceUploadOutput> {
  const normalized = request as LakeUploadRequest;
  const payload = request instanceof File ? request : normalized.data ?? normalized.file;

  // File upload from Lake's file picker
  if (payload instanceof File) {
    // Non-image files (PDF, doc, zip, audio, video, etc.) → 资产落盘（与图片同构的附件）
    if (!isImageFile(payload)) {
      return uploadAttachmentFile(payload, noteId);
    }
    // Image files → preserve the detected source format (including animated GIF/WebP)
    const input = normalizeImageInput(new Uint8Array(await payload.arrayBuffer()), payload.name || "image");
    return uploadWithOriginalFormat(input, noteId);
  }

  // Already-local data URL: pasted base64 image from local clipboard
  if (typeof payload === "string" && payload.startsWith("data:")) {
    // Non-image data URLs pass through as-is（审计 #14：先按 base64 长度预检）
    if (!payload.startsWith("data:image/")) {
      const [header, encoded = ""] = payload.split(",", 2);
      if (decodedBase64Length(encoded) > configuredMaxAttachmentBytes()) {
        throw new Error(`附件超过 ${configuredMaxAttachmentBytes() / 1024 / 1024} MiB 上限`);
      }
      return { url: payload, resourceRef: payload, filename: "attachment", mimeType: header.replace("data:", "").split(";")[0] || "application/octet-stream", size: decodedBase64Length(encoded) };
    }
    const input = dataUrlInput(payload);
    return uploadWithOriginalFormat(input, noteId);
  }

  // External URL：
  // - Electron：主进程是唯一受控下载路径（SSRF 防护 + DNS 解析 + 逐跳重定向校验 +
  //   25 MiB 上限 + Chromium TLS 指纹）。任何失败（含 SSRF 拒绝）都不回退到渲染层
  //   fetch——那会明确绕过主进程安全策略（审计 #5）。
  // - 浏览器演示模式（无原生桥）：尽力而为的直连，仍带大小限制与字面私网/本机拦截。
  if (typeof payload === "string" && (payload.startsWith("http://") || payload.startsWith("https://"))) {
    if (isDesktop()) {
      return native.downloadRemoteResource(payload, noteId);
    }
    return downloadWithBrowserFetch(payload);
  }

  throw new Error("无法识别的上传内容");
}

function dataUrlInput(value: string): ResourceUploadInput {
  const [header, encoded = ""] = value.split(",", 2);
  if (!/^data:[^;]+;base64$/i.test(header)) throw new Error("图片 Data URL 格式无效");
  // 审计 #14：atob/数组转换前预检解码长度（大 Data URL 不再先复制多份内存）
  if (decodedBase64Length(encoded) > MAX_IMAGE_BYTES) {
    throw new Error("图片超过 25 MiB");
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return normalizeImageInput(bytes, "image");
}

async function uploadWithOriginalFormat(input: ResourceUploadInput, noteId: string): Promise<ResourceUploadOutput> {
  // Do not rasterize WebP/AVIF here: an animated WebP/GIF must remain animated.
  // PNG conversion is still intentionally kept in electron/assetServer.ts for
  // clipboard export to applications that cannot consume WebP/AVIF data URLs.
  return native.uploadResource(input, noteId);
}

const MAX_BROWSER_REDIRECTS = 5;

/** 渲染层可用的字面 host 私网/本机校验（ssrf.ts 依赖 node:net，renderer 不可用） */
function isBlockedLiteralHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv6：未指定/回环、fc00::/7、fe80::/10、IPv4-mapped
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (h.startsWith("fc") || h.startsWith("fd") || /^fe[89ab]/.test(h)) return true;
    if (h.startsWith("::ffff:")) return isBlockedLiteralHost(h.slice("::ffff:".length));
    return false;
  }
  // IPv4：四段纯数字才做范围判断
  const parts = h.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return false; // 域名不做解析
  const nums = parts.map(Number);
  if (nums.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

/** 浏览器演示模式下载：逐跳校验（协议 + 字面 host），流式限量 25 MiB */
async function downloadWithBrowserFetch(initialUrl: string): Promise<ResourceUploadOutput> {
  let current = initialUrl;
  for (let hop = 0; ; hop++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { throw new Error("资源地址无效"); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("图片地址仅支持 HTTP 或 HTTPS");
    if (isBlockedLiteralHost(parsed.hostname)) throw new Error("不允许下载本机或私网地址");
    const resp = await fetch(current, { redirect: "manual" });
    let next: string | null = null;
    if (resp.type === "opaqueredirect") {
      next = resp.url && resp.url !== current ? resp.url : null;
    } else if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (location) next = new URL(location, current).href;
    }
    if (next) {
      if (hop >= MAX_BROWSER_REDIRECTS) throw new Error("重定向次数过多");
      current = next;
      continue;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = resp.headers.get("content-type") || "";
    const declaredLength = Number(resp.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error("资源超过 25 MiB");
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("响应无内容");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("资源超过 25 MiB");
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const filename = new URL(initialUrl).pathname.split("/").pop() || "file";
    if (!contentType.startsWith("image/")) {
      const mime = contentType.split(";")[0] || "application/octet-stream";
      const url = `data:${mime};base64,${bytesToBase64(merged)}`;
      return { url, resourceRef: url, filename, mimeType: mime, size: merged.length };
    }
    // 演示模式无原生层：校验图片格式后直接嵌入 data URL（不落盘）
    return imageDataUrl(normalizeImageInput(merged, filename));
  }
}

/** Uint8Array → base64（无原生层的演示模式用；分块避免参数栈溢出）。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
