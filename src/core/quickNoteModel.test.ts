import { describe, expect, it } from "vitest";
import { QuickNoteModelError } from "./quickNoteModel";
import {
  MAX_QUICK_NOTE_TEXT_LENGTH,
  normalizeQuickNoteContent,
  parseQuickNoteContent,
  previewQuickNote,
  serializeQuickNoteContent,
  validateQuickNoteContent,
} from "./quickNoteModel";

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