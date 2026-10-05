import sharp from "sharp";
import { AppError } from "../../src/core/storeErrors.js";

/** 图片硬约束：供应商单边上限 8192px（>=15 张时 4096）；我们统一更保守。 */
export const AI_IMAGE_MAX_DIMENSION = 4096;
/** 透传 / 归一化后的单图字节上限。 */
export const AI_IMAGE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 按**内容**嗅探图片格式（供应商也按内容判断，不看扩展名 / MIME）。 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIG)) return "image/png";
  if (bytes.length >= 6) {
    const sig = bytes.subarray(0, 6).toString("latin1");
    if (sig === "GIF87a" || sig === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/**
 * 本地图片 → data URL。
 * 已是 4 种受支持格式、且尺寸 / 字节在限内 → **原样透传**（不重编码，保真且省 CPU）；
 * 否则用 sharp 归一化 / 缩放（透明保 PNG，其余 JPEG）。
 */
export async function toImageDataUrl(bytes: Buffer, name: string): Promise<string> {
  const sniffed = sniffImageMime(bytes);
  const meta = await sharp(bytes, { failOn: "none" }).metadata().catch(() => null);
  const width = meta?.width ?? 0;
  const height = meta?.height ?? 0;
  const withinDimension = width > 0 && height > 0 && Math.max(width, height) <= AI_IMAGE_MAX_DIMENSION;
  const withinBytes = bytes.length <= AI_IMAGE_MAX_OUTPUT_BYTES;
  if (sniffed && withinDimension && withinBytes) return "data:" + sniffed + ";base64," + bytes.toString("base64");
  const hasAlpha = Boolean(meta?.hasAlpha);
  const resized = sharp(bytes, { failOn: "none" }).rotate().resize({
    width: AI_IMAGE_MAX_DIMENSION,
    height: AI_IMAGE_MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });
  const out = await (hasAlpha ? resized.png() : resized.jpeg({ quality: 85 })).toBuffer().catch(() => null);
  if (!out || out.length === 0) throw new AppError("InvalidInput", "无法读取图片：" + name);
  if (out.length > AI_IMAGE_MAX_OUTPUT_BYTES) throw new AppError("InvalidInput", "图片过大，无法发送：" + name);
  return "data:" + (hasAlpha ? "image/png" : "image/jpeg") + ";base64," + out.toString("base64");
}
