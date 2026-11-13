/**
 * 日记 → 小记（移动端 261113 task-106）：与桌面 electron/diaryQuickNoteConversion 同口径的行为覆盖。
 * 覆盖：完整搬运（作用域改写 / 图片+附件清单与文件一致）、纯文本镜像、原文软删可恢复、
 * 缺失资产拒绝、非 doc 拒绝、卡片零剥离（droppedKinds 恒空）、失败回滚（保存失败 / 软删失败都不留半成品）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, readNote } from "../data/noteRepository.js";
import { readQuickNote } from "../data/quickNotesRepository.js";
import * as trashRepository from "../data/trashRepository.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { convertDiaryToQuickNote, type ConvertDiaryToQuickNoteDeps } from "./diaryToQuickNote.js";

const NOTE = "note-diary-1";
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const PDF = Uint8Array.from([1, 2, 3, 4]);

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

/** 正文：普通段落 + image/file 卡片（可承载）+ board 卡片（不可承载，应被剥掉并上报）。 */
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
  let seq = 0;
  const deps: ConvertDiaryToQuickNoteDeps = {
    listNoteAssetKeys: async (noteId) => [...map.keys()].filter((k) => k.startsWith(noteId + "/")),
    loadAssetBytes: async (k) => map.get(k) ?? null,
    saveAssetFile: async (k, b) => { map.set(k, b); },
    removeQuickNoteAssetsDir: async (id) => { for (const k of [...map.keys()]) if (k.startsWith("quick-notes/" + id + "/")) map.delete(k); },
    newId: () => "id-" + (++seq),
  };
  return { map, deps };
}

async function quickNoteCount(db: SqlJsAsyncDb): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS c FROM quick_notes").get() as { c: number }).c;
}

describe("日记条目 → 小记（task-106）", () => {
  it("完整搬运：作用域改写 + 图片/附件清单与文件一致 + 文本含标题 + 原文软删可恢复", async () => {
    const db = await freshDb();
    const { map, deps } = memoryAssets();
    map.set(NOTE + "/img.png", PNG);
    map.set(NOTE + "/doc.pdf", PDF);
    await createNote(db, NOTE, "2026-11-13", diaryBody(NOTE), null, new Map());

    const result = await convertDiaryToQuickNote(db, NOTE, deps);
    // 261113 用户裁决：卡片零剥离（字段保留但恒为空）。
    expect(result.droppedKinds).toEqual([]);

    const qn = await readQuickNote(db, result.quickNoteId);
    expect(qn).not.toBeNull();
    const content = qn!.content;
    expect(content.text).toContain("2026-11-13");
    expect(content.text).toContain("今天记一笔");
    // 正文引用已搬到小记作用域；原文作用域引用不再出现；不可承载的 board 卡片被剥掉。
    expect(content.body).toContain("/quick-notes/" + result.quickNoteId + "/img.png");
    expect(content.body).toContain("/quick-notes/" + result.quickNoteId + "/doc.pdf");
    expect(content.body).not.toContain("/" + NOTE + "/");
    // 卡片零剥离：画板卡原样保留（不再剥掉）。
    expect(content.body).toContain("name=\"board\"");
    // 清单：图片带尺寸；附件 width/height=null；hash/字节与源一致；文件名保持原样（正文引用才能对上）。
    expect(content.images.map((i) => i.filename)).toEqual(["img.png", "doc.pdf"]);
    const img = content.images[0];
    expect(img.mimeType).toBe("image/png");
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(img.hash).toBe(sha256Sync(PNG));
    expect(content.images[1].width).toBeNull();
    expect(content.images[1].hash).toBe(sha256Sync(PDF));
    // 文件真的写了，且与清单一致（清单 = 文件）。
    expect(map.get("quick-notes/" + result.quickNoteId + "/img.png")).toEqual(PNG);
    expect(map.get("quick-notes/" + result.quickNoteId + "/doc.pdf")).toEqual(PDF);
    // 原文：软删（可恢复）+ 正文与资产原样保留。
    const row = await db.prepare("SELECT trashed_at, is_purged FROM notes WHERE id=?").get(NOTE) as { trashed_at: string | null; is_purged: number };
    expect(row.trashed_at).toBeTruthy();
    expect(row.is_purged).toBe(0);
    expect((await readNote(db, NOTE))!.content).toBe(diaryBody(NOTE));
    expect(map.get(NOTE + "/img.png")).toEqual(PNG);
    await trashRepository.restoreTreeItem(db, NOTE, "note", async () => {});
    const restored = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get(NOTE) as { trashed_at: string | null };
    expect(restored.trashed_at).toBeNull();
    await db.close();
  });

  it("正文引用的资产文件缺失 ⇒ 明确拒绝，且不建小记、不软删原文", async () => {
    const db = await freshDb();
    const { deps } = memoryAssets();
    await createNote(db, NOTE, "2026-11-13", diaryBody(NOTE), null, new Map());
    await expect(convertDiaryToQuickNote(db, NOTE, deps)).rejects.toThrow(/资源文件缺失/);
    expect(await quickNoteCount(db)).toBe(0);
    const row = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get(NOTE) as { trashed_at: string | null };
    expect(row.trashed_at).toBeNull();
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

  it("保存失败（第二个文件写挂）⇒ 回滚：无小记行、无小记资产、原文未软删", async () => {
    const db = await freshDb();
    const { map, deps } = memoryAssets();
    map.set(NOTE + "/img.png", PNG);
    map.set(NOTE + "/doc.pdf", PDF);
    let writes = 0;
    deps.saveAssetFile = async (k, b) => { if (++writes === 2) throw new Error("disk boom"); map.set(k, b); };
    await createNote(db, NOTE, "2026-11-13", diaryBody(NOTE), null, new Map());
    await expect(convertDiaryToQuickNote(db, NOTE, deps)).rejects.toThrow("disk boom");
    expect(await quickNoteCount(db)).toBe(0);
    expect([...map.keys()].filter((k) => k.startsWith("quick-notes/"))).toEqual([]);
    const row = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get(NOTE) as { trashed_at: string | null };
    expect(row.trashed_at).toBeNull();
    await db.close();
  });

  it("软删失败 ⇒ 回滚刚建的小记（硬删、不写墓碑），原文保留", async () => {
    const db = await freshDb();
    const { map, deps } = memoryAssets();
    map.set(NOTE + "/img.png", PNG);
    map.set(NOTE + "/doc.pdf", PDF);
    await createNote(db, NOTE, "2026-11-13", diaryBody(NOTE), null, new Map());
    deps.trashNote = async () => { throw new Error("trash boom"); };
    await expect(convertDiaryToQuickNote(db, NOTE, deps)).rejects.toThrow("trash boom");
    expect(await quickNoteCount(db)).toBe(0);
    expect([...map.keys()].filter((k) => k.startsWith("quick-notes/"))).toEqual([]);
    const tomb = await db.prepare("SELECT COUNT(*) AS c FROM quick_note_deleted").get() as { c: number };
    expect(tomb.c).toBe(0);
    const row = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get(NOTE) as { trashed_at: string | null };
    expect(row.trashed_at).toBeNull();
    await db.close();
  });
});