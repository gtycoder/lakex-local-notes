import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

import { applyMobileSchema } from "./schema.js";
import {
  DEFAULT_HISTORY_SETTINGS,
  cleanupHistory,
  createHistorySnapshot,
  getHistorySettings,
  listNoteHistory,
  readHistory,
} from "./historyRepository.js";
import { SqlJsDb } from "./sqliteDb.js";
import { SqlJsAsyncDb } from "./sqliteDb.js";

describe("mobile history repository", () => {
  it("快照正文写 *.body.gz 文件，DB 只存 file_path；readHistory 能解压回原文", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(new SqlJsAsyncDb(db));
    const mobileDb = new SqlJsAsyncDb(db);
    await createHistorySnapshot(mobileDb, "note-1", "<p>正文原文</p>", { title: "T", parentId: null, sortOrder: 0 });
    const row = db.prepare("SELECT file_path FROM note_history WHERE note_id=?").get("note-1") as { file_path: string };
    expect(row.file_path).toMatch(/^history\/note-1\/.*\.body\.gz$/);
    const list = await listNoteHistory(mobileDb, "note-1");
    expect(list).toHaveLength(1);
    await expect(readHistory(mobileDb, list[0].id)).resolves.toMatchObject({ noteId: "note-1", content: "<p>正文原文</p>" });
  });

  it("deduplicates identical snapshots within 24 hours", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(new SqlJsAsyncDb(db));
    const mobileDb = new SqlJsAsyncDb(db);
    const meta = { title: "Title", parentId: null, sortOrder: 0 };

    await createHistorySnapshot(mobileDb, "note-1", "<p>same</p>", meta);
    await createHistorySnapshot(mobileDb, "note-1", "<p>same</p>", meta);

    const count = db.prepare("SELECT COUNT(*) AS count FROM note_history WHERE note_id=?")
      .get("note-1") as { count: number };
    expect(count.count).toBe(1);
  });

  it("冲突归档保护窗口内的快照不被保留策略自动清理（对齐桌面 B3），到期后恢复清理", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(new SqlJsAsyncDb(db));
    const mobileDb = new SqlJsAsyncDb(db);
    const meta = { title: "Title", parentId: null, sortOrder: 0 };
    await createHistorySnapshot(mobileDb, "note-1", "<p>被覆盖的本地版本</p>", { ...meta, protectedDays: 1 });
    // 把它伪装成很旧的快照（会命中"超保留窗口"）；保护期内必须留下。
    db.prepare("UPDATE note_history SET created_at=? WHERE note_id=?").run("2020-01-01T00:00:00.000Z", "note-1");
    await createHistorySnapshot(mobileDb, "note-1", "<p>新版本</p>", meta);

    await cleanupHistory(mobileDb, { maxSnapshots: 1, retentionDays: 30, cleanupIntervalHours: 24, snapshotIntervalMinutes: 15 });
    let count = db.prepare("SELECT COUNT(*) AS c FROM note_history WHERE note_id=?").get("note-1") as { c: number };
    expect(count.c).toBe(2);

    // 保护到期 ⇒ 回归普通保留策略（maxSnapshots=1 只留最新）。
    db.prepare("UPDATE note_history SET protected_until=? WHERE note_id=?").run("2000-01-01T00:00:00.000Z", "note-1");
    await cleanupHistory(mobileDb, { maxSnapshots: 1, retentionDays: 30, cleanupIntervalHours: 24, snapshotIntervalMinutes: 15 });
    count = db.prepare("SELECT COUNT(*) AS c FROM note_history WHERE note_id=?").get("note-1") as { c: number };
    expect(count.c).toBe(1);
  });

  it("falls back to default settings when stored JSON is invalid", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(new SqlJsAsyncDb(db));
    const mobileDb = new SqlJsAsyncDb(db);
    db.prepare("INSERT INTO device_state(key,value) VALUES('history_settings',?)")
      .run("{invalid-json");

    await expect(getHistorySettings(mobileDb)).resolves.toEqual(DEFAULT_HISTORY_SETTINGS);
  });
});
