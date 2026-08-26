import type { ResourceUploadInput, ResourceUploadOutput } from "../../lib/types";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface ImageFormat {
  mimeType: string;
  extension: string;
}

interface ValidatedImageInput extends ResourceUploadInput {
  format: ImageFormat;
}

export function sniffImageFormat(bytes: ArrayLike<number>): ImageFormat | null {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mimeType: "image/png", extension: "png" };
  if (startsWith(0xff, 0xd8, 0xff)) return { mimeType: "image/jpeg", extension: "jpg" };
  if (startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)) return { mimeType: "image/gif", extension: "gif" };
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mimeType: "image/webp", extension: "webp" };
  const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && (brand === "avif" || brand === "avis")) return { mimeType: "image/avif", extension: "avif" };
  return null;
}

export function normalizeImageInput(bytes: Uint8Array, filename: string): ResourceUploadInput {
  const validated = validateImageInput(bytes, filename);
  return { bytes: validated.bytes, filename: validated.filename };
}

function validateImageInput(bytes: Uint8Array, filename: string): ValidatedImageInput {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("图片为空或超过 25 MiB");
  const format = sniffImageFormat(bytes);
  if (!format) throw new Error("仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
  const stem = filename.replace(/\.[^./\\]+$/, "") || "image";
  return { bytes, filename: `${stem}.${format.extension}`, format };
}

export function imageDataUrl(input: ResourceUploadInput): ResourceUploadOutput {
  const normalized = validateImageInput(input.bytes, input.filename);
  let binary = "";
  for (let offset = 0; offset < normalized.bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...normalized.bytes.slice(offset, offset + 0x8000));
  }
  const url = `data:${normalized.format.mimeType};base64,${btoa(binary)}`;
  return { url, resourceRef: url, filename: normalized.filename, mimeType: normalized.format.mimeType, size: normalized.bytes.length };
}
