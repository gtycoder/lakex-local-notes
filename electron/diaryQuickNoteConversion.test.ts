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
import { rewriteQuickNoteAssetScope } from "../src/core/quickNoteModel.js";

/**
 * 日记 → 小记 = **移动**（261113 用户裁决）：
 *  · 同一 id / 同一份正文（卡片零剥离，含画板）/ 资产目录整体搬走（源不留副本）；
 *  · Lake 侧 notes/tree_nodes + 正文 + 资产 + **历史快照**移除，**不进回收站**；
 *  · 只写 `deleted_notes` 删除意图（同步机制要求；不是可恢复副本）；
 *  · 失败回滚：小记没建好/原文没删掉都不留半成品。
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
const quickAssetsDir = (id: string) => path.join(root, "quick-notes", "assets", id);
const bodyPath = (noteId: string) => path.join(root, "notes", noteId + ".lake");
const historyDir = (noteId: string) => path.join(root, "history", noteId);

function cardParagraph(cardName: string, value: Record<string, unknown>): string {
  return `<p data-lake-id="u${crypto.randomUUID()}" id="u${crypto.randomUUID()}" class="ne-p"><card type="inline" name="${cardName}" value="data:${encodeURIComponent(JSON.stringify(value))}"></card></p>`;
}

function listFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function tombstone(noteId: string): { purged_at: string | null } | undefined {
  const db = new Database(store.databasePath);
  try {
    return db.prepare("SELECT purged_at FROM deleted_notes WHERE id=?").get(noteId) as { purged_at: string | null } | undefined;
  } finally { db.close(); }
}

describe("日记 → 小记：同一篇内容移动（无副本、不可恢复）", () => {
  it("id 沿用 + 正文原样（含画板卡）+ 资产目录搬走 + Lake 行/正文/历史移除 + 不进回收站", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const noteId = opened.noteId;
    fs.mkdirSync(assetDir(noteId), { recursive: true });
    fs.writeFileSync(path.join(assetDir(noteId), "photo.png"), PNG);
    fs.writeFileSync(path.join(assetDir(noteId), "notes.pdf"), PDF);
    const src = `http://127.0.0.1:19876/${noteId}/`;
    const body = [
      lakeTextParagraph("p1", "t1", "今天写了点东西"),
      // 画板卡旧口径会被 strip（CARRYABLE_CARD_NAMES 白名单）——新语义必须原样保留。
      cardParagraph("board", { src: "board:abc", name: "画板" }),
      lakeImageCardParagraph("p2", buildLakeImageCardValue({
        src: src + "photo.png", cardId: "c1", taskId: "t2", clientId: "c2",
        name: "photo.png", size: PNG.length, from: "doc", originWidth: 1, originHeight: 1,
      })),
      cardParagraph("file", { src: src + "notes.pdf", name: "notes.pdf", size: PDF.length }),
      cardParagraph("weirdUnknownCard", { foo: "bar" }),
    ].join("");
    fs.writeFileSync(bodyPath(noteId), body, "utf8");
    const times = store.noteTimesForConversion(noteId);
    // 先造一条历史快照：移动后必须删除（小记没有历史快照，迁移后也没有入口能读）。
    expect(store.createHistorySnapshot(noteId, body, true)).toBeTruthy();
    expect(fs.existsSync(historyDir(noteId))).toBe(true);

    const result = convertDiaryNoteToQuickNote(quickNotes, store, noteId);
    // 新 id（不沿用：同步状态按 id 跨空间共享，见转换文件注释），但仍是同一篇内容/同一批资产。
    expect(result.quickNoteId).not.toBe(noteId);
    expect(result.movedMediaCount).toBe(2);
    expect(result.removedHistoryCount).toBeGreaterThan(0);
    // 正文逐字相等于「只改作用域」后的原文：卡片零剥离（含画板/未知卡）。
    const quickId = result.quickNoteId;
    const quick = quickNotes.readQuickNote(quickId);
    const expectedBody = rewriteQuickNoteAssetScope(body, `/${noteId}/`, `/quick-notes/${quickId}/`);
    expect(quick.content.body).toBe(expectedBody);
    expect(quick.content.body).toContain('name="board"');
    expect(quick.content.body).toContain('name="weirdUnknownCard"');
    expect(decodeURIComponent(quick.content.body)).toContain(`/quick-notes/${quickId}/photo.png`);
    // 旧 URL 前缀（含旧 id）不得残留。
    expect(decodeURIComponent(quick.content.body)).not.toContain(`19876/${noteId}/`);
    // 资源清单 = 正文引用的媒体（图片 + 附件），元数据与原文件一致。
    const byName = new Map(quick.content.images.map((image) => [image.filename, image]));
    expect([...byName.keys()].sort()).toEqual(["notes.pdf", "photo.png"]);
    expect(byName.get("photo.png")!.mimeType).toBe("image/png");
    expect(byName.get("photo.png")!.width).toBe(1);
    expect(byName.get("notes.pdf")!.width).toBeNull();
    // 资产 = 移动：小记目录有文件，源目录不复存在（不留副本）。
    expect(listFiles(quickAssetsDir(quickId))).toEqual(["notes.pdf", "photo.png"]);
    expect(fs.existsSync(assetDir(noteId))).toBe(false);
    // 时间线保留原日记时间（不是“今天”）。
    expect(quick.createdAt).toBe(times.createdAt);
    expect(quick.updatedAt).toBe(times.updatedAt);
    // Lake 侧完全移除：树/回收站/正文/历史都没有；删除意图已写（同步传播用，不是可恢复副本）。
    expect(store.listTreeNodes().some((node) => node.id === noteId)).toBe(false);
    expect(store.listTrash()).toEqual([]);
    expect(() => store.readNoteBodyForConversion(noteId)).toThrow(/正文文件缺失|不存在/);
    expect(fs.existsSync(bodyPath(noteId))).toBe(false);
    expect(fs.existsSync(historyDir(noteId))).toBe(false);
    expect(tombstone(noteId)?.purged_at).toBeTruthy();
    // 小记是本地待上传
    expect(quickNotes.getPendingSyncSummary().items).toBeGreaterThanOrEqual(1);
  });

  it("中文/空格文件名：目录搬走 + 正文三层编码作用域都改写", () => {
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
    expect(result.movedMediaCount).toBe(1);
    const quick = quickNotes.readQuickNote(result.quickNoteId);
    expect(quick.content.images[0].filename).toBe(filename);
    expect(listFiles(quickAssetsDir(result.quickNoteId))).toEqual([filename]);
    expect(fs.existsSync(assetDir(noteId))).toBe(false);
    let decoded = quick.content.body;
    for (let i = 0; i < 3; i += 1) decoded = decodeURIComponent(decoded);
    expect(decoded).toContain(`/quick-notes/${result.quickNoteId}/${filename}`);
    expect(decoded).not.toContain(`19876/${noteId}/`);
  });

  it("正文引用但本地资产缺失：明确失败，不改任何东西", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const noteId = opened.noteId;
    const src = `http://127.0.0.1:19876/${noteId}/`;
    const body = lakeImageCardParagraph("p2", buildLakeImageCardValue({
      src: src + "missing.png", cardId: "c1", taskId: "t2", clientId: "c2",
      name: "missing.png", size: 10, from: "doc",
    }));
    fs.writeFileSync(bodyPath(noteId), body, "utf8");

    expect(() => convertDiaryNoteToQuickNote(quickNotes, store, noteId)).toThrow(/资源文件缺失|资源/);
    expect(quickNotes.countQuickNotes()).toBe(0);
    expect(store.listTreeNodes().some((node) => node.id === noteId)).toBe(true);
    expect(fs.existsSync(bodyPath(noteId))).toBe(true);
    expect(tombstone(noteId)).toBeUndefined();
  });

  it("小记创建失败（资产移动失败）⇒ 回滚：无小记、原稿与资产原样保留", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const noteId = opened.noteId;
    fs.mkdirSync(assetDir(noteId), { recursive: true });
    fs.writeFileSync(path.join(assetDir(noteId), "photo.png"), PNG);
    fs.writeFileSync(bodyPath(noteId), lakeTextParagraph("p1", "t1", "回滚用"), "utf8");
    const original = fs.readFileSync(bodyPath(noteId), "utf8");

    const spy = vi.spyOn(quickNotes, "adoptMovedNoteAsQuickNote").mockImplementation(() => { throw new Error("模拟资产移动失败"); });
    try {
      expect(() => convertDiaryNoteToQuickNote(quickNotes, store, noteId)).toThrow(/模拟资产移动失败/);
    } finally { spy.mockRestore(); }
    expect(quickNotes.countQuickNotes()).toBe(0);
    expect(store.listTreeNodes().some((node) => node.id === noteId)).toBe(true);
    expect(fs.readFileSync(bodyPath(noteId), "utf8")).toBe(original);
    expect(listFiles(assetDir(noteId))).toEqual(["photo.png"]);
    expect(listFiles(path.join(root, "quick-notes", "assets"))).toEqual([]);
    expect(tombstone(noteId)).toBeUndefined();
  });

  it("Lake 侧移除失败 ⇒ 完整回滚：资产移回、小记行/正文删除、原稿可打开", () => {
    const opened = store.openDiaryDate("2026-11-09");
    const noteId = opened.noteId;
    fs.mkdirSync(assetDir(noteId), { recursive: true });
    fs.writeFileSync(path.join(assetDir(noteId), "photo.png"), PNG);
    fs.writeFileSync(path.join(assetDir(noteId), "notes.pdf"), PDF);
    const src = `http://127.0.0.1:19876/${noteId}/`;
    const body = [
      lakeTextParagraph("p1", "t1", "回滚用"),
      lakeImageCardParagraph("p2", buildLakeImageCardValue({
        src: src + "photo.png", cardId: "c1", taskId: "t2", clientId: "c2",
        name: "photo.png", size: PNG.length, from: "doc", originWidth: 1, originHeight: 1,
      })),
    ].join("");
    fs.writeFileSync(bodyPath(noteId), body, "utf8");

    const spy = vi.spyOn(store, "removeNoteForQuickNoteMove").mockImplementation(() => { throw new Error("模拟移除失败"); });
    try {
      expect(() => convertDiaryNoteToQuickNote(quickNotes, store, noteId)).toThrow(/模拟移除失败/);
    } finally { spy.mockRestore(); }
    // 小记完全回滚（行/正文/搜索索引都没有）
    expect(quickNotes.countQuickNotes()).toBe(0);
    const quickItemsDir = path.join(root, "quick-notes", "items");
    expect(fs.existsSync(quickItemsDir) ? listFiles(quickItemsDir) : []).toEqual([]);
    // 资产移回、字节不变；小记资产目录没有残留
    expect(listFiles(assetDir(noteId))).toEqual(["notes.pdf", "photo.png"]);
    expect(listFiles(path.join(root, "quick-notes", "assets"))).toEqual([]);
    // 原稿仍可正常打开/读取，且没有删除意图
    expect(store.listTreeNodes().some((node) => node.id === noteId)).toBe(true);
    expect(store.readNoteBodyForConversion(noteId)).toBe(body);
    expect(tombstone(noteId)).toBeUndefined();
  });

  it("非 doc 类型（表格/多维表/画板/手写板）明确拒绝，不产生任何变更", () => {
    store.openDiaryDate("2026-11-09");
    const nodes = store.listTreeNodes();
    const diaryNotebookId = nodes.find((node) => node.space === "diary")!.id;
    const personalNotebookId = nodes.find((node) => node.nodeType === "notebook" && node.space !== "diary")!.id;
    // F-05 起公开 API 已禁止在日记空间新建非日记文档；这里先建表格再直接改库模拟旧脏数据。
    const sheet = store.createUsheetIn(personalNotebookId, "2026-11-10");
    const db = new Database(store.databasePath);
    try {
      db.prepare("UPDATE tree_nodes SET parent_id=? WHERE id=?").run(diaryNotebookId, sheet.id);
    } finally { db.close(); }
    expect(() => convertDiaryNoteToQuickNote(quickNotes, store, sheet.id)).toThrow(/不能转为小记/);
    expect(quickNotes.countQuickNotes()).toBe(0);
  });

  it("F-04：普通文档（不在日记子树）调用被明确拒绝，不产生小记", () => {
    const nb = store.createNotebook("普通本");
    const doc = store.createNoteIn(nb.id, "普通文档");
    expect(() => convertDiaryNoteToQuickNote(quickNotes, store, doc.id)).toThrow(/只能把日记条目转为小记/);
    expect(quickNotes.countQuickNotes()).toBe(0);
  });
});
