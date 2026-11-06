import { describe, expect, it, vi } from "vitest";

vi.mock("../bridge", () => ({ bridge: { createNote: vi.fn(), saveNote: vi.fn(), trashNote: vi.fn() } }));

import { importSharedMarkdown, markdownTitleOf } from "./markdownShareImport";

const file = (filename: string, displayName?: string) => ({ filename, mimeType: "text/markdown", displayName });
const converted = (body: string, warnings: string[] = []) => ({ body, warnings, imageCount: 0, durationMs: 1 });

describe("markdownTitleOf（标题推导）", () => {
  it("优先用分享方的显示名（去目录、去 .md 后缀）；缺省回落文件名", () => {
    expect(markdownTitleOf("u1.md", "第一篇.md")).toBe("第一篇");
    expect(markdownTitleOf("u1.md", "dir/第二篇.markdown")).toBe("第二篇");
    expect(markdownTitleOf("u1.md")).toBe("u1");
    expect(markdownTitleOf("u1.md", "  ")).toBe("u1");
    expect(markdownTitleOf("u1.md", ".md")).toBe("u1"); // 显示名只有后缀 ⇒ 回落，不要空标题
  });
});

describe("importSharedMarkdown（分享 md → 文档）", () => {
  it("单文件：读文本 → 管线转换 → 在默认笔记本下建文档并保存", async () => {
    const createNote = vi.fn(async () => ({ id: "n1" }));
    const saveNote = vi.fn(async () => undefined);
    const summary = await importSharedMarkdown({
      files: [file("u1.md", "第一篇.md")],
      notebookId: "nb1",
      deps: {
        readText: async () => "# 你好",
        convert: async () => converted("<p>你好</p>", ["图片 a.png 无法访问，已降级为链接"]),
        createNote,
        saveNote,
        trashNote: vi.fn(),
      },
    });
    expect(createNote).toHaveBeenCalledWith("第一篇", "nb1");
    expect(saveNote).toHaveBeenCalledWith("n1", "第一篇", "<p>你好</p>", "nb1");
    expect(summary.imported).toEqual([{ filename: "u1.md", noteId: "n1", title: "第一篇" }]);
    expect(summary.failed).toEqual([]);
    expect(summary.warnings).toEqual(["第一篇: 图片 a.png 无法访问，已降级为链接"]);
  });

  it("多文件逐个导入：进度 1/2、2/2；单个失败不影响其它", async () => {
    const progress: string[] = [];
    const summary = await importSharedMarkdown({
      files: [file("u1.md", "一.md"), file("u2.md", "二.md")],
      notebookId: "nb1",
      onProgress: (i, total, f) => progress.push(i + "/" + total + ":" + f.filename),
      deps: {
        readText: async (filename) => (filename === "u1.md" ? "# 一" : null),
        convert: async () => converted("<p>一</p>"),
        createNote: async () => ({ id: "n1" }),
        saveNote: async () => undefined,
        trashNote: vi.fn(),
      },
    });
    expect(progress).toEqual(["1/2:u1.md", "2/2:u2.md"]);
    expect(summary.imported.map((item) => item.title)).toEqual(["一"]);
    expect(summary.failed).toEqual([{ filename: "u2.md", reason: "读取分享文件失败（文件已保留，可重试）" }]);
  });

  it("建了文档但保存失败 ⇒ 软删回滚，不留半成品；失败原因可见", async () => {
    const trashNote = vi.fn(async () => undefined);
    const summary = await importSharedMarkdown({
      files: [file("u1.md", "一.md")],
      notebookId: "nb1",
      deps: {
        readText: async () => "# 一",
        convert: async () => converted("<p>一</p>"),
        createNote: async () => ({ id: "n1" }),
        saveNote: async () => { throw new Error("磁盘已满"); },
        trashNote,
      },
    });
    expect(trashNote).toHaveBeenCalledWith("n1");
    expect(summary.imported).toEqual([]);
    expect(summary.failed[0]?.reason).toContain("磁盘已满");
  });

  it("转换失败（管线抛错）⇒ 不建文档、不留下半成品", async () => {
    const createNote = vi.fn();
    const summary = await importSharedMarkdown({
      files: [file("u1.md", "一.md")],
      notebookId: "nb1",
      deps: {
        readText: async () => "# 一",
        convert: async () => { throw new Error("Markdown 转换超时（超过 15000ms）"); },
        createNote,
        saveNote: vi.fn(),
        trashNote: vi.fn(),
      },
    });
    expect(createNote).not.toHaveBeenCalled();
    expect(summary.failed[0]?.reason).toContain("转换超时");
  });
});
