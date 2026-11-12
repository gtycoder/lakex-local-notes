/**
 * 陈旧编辑器保存**已删小记**必须拒绝并明说（261112 task-55 M2，用户裁决 B）。
 *
 * 现场：小记编辑器打开后，该小记在别处被删除（本机回收站 / 他端同步删除 / 彻底删除）；用户再点保存。
 * 旧实现 upsert 的 ON CONFLICT 把 deleted_at 清空 = **静默复活**一条已删小记。
 * 判据：persistQuickNoteContent 写入前检查 deleted_at / 墓碑，命中即抛明确文案；显式 restoreQuickNote 不受影响。
 */
import { describe, expect, it } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { deleteQuickNote, readQuickNote, restoreQuickNote, saveQuickNote, saveQuickNoteContent } from "./quickNotesRepository.js";

const T = "2026-11-12T00:00:00.000Z";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

const rowOf = async (db: SqlJsAsyncDb, id: string) =>
  await db.prepare("SELECT deleted_at, content_hash FROM quick_notes WHERE id=?").get(id) as
    | { deleted_at: string | null; content_hash: string }
    | undefined;

describe("小记不静默复活（task-55 M2）", () => {
  it("保存已进回收站的小记 ⇒ 拒绝且文案含「回收站」；行仍保持删除、正文不变", async () => {
    const db = await freshDb();
    try {
      await saveQuickNote(db, "q1", "第一版");
      await deleteQuickNote(db, "q1");
      const before = (await rowOf(db, "q1"))!;
      await expect(saveQuickNote(db, "q1", "陈旧编辑器的第二版")).rejects.toThrow(/回收站/);
      const after = (await rowOf(db, "q1"))!;
      expect(after.deleted_at).toBe(before.deleted_at); // 没有被静默复活
      expect(after.content_hash).toBe(before.content_hash); // 也没有偷偷写正文
      expect((await readQuickNote(db, "q1"))?.content.text).toBe("第一版");
    } finally { await db.close(); }
  });

  it("内核正文保存路径（saveQuickNoteContent）同口径拒绝", async () => {
    const db = await freshDb();
    try {
      await saveQuickNote(db, "q2", "第一版");
      await deleteQuickNote(db, "q2");
      await expect(saveQuickNoteContent(db, "q2", { text: "第二版", body: "<p>第二版</p>", images: [] })).rejects.toThrow(/回收站/);
      expect((await rowOf(db, "q2"))!.deleted_at).not.toBeNull();
    } finally { await db.close(); }
  });

  it("已彻底删除（墓碑 + 行已删）⇒ 拒绝且文案含「彻底删除」", async () => {
    const db = await freshDb();
    try {
      await saveQuickNote(db, "q3", "第一版");
      await db.prepare("INSERT INTO quick_note_deleted (id, created_at, updated_at, deleted_at, purged_at) VALUES ('q3',?,?,?,?)").run(T, T, T, T);
      await db.prepare("DELETE FROM quick_notes WHERE id='q3'").run();
      await expect(saveQuickNote(db, "q3", "复活尝试")).rejects.toThrow(/彻底删除/);
      expect(await rowOf(db, "q3")).toBeUndefined();
    } finally { await db.close(); }
  });

  it("显式恢复入口不受影响：restore 后可正常保存", async () => {
    const db = await freshDb();
    try {
      await saveQuickNote(db, "q4", "第一版");
      await deleteQuickNote(db, "q4");
      await restoreQuickNote(db, "q4");
      await expect(saveQuickNote(db, "q4", "恢复后的编辑")).resolves.toBe("q4");
      expect((await rowOf(db, "q4"))!.deleted_at).toBeNull();
    } finally { await db.close(); }
  });
});
