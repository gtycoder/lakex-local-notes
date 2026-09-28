/**
 * 图片工具（V5 Phase 2）：签名全部改为 Uint8Array，解绑 node:buffer ——
 * 不再 import Buffer，移动端/纯逻辑消费方可直接复用。
 * Buffer 是 Uint8Array 子类，既有调用方传 Buffer 不受影响。
 */

export interface ImageFormat {
  mimeType: string;
  extension: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const ASCII = new TextDecoder("ascii");

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array): string {
  return ASCII.decode(bytes);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 8 && bytesEqual(bytes.subarray(0, 8), PNG_MAGIC)) return { mimeType: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (ascii(bytes.subarray(0, 6)) === "GIF87a" || ascii(bytes.subarray(0, 6)) === "GIF89a") return { mimeType: "image/gif", extension: "gif" };
  if (bytes.length >= 12 && ascii(bytes.subarray(0, 4)) === "RIFF" && ascii(bytes.subarray(8, 12)) === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  if (bytes.length >= 12 && ascii(bytes.subarray(4, 8)) === "ftyp" && ["avif", "avis"].includes(ascii(bytes.subarray(8, 12)))) return { mimeType: "image/avif", extension: "avif" };
  return null;
}

/** Decode-free dimensions for common raster formats, used before sharp/libvips. */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length >= 24 && bytesEqual(bytes.subarray(0, 8), PNG_MAGIC) && ascii(bytes.subarray(12, 16)) === "IHDR") {
    return { width: view(bytes).getUint32(16), height: view(bytes).getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xd9) break;
      const segmentLength = view(bytes).getUint16(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: view(bytes).getUint16(offset + 5), width: view(bytes).getUint16(offset + 7) };
      }
      offset += 2 + segmentLength;
    }
  }
  if (bytes.length >= 10 && (ascii(bytes.subarray(0, 6)) === "GIF87a" || ascii(bytes.subarray(0, 6)) === "GIF89a")) {
    return { width: view(bytes).getUint16(6, true), height: view(bytes).getUint16(8, true) };
  }
  if (bytes.length >= 30 && ascii(bytes.subarray(0, 4)) === "RIFF" && ascii(bytes.subarray(8, 12)) === "WEBP" && ascii(bytes.subarray(12, 16)) === "VP8X") {
    return { width: (view(bytes).getUint32(24, true) & 0x00ff_ffff) + 1, height: (view(bytes).getUint32(27, true) & 0x00ff_ffff) + 1 };
  }
  return null;
}
