/**
 * AI 图片附件（261023 P2）：
 *  · 拍照/相册 → 前端压缩（长边 1600 / ≤1MB JPEG）→ 临时 data URL（本轮发送，不落笔记资源）；
 *  · 资料文档里的图片 → 只传 `{noteId, filename}` 引用，原生读文件（字节不过 WebView）；
 *  · 单次 ≤10 张（对齐桌面 AI_MAX_IMAGES）。
 */
import type { AiRequestPart } from "../native/aiChat";

export const AI_IMAGES_MAX = 10;
export const AI_IMAGE_MAX_EDGE = 1600;
export const AI_IMAGE_MAX_BYTES = 1024 * 1024;

export type AiPendingImage =
  | { id: string; kind: "temp"; dataUrl: string; mimeType: string; bytes: number }
  | { id: string; kind: "asset"; noteId: string; filename: string; title: string; dataUrl?: string };

/** 压缩一张本地图片（createImageBitmap + canvas；无 canvas 环境返回 null）。 */
export async function compressImageFile(file: File): Promise<{ dataUrl: string; mimeType: string; bytes: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, AI_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const bytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
      if (bytes <= AI_IMAGE_MAX_BYTES) return { dataUrl, mimeType: "image/jpeg", bytes };
    }
    return null;
  } catch {
    return null;
  }
}

export function canAddImage(current: number): string | null {
  return current >= AI_IMAGES_MAX ? "一次最多发送 " + AI_IMAGES_MAX + " 张图片" : null;
}

/** 待发送图片 → 请求内容块（text 由调用方另加）。 */
export function imagePartsOf(images: readonly AiPendingImage[]): AiRequestPart[] {
  return images.slice(0, AI_IMAGES_MAX).map((image) => image.kind === "asset"
    ? ({ type: "image", asset: { noteId: image.noteId, filename: image.filename } } as AiRequestPart)
    : ({ type: "image", dataUrl: image.dataUrl } as AiRequestPart));
}
