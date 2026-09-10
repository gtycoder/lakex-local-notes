import { describe, expect, it } from "vitest";
import { QuickNoteModelError } from "./quickNoteModel";
import {
  MAX_QUICK_NOTE_TEXT_LENGTH,
  buildQuickNoteImageFiles,
  normalizeQuickNoteContent,
  parseQuickNoteContent,
  previewQuickNote,
  serializeQuickNoteContent,
  validateQuickNoteContent,
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
} from "./quickNoteModel";
import { MAX_IMAGE_BYTES } from "./storeLimits";

const image = {
  id: "img-1",
  filename: "1234567890123_deadbeef.png",
  mimeType: "image/png",
  width: 16,
  height: 12,
  size: 4,
  hash: "a".repeat(64),
};

describe("quickNoteModel", () => {
  it("normalizes valid content and rejects empty/oversized text", () => {
    expect(normalizeQuickNoteContent(" hello ", [])).toEqual({ version: 1, text: " hello ", images: [] });
    expect(() => normalizeQuickNoteContent("", [])).toThrow("请至少记录文字或一张图片");
    expect(() => normalizeQuickNoteContent("x".repeat(MAX_QUICK_NOTE_TEXT_LENGTH + 1), [])).toThrow("小记正文过长");
  });

  it("validates image metadata, duplicate IDs, and unsafe paths", () => {
    expect(validateQuickNoteContent({ version: 1, text: "", images: [image] }).images[0]).toEqual(image);
    expect(() => validateQuickNoteContent({ version: 1, text: "x", images: [{ ...image, id: "../bad" }] })).toThrow("小记图片元数据无效");
    expect(() => validateQuickNoteContent({ version: 1, text: "x", images: [image, image] })).toThrow("小记图片元数据无效");
    expect(() => validateQuickNoteContent({ version: 1, text: "x", images: [{ ...image, mimeType: "text/plain" }] })).toThrow("小记图片元数据无效");
  });

  it("round-trips canonical JSON without runtime URLs", () => {
    const content = normalizeQuickNoteContent("hello", [image]);
    const encoded = serializeQuickNoteContent(content);
    const parsed = validateQuickNoteContent(parseQuickNoteContent(encoded));
    expect(parsed).toEqual(content);
    expect(encoded).toContain('"version": 1');
    expect(encoded).not.toContain("url");
  });

  it("creates stable previews for text, images, and empty content", () => {
    expect(previewQuickNote("  hello\nworld  ", 0)).toBe("hello world");
    expect(previewQuickNote("", 1)).toBe("[图片]");
    expect(previewQuickNote("", 0)).toBe("");
    expect(previewQuickNote("x".repeat(140), 0)).toHaveLength(120);
  });

  it("preserves AppError classification for invalid persisted data", () => {
    try { validateQuickNoteContent(null); } catch (error) {
      expect(error).toBeInstanceOf(QuickNoteModelError);
      expect((error as QuickNoteModelError).kind).toBe("InvalidInput");
    }
  });
});

describe("buildQuickNoteImageFiles", () => {
  const bytes = (seed: number): Uint8Array => new Uint8Array([137, 80, 78, 71, seed, seed, seed, seed]);

  it("content 引用的 filename 与落盘文件名一致（防 double buildAssetFilename 回归：真机踩过同步找不到文件）", () => {
    const { images, files } = buildQuickNoteImageFiles([
      { filename: "photo.png", mimeType: "image/png", width: 10, height: 10, bytes: bytes(1) },
      { filename: "clip.jpg", mimeType: "image/jpeg", width: 20, height: 20, bytes: bytes(2) },
    ]);
    expect(images.map((i) => i.filename)).toEqual(files.map((f) => f.filename));
    expect(images).toHaveLength(2);
    for (const img of images) {
      expect(img.filename).toMatch(/^\d{13}_[0-9a-f]{8}\.(png|jpg)$/);
    }
    expect(images[0].size).toBe(8);
    expect(images[0].mimeType).toBe("image/png");
  });

  it("同原始文件名两次调用生成不同唯一名（同名不覆盖）", () => {
    const a = buildQuickNoteImageFiles([{ filename: "same.png", mimeType: "image/png", width: null, height: null, bytes: bytes(1) }]);
    const b = buildQuickNoteImageFiles([{ filename: "same.png", mimeType: "image/png", width: null, height: null, bytes: bytes(2) }]);
    expect(a.images[0].filename).not.toBe(b.images[0].filename);
  });

  it("空输入返回空（不生成文件）", () => {
    const { images, files } = buildQuickNoteImageFiles([]);
    expect(images).toHaveLength(0);
    expect(files).toHaveLength(0);
  });

  it("生成的 content 可通过 validateQuickNoteContent（与同步/持久化链路一致）", () => {
    const { images } = buildQuickNoteImageFiles([
      { filename: "ok.png", mimeType: "image/png", width: 5, height: 5, bytes: bytes(3) },
    ]);
    const content = normalizeQuickNoteContent("带图", images);
    const serialized = serializeQuickNoteContent(content);
    expect(validateQuickNoteContent(JSON.parse(serialized)).images[0].filename).toBe(images[0].filename);
  });
});

describe("quick-note image validation", () => {
  const pngMagic = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

  it("accepts supported magic bytes and rejects SVG or empty input", () => {
    expect(validateQuickNoteImageBytes(pngMagic)).toEqual({ mimeType: "image/png", extension: "png" });
    expect(() => validateQuickNoteImageBytes(new Uint8Array())).toThrow("图片为空或超过 25 MiB");
    expect(() => validateQuickNoteImageBytes(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")))
      .toThrow("仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
  });

  it("rejects images above the protocol size and decoded pixel limits", () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set(pngMagic);
    expect(() => validateQuickNoteImageBytes(oversized)).toThrow("图片为空或超过 25 MiB");
    expect(() => validateQuickNoteImageDimensions({ width: 10_000, height: 5_001 }))
      .toThrow("图片尺寸过大");
  });
});
