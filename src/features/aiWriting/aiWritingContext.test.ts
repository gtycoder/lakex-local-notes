import { describe, expect, it } from "vitest";
import { resolveAiWritingDocs, type AiWritingDocReader } from "./aiWritingContext";
import type { AiWritingDocRef } from "../../core/aiWriting";

function reader(overrides: Partial<AiWritingDocReader> = {}): AiWritingDocReader {
  return {
    readNoteCaches: async () => ({ markdown: null, plain: null }),
    readNote: async () => ({ content: "<p>正文</p>", kind: "doc" }),
    readQuickNote: async () => ({ content: { text: "小记正文" } }),
    ...overrides,
  };
}

const noteRef = (id: string, title = id): AiWritingDocRef => ({ kind: "note", id, title });
const quickRef = (id: string, title = id): AiWritingDocRef => ({ kind: "quick-note", id, title });

describe("resolveAiWritingDocs", () => {
  it("文档优先用 Markdown 缓存；小记用纯文本", async () => {
    const docs = await resolveAiWritingDocs(
      [noteRef("n1", "文档一"), quickRef("q1", "小记一")],
      reader({
        readNoteCaches: async () => ({ markdown: "# 标题\n正文", plain: "标题正文" }),
      }),
    );
    expect(docs).toEqual([
      { title: "文档一", text: "# 标题\n正文" },
      { title: "小记一", text: "小记正文" },
    ]);
  });

  it("缓存缺失时回落到正文派生纯文本（按 kind）", async () => {
    const docs = await resolveAiWritingDocs([noteRef("n1", "文档一")], reader());
    expect(docs[0].text).toContain("正文");
  });

  it("单篇读取失败 / 空内容只跳过该篇，不中断其它", async () => {
    const docs = await resolveAiWritingDocs(
      [noteRef("bad"), noteRef("empty"), quickRef("q1")],
      reader({
        readNoteCaches: async () => ({ markdown: null, plain: null }),
        readNote: async (id) => {
          if (id === "bad") throw new Error("ENOENT");
          return { content: id === "empty" ? "" : "<p>ok</p>", kind: "doc" };
        },
      }),
    );
    expect(docs.map((doc) => doc.title)).toEqual(["q1"]);
  });

  it("超长正文按单篇上限截断", async () => {
    const long = "字".repeat(50_000);
    const docs = await resolveAiWritingDocs([noteRef("n1")], reader({ readNoteCaches: async () => ({ markdown: long, plain: null }) }));
    expect(docs[0].text.length).toBe(40_000);
  });
});
