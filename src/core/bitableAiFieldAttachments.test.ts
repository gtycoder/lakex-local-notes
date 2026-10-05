import { describe, expect, it } from "vitest";
import { buildAiFieldMessages, type BitableDoc } from "./bitableDoc.js";

const T = "2026-01-01T00:00:00.000Z";

function makeDoc(includeAttachments: boolean): BitableDoc {
  return {
    kind: "bitable",
    version: 1,
    activeTableId: "t1",
    tables: [{
      id: "t1",
      name: "表",
      activeViewId: "v1",
      fields: [
        { id: "f_text", name: "文本", type: "text" },
        { id: "f_img", name: "图片", type: "image" },
        { id: "f_file", name: "附件", type: "attachment" },
        { id: "f_ai", name: "摘要", type: "ai", ai: { prompt: "阅读{{附件}}与{{图片}}", ...(includeAttachments ? { includeAttachments: true } : {}) } },
      ],
      records: [{
        id: "r1",
        values: {
          f_text: "正文",
          f_img: [{ file: "1111111111111_abc.png", name: "图.png", size: 3 }],
          f_file: [
            { file: "1111111111112_def.pdf", name: "报告.pdf", size: 3 },
            { file: "1111111111113_ghi.docx", name: "合同.docx", size: 3 },
          ],
        },
        createdAt: T,
        updatedAt: T,
      }],
      views: [],
    }],
  };
}

describe("buildAiFieldMessages：多模态附件", () => {
  it("开启 includeAttachments：图片 / PDF 出内容块，其它附件仍只出文件名", () => {
    const r = buildAiFieldMessages(makeDoc(true), "t1", "r1", "f_ai", { noteId: "n1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const user = r.messages[1];
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<{ type: string; asset?: { filename: string }; text?: string }>;
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain("报告.pdf");
    expect(parts.filter((p) => p.type === "image").map((p) => p.asset!.filename)).toEqual(["1111111111111_abc.png"]);
    expect(parts.filter((p) => p.type === "document").map((p) => p.asset!.filename)).toEqual(["1111111111112_def.pdf"]);
    // docx 不进内容块（当前只支持 PDF）
    expect(parts.some((p) => p.asset?.filename === "1111111111113_ghi.docx")).toBe(false);
  });

  it("未开启 / 缺 noteId 时保持纯文本（向后兼容）", () => {
    const off = buildAiFieldMessages(makeDoc(false), "t1", "r1", "f_ai", { noteId: "n1" });
    expect(off.ok && typeof off.messages[1].content === "string").toBe(true);
    const noNote = buildAiFieldMessages(makeDoc(true), "t1", "r1", "f_ai");
    expect(noNote.ok && typeof noNote.messages[1].content === "string").toBe(true);
  });
});
