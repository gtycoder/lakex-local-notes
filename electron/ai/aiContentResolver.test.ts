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


describe("本机文件附件（261116 第四稿）", () => {
  const localFiles = (files: Record<string, { bytes: Buffer; mimeType: string; name: string }>) => ({
    readLocalFile(ref: { token: string }) {
      const file = files[ref.token];
      return file ? { bytes: file.bytes, mimeType: file.mimeType, name: file.name, size: file.bytes.length } : null;
    },
  });
  const textRef = (name: string) => ({ kind: "local" as const, token: name, name, size: 10, mimeType: "text/plain" });

  it("文本/代码 → 带文件名的 text 块；图片 → image_url；顺序保持", async () => {
    const out = await resolveAiMessages(
      [{ role: "user", content: [
        { type: "text", text: "看看这些" },
        { type: "local_file", file: textRef("main.ts") },
        { type: "local_file", file: { kind: "local", token: "img", name: "shot.png", size: PNG_1PX.length, mimeType: "image/png" } },
      ] }],
      reader({}),
      localFiles({
        "main.ts": { bytes: Buffer.from("export const x = 1;\n"), mimeType: "text/plain", name: "main.ts" },
        img: { bytes: PNG_1PX, mimeType: "image/png", name: "shot.png" },
      }),
    );
    const parts = out[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]).toEqual({ type: "text", text: "看看这些" });
    expect(parts[1].type).toBe("text");
    expect(parts[1].text).toContain("【附件：main.ts】");
    expect(parts[1].text).toContain("export const x");
    expect(parts[2].type).toBe("image_url");
    expect(parts[2].image_url?.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("PDF/未知二进制 → 明确拒绝（Phase 2 文案）；失效 token → 请重新选择", async () => {
    const pdf = [{ type: "local_file" as const, file: { kind: "local" as const, token: "pdf", name: "a.pdf", size: 10, mimeType: "application/pdf" } }];
    await expect(resolveAiMessages([{ role: "user", content: pdf }], reader({}), localFiles({ pdf: { bytes: Buffer.from("%PDF"), mimeType: "application/pdf", name: "a.pdf" } })))
      .rejects.toThrow(/暂不支持该文件类型：a\.pdf.*Phase 2/);
    await expect(resolveAiMessages([{ role: "user", content: pdf }], reader({}), localFiles({})))
      .rejects.toThrow(/本机文件附件已失效/);
  });

  it("文本附件过大 → 可执行错误（上限 200KB）", async () => {
    const big = Buffer.alloc(200 * 1024 + 1, 97);
    await expect(resolveAiMessages(
      [{ role: "user", content: [{ type: "local_file", file: { kind: "local", token: "big", name: "big.txt", size: big.length, mimeType: "text/plain" } }] }],
      reader({}),
      localFiles({ big: { bytes: big, mimeType: "text/plain", name: "big.txt" } }),
    )).rejects.toThrow(/文本附件过大：big\.txt（上限 200KB）/);
  });
});
