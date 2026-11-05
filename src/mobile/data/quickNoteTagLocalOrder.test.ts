/**
 * 261105：标签目录顺序 = 设备本地视图（不参与同步）。
 * - 默认：新的在前（createdAt DESC）→ 名称；
 * - 手动拖拽后：本机 device_state 标记，按 sort_order；之后新增标签追加末尾；
 * - 同步合并（远端改名/墓碑/新增）不覆盖本机顺序。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
const assetStore = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetStore.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetStore.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetStore.delete(key); },
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { createQuickNoteTag, listQuickNoteTags, mergeRemoteQuickNoteTags, reorderQuickNoteTags } from "./quickNoteTagsRepository.js";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertTag(db: SqlJsAsyncDb, id: string, name: string, createdAt: string) {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,0,?,?,NULL)").run(id, name, createdAt, createdAt);
}

describe("标签目录顺序（设备本地）", () => {
  it("默认新的在前；手动排序后按本机顺序；之后新增追加末尾", async () => {
    const db = await freshDb();
    try {
      await insertTag(db, "t_000000000000000a", "旧", "2026-01-01T00:00:00.000Z");
      await insertTag(db, "t_000000000000000b", "新", "2026-02-01T00:00:00.000Z");
      expect((await listQuickNoteTags(db)).map((t) => t.name)).toEqual(["新", "旧"]);
      await reorderQuickNoteTags(db, ["t_000000000000000a", "t_000000000000000b"]);
      expect((await listQuickNoteTags(db)).map((t) => t.name)).toEqual(["旧", "新"]);
      await createQuickNoteTag(db, "更晚");
      expect((await listQuickNoteTags(db)).map((t) => t.name)).toEqual(["旧", "新", "更晚"]);
    } finally { await db.close(); }
  });

  it("同步合并不覆盖本机顺序：远端改名/墓碑/新增都不搬家", async () => {
    const db = await freshDb();
    try {
      await insertTag(db, "t_000000000000000a", "A", "2026-01-01T00:00:00.000Z");
      await insertTag(db, "t_000000000000000b", "B", "2026-02-01T00:00:00.000Z");
      await reorderQuickNoteTags(db, ["t_000000000000000b", "t_000000000000000a"]);
      expect((await listQuickNoteTags(db)).map((t) => t.name)).toEqual(["B", "A"]);
      await mergeRemoteQuickNoteTags(db, [
        { id: "t_000000000000000a", name: "A2", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z", deletedAt: null },
        { id: "t_000000000000000c", name: "C", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z", deletedAt: null },
      ]);
      expect((await listQuickNoteTags(db)).map((t) => t.name)).toEqual(["B", "A2", "C"]);
    } finally { await db.close(); }
  });
});
