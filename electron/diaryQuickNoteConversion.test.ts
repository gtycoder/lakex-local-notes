import crypto from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import { Store } from "./store.js";
import { QuickNotesStore } from "./quickNotes.js";
import { convertDiaryNoteToQuickNote } from "./diaryQuickNoteConversion.js";
import { buildLakeImageCardValue, lakeImageCardParagraph, lakeTextParagraph } from "../src/core/lakeDocForm.js";

/**
 * 日记 → 小记（261112 task-92）：正文原样承载 + 媒体搬进小记资产作用域 + 原文软删。
 * 覆盖：成功搬运（图片+附件）/ 不支持卡片上报 / 失败注入无半成品 / 非 doc 类型拒绝 / 软删失败回滚。
 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

let root: string;
let store: Store;
let quickNotes: QuickNotesStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-diary-to-quick-"));
  store = new Store(root);
  store.bootstrap();
  quickNotes = new QuickNotesStore(root);
});
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  fs.rmSync(root, { recursive: true, force: true });
});

const assetDir = (noteId: string) => path.join(root, "note-assets", noteId);
const bodyPath = (noteId: string) => path.join(root, "notes", noteId + ".lake");

function cardParagraph(cardName: string, value: Record<string, unknown>): string {
  return `<p data-lake-id="u${crypto.randomUUID()}" id="u${crypto.randomUUID()}" class="ne-p"><card type="inline" name="${cardName}" value="data:${encodeURIComponent(JSON.stringify(value))}"></card></p>`;
}

describe("日记 → 小记（正文原样承载 + 媒体搬运）", () => {
  it("图片 + 附件都搬到小记作用域：content.images / 资产文件 / 正文引用正确，原文进回收站且原资产仍在", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const noteId = opened.noteId;
    fs.mkdirSync(assetDir(noteId), { recursive: true });
    fs.writeFileSync(path.join(assetDir(noteId), "photo.png"), PNG);
    fs.writeFileSync(path.join(assetDir(noteId), "notes.pdf"), PDF);
    const src = `http://127.0.0.1:19876/${noteId}/`;
    const body = [
      lakeTextParagraph("p1", "t1", "今天写了点东西"),
      lakeImageCardParagraph("p2", buildLakeImageCardValue({
        src: src + "photo.png", cardId: "c1", taskId: "t2", clientId: "c2",
        name: "photo.png", size: PNG.length, from: "doc", originWidth: 1, originHeight: 1,
      })),
      cardParagraph("file", { src: src + "notes.pdf", name: "notes.pdf", size: PDF.length }),
    ].join("");
    fs.writeFileSync(bodyPath(noteId), body, "utf8");

    const result = convertDiaryNoteToQuickNote(quickNotes, store, noteId);
    expect(result.droppedKinds).toEqual([]);
    // task-105 P3-8：提示文案按实际搬运 —— 本篇带了图片 + 附件 ⇒ 计数 2
    expect(result.carriedMediaCount).toBe(2);
    const quick = quickNotes.readQuickNote(result.quickNoteId);
    // 资源清单：图片 + 附件混在同一数组；附件没有像素尺寸。
    const byName = new Map(quick.content.images.map((image) => [image.filename, image]));
    expect([...byName.keys()].sort()).toEqual(["notes.pdf", "photo.png"]);
    expect(byName.get("photo.png")!.mimeType).toBe("image/png");
    expect(byName.get("photo.png")!.width).toBe(1);
    expect(byName.get("photo.png")!.height).toBe(1);
    expect(byName.get("notes.pdf")!.mimeType).toBe("application/pdf");
    expect(byName.get("notes.pdf")!.width).toBeNull();
    // 正文引用改写：卡片 value 里是 URL-encoded 形态 ⇒ 解码后必须两种资源都指向小记作用域。
    const decodedBody = decodeURIComponent(quick.content.body);
    expect(decodedBody).toContain(`/quick-notes/${result.quickNoteId}/photo.png`);
    expect(decodedBody).toContain(`/quick-notes/${result.quickNoteId}/notes.pdf`);
    expect(decodedBody).not.toContain(`/${noteId}/`);
    // 资产文件真的落到小记资产目录
    const quickAssets = quickNotes.quickNoteAssetsPathFor(result.quickNoteId);
    expect(fs.existsSync(path.join(quickAssets, "photo.png"))).toBe(true);
    expect(fs.existsSync(path.join(quickAssets, "notes.pdf"))).toBe(true);
    // 纯文本镜像保留可搜内容
    expect(quick.previewText).toContain("今天写了点东西");
    // 原文软删进回收站（可恢复），原资产仍在（恢复后仍完整）
    expect(store.listTrash().some((item) => item.id === noteId)).toBe(true);
    expect(fs.existsSync(path.join(assetDir(noteId), "photo.png"))).toBe(true);
    // 新小记是本地待上传（不会被当成已同步）
    expect(quickNotes.getPendingSyncSummary().items).toBeGreaterThanOrEqual(1);
    // 可恢复：恢复后回到日记空间
    store.restoreTrashItem(noteId);
    expect(store.listTreeNodes().some((node) => node.id === noteId)).toBe(true);
  });

  it("小记承载不了的卡片：整段剥掉并上报 droppedKinds，其它正文不丢", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const board = cardParagraph("board", { src: "board:abc", name: "画板" });
    const body = lakeTextParagraph("p1", "t1", "保留这段文字") + board + lakeTextParagraph("p3", "t3", "后面这段也在");
    fs.writeFileSync(bodyPath(opened.noteId), body, "utf8");

    const result = convertDiaryNoteToQuickNote(quickNotes, store, opened.noteId);
    expect(result.droppedKinds).toEqual(["board"]);
    // 没有媒体 ⇒ 计数 0（UI 不说「含图片/附件」）
    expect(result.carriedMediaCount).toBe(0);
    const quick = quickNotes.readQuickNote(result.quickNoteId);
    expect(quick.content.body).toContain("保留这段文字");
    expect(quick.content.body).toContain("后面这段也在");
    expect(quick.content.body).not.toContain('name="board"');
    expect(quick.content.images).toEqual([]);
  });

  it("失败注入（资产文件缺失）：抛错且不产生小记、日记未软删", () => {
    const opened = store.openDiaryDate("2026-11-09");
    fs.mkdirSync(assetDir(opened.noteId), { recursive: true });
    const src = `http://127.0.0.1:19876/${opened.noteId}/`;
    const body = lakeImageCardParagraph("p2", buildLakeImageCardValue({
      src: src + "missing.png", cardId: "c1", taskId: "t2", clientId: "c2",
      name: "missing.png", size: 10, from: "doc",
    }));
    fs.writeFileSync(bodyPath(opened.noteId), body, "utf8");

    expect(() => convertDiaryNoteToQuickNote(quickNotes, store, opened.noteId)).toThrow(/正文文件缺失|资源|missing/);
    expect(quickNotes.countQuickNotes()).toBe(0);
    expect(store.listTrash()).toEqual([]);
    expect(store.listTreeNodes().some((node) => node.id === opened.noteId)).toBe(true);
  });

  it("软删失败回滚：刚创建的小记被清掉（不写墓碑），不留半成品", () => {
    const opened = store.openDiaryDate("2026-11-09");
    fs.writeFileSync(bodyPath(opened.noteId), lakeTextParagraph("p1", "t1", "回滚用"), "utf8");
    const spy = vi.spyOn(store, "deleteTreeNode").mockImplementation(() => { throw new Error("模拟软删失败"); });
    try {
      expect(() => convertDiaryNoteToQuickNote(quickNotes, store, opened.noteId)).toThrow(/模拟软删失败/);
    } finally {
      spy.mockRestore();
    }
    expect(quickNotes.countQuickNotes()).toBe(0);
    expect(store.listTreeNodes().some((node) => node.id === opened.noteId)).toBe(true);
  });


  it("创建失败（如 promote 失败）也回滚：不留下会被重启补出来的半成品（261112 F-03）", () => {
    const opened = store.openDiaryDate("2026-11-09");
    fs.writeFileSync(bodyPath(opened.noteId), lakeTextParagraph("p1", "t1", "创建失败用"), "utf8");
    const spy = vi.spyOn(quickNotes, "createQuickNoteFromContent").mockImplementation(() => { throw new Error("模拟 promote 失败"); });
    try {
      expect(() => convertDiaryNoteToQuickNote(quickNotes, store, opened.noteId)).toThrow(/模拟 promote 失败/);
    } finally {
      spy.mockRestore();
    }
    expect(quickNotes.countQuickNotes()).toBe(0);
    expect(store.listTreeNodes().some((node) => node.id === opened.noteId)).toBe(true);
    // journal/staging 已清：不再有残留操作记录会被 recoverImports 补做
    const staging = path.join(root, "quick-notes", "staging");
    expect(fs.existsSync(staging) ? fs.readdirSync(staging).filter((f) => !f.startsWith(".")) : []).toEqual([]);
  });

  it("非 doc 类型（表格/多维表/画板/手写板）明确拒绝，不产生任何变更", () => {
    const opened = store.openDiaryDate("2026-11-09");
    void opened;
    const nodes = store.listTreeNodes();
    const diaryNotebookId = nodes.find((node) => node.space === "diary")!.id;
    const personalNotebookId = nodes.find((node) => node.nodeType === "notebook" && node.space !== "diary")!.id;
    // F-05 起公开 API 已禁止在日记空间新建非日记文档（store.assertNotDiaryCreateTarget）；
    // 这里先在普通笔记本建表格、再直接改库模拟**旧脏数据**（该守卫只拦入口，不拦已存在的行）。
    const sheet = store.createUsheetIn(personalNotebookId, "2026-11-10");
    const db = new Database(store.databasePath);
    try {
      db.prepare("UPDATE tree_nodes SET parent_id=? WHERE id=?").run(diaryNotebookId, sheet.id);
    } finally { db.close(); }
    expect(() => convertDiaryNoteToQuickNote(quickNotes, store, sheet.id)).toThrow(/不能转为小记/);
    expect(quickNotes.countQuickNotes()).toBe(0);
  });
});

describe("转换入口守卫与资产文件名（task-104）", () => {
  it("F-04：普通文档（不在日记子树）调用被明确拒绝，不产生小记", () => {
    const nb = store.createNotebook("普通本");
    const doc = store.createNoteIn(nb.id, "普通文档");
    expect(() => convertDiaryNoteToQuickNote(quickNotes, store, doc.id)).toThrow(/只能把日记条目转为小记/);
    expect(quickNotes.countQuickNotes()).toBe(0);
  });

  it("F-06：中文/空格文件名资产能被识别并改名搬运（正文引用同步改写）", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const noteId = opened.noteId;
    const filename = "图片 一.png";
    fs.mkdirSync(assetDir(noteId), { recursive: true });
    fs.writeFileSync(path.join(assetDir(noteId), filename), PNG);
    const src = `http://127.0.0.1:19876/${noteId}/` + encodeURIComponent(filename);
    const body = lakeImageCardParagraph("p2", buildLakeImageCardValue({
      src, cardId: "c1", taskId: "t2", clientId: "c2", name: filename, size: PNG.length, from: "doc",
    }));
    fs.writeFileSync(bodyPath(noteId), body, "utf8");

    const result = convertDiaryNoteToQuickNote(quickNotes, store, noteId);
    expect(result.carriedMediaCount).toBe(1);
    const quick = quickNotes.readQuickNote(result.quickNoteId);
    const image = quick.content.images[0];
    // 中文/空格文件名本身是合法路径片段（quick note 校验允许）；关键是资产被搬运且正文引用被改写。
    expect(image.filename).toBe(filename);
    expect(image.mimeType).toBe("image/png");
    expect(fs.existsSync(path.join(quickNotes.quickNoteAssetsPathFor(result.quickNoteId), image.filename))).toBe(true);
    let decoded = quick.content.body;
    for (let i = 0; i < 3; i += 1) decoded = decodeURIComponent(decoded);
    expect(decoded).toContain(`/quick-notes/${result.quickNoteId}/${image.filename}`);
    expect(decoded).not.toContain(`/${noteId}/`);
  });

  it("F-06：中文名资产缺失时明确报错（不产半成品）", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const noteId = opened.noteId;
    const filename = "图片 缺失.png";
    fs.mkdirSync(assetDir(noteId), { recursive: true });
    const src = `http://127.0.0.1:19876/${noteId}/` + encodeURIComponent(filename);
    const body = lakeImageCardParagraph("p2", buildLakeImageCardValue({
      src, cardId: "c1", taskId: "t2", clientId: "c2", name: filename, size: 10, from: "doc",
    }));
    fs.writeFileSync(bodyPath(noteId), body, "utf8");
    expect(() => convertDiaryNoteToQuickNote(quickNotes, store, noteId)).toThrow(/资源文件缺失/);
    expect(quickNotes.countQuickNotes()).toBe(0);
    expect(store.listTrash()).toEqual([]);
  });
});
