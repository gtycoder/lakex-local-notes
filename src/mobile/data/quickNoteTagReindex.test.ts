/**
 * 261105：标签目录变化后的搜索索引重刷必须**只碰受影响小记**（旧实现 reindexAll 全量重建）。
 * 标签名只是搜索索引里的派生列；标签模型本身不参与搜索。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

const indexSpy = vi.hoisted(() => vi.fn(async (_db: unknown, _id: string, _force?: boolean) => undefined));
vi.mock("./quickNotesSearch.js", () => ({ indexQuickNote: indexSpy }));
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
import { mobileQuickNoteTags } from "./quickNoteTagService.js";
import { createMobilePlatformPort } from "../v3/mobilePlatformPort.js";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const TA = "t_000000000000000a";
const TB = "t_000000000000000b";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  for (const id of ["n1", "n2", "n3"]) {
    await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,?,0,0)")
      .run(id, T1, T1, "hash-" + id);
  }
  for (const [id, name] of [[TA, "A"], [TB, "B"]] as const) {
    await db.prepare("INSERT INTO tags (id,name,sort_order,pinned,created_at,updated_at,deleted_at) VALUES (?,?,0,0,?,?,NULL)").run(id, name, T1, T1);
  }
  const link = db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote',?,?,0)");
  await link.run("n1", TA);
  await link.run("n2", TB);
  return db;
}

describe("标签目录变化只重刷受影响小记的搜索索引", () => {
  it("改名：只重刷关联该标签的小记；无关小记不动", async () => {
    const db = await freshDb();
    try {
      indexSpy.mockClear();
      await mobileQuickNoteTags.update(db, TA, { name: "A2" });
      expect(indexSpy.mock.calls.map((call) => call[1])).toContain("n1");
      expect(indexSpy.mock.calls.map((call) => call[1])).not.toContain("n2");
      expect(indexSpy.mock.calls.every((call) => call[2] === true)).toBe(true);
    } finally { await db.close(); }
  });

  it("删除：只重刷该标签关联的小记", async () => {
    const db = await freshDb();
    try {
      indexSpy.mockClear();
      await mobileQuickNoteTags.delete(db, TB);
      expect(indexSpy.mock.calls.map((call) => call[1])).toEqual(["n2"]);
    } finally { await db.close(); }
  });

  it("合并：只重刷源标签关联的小记", async () => {
    const db = await freshDb();
    try {
      indexSpy.mockClear();
      await mobileQuickNoteTags.merge(db, TA, TB);
      expect(indexSpy.mock.calls.map((call) => call[1])).toEqual(["n1"]);
    } finally { await db.close(); }
  });

  it("远端目录改名/墓碑（同步端口）：只重刷关联小记", async () => {
    const db = await freshDb();
    try {
      const port = createMobilePlatformPort(db);
      indexSpy.mockClear();
      await port.mergeQuickTags([{ id: TA, name: "A3", sortOrder: 0, pinned: false, createdAt: T1, updatedAt: T2 }]);
      expect(indexSpy.mock.calls.map((call) => call[1])).toContain("n1");
      expect(indexSpy.mock.calls.map((call) => call[1])).not.toContain("n2");
      indexSpy.mockClear();
      await port.mergeQuickTags([{ id: TB, name: "B", sortOrder: 0, pinned: false, createdAt: T1, updatedAt: T2, deletedAt: T2 }]);
      expect(indexSpy.mock.calls.map((call) => call[1])).toEqual(["n2"]);
    } finally { await db.close(); }
  });
});
