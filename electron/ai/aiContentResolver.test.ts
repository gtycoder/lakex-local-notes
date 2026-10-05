import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractPdfText: vi.fn(async () => ({ text: "PDF 正文", pages: 1, truncated: false })),
}));
vi.mock("./pdfText.js", () => ({ extractPdfText: mocks.extractPdfText }));

const { resolveAiMessages } = await import("./aiContentResolver.js");
type Reader = import("./aiContentResolver.js").AiAssetReader;

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function reader(files: Record<string, { bytes: Buffer; mimeType: string }>): Reader {
  return {
    readAssetBytes(noteId, filename) {
      const file = files[noteId + "/" + filename];
      return file ? { bytes: file.bytes, mimeType: file.mimeType, size: file.bytes.length } : null;
    },
  };
}

describe("内容块 → 供应商消息", () => {
  it("图片 → image_url data URL；PDF → 带文件名标题的文本块；文本顺序保持", async () => {
    const out = await resolveAiMessages(
      [{ role: "user", content: [
        { type: "text", text: "看图" },
        { type: "image", asset: { noteId: "n", filename: "a.png", name: "图.png" } },
        { type: "document", asset: { noteId: "n", filename: "b.pdf", name: "报告.pdf" } },
      ] }],
      reader({
        "n/a.png": { bytes: PNG_1PX, mimeType: "image/png" },
        "n/b.pdf": { bytes: Buffer.from("%PDF-1.4"), mimeType: "application/pdf" },
      }),
    );
    const parts = out[0].content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
    expect(parts[0]).toEqual({ type: "text", text: "看图" });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url!.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(parts[2]).toEqual({ type: "text", text: "【附件：报告.pdf】\nPDF 正文" });
  });

  it("纯文本消息原样透传（不建内容块）", async () => {
    await expect(resolveAiMessages([{ role: "user", content: "hi" }], reader({})))
      .resolves.toEqual([{ role: "user", content: "hi" }]);
  });

  it("附件不存在 → 明确报错", async () => {
    await expect(resolveAiMessages(
      [{ role: "user", content: [{ type: "image", asset: { noteId: "n", filename: "x.png" } }] }],
      reader({}),
    )).rejects.toThrow(/不存在/);
  });

  it("document 块不是 PDF → 明确报错（当前仅 PDF）", async () => {
    await expect(resolveAiMessages(
      [{ role: "user", content: [{ type: "document", asset: { noteId: "n", filename: "a.docx" } }] }],
      reader({ "n/a.docx": { bytes: Buffer.from("x"), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } }),
    )).rejects.toThrow(/仅支持 PDF/);
  });
});
