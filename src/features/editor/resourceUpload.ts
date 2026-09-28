import { hasNativeBridge, isDesktop, native } from "../../lib/native";
import type { ResourceUploadInput, ResourceUploadOutput } from "../../lib/types";
import { MAX_IMAGE_BYTES, MAX_ATTACHMENT_BYTES } from "../../core/storeLimits";
import { loadSettings } from "../../lib/settings";
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

export interface ResourceUploadOptions {
  /** 覆盖默认落盘（默认 = `native.uploadResource(input, noteId)`）。小记用它把图片写进 quick-notes 空间。 */
  saveResource?: (input: ResourceUploadInput) => Promise<ResourceUploadOutput>;
  /** 是否允许「网络图片 URL」走主进程下载。小记 v1 关闭（避免写进文档资源空间）。默认 true。 */
  allowRemoteDownload?: boolean;
}

export async function uploadLakeResource(request: unknown, noteId: string, options: ResourceUploadOptions = {}): Promise<ResourceUploadOutput> {
  return uploadQueue.add(() =>
    withRetry(() => performUpload(request, noteId, options), {
      maxRetries: 2,
      delayMs: 1000,
      backoffMultiplier: 2,
    })
  );
}

/** 图片判定（上传分流用）：先信 MIME，再按扩展名兜底。
 *  注意与 `core/assetNaming.ts` 的 **卡片分发** 清单（ASSET_IMAGE_EXTS）区分：这里决定"按图片处理"，
 *  那边决定"图片卡/附件卡"，两者刻意各自维护（本函数更宽，例如 ico/tif 也当图片上传）。 */
function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico", "tiff", "tif"].includes(ext);
}

/** 音频判定（Lake audio 卡专用字段）：file.type 或扩展名。
 *  比 `core/assetNaming.ts` 的 AUDIO_EXTENSIONS 多 aac/ogg —— 那两个也要补 audioId，否则内核 audio 卡
 *  永远停在"上传中"（见下方 uploadAttachmentFile 的注释）。改动这条要同时想清两张卡的分发语义。 */
function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(ext);
}

/** 非图片附件：作为资产落盘（note-assets/{noteId}/{file}），返回 canonical URL —— 不再 base64 内嵌正文。
 * 上传上限取用户配置（maxAttachmentBytes，默认 25MiB，可到 100MiB）。 */
async function uploadAttachmentFile(file: File, noteId: string, options: ResourceUploadOptions = {}): Promise<ResourceUploadOutput> {
  const maxBytes = configuredMaxAttachmentBytes();
  if (file.size > maxBytes) {
    throw new Error(`附件超过 ${maxBytes / 1024 / 1024} MiB 上限（可在设置中调整）`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // `saveResource`（小记注入）必须同样覆盖附件：否则小记的附件会落到 `note-assets/<draftId>/`
  // （文档资源空间）而不是小记 staging ⇒ 保存时 promote 找不到文件、转换也搬不走。
  const out = options.saveResource
    ? await options.saveResource({ bytes, filename: file.name })
    : await native.uploadResource({ bytes, filename: file.name }, noteId);
  // Lake audio 卡 handleUploadSuccess 读 video_id/audioId（播放源 id）→ 传 canonical URL，
  // filesize 供 audioInfo.fileSize 显示；否则 audio 卡 setId(null) → 永远"上传中"。
  if (isAudioFile(file)) {
    return { ...out, audioId: out.url, filesize: out.size };
  }
  return out;
}

async function performUpload(request: unknown, noteId: string, options: ResourceUploadOptions = {}): Promise<ResourceUploadOutput> {
  const normalized = request as LakeUploadRequest;
  const payload = request instanceof File ? request : normalized.data ?? normalized.file;

  // File upload from Lake's file picker
  if (payload instanceof File) {
    // Non-image files (PDF, doc, zip, audio, video, etc.) → 资产落盘（与图片同构的附件）
    if (!isImageFile(payload)) {
      return uploadAttachmentFile(payload, noteId, options);
    }
    // Image files → preserve the detected source format (including animated GIF/WebP)
    const input = normalizeImageInput(new Uint8Array(await payload.arrayBuffer()), payload.name || "image");
    return uploadWithOriginalFormat(input, noteId, options);
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
  // - 移动端（Capacitor 原生桥，无主进程下载 IPC）：渲染层下载后交原生桥落盘为资产，
  //   与桌面同构（不能内嵌 base64 进正文，否则文档膨胀且不走 S3 同步）。
  // - 纯浏览器演示模式（无原生桥）：尽力而为的直连并内嵌 data URL，仍带大小限制与字面私网/本机拦截。
  if (typeof payload === "string" && (payload.startsWith("http://") || payload.startsWith("https://"))) {
    if (options.allowRemoteDownload === false) {
      throw new Error("这里暂不支持直接插入网络图片，请先把图片保存到本地再拖入或粘贴");
    }
    if (isDesktop()) {
      return native.downloadRemoteResource(payload, noteId);
    }
    const downloaded = await downloadRemoteBytes(payload);
    if (hasNativeBridge()) {
      return native.uploadResource(
        downloaded.mime.startsWith("image/")
          ? normalizeImageInput(downloaded.bytes, downloaded.filename)
          : { bytes: downloaded.bytes, filename: downloaded.filename },
        noteId
      );
    }
    return embedAsDataUrl(downloaded);
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

async function uploadWithOriginalFormat(input: ResourceUploadInput, noteId: string, options: ResourceUploadOptions = {}): Promise<ResourceUploadOutput> {
  // Do not rasterize WebP/AVIF here: an animated WebP/GIF must remain animated.
  // PNG conversion is still intentionally kept in electron/assetServer.ts for
  // clipboard export to applications that cannot consume WebP/AVIF data URLs.
  return options.saveResource ? options.saveResource(input) : native.uploadResource(input, noteId);
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

interface DownloadedRemote {
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

/** 渲染层下载（移动端 / 浏览器演示共用）：逐跳校验（协议 + 字面 host），流式限量 25 MiB。
 * 只负责取回原始字节；落盘（移动端 native.uploadResource）还是内嵌（纯 web）由调用方决定。 */
async function downloadRemoteBytes(initialUrl: string): Promise<DownloadedRemote> {
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
    return { bytes: merged, mime: contentType.split(";")[0] || "application/octet-stream", filename };
  }
}

/** 纯浏览器演示（无原生桥）：图片校验格式后内嵌，非图片按 base64 内嵌，都不落盘。 */
function embedAsDataUrl(downloaded: DownloadedRemote): ResourceUploadOutput {
  if (!downloaded.mime.startsWith("image/")) {
    const url = `data:${downloaded.mime};base64,${bytesToBase64(downloaded.bytes)}`;
    return { url, resourceRef: url, filename: downloaded.filename, mimeType: downloaded.mime, size: downloaded.bytes.length };
  }
  return imageDataUrl(normalizeImageInput(downloaded.bytes, downloaded.filename));
}

/** Uint8Array → base64（无原生层的演示模式用；分块避免参数栈溢出）。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
