import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractPdfText: vi.fn(async () => ({ text: "PDF 正文", pages: 1, truncated: false })),
  AI_PDF_MAX_BYTES: 32 * 1024 * 1024,
}));
vi.mock("./pdfText.js", () => ({ extractPdfText: mocks.extractPdfText, AI_PDF_MAX_BYTES: mocks.AI_PDF_MAX_BYTES }));

const { resolveAiMessages } = await import("./aiContentResolver.js");
const { AI_MAX_IMAGES } = await import("../../src/core/aiChatMessages.js");
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
  /**
   * P0-1 后的 reader 是**两步**：statLocalFile（判限额）→ readLocalFile（异步读字节）。
   * 测试里 records.reads 用来断言「超限时**一次都没读盘**」。
   */
  interface FakeFile { bytes: Buffer; mimeType: string; name: string; size?: number; pdf?: { text: string; pages: number; truncated: boolean } }
  const localFiles = (files: Record<string, FakeFile>, records?: { reads: string[] }) => ({
    statLocalFile(ref: { token: string }) {
      const file = files[ref.token];
      return file ? { size: file.size ?? file.bytes.length, mimeType: file.mimeType, name: file.name, ...(file.pdf ? { pdf: file.pdf } : {}) } : null;
    },
    async readLocalFile(ref: { token: string }) {
      records?.reads.push(ref.token);
      const file = files[ref.token];
      return file ? file.bytes : null;
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

  it("PDF 本地文件 → 带文件名与页数的 text 块（不是 image_url）；失效 token → 请重新选择", async () => {
    const pdf = [{ type: "local_file" as const, file: { kind: "local" as const, token: "pdf", name: "a.pdf", size: 10, mimeType: "application/pdf" } }];
    const out = await resolveAiMessages(
      [{ role: "user", content: pdf }],
      reader({}),
      localFiles({ pdf: { bytes: Buffer.from("%PDF"), mimeType: "application/pdf", name: "a.pdf" } }),
    );
    const parts = out[0].content as Array<{ type: string; text?: string; image_url?: unknown }>;
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain("【附件：a.pdf（PDF，1 页）】");
    expect(parts[0].text).toContain("PDF 正文");
    expect(parts[0].image_url).toBeUndefined();
    expect(mocks.extractPdfText).toHaveBeenCalled();
    await expect(resolveAiMessages([{ role: "user", content: pdf }], reader({}), localFiles({})))
      .rejects.toThrow(/本机文件附件已失效/);
  });

  it("PDF 优先用选择时缓存（不再二次解析）；预算截断有标注、超限明确报错", async () => {
    mocks.extractPdfText.mockClear();
    const cachedPdf = async () => {
      const out = await resolveAiMessages(
        [{ role: "user", content: [{ type: "local_file", file: { kind: "local", token: "cached", name: "cached.pdf", size: 10, mimeType: "application/pdf" } }] }],
        reader({}),
        localFiles({ cached: { bytes: Buffer.from("%PDF"), mimeType: "application/pdf", name: "cached.pdf", size: 10, pdf: { text: "x".repeat(100), pages: 7, truncated: true } } }),
      );
      return out;
    };
    const out = await cachedPdf();
    expect(mocks.extractPdfText).not.toHaveBeenCalled();
    const text = (out[0].content as Array<{ type: string; text?: string }>)[0].text!;
    expect(text).toContain("cached.pdf（PDF，7 页，原文过长已截断）");
    // 预算：60k 之后不再接受新附件（不静默丢）
    const big = "y".repeat(60_000);
    await expect(resolveAiMessages(
      [{ role: "user", content: [
        { type: "local_file", file: { kind: "local", token: "big", name: "big.pdf", size: 10, mimeType: "application/pdf" } },
        { type: "local_file", file: { kind: "local", token: "after", name: "after.txt", size: 10, mimeType: "text/plain" } },
      ] }],
      reader({}),
      localFiles({
        big: { bytes: Buffer.from("%PDF"), mimeType: "application/pdf", name: "big.pdf", size: 10, pdf: { text: big, pages: 1, truncated: false } },
        after: { bytes: Buffer.from("tail"), mimeType: "text/plain", name: "after.txt", size: 4 },
      }),
    )).rejects.toThrow(/附件总长度超过上限/);
  });

  it("文本附件过大 → 可执行错误（上限 200KB）", async () => {
    const big = Buffer.alloc(200 * 1024 + 1, 97);
    await expect(resolveAiMessages(
      [{ role: "user", content: [{ type: "local_file", file: { kind: "local", token: "big", name: "big.txt", size: big.length, mimeType: "text/plain" } }] }],
      reader({}),
      localFiles({ big: { bytes: big, mimeType: "text/plain", name: "big.txt" } }),
    )).rejects.toThrow(/文本附件过大：big\.txt（上限 200KB）/);
  });

  it("P0-1：超限附件在**读盘前**被拒（图 10MB / 文本 200KB / PDF 32MB 三类都验）", async () => {
    const records = { reads: [] as string[] };
    const one = (token: string, name: string, mimeType: string, size: number) => (
      [{ role: "user" as const, content: [{ type: "local_file" as const, file: { kind: "local" as const, token, name, size, mimeType } }] }]
    );
    await expect(resolveAiMessages(one("img", "big.png", "image/png", 10 * 1024 * 1024 + 1), reader({}),
      localFiles({ img: { bytes: Buffer.from("x"), mimeType: "image/png", name: "big.png", size: 10 * 1024 * 1024 + 1 } }, records)))
      .rejects.toThrow(/图片过大：big\.png（上限 10MB）/);
    await expect(resolveAiMessages(one("txt", "big.txt", "text/plain", 200 * 1024 + 1), reader({}),
      localFiles({ txt: { bytes: Buffer.from("x"), mimeType: "text/plain", name: "big.txt", size: 200 * 1024 + 1 } }, records)))
      .rejects.toThrow(/文本附件过大：big\.txt（上限 200KB）/);
    await expect(resolveAiMessages(one("pdf", "a.pdf", "application/pdf", 32 * 1024 * 1024 + 1), reader({}),
      localFiles({ pdf: { bytes: Buffer.from("%PDF"), mimeType: "application/pdf", name: "a.pdf", size: 32 * 1024 * 1024 + 1 } }, records)))
      .rejects.toThrow(/PDF 文件过大：a\.pdf（上限 32MB）/);
    // 关键断言：三类超限都**没有触发 readLocalFile**（P0-1 的核心 —— 先 stat 后读）
    expect(records.reads, "超限必须在读字节之前拒绝，否则大文件会把主进程读爆").toEqual([]);
  });

  it("P0-2：HEIC/HEIF 报「请先转换为 JPEG/PNG」，而不是笼统的「无法读取图片」", async () => {
    await expect(resolveAiMessages(
      [{ role: "user", content: [{ type: "local_file", file: { kind: "local", token: "h", name: "IMG_0001.HEIC", size: 10, mimeType: "image/heic" } }] }],
      reader({}),
      localFiles({ h: { bytes: Buffer.from("x"), mimeType: "image/heic", name: "IMG_0001.HEIC" } }),
    )).rejects.toThrow(/HEIC\/HEIF 暂不支持（IMG_0001\.HEIC），请先转换为 JPEG 或 PNG/);
  });

  it("10 张上限用 core 的 AI_MAX_IMAGES（单一来源，不在 resolver 再写一个 10）", async () => {
    const files: Record<string, { bytes: Buffer; mimeType: string; name: string }> = {};
    const content = Array.from({ length: 11 }, (_, i) => {
      const token = "i" + i;
      files[token] = { bytes: PNG_1PX, mimeType: "image/png", name: "s" + i + ".png" };
      return { type: "local_file" as const, file: { kind: "local" as const, token, name: "s" + i + ".png", size: PNG_1PX.length, mimeType: "image/png" } };
    });
    await expect(resolveAiMessages([{ role: "user", content }], reader({}), localFiles(files)))
      .rejects.toThrow(new RegExp("一次最多发送 " + AI_MAX_IMAGES + " 个图片附件"));
  });
});
