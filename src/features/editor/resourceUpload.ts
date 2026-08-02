import { native } from "../../lib/native";
import type { ResourceUploadInput, ResourceUploadOutput } from "../../lib/types";
import { MAX_IMAGE_BYTES, normalizeImageInput, sniffImageFormat } from "./imageFormat";
import { createConcurrencyQueue } from "../../lib/concurrency";
import { withRetry } from "../../lib/retry";
import { WorkerPool } from "../../lib/workerPool";

interface LakeUploadRequest {
  type?: "url" | "file" | "base64";
  data?: File | string;
  file?: File | string;
}

const uploadQueue = createConcurrencyQueue(6);

let imageConverterPool: WorkerPool | null = null;

function getImageConverterPool(): WorkerPool {
  if (!imageConverterPool) {
    imageConverterPool = new WorkerPool(
      () => new Worker(new URL("../../lib/imageConverter.worker.ts", import.meta.url), { type: "module" }),
      4
    );
  }
  return imageConverterPool;
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

/** Convert a File to a base64 data URL (for non-image attachments) */
async function fileToBase64DataUrl(file: File): Promise<ResourceUploadOutput> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const mime = file.type || "application/octet-stream";
  const url = `data:${mime};base64,${btoa(binary)}`;
  return {
    url,
    resourceRef: url,
    filename: file.name || "attachment",
    mimeType: mime,
    size: bytes.length,
  };
}

async function performUpload(request: unknown, noteId: string): Promise<ResourceUploadOutput> {
  const normalized = request as LakeUploadRequest;
  const payload = request instanceof File ? request : normalized.data ?? normalized.file;

  // File upload from Lake's file picker
  if (payload instanceof File) {
    // Non-image files (PDF, doc, zip, etc.) → base64 data URL directly
    if (!isImageFile(payload)) {
      return fileToBase64DataUrl(payload);
    }
    // Image files → existing image pipeline (with WebP conversion etc.)
    const input = normalizeImageInput(Array.from(new Uint8Array(await payload.arrayBuffer())), payload.name || "image");
    return uploadWithWebpConversion(input, noteId);
  }

  // Already-local data URL: pasted base64 image from local clipboard
  if (typeof payload === "string" && payload.startsWith("data:")) {
    // Non-image data URLs pass through as-is
    if (!payload.startsWith("data:image/")) {
      return { url: payload, resourceRef: payload, filename: "attachment", mimeType: payload.split(";")[0].replace("data:", ""), size: 0 };
    }
    const input = dataUrlInput(payload);
    return uploadWithWebpConversion(input, noteId);
  }

  // External URL: 优先走主进程下载（对齐 Tauri 版 Rust 后端——下载在原生层完成，
  // 可带 Referer/浏览器 UA 绕过防盗链、无渲染进程 CORS 限制、有 SSRF 防护与大小限制），
  // 失败时回退到渲染进程 fetch（例如主进程 SSRF 策略拒绝的本地/私网地址）。
  if (typeof payload === "string" && (payload.startsWith("http://") || payload.startsWith("https://"))) {
    try {
      return await native.downloadRemoteResource(payload, noteId);
    } catch (nativeError) {
      try {
        const resp = await fetch(payload);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const contentType = resp.headers.get("content-type") || "";
        // 与主进程一致：流式读取 + 25 MiB 上限，防止大响应撑爆渲染进程内存
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
        const bytes = Array.from(merged);
        const filename = new URL(payload).pathname.split("/").pop() || "file";

        // Non-image URL → base64 data URL
        if (!contentType.startsWith("image/")) {
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
          }
          const mime = contentType.split(";")[0] || "application/octet-stream";
          const url = `data:${mime};base64,${btoa(binary)}`;
          return { url, resourceRef: url, filename, mimeType: mime, size: bytes.length };
        }

        const input = normalizeImageInput(bytes, filename);
        return uploadWithWebpConversion(input, noteId);
      } catch (fetchError) {
        if (nativeError instanceof Error && nativeError.message.includes("浏览器模式")) throw nativeError;
        throw new Error(`资源下载失败：${String(nativeError || fetchError)}`);
      }
    }
  }

  throw new Error("无法识别的上传内容");
}

function dataUrlInput(value: string): ResourceUploadInput {
  const [header, encoded = ""] = value.split(",", 2);
  if (!/^data:[^;]+;base64$/i.test(header)) throw new Error("图片 Data URL 格式无效");
  const binary = atob(encoded);
  return normalizeImageInput(Array.from(binary, (character) => character.charCodeAt(0)), "image");
}

async function uploadWithWebpConversion(input: ResourceUploadInput, noteId: string): Promise<ResourceUploadOutput> {
  const format = sniffImageFormat(input.bytes);
  if (format && (format.mimeType === "image/webp" || format.mimeType === "image/avif")) {
    try {
      const pool = getImageConverterPool();
      const pngBytes = await pool.convertToPng(input.bytes, format.mimeType);
      const pngInput: ResourceUploadInput = {
        bytes: pngBytes,
        filename: input.filename.replace(/\.[^./\\]+$/, ".png"),
      };
      return native.uploadResource(pngInput, noteId);
    } catch (error) {
      console.warn("Failed to convert image to PNG, uploading original:", error);
      return native.uploadResource(input, noteId);
    }
  }
  return native.uploadResource(input, noteId);
}

export function getUploadQueueStatus() {
  return {
    uploadQueue: uploadQueue.status,
    workerPool: imageConverterPool?.status ?? null,
  };
}

export function cleanupUploadResources(): void {
  if (imageConverterPool) {
    imageConverterPool.terminate();
    imageConverterPool = null;
  }
}
