import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractText: vi.fn(),
  destroy: vi.fn(async () => {}),
}));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({ destroy: mocks.destroy })),
  extractText: mocks.extractText,
}));

const { AI_PDF_MAX_CHARS, clearPdfTextCache, extractPdfText } = await import("./pdfText.js");

beforeEach(() => {
  mocks.extractText.mockReset();
  mocks.destroy.mockClear();
  clearPdfTextCache();
});

describe("PDF 文本抽取（主进程）", () => {
  it("合并各页文本", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 2, text: "hello pdf" });
    await expect(extractPdfText(Buffer.from("%PDF-1.4"))).resolves.toEqual({ text: "hello pdf", pages: 2, truncated: false });
  });

  it("超长截断并标记", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 1, text: "x".repeat(AI_PDF_MAX_CHARS + 10) });
    const r = await extractPdfText(Buffer.from("%PDF-1.4"));
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("已截断");
  });

  it("没有可提取文字（扫描件）明确报错", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 1, text: "   " });
    await expect(extractPdfText(Buffer.from("%PDF-1.4"))).rejects.toThrow(/扫描件/);
  });

  it("同一 cacheKey 第二次走缓存，不再解析", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 1, text: "cached" });
    await extractPdfText(Buffer.from("%PDF-1.4"), "n1/a.pdf/3");
    await extractPdfText(Buffer.from("%PDF-1.4"), "n1/a.pdf/3");
    expect(mocks.extractText).toHaveBeenCalledTimes(1);
  });

  it("超过上限直接拒绝，不进入解析", async () => {
    await expect(extractPdfText(Buffer.alloc(33 * 1024 * 1024))).rejects.toThrow(/过大/);
    expect(mocks.extractText).not.toHaveBeenCalled();
  });
});
