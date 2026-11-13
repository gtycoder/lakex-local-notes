import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNotebook } from "../data/treeRepository.js";
import { createNote } from "../data/noteRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import type { DeviceBaseline } from "../../core/s3v3DeviceStore.js";

async function setup() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const nb = await createNotebook(db, { title: "NB", icon: null });
  await createNote(db, "n1", "Doc", "hello", nb.id, new Map());
  return db;
}

async function noteRow(db: SqlJsAsyncDb) {
  return await db.prepare("SELECT updated_at, is_dirty, restore_pending_at FROM notes WHERE id=?").get("n1") as { updated_at: string; is_dirty: number; restore_pending_at: string | null };
}

function baselineWith(updatedAt: string): DeviceBaseline {
  return {
    epoch: "e1", generation: 1, lakeCommit: "c1", quickNotesCommit: "q1",
    lake: { v: 3, space: "lake", notes: [{ id: "n1", title: "Doc", parentId: null, sortOrder: 0, updatedAt, contentHash: "h" }], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [] },
  };
}

describe("移动端 saveBaseline 守卫式归位（261107 数据安全）", () => {
  it("updated_at 未变才清 dirty；窗口内改名保持待同步", async () => {
    const db = await setup();
    const store = new MobileDeviceStore(db);
    await store.init();
    const before = (await noteRow(db)).updated_at;
    await store.saveBaseline(baselineWith(before));
    expect((await noteRow(db)).is_dirty).toBe(0);

    // 模拟同步窗口内改名：updated_at 变了，旧 baseline 不得标 synced。
    const later = new Date(Date.now() + 10_000).toISOString();
    await db.prepare("UPDATE notes SET title=?, updated_at=?, is_dirty=1 WHERE id=?").run("Renamed in window", later, "n1");
    await store.saveBaseline(baselineWith(before));
    const row = await noteRow(db);
    expect(row.is_dirty).toBe(1);
    expect(row.updated_at).toBe(later);
  });

  it("is_dirty=0 但 restore_pending_at 非空 ⇒ 仍被归位清除（261113 D1 新过滤条件不漏）", async () => {
    const db = await setup();
    const store = new MobileDeviceStore(db);
    await store.init();
    const before = (await noteRow(db)).updated_at;
    // 只标「待恢复」（dirty 已清）：旧实现靠「全表 IN 扫描 + updated_at 相等」才会清 restore_pending，
    // 新实现先按 (is_dirty=1 OR restore_pending_at IS NOT NULL) 捞行 ⇒ 必须仍在候选里。
    await db.prepare("UPDATE notes SET is_dirty=0, restore_pending_at=? WHERE id=?").run(before, "n1");
    await store.saveBaseline(baselineWith(before));
    const row = await noteRow(db);
    expect(row.restore_pending_at).toBeNull();
    expect(row.is_dirty).toBe(0);
  });

  it("窗口内恢复（restore_pending_at）不被旧基线清掉", async () => {
    const db = await setup();
    const store = new MobileDeviceStore(db);
    await store.init();
    const before = (await noteRow(db)).updated_at;
    await store.saveBaseline(baselineWith(before));
    const later = new Date(Date.now() + 20_000).toISOString();
    await db.prepare("UPDATE notes SET updated_at=?, is_dirty=1, restore_pending_at=? WHERE id=?").run(later, later, "n1");
    await store.saveBaseline(baselineWith(before));
    const row = await noteRow(db);
    expect(row.is_dirty).toBe(1);
    expect(row.restore_pending_at).not.toBeNull();
  });
});
