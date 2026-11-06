/**
 * 261106 任务：删除 / 合并标签时**文档关系同库收敛**（既有实现已处理，这里补护栏）。
 *
 * 判据（与桌面同名语义）：
 *  · 合并 = 源标签的文档关系改指目标（同一条里已含目标则去重、保留原位置）→ 源标签物理删行；
 *  · 删除 = 物理清掉该标签的文档关系（其它标签关系原样保留）；
 *  · 两种路径都要推进受影响文档的关系版本（删除/合并才能随同步传出去）；
 *  · 小记关系与文档关系在**同一事务**里收敛，不许只改一半。
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
import { createQuickNoteTag } from "./quickNoteTagsRepository.js";
import { listQuickNoteTagIds } from "./quickNoteTagLinksRepository.js";
import { listNoteTagIds, noteTagsUpdatedAt, setNoteTags } from "./noteTagLinksRepository.js";
import { mobileQuickNoteTags } from "./quickNoteTagService.js";

const T1 = "2026-11-01T00:00:00.000Z";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertQuickNote(db: SqlJsAsyncDb, id: string): Promise<void> {
  await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,?,0,0)")
    .run(id, T1, T1, "hash-" + id);
}

describe("标签删除/合并：文档关系同库收敛（移动端）", () => {
  it("合并：文档关系改指目标（去重、保留位置）、源标签物理删行、小记关系同步改指、版本推进", async () => {
    const db = await freshDb();
    try {
      const work = await createQuickNoteTag(db, "工作");
      const idea = await createQuickNoteTag(db, "灵感");
      // 版本显式给一个旧时间，便于断言「合推进会」而不是碰上同一毫秒。
      await setNoteTags(db, "n1", [work.id], "2026-11-01T00:00:00.000Z");
      await setNoteTags(db, "n2", [work.id, idea.id], "2026-11-01T00:00:00.000Z");
      await insertQuickNote(db, "q1");
      await mobileQuickNoteTags.setNoteTags(db, "q1", [work.id]);
      const beforeVersion = await noteTagsUpdatedAt(db, "n1");

      await mobileQuickNoteTags.merge(db, work.id, idea.id);

      expect(await listNoteTagIds(db, "n1")).toEqual([idea.id]);
      expect(await listNoteTagIds(db, "n2")).toEqual([idea.id]); // 去重、只剩目标
      expect(await listQuickNoteTagIds(db, "q1")).toEqual([idea.id]);
      // 源标签 = 物理消失（删除=缺席，不留墓碑行）
      expect(await db.prepare("SELECT 1 FROM tags WHERE id=?").get(work.id)).toBeUndefined();
      expect((await mobileQuickNoteTags.list(db)).map((tag) => tag.name)).toEqual(["灵感"]);
      // 版本推进 ⇒ 合并结果能随同步传出去
      expect(await noteTagsUpdatedAt(db, "n1")).not.toBe(beforeVersion);
      expect(await noteTagsUpdatedAt(db, "n1")).toBeTruthy();
    } finally { await db.close(); }
  });

  it("删除：清掉该标签的文档/小记关系，其它标签关系原样保留，版本推进", async () => {
    const db = await freshDb();
    try {
      const work = await createQuickNoteTag(db, "工作");
      const idea = await createQuickNoteTag(db, "灵感");
      await setNoteTags(db, "n1", [work.id], "2026-11-01T00:00:00.000Z");
      await setNoteTags(db, "n3", [idea.id], "2026-11-01T00:00:00.000Z");
      await insertQuickNote(db, "q1");
      await mobileQuickNoteTags.setNoteTags(db, "q1", [work.id]);
      const beforeVersion = await noteTagsUpdatedAt(db, "n1");

      await mobileQuickNoteTags.delete(db, work.id);

      expect(await listNoteTagIds(db, "n1")).toEqual([]);
      expect(await listNoteTagIds(db, "n3")).toEqual([idea.id]); // 无关文档不受影响
      expect(await listQuickNoteTagIds(db, "q1")).toEqual([]);
      expect(await db.prepare("SELECT 1 FROM tags WHERE id=?").get(work.id)).toBeUndefined();
      expect(await db.prepare("SELECT COUNT(*) AS c FROM tag_links WHERE tag_id=?").get(work.id)).toMatchObject({ c: 0 });
      // 版本**真的推进**了 ⇒ 删除能随同步传出去（此前跨 kind 先删行导致文档侧找不到目标、版本不推进）。
      expect(await noteTagsUpdatedAt(db, "n1")).not.toBe(beforeVersion);
      expect(await noteTagsUpdatedAt(db, "n1")).toBeTruthy();
    } finally { await db.close(); }
  });
});
