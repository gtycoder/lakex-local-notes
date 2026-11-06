import { describe, expect, it } from "vitest";
import {
  createNotesFromMarkdownBatch,
  dirnameOfPath,
  folderSegmentsOf,
  titleFromMarkdownFileName,
  type MarkdownImportHost,
  type MarkdownImportItem,
} from "./markdownBatchImport";
import type { TreeNode } from "../../lib/types";

/**
 * 261106 Markdown 批量落盘编排（renderer 侧，host 注入 ⇒ 不碰 Electron）。
 * 守：文件夹层级 → 分组（同名复用）、标题同名 (2)、失败软删回滚（绝不物理删除）、
 * 逐条结果 + summary（含 skipped）、进度回调、图片物化走 uploadResource。
 */
interface HostState {
  nodes: Array<Pick<TreeNode, "id" | "parentId" | "nodeType" | "title">>;
  groups: string[];
  notes: Array<{ id: string; parentId: string | null; title: string }>;
  saved: Array<{ id: string; title: string; body: string }>;
  trashed: string[];
  uploads: Array<{ noteId: string; filename: string; bytes: number }>;
  seq: number;
}

function makeHost(over: Partial<HostState> = {}, options: { failSave?: Set<string>; failConvert?: Set<string>; images?: Record<string, { bytes: Uint8Array; mimeType: string; filename: string }> } = {}) {
  const state: HostState = {
    nodes: over.nodes ?? [{ id: "nb-1", parentId: null, nodeType: "notebook", title: "知识库" }],
    groups: [],
    notes: [],
    saved: [],
    trashed: [],
    uploads: [],
    seq: 0,
  };
  const host: MarkdownImportHost = {
    listTreeNodes: async () => [...state.nodes],
    createGroup: async (parentId: string, title: string) => {
      state.seq += 1;
      const id = "grp-" + state.seq;
      state.groups.push(id + ":" + title);
      state.nodes.push({ id, parentId, nodeType: "group", title });
      return { id };
    },
    createNoteIn: async (parentId: string | null, title: string) => {
      state.seq += 1;
      const id = "note-" + state.seq;
      state.notes.push({ id, parentId, title });
      return { id };
    },
    uploadResource: async (input, noteId: string) => {
      state.uploads.push({ noteId, filename: input.filename, bytes: input.bytes.byteLength });
      return { url: "http://127.0.0.1:19876/" + noteId + "/" + input.filename };
    },
    saveNote: async (id: string, title: string, body: string) => {
      if (options.failSave?.has(title)) throw new Error("saveNote 失败（磁盘已满）");
      state.saved.push({ id, title, body });
      return { id };
    },
    deleteNote: async (id: string) => { state.trashed.push(id); },
    readImportImage: async (absolutePath: string) => {
      const image = options.images?.[absolutePath];
      if (!image) throw new Error("图片不存在：" + absolutePath);
      return image;
    },
  };
  return { host, state };
}

function item(relativePath: string, markdown = "# 标题\n正文"): MarkdownImportItem {
  const name = relativePath.split("/").pop()!;
  return { path: "/picked/" + relativePath, name, relativePath, markdown };
}

/** 默认转换 stub：把 md 包成带 data-lake-id 的 lake 正文；可记录 assetUploader 调用。 */
function makeConvert(options: { failTitleContains?: string; imageUrls?: Record<string, string> } = {}) {
  const calls: Array<{ baseDir: string; markdown: string; uploaded: string[] }> = [];
  const convert = async (input: { markdown: string; baseDir: string; assetUploader: (abs: string) => Promise<string | null> }) => {
    const uploaded: string[] = [];
    const md = await (async () => {
      // 走真实的图片引用改写逻辑不重要：这里只验证 batch 侧把 assetUploader 接上了
      const match = /!\[[^\]]*\]\(([^)]+)\)/.exec(input.markdown);
      if (match) {
        // 真实管线会把相对路径解析成绝度路径再交给 assetUploader；stub 这里做等价处理
        const url = await input.assetUploader(input.baseDir + "/" + match[1].replace(/^\.\//, ""));
        uploaded.push(url ?? "");
      }
      return input.markdown;
    })();
    if (options.failTitleContains && input.markdown.includes(options.failTitleContains)) throw new Error("转换超时（stub）");
    calls.push({ baseDir: input.baseDir, markdown: md, uploaded });
    return { body: '<p data-lake-id="x">' + md.replace(/\n/g, " ") + "</p>", warnings: ["警告：远程图片已降级"] };
  };
  return { convert, calls };
}

