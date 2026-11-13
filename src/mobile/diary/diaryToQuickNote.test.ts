/**
 * 日记 → 小记 = **移动**（261113 用户裁决；移动端与桌面 electron/diaryQuickNoteConversion 同语义）。
 * 覆盖：同一 id / 正文零剥离（含画板）/ 资产目录搬走（源不留副本）/ 原稿物理移除（无回收站）/ 历史快照删除 /
 * 缺失资产拒绝 / 非 doc 拒绝 / 失败回滚（资产搬失败 / 原稿移除失败都不留半成品）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, readNote } from "../data/noteRepository.js";
import { readQuickNote } from "../data/quickNotesRepository.js";
import { createHistorySnapshot } from "../data/historyRepository.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { rewriteQuickNoteAssetScope } from "../../core/quickNoteModel.js";
import { convertDiaryToQuickNote, type ConvertDiaryToQuickNoteDeps } from "./diaryToQuickNote.js";

const NOTE = "note-diary-1";
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const PDF = Uint8Array.from([1, 2, 3, 4]);

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

/** 正文：普通段落 + image/file 卡片（可承载）+ board 卡片（旧口径会剥掉；移动语义必须原样保留）。 */
function diaryBody(noteId: string): string {
  const v = (json: string) => "'" + json.replace("__NOTE__", noteId) + "'";
  return [
    "<p>今天记一笔</p>",
    "<p><card name=\"image\" value=" + v('{"src":"/__NOTE__/img.png","originalWidth":1,"originalHeight":1}') + "></card></p>",
    "<p><card name=\"file\" value=" + v('{"src":"/__NOTE__/doc.pdf","name":"doc.pdf"}') + "></card></p>",
    "<p><card name=\"board\" value=\"x\"></card></p>",
  ].join("\n");
}

function memoryAssets() {
  const map = new Map<string, Uint8Array>();
  const prefixOf = (id: string) => id + "/";
  const deps: ConvertDiaryToQuickNoteDeps = {
    listNoteAssetKeys: async (noteId) => [...map.keys()].filter((k) => k.startsWith(prefixOf(noteId))),
    loadAssetBytes: async (k) => map.get(k) ?? null,
    // 移动 = 复制到目标前缀后删源（与生产「原生 copy + 删源」同语义；源不留副本）。
    moveNoteAssetsToQuickNote: async (noteId, quickNoteId) => {
      const quickPrefix = "quick-notes/" + quickNoteId + "/";
      if ([...map.keys()].some((k) => k.startsWith(quickPrefix))) throw new Error("小记资产目录已存在");
      const keys = [...map.keys()].filter((k) => k.startsWith(prefixOf(noteId)));
      for (const k of keys) map.set(quickPrefix + k.slice(prefixOf(noteId).length), map.get(k)!);
      for (const k of keys) map.delete(k);
      return keys.length;
    },
    moveQuickNoteAssetsBackToNote: async (quickNoteId, noteId) => {
      const quickPrefix = "quick-notes/" + quickNoteId + "/";
      const keys = [...map.keys()].filter((k) => k.startsWith(quickPrefix));
      for (const k of keys) map.set(prefixOf(noteId) + k.slice(quickPrefix.length), map.get(k)!);
      for (const k of keys) map.delete(k);
    },
  };
  return { map, deps };
}

async function quickNoteCount(db: SqlJsAsyncDb): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS c FROM quick_notes").get() as { c: number }).c;
}

async function noteRow(db: SqlJsAsyncDb, id: string): Promise<{ trashed_at: string | null } | undefined> {
  return await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get(id) as { trashed_at: string | null } | undefined;
}

async function tombstone(db: SqlJsAsyncDb, id: string): Promise<{ purged_at: string | null } | undefined> {
  return await db.prepare("SELECT purged_at FROM deleted_notes WHERE id=?").get(id) as { purged_at: string | null } | undefined;
}

