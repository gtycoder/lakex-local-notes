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
import type { SyncConflictEvent } from "../../core/syncConflictLog.js";
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

  it("P2-D 批量落库：单次调用多值 INSERT（读回一致），同批重复与已存在都跳过", async () => {
    const db = await freshDb();
    try {
      const at = "2026-11-05T00:00:00.000Z";
      const batch: SyncConflictEvent[] = Array.from({ length: 3 }, (_, index) => ({ noteId: "bulk" + index, space: "lake", kind: "remote_wins", at }));
      expect(await insertSyncConflicts(db, [...batch, batch[0]])).toBe(3); // 同批重复只留一条
      // 已有未解决键 + 新键混在一批：只插新的
      expect(await insertSyncConflicts(db, [batch[0], { noteId: "bulk-new", space: "quickNotes", kind: "remote_purged", at }])).toBe(1);
      const rows = (await listSyncConflicts(db)).items;
      expect(rows).toHaveLength(4);
      expect(rows.find((row) => row.noteId === "bulk1")).toMatchObject({ space: "lake", kind: "remote_wins", at, ackedAt: null });
      expect(rows.find((row) => row.noteId === "bulk-new")).toMatchObject({ space: "quickNotes", kind: "remote_purged" });
    } finally { await db.close(); }
  });

  it("P2-D 跨批写入（>100 行，多值 INSERT 分语句）读回完整", async () => {
    const db = await freshDb();
    try {
      const events: SyncConflictEvent[] = Array.from({ length: 205 }, (_, index) => ({
        noteId: "many" + index, space: "lake", kind: "remote_wins",
        at: new Date(Date.now() - index * 1000).toISOString(),
        title: "标题" + index,
      }));
      expect(await insertSyncConflicts(db, events)).toBe(205);
      // listSyncConflicts 默认 limit=200（列表页窗口）⇒ 这里显式放宽验证全量落库。
      expect((await listSyncConflicts(db, 1000)).items).toHaveLength(205);
    } finally { await db.close(); }
  });

  it("P2-D 轮转每次落库只跑一次（空事件不触发 prune）", async () => {
    const db = await freshDb();
    try {
      // 空事件直接返回，不打开事务也不 prune（不能因为"没东西"去扫全表）。
      expect(await insertSyncConflicts(db, [])).toBe(0);
      // 一次落库把过期行清掉（同一调用内只跑一次 prune）
      await insertSyncConflicts(db, [
        { noteId: "expired", space: "lake", kind: "remote_wins", at: "2020-01-01T00:00:00.000Z" },
        { noteId: "fresh", space: "lake", kind: "remote_wins", at: new Date().toISOString() },
      ]);
      expect((await listSyncConflicts(db)).items.map((row) => row.noteId)).toEqual(["fresh"]);
    } finally { await db.close(); }
  });
});