describe("文件名/路径工具", () => {
  it("标题去扩展名、目录层级、目录名解析", () => {
    expect(titleFromMarkdownFileName("我的笔记.md")).toBe("我的笔记");
    expect(titleFromMarkdownFileName(".md")).toBe(".md");
    expect(folderSegmentsOf("a/b/c.md")).toEqual(["a", "b"]);
    expect(folderSegmentsOf("c.md")).toEqual([]);
    expect(dirnameOfPath("/picked/a/b.md")).toBe("/picked/a");
    expect(dirnameOfPath("b.md")).toBe("");
  });
});

describe("批量导入：文件夹结构 + 同名 (2)", () => {
  it("子目录建分组（多层）、同名分组复用、文件落在对应分组下", async () => {
    const { host, state } = makeHost();
    const { convert } = makeConvert();
    const result = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1",
      host,
      convert,
      items: [item("a.md"), item("docs/b.md"), item("docs/deep/c.md"), item("docs/d.md")],
    });
    expect(result.summary).toEqual({ total: 4, done: 4, failed: 0, skipped: 0 });
    // docs 只建一次；deep 建在 docs 下
    expect(state.groups.filter((group) => group.endsWith(":docs"))).toHaveLength(1);
    expect(state.groups.filter((group) => group.endsWith(":deep"))).toHaveLength(1);
    const docs = state.groups.find((group) => group.endsWith(":docs"))!.split(":")[0];
    const deep = state.groups.find((group) => group.endsWith(":deep"))!.split(":")[0];
    const byTitle = Object.fromEntries(state.notes.map((note) => [note.title, note.parentId]));
    expect(byTitle["a"]).toBe("nb-1");
    expect(byTitle["b"]).toBe(docs);
    expect(byTitle["c"]).toBe(deep);
    expect(byTitle["d"]).toBe(docs);
  });

  it("同名标题追加 (2)(3)：与现有文档一起判重", async () => {
    const { host, state } = makeHost({ nodes: [
      { id: "nb-1", parentId: null, nodeType: "notebook", title: "知识库" },
      { id: "old-1", parentId: "nb-1", nodeType: "note", title: "重复" },
    ] });
    const { convert } = makeConvert();
    const result = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert,
      items: [item("重复.md"), item("重复.md")],
    });
    expect(result.summary.done).toBe(2);
    expect(state.notes.map((note) => note.title)).toEqual(["重复 (2)", "重复 (3)"]);
  });

  it("已有同名分组不重复创建", async () => {
    const { host, state } = makeHost({ nodes: [
      { id: "nb-1", parentId: null, nodeType: "notebook", title: "知识库" },
      { id: "grp-x", parentId: "nb-1", nodeType: "group", title: "docs" },
    ] });
    const { convert } = makeConvert();
    await createNotesFromMarkdownBatch({ parentNotebookId: "nb-1", host, convert, items: [item("docs/a.md")] });
    expect(state.groups).toEqual([]);
    expect(state.notes[0].parentId).toBe("grp-x");
  });
});

