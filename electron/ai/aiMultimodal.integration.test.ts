import { describe, expect, it } from "vitest";
import { resolveAiMessages, type AiAssetReader } from "./aiContentResolver.js";

/**
 * 集成测试（261006）：**不 mock** unpdf / sharp，真跑「图片 data URL + PDF 抽文本」这条链路。
 * 与 aiContentResolver.test.ts（mock 掉抽取）互补：这里验证依赖本身在 Node 24 下确实可用。
 */

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** 生成一份最小合法 PDF（含一段文字），xref 偏移按实际字节计算。 */
function buildPdf(): Buffer {
  const content = "BT /F1 24 Tf 20 100 Td (Hello Lake) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += (i + 1) + " 0 obj\n" + obj + "\nendobj\n";
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const off of offsets) body += String(off).padStart(10, "0") + " 00000 n \n";
  body += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(body, "latin1");
}

describe("多模态集成（真实 unpdf + sharp）", () => {
  it("图片 → image_url data URL；PDF → 带文件名标题的文本块，顺序保持", async () => {
    const pdf = buildPdf();
    const reader: AiAssetReader = {
      readAssetBytes(_noteId, filename) {
        if (filename.endsWith(".png")) return { bytes: PNG_1PX, mimeType: "image/png", size: PNG_1PX.length };
        if (filename.endsWith(".pdf")) return { bytes: pdf, mimeType: "application/pdf", size: pdf.length };
        return null;
      },
    };
    const out = await resolveAiMessages(
      [{ role: "user", content: [
        { type: "text", text: "总结" },
        { type: "image", asset: { noteId: "n", filename: "a.png", name: "图.png" } },
        { type: "document", asset: { noteId: "n", filename: "b.pdf", name: "报告.pdf" } },
      ] }],
      reader,
    );
    const parts = out[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]).toEqual({ type: "text", text: "总结" });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url!.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(parts[2].type).toBe("text");
    expect(parts[2].text).toContain("Hello Lake");
    expect(parts[2].text).toContain("【附件：报告.pdf】");
  });
});
