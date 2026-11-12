import { describe, expect, it } from "vitest";
import { imageSizeFromDataUrl } from "./imageDimensions.js";

/**
 * task-82：复制物化时的**原图尺寸**解析（PNG/JPEG/GIF/WebP）——只解头部，不解整串 base64。
 * 判据：拿不到就返回 null（调用方省略尺寸），**绝不**回落到显示尺寸。
 */
const toDataUrl = (mime: string, bytes: number[]): string => `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

/** 真实 1×1 PNG（仅借它拿到合法 PNG 头；下面按需改 IHDR 宽高，不重算 CRC —— 解析器只读头）。 */
const PNG_1PX_BYTES = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const pngBytes = (width: number, height: number): number[] => {
  const bytes = Array.from(PNG_1PX_BYTES);
  bytes[16] = (width >>> 24) & 0xff; bytes[17] = (width >>> 16) & 0xff; bytes[18] = (width >>> 8) & 0xff; bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff; bytes[21] = (height >>> 16) & 0xff; bytes[22] = (height >>> 8) & 0xff; bytes[23] = height & 0xff;
  return bytes;
};
const gifBytes = (width: number, height: number): number[] => [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 0xff, (width >>> 8) & 0xff, height & 0xff, (height >>> 8) & 0xff, 0, 0];
/** VP8X：12-15 块名，24-26 宽-1（LE24），27-29 高-1（LE24）。 */
const webpVp8xBytes = (width: number, height: number): number[] => {
  const bytes = new Array(30).fill(0);
  bytes[0] = 0x52; bytes[1] = 0x49; bytes[2] = 0x46; bytes[3] = 0x46;
  bytes[8] = 0x57; bytes[9] = 0x45; bytes[10] = 0x42; bytes[11] = 0x50;
  bytes[12] = 0x56; bytes[13] = 0x50; bytes[14] = 0x38; bytes[15] = 0x58;
  const w = width - 1; const h = height - 1;
  bytes[24] = w & 0xff; bytes[25] = (w >>> 8) & 0xff; bytes[26] = (w >>> 16) & 0xff;
  bytes[27] = h & 0xff; bytes[28] = (h >>> 8) & 0xff; bytes[29] = (h >>> 16) & 0xff;
  return bytes;
};
/** VP8L：20 固定 0x2f，21-24 位域（宽 14bit，高 14bit，均 -1 存）。 */
const webpVp8lBytes = (width: number, height: number): number[] => {
  const bytes = new Array(25).fill(0);
  bytes[0] = 0x52; bytes[1] = 0x49; bytes[2] = 0x46; bytes[3] = 0x46;
  bytes[8] = 0x57; bytes[9] = 0x45; bytes[10] = 0x42; bytes[11] = 0x50;
  bytes[12] = 0x56; bytes[13] = 0x50; bytes[14] = 0x38; bytes[15] = 0x4c;
  bytes[20] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  bytes[21] = bits & 0xff; bytes[22] = (bits >>> 8) & 0xff; bytes[23] = (bits >>> 16) & 0xff; bytes[24] = (bits >>> 24) & 0xff;
  return bytes;
};
/** VP8（有损）：26-27 宽（14bit），28-29 高（14bit），23-25 起始码 9d 01 2a。 */
const webpVp8Bytes = (width: number, height: number): number[] => {
  const bytes = new Array(30).fill(0);
  bytes[0] = 0x52; bytes[1] = 0x49; bytes[2] = 0x46; bytes[3] = 0x46;
  bytes[8] = 0x57; bytes[9] = 0x45; bytes[10] = 0x42; bytes[11] = 0x50;
  bytes[12] = 0x56; bytes[13] = 0x50; bytes[14] = 0x38; bytes[15] = 0x20;
  bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a;
  bytes[26] = width & 0xff; bytes[27] = (width >>> 8) & 0xff;
  bytes[28] = height & 0xff; bytes[29] = (height >>> 8) & 0xff;
  return bytes;
};
/** JPEG：SOI + SOF0（长度 0x11，精度 8，高 BE16，宽 BE16）。 */
const jpegBytes = (width: number, height: number): number[] => [
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  (height >>> 8) & 0xff, height & 0xff,
  (width >>> 8) & 0xff, width & 0xff,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
];

describe("imageSizeFromDataUrl（原图尺寸解析）", () => {
  const cases: Array<[string, string, { width: number; height: number }]> = [
    ["PNG 4×3", toDataUrl("image/png", pngBytes(4, 3)), { width: 4, height: 3 }],
    ["PNG 1×1（真实文件）", `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="}`, { width: 1, height: 1 }],
    ["GIF 7×5", toDataUrl("image/gif", gifBytes(7, 5)), { width: 7, height: 5 }],
    ["WebP VP8X 9×7", toDataUrl("image/webp", webpVp8xBytes(9, 7)), { width: 9, height: 7 }],
    ["WebP VP8L 11×6", toDataUrl("image/webp", webpVp8lBytes(11, 6)), { width: 11, height: 6 }],
    ["WebP VP8 13×10", toDataUrl("image/webp", webpVp8Bytes(13, 10)), { width: 13, height: 10 }],
    ["JPEG 12×8", toDataUrl("image/jpeg", jpegBytes(12, 8)), { width: 12, height: 8 }],
    ["JPEG 大尺寸（SOF 在后）", toDataUrl("image/jpeg", [...jpegBytes(1600, 1200), 0xff, 0xd9]), { width: 1600, height: 1200 }],
  ];
  for (const [name, dataUrl, expected] of cases) {
    it(name, () => {
      expect(imageSizeFromDataUrl(dataUrl)).toEqual(expected);
    });
  }

  it("不支持的格式 / 非 data URL / 头不完整 ⇒ null（调用方必须省略尺寸，不得回落显示尺寸）", () => {
    expect(imageSizeFromDataUrl("https://example.com/a.png")).toBeNull();
    expect(imageSizeFromDataUrl("data:image/avif;base64,AAAA")).toBeNull();
    expect(imageSizeFromDataUrl("data:image/png;base64,!!notbase64!!")).toBeNull();
    expect(imageSizeFromDataUrl(toDataUrl("image/png", [0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(imageSizeFromDataUrl(toDataUrl("image/svg+xml", [0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });
});
