import { describe, expect, it } from "vitest";
import { createNotesFromImportBatch, type FileImportItem } from "./fileImportBatch";
import type { MarkdownImportHost } from "./markdownBatchImport";
import { parseUsheetBody } from "../../core/usheetDoc";

function makeHost() {
  const state = {
    notes: [] as Array<{ id: string; parentId: string | null; title: string }>,
    sheets: [] as Array<{ id: string; parentId: string | null; title: string }>,
    saved: [] as Array<{ id: string; title: string; body: string }>,
    uploads: [] as Array<{ noteId: string; filename: string; bytes: number }>,
    seq: 0,
  };
  const host: MarkdownImportHost = {
    listTreeNodes: async () => [{ id: "nb", parentId: null, nodeType: "notebook", title: "知识库" }],
    createGroup: async () => ({ id: "g" }),
    createNoteIn: async (parentId, title) => { const id = "n" + (++state.seq); state.notes.push({ id, parentId, title }); return { id }; },
    createUsheetIn: async (parentId, title) => { const id = "s" + (++state.seq); state.sheets.push({ id, parentId, title }); return { id }; },
    uploadResource: async (input, noteId) => { state.uploads.push({ noteId, filename: input.filename, bytes: input.bytes.byteLength }); return { url: "http://asset/" + input.filename }; },
    saveNote: async (id, title, body) => { state.saved.push({ id, title, body }); return { id }; },
    deleteNote: async () => undefined,
    readImportImage: async () => { throw new Error("unused"); },
  };
  return { host, state };
}

describe("261108 通用导入批量（桌面）", () => {
  it("Markdown/Word → doc；Excel/CSV → usheet；共用标题去重与进度", async () => {
    const { host, state } = makeHost();
    const items: FileImportItem[] = [
      { kind: "markdown", path: "/p/a.md", name: "a.md", relativePath: "sub/a.md", markdown: "# A" },
      { kind: "docx", path: "/p/b.docx", name: "b.docx", relativePath: "sub/b.docx", html: "<h1>B</h1>" },
      { kind: "sheet", path: "/p/c.csv", name: "c.csv", relativePath: "sub/c.csv", workbook: { id: "w", sheetOrder: ["s1"], sheets: { s1: { id: "s1", cellData: { "0": { "0": { v: "x" } } } } } } },
    ];
    const progress: number[] = [];
    const result = await createNotesFromImportBatch({
      parentNotebookId: "nb",
      host,
      items,
      convertMarkdown: async () => ({ body: '<p data-lake-id="x">md</p>', warnings: [] }),
      convertHtml: async (input) => { const url = await input.uploadDataImage({ bytes: new Uint8Array([1]), mimeType: "image/png", filename: "w.png" }); return { body: '<p data-lake-id="x">' + url + "</p>", warnings: [] }; },
      onProgress: (p) => progress.push(p.index),
    });
    expect(result.summary).toEqual({ total: 3, done: 3, failed: 0, skipped: 0 });
    expect(progress).toEqual([1, 2, 3]);
    expect(state.notes.map((n) => n.title)).toEqual(["a", "b"]);
    expect(state.sheets.map((s) => s.title)).toEqual(["c"]);
    expect(state.saved).toHaveLength(3);
    expect(parseUsheetBody(state.saved[2].body)?.workbook.sheetOrder).toEqual(["s1"]);
    expect(state.uploads).toHaveLength(1);
  });

  it("失败条目移入回收站，不物理删除；缺平台表格能力计入 failed", async () => {
    const { host, state } = makeHost();
    const trashed: string[] = [];
    const custom: MarkdownImportHost = { ...host, createUsheetIn: undefined, deleteNote: async (id) => { trashed.push(id); } };
    const result = await createNotesFromImportBatch({
      parentNotebookId: "nb",
      host: custom,
      items: [{ kind: "sheet", path: "/p/a.csv", name: "a.csv", relativePath: "a.csv", workbook: { id: "w", sheetOrder: ["s1"], sheets: { s1: { id: "s1" } } } }],
    });
    expect(result.summary.failed).toBe(1);
    expect(state.sheets).toHaveLength(0);
    expect(trashed).toHaveLength(0);
  });
});
