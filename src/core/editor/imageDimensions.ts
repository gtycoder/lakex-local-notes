/**
 * 从 **data URL 的 base64 头部**同步解析图片像素尺寸（原图尺寸的单一来源）。
 *
 * 为什么需要它（task-82 / HANDOFF §3 P1「图片缩略残余」①）：复制图片物化时，
 * `<img width/height>` 必须是**原图像素尺寸**；浏览器里能拿到的 `image.width/height` 是**渲染/显示尺寸**
 * （卡片宽度、`?w=1024` 缩略档位），把它写进剪贴板/正文会让接收方按错误的原尺寸重新排版。
 * 同步 XHR 取回的原图字节就在 data URL 里 ⇒ 只解头部即可拿到真实尺寸，无需整串 atob（大图不能卡主线程）。
 *
 * 覆盖 PNG / JPEG / GIF / WebP（含 VP8 / VP8L / VP8X 三种块）；其它格式（avif/bmp/svg…）返回 null，
 * 由调用方**省略尺寸**（宁可不写，也不写显示尺寸）。纯函数、零 DOM 依赖。
 */

export interface ImagePixelSize {
  width: number;
  height: number;
}

/** 只解 data URL 头部这么多 base64 字符（≈6KB 原始字节）：PNG/GIF/WebP 头在前 30B，JPEG SOF 也远早于此。 */
const HEAD_BASE64_CHARS = 8192;

function dataUrlBase64(value: string): string | null {
  const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  return match[1].replace(/\s/g, "");
}

function readHeadBytes(payload: string): Uint8Array | null {
  try {
    const chars = Math.min(payload.length, Math.floor(HEAD_BASE64_CHARS / 4) * 4);
    const binary = atob(payload.slice(0, chars));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const be16 = (bytes: Uint8Array, at: number): number => (bytes[at] << 8) | bytes[at + 1];
const le16 = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8);
const be32 = (bytes: Uint8Array, at: number): number => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const le24 = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
const le32 = (bytes: Uint8Array, at: number): number => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

const isPng = (b: Uint8Array): boolean => b.length >= 24
  && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;

const isGif = (b: Uint8Array): boolean => b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;

const isWebp = (b: Uint8Array): boolean => b.length >= 25   // VP8L 最小 25B（VP8/VP8X 在 webpSize 内再判长度）
  && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
  && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;

const isJpeg = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8;

function webpSize(b: Uint8Array): ImagePixelSize | null {
  if (b.length < 25) return null;   // 最小块 = VP8L 头（0-24）
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8 ") {
    if (b.length < 30) return null;
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = le32(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    if (b.length < 30) return null;
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return null;
}

/** JPEG：从第 2 字节起扫 marker，取第一个 SOF（C0-C3/C5-C7/C9-CB/CD-CF）的宽高。 */
function jpegSize(b: Uint8Array): ImagePixelSize | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) { at += 1; continue; }
    const marker = b[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = be16(b, at + 2);
    if (length < 2) return null;
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) return { width: be16(b, at + 7), height: be16(b, at + 5) };
    at += 2 + length;
  }
  return null;
}

/** data URL → 原图像素尺寸；非 data URL / 不支持的格式 / 头不完整 ⇒ null（调用方省略尺寸）。 */
export function imageSizeFromDataUrl(dataUrl: string): ImagePixelSize | null {
  const payload = dataUrlBase64(dataUrl);
  if (!payload) return null;
  const bytes = readHeadBytes(payload);
  if (!bytes) return null;
  const size = isPng(bytes)
    ? { width: be32(bytes, 16), height: be32(bytes, 20) }
    : isGif(bytes)
      ? { width: le16(bytes, 6), height: le16(bytes, 8) }
      : isWebp(bytes)
        ? webpSize(bytes)
        : isJpeg(bytes)
          ? jpegSize(bytes)
          : null;
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
  if (size.width <= 0 || size.height <= 0 || size.width > 100_000 || size.height > 100_000) return null;
  return size;
}
