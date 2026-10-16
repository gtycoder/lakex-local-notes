import { describe, expect, it, vi } from "vitest";
import path from "node:path";

// Sql.js 需要定位 wasm（与 sqliteDb.test.ts 同口径）。
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

// 真实行为测试不触达文件系统：资源端口最小替身。
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { createNote, isTombstoned, noteWriteState, readNote, saveNote, trashNote } from "./noteRepository.js";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

describe("mobile noteRepository 保存写边界（审计 F06）", () => {
  it("createNote 新建；saveNote 正常更新", async () => {
    const db = await freshDb();
    await createNote(db, "n1", "标题", "<p>v1</p>", null, new Map());
    expect((await readNote(db, "n1"))!.content).toBe("<p>v1</p>");
    await expect(saveNote(db, "n1", "标题2", "<p>v2</p>", null, new Map())).resolves.toBe(true);
    expect((await readNote(db, "n1"))!.content).toBe("<p>v2</p>");
    await db.close();
  });

  it("回收站中的行：晚到保存被明确拒绝，正文与 trashed_at 不被改写（R10）", async () => {
    const db = await freshDb();
    await createNote(db, "t1", "标题", "<p>trash-original</p>", null, new Map());
    await trashNote(db, "t1");
    expect(await noteWriteState(db, "t1")).toBe("gone");
    const before = await db.prepare("SELECT content, sync_state, trashed_at FROM notes WHERE id=?").get("t1");
    await expect(saveNote(db, "t1", "标题", "<p>late-save</p>", null, new Map())).rejects.toThrow();
    const after = await db.prepare("SELECT content, sync_state, trashed_at FROM notes WHERE id=?").get("t1");
    expect(after).toEqual(before);
    await db.close();
  });

  it("他端 purge 的保留副本（sync_state='purged'）：晚到保存被拒绝，不标回 local", async () => {
    const db = await freshDb();
    await createNote(db, "p1", "标题", "<p>purged-original</p>", null, new Map());
    await db.prepare("UPDATE notes SET trashed_at=?, sync_state='purged' WHERE id=?").run("2026-09-30T00:00:00.000Z", "p1");
    await expect(saveNote(db, "p1", "标题", "<p>late</p>", null, new Map())).rejects.toThrow();
    const row = await db.prepare("SELECT content, sync_state FROM notes WHERE id=?").get("p1");
    expect(row).toMatchObject({ content: "<p>purged-original</p>", sync_state: "purged" });
    await db.close();
  });

  it("missing：saveNote 拒绝（不做 upsert 自愈）；无墓碑的新 id 由 createNote 初始化", async () => {
    const db = await freshDb();
    await expect(saveNote(db, "missing", "t", "<p>x</p>", null, new Map())).rejects.toThrow();
    expect(await noteWriteState(db, "missing")).toBe("missing");
    expect(await isTombstoned(db, "missing")).toBe(false);
    await db.prepare("INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at) VALUES('dead','x',NULL,0,'2026-09-30','2026-09-30')").run();
    expect(await isTombstoned(db, "dead")).toBe(true);
    await db.close();
  });

  it("显式恢复后（trashed_at 清空、sync_state=local）可继续保存", async () => {
    const db = await freshDb();
    await createNote(db, "r1", "标题", "<p>v1</p>", null, new Map());
    await trashNote(db, "r1");
    await db.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local' WHERE id=?").run("2026-10-01T00:00:00.000Z", "r1");
    await expect(saveNote(db, "r1", "标题", "<p>恢复后编辑版</p>", null, new Map())).resolves.toBe(true);
    expect((await readNote(db, "r1"))!.content).toBe("<p>恢复后编辑版</p>");
    await db.close();
  });
});