describe("批量导入：图片物化 / 保存内容", () => {
  it("assetUploader 走 readImportImage + uploadResource（落在该篇 noteId 上）", async () => {
    const { host, state } = makeHost({}, {
      images: { "/picked/img/a.png": { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", filename: "a.png" } },
    });
    const { convert, calls } = makeConvert();
    const result = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert,
      items: [{ path: "/picked/图.md", name: "图.md", relativePath: "图.md", markdown: "# 图\n![x](./img/a.png)" }],
    });
    expect(result.summary.done).toBe(1);
    expect(state.uploads).toEqual([{ noteId: state.notes[0].id, filename: "a.png", bytes: 3 }]);
    expect(calls[0].baseDir).toBe("/picked");
    expect(calls[0].uploaded[0]).toContain(state.notes[0].id);
    // 保存的是转换产物（含 data-lake-id），不是原始 md
    expect(state.saved[0].body).toContain("data-lake-id");
    expect(result.results[0].warnings).toContain("警告：远程图片已降级");
  });
});

describe("批量导入：失败回滚 = 软删进回收站", () => {
  it("转换失败 ⇒ 该篇移入回收站 + 计入 failed；其它篇照常成功", async () => {
    const { host, state } = makeHost();
    const { convert } = makeConvert({ failTitleContains: "坏" });
    const result = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert,
      items: [item("好.md"), item("坏.md", "# 标题\n坏内容")],
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toEqual({ total: 2, done: 1, failed: 1, skipped: 0 });
    const failed = result.results.find((entry) => !entry.ok)!;
    expect(failed.path).toBe("/picked/坏.md");
    expect(failed.reason).toContain("转换超时");
    // 失败那篇的 noteId 被软删（移入回收站），成功那篇不受影响
    expect(state.trashed).toEqual([failed.noteId]);
    expect(state.notes.map((note) => note.id)).toEqual([result.results[0].noteId, failed.noteId]);
  });

  it("保存失败 ⇒ 同样软删回滚", async () => {
    const { host, state } = makeHost({}, { failSave: new Set(["保存失败"]) });
    const { convert } = makeConvert();
    const result = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert, items: [item("保存失败.md")],
    });
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].reason).toContain("磁盘已满");
    expect(state.trashed).toEqual([result.results[0].noteId]);
  });

  it("不支持的文件 ⇒ 计入 skipped，不建笔记", async () => {
    const { host, state } = makeHost();
    const { convert } = makeConvert();
    const result = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert,
      items: [{ ...item("readme.txt"), supported: false },
              { ...item("a.md"), supported: true }],
    });
    expect(result.summary).toEqual({ total: 2, done: 1, failed: 0, skipped: 1 });
    expect(state.notes).toHaveLength(1);
  });

  it("取消：后续条目不建笔记（逐条给 reason）", async () => {
    const { host, state } = makeHost();
    const { convert } = makeConvert();
    const controller = new AbortController();
    const result = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert, signal: controller.signal,
      items: [item("a.md"), item("b.md")],
    });
    expect(result.summary.done).toBe(2);
    // 取消场景：第一轮之前就中止
    controller.abort();
    const cancelled = await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert, signal: controller.signal,
      items: [item("c.md"), item("d.md")],
    });
    expect(cancelled.summary.done).toBe(0);
    expect(cancelled.results.every((entry) => entry.reason === "导入已取消")).toBe(true);
    expect(state.notes).toHaveLength(2); // 只有第一轮的两篇
  });

  it("进度回调：index/total/title（逐篇一次）", async () => {
    const { host } = makeHost();
    const { convert } = makeConvert();
    const progress: Array<{ index: number; total: number; title: string }> = [];
    await createNotesFromMarkdownBatch({
      parentNotebookId: "nb-1", host, convert,
      items: [item("a.md"), item("b.md")],
      onProgress: (entry) => progress.push({ index: entry.index, total: entry.total, title: entry.title }),
    });
    expect(progress).toEqual([{ index: 1, total: 2, title: "a" }, { index: 2, total: 2, title: "b" }]);
  });
});
