/**
 * 批量读文档标签（261105 P1 只读展示用）：顺序 = 本机 position，未请求/无标签的文档不出现。
 * 这是属性面板与文档列表筛选的唯一数据入口（bridge/noteTagReads.loadNoteTagIdsForNotes 薄封装）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {}, loadAssetBytesFs: async () => null, removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [], listQuickNoteAssetKeysFs: async () => [], listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {}, removeQuickNoteAssetsDirFs: async () => {},
}));
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { listNoteTagIdsForNotes } from "./noteTagLinksRepository.js";

const T1 = "2026-11-01T00:00:00.000Z";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const insertTag = db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,0,?,?,NULL)");
  for (const [id, name] of [["t_work", "工作"], ["t_idea", "灵感"], ["t_life", "生活"]] as const) await insertTag.run(id, name, T1, T1);
  const link = db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES (?,?,?,?)");
  // n1: 灵感(pos0) → 工作(pos1)；n2: 工作；n3: 无标签；quickNote 行必须不串进文档标签
  await link.run("note", "n1", "t_idea", 0);
  await link.run("note", "n1", "t_work", 1);
  await link.run("note", "n2", "t_work", 0);
  await link.run("quickNote", "q1", "t_life", 0);
  return db;
}

describe("listNoteTagIdsForNotes", () => {
  it("按 target_id + 本机 position 返回；只回被请求的文档，无标签文档不出现", async () => {
    const db = await freshDb();
    try {
      const map = await listNoteTagIdsForNotes(db, ["n1", "n2", "n3"]);
      expect([...map.keys()].sort()).toEqual(["n1", "n2"]);
      expect(map.get("n1")).toEqual(["t_idea", "t_work"]);
      expect(map.get("n2")).toEqual(["t_work"]);
      // quickNote 的关联不串进文档标签
      expect([...map.values()].flat()).not.toContain("t_life");
    } finally { await db.close(); }
  });

  it("空请求/重复 id/非文档 id ⇒ 空或幂等（不抛）", async () => {
    const db = await freshDb();
    try {
      await expect(listNoteTagIdsForNotes(db, [])).resolves.toEqual(new Map());
      const dup = await listNoteTagIdsForNotes(db, ["n2", "n2"]);
      expect(dup.get("n2")).toEqual(["t_work"]);
      await expect(listNoteTagIdsForNotes(db, ["missing"])).resolves.toEqual(new Map());
    } finally { await db.close(); }
  });
});