describe("日记条目 → 小记（移动语义，无副本）", () => {
  it("新小记 id + 正文原样（含画板）+ 资产目录搬走 + 原稿物理移除 + 历史快照删除 + 删除意图", async () => {
    const db = await freshDb();
    const { map, deps } = memoryAssets();
    map.set(NOTE + "/img.png", PNG);
    map.set(NOTE + "/doc.pdf", PDF);
    const body = diaryBody(NOTE);
    await createNote(db, NOTE, "2026-11-13", body, null, new Map());
    await createHistorySnapshot(db, NOTE, body, { title: "2026-11-13", parentId: null, sortOrder: 0 });

    const result = await convertDiaryToQuickNote(db, NOTE, deps);
    // 新 id（不沿用：同步状态按 id 跨空间共享，见转换文件注释）；媒体计数 = 正文引用的图片 + 附件
    expect(result.quickNoteId).not.toBe(NOTE);
    expect(result.movedMediaCount).toBe(2);
    expect(result.removedHistoryCount).toBe(1);

    const quickId = result.quickNoteId;
    const qn = await readQuickNote(db, quickId);
    expect(qn).not.toBeNull();
    const content = qn!.content;
    expect(content.text).toContain("2026-11-13");
    expect(content.text).toContain("今天记一笔");
    // 正文 = 只改作用域后的原文：卡片零剥离（含画板）。
    expect(content.body).toBe(rewriteQuickNoteAssetScope(body, "/" + NOTE + "/", "/quick-notes/" + quickId + "/"));
    expect(content.body).toContain('name="board"');
    expect(content.body).toContain("/quick-notes/" + quickId + "/img.png");
    expect(content.body).toContain("/quick-notes/" + quickId + "/doc.pdf");
    // 旧 URL 起点（引号后紧跟 /旧 id/）不得残留。
    expect(content.body).not.toContain('"/' + NOTE + "/");
    // 资源清单：图片带尺寸；附件 width/height=null；hash 与源一致。
    expect(content.images.map((i) => i.filename)).toEqual(["img.png", "doc.pdf"]);
    const img = content.images[0];
    expect(img.mimeType).toBe("image/png");
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(img.hash).toBe(sha256Sync(PNG));
    expect(content.images[1].width).toBeNull();
    expect(content.images[1].hash).toBe(sha256Sync(PDF));
    // 资产 = 移动：小记前缀有文件、源前缀已消失。
    expect(map.get("quick-notes/" + quickId + "/img.png")).toEqual(PNG);
    expect(map.get("quick-notes/" + quickId + "/doc.pdf")).toEqual(PDF);
    expect([...map.keys()].filter((k) => k.startsWith(NOTE + "/"))).toEqual([]);
    // 原稿物理移除：notes 行、正文、历史行全部没有；**不进回收站**（没有 trashed_at 行）。
    expect(await noteRow(db, NOTE)).toBeUndefined();
    expect(await readNote(db, NOTE)).toBeNull();
    const hist = await db.prepare("SELECT COUNT(*) AS c FROM note_history WHERE note_id=?").get(NOTE) as { c: number };
    expect(hist.c).toBe(0);
    const trash = await db.prepare("SELECT COUNT(*) AS c FROM notes WHERE trashed_at IS NOT NULL").get() as { c: number };
    expect(trash.c).toBe(0);
    // 删除意图（同步传播用；不是可恢复副本）
    expect((await tombstone(db, NOTE))?.purged_at).toBeTruthy();
    await db.close();
  });

  it("正文引用的资产文件缺失 ⇒ 明确拒绝，且不建小记、不删原文", async () => {
    const db = await freshDb();
    const { deps } = memoryAssets();
    await createNote(db, NOTE, "2026-11-13", diaryBody(NOTE), null, new Map());
    await expect(convertDiaryToQuickNote(db, NOTE, deps)).rejects.toThrow(/资源文件缺失/);
    expect(await quickNoteCount(db)).toBe(0);
    expect((await noteRow(db, NOTE))?.trashed_at ?? null).toBeNull();
    expect(await tombstone(db, NOTE)).toBeUndefined();
    await db.close();
  });

  it("非 doc 类型（表格）整篇拒绝", async () => {
    const db = await freshDb();
    const { deps } = memoryAssets();
    await createNote(db, "note-usheet", "表", "{}", null, new Map(), undefined, "usheet");
    await expect(convertDiaryToQuickNote(db, "note-usheet", deps)).rejects.toThrow(/不能转为小记/);
    expect(await quickNoteCount(db)).toBe(0);
    await db.close();
  });

  it("资产移动失败 ⇒ 回滚：无小记行/正文，源资产原样，原文未删", async () => {
    const db = await freshDb();
    const { map, deps } = memoryAssets();
    map.set(NOTE + "/img.png", PNG);
    map.set(NOTE + "/doc.pdf", PDF);
    await createNote(db, NOTE, "2026-11-13", diaryBody(NOTE), null, new Map());
    deps.moveNoteAssetsToQuickNote = async () => { throw new Error("disk boom"); };
    await expect(convertDiaryToQuickNote(db, NOTE, deps)).rejects.toThrow("disk boom");
    expect(await quickNoteCount(db)).toBe(0);
    const body = await readNote(db, NOTE);
    expect(body).not.toBeNull();
    expect(map.get(NOTE + "/img.png")).toEqual(PNG);
    expect([...map.keys()].filter((k) => k.startsWith("quick-notes/"))).toEqual([]);
    expect(await tombstone(db, NOTE)).toBeUndefined();
    await db.close();
  });

  it("原稿移除失败 ⇒ 完整回滚：资产移回、小记行/正文删除、原文仍在", async () => {
    const db = await freshDb();
    const { map, deps } = memoryAssets();
    map.set(NOTE + "/img.png", PNG);
    map.set(NOTE + "/doc.pdf", PDF);
    await createNote(db, NOTE, "2026-11-13", diaryBody(NOTE), null, new Map());
    deps.removeSourceNote = async () => { throw new Error("remove boom"); };
    await expect(convertDiaryToQuickNote(db, NOTE, deps)).rejects.toThrow("remove boom");
    expect(await quickNoteCount(db)).toBe(0);
    expect(await readNote(db, NOTE)).not.toBeNull();
    // 资产移回原前缀、小记前缀清空
    expect(map.get(NOTE + "/img.png")).toEqual(PNG);
    expect(map.get(NOTE + "/doc.pdf")).toEqual(PDF);
    expect([...map.keys()].filter((k) => k.startsWith("quick-notes/"))).toEqual([]);
    expect(await tombstone(db, NOTE)).toBeUndefined();
    await db.close();
  });

});
