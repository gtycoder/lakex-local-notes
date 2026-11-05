/**
 * 261105 P1 第 4 项：移动端同步记录账本（落库/读回/角标/轮转/结算）。
 * 判据复用 core/syncConflictLog；这里验证移动端表与仓库行为。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {},
  loadAssetBytesFs: async () => null,
  removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import {
  ackSyncConflicts,
  getSyncConflict,
  insertSyncConflicts,
  listSyncConflicts,
  markSyncConflictResolved,
  pruneSyncConflicts,
} from "./syncConflictRepository.js";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

describe("移动端同步记录账本", () => {
  it("落库 + 读回（at 倒序）+ unacked 角标；同 note/kind 未解决不重复", async () => {
    const db = await freshDb();
    try {
      const T1 = "2026-11-01T00:00:00.000Z";
      const T2 = "2026-11-02T00:00:00.000Z";
      expect(await insertSyncConflicts(db, [
        { noteId: "n1", space: "lake", kind: "remote_wins", at: T1, title: "一" },
        { noteId: "n2", space: "quickNotes", kind: "remote_purged", at: T2 },
      ])).toBe(2);
      // 同 note/kind 未解决：不重复落库
      expect(await insertSyncConflicts(db, [{ noteId: "n1", space: "lake", kind: "remote_wins", at: T2 }])).toBe(0);
      const listed = await listSyncConflicts(db);
      expect(listed.items.map((row) => row.noteId)).toEqual(["n2", "n1"]);
      expect(listed.unacked).toBe(2);
      expect(listed.items.find((row) => row.noteId === "n1")).toMatchObject({ space: "lake", kind: "remote_wins", title: "一", ackedAt: null });
    } finally { await db.close(); }
  });

  it("ack（单条/全部）+ resolved 同时算已读（数据不删）", async () => {
    const db = await freshDb();
    try {
      const at = new Date().toISOString();
      await insertSyncConflicts(db, [
        { noteId: "a", space: "lake", kind: "remote_wins", at },
        { noteId: "b", space: "lake", kind: "remote_wins", at: new Date(Date.now() + 1).toISOString() },
      ]);
      const rows = (await listSyncConflicts(db)).items;
      expect(await ackSyncConflicts(db, [rows[0].id])).toEqual({ acked: 1, unacked: 1 });
      expect(await ackSyncConflicts(db)).toEqual({ acked: 1, unacked: 0 });
      await markSyncConflictResolved(db, rows[0].id, "restored");
      const row = await getSyncConflict(db, rows[0].id);
      expect(row).toMatchObject({ resolution: "restored" });
      expect(row?.resolvedAt).toBeTruthy();
      expect(row?.ackedAt).toBeTruthy();
    } finally { await db.close(); }
  });

  it("轮转：超过 90 天的旧记录删除（500 条上限由 core 判据覆盖）", async () => {
    const db = await freshDb();
    try {
      await insertSyncConflicts(db, [
        { noteId: "old", space: "lake", kind: "remote_wins", at: "2020-01-01T00:00:00.000Z" },
        { noteId: "new", space: "lake", kind: "remote_wins", at: new Date().toISOString() },
      ]);
      // insert 已顺手轮转（now=当前，2020 的超 90 天）
      const rows = (await listSyncConflicts(db)).items;
      expect(rows.map((row) => row.noteId)).toEqual(["new"]);
      expect(await pruneSyncConflicts(db)).toBe(0);
    } finally { await db.close(); }
  });
});
