/**
 * F-01（P0，task-62）移动端同口径回归：purge 一个「随分组进回收站的子树」必须整棵彻底删除。
 *
 * 缺陷形态（桌面实测）：删除分组进回收站后，同步侧会把子树里 trashed 条目的 parent 归一成回收站容器
 * （原始父只剩 `deleted_from_parent_id`）⇒ 只按 parent_id 遍历的后代收集会漏掉子文档，purge 只删根，
 * 子文档残留并继续以 trashed 条目发布，云端索引残留（违反 AGENTS §3#15 删除传播红线）。
 * 移动端 `collectSubtree` 已补「原始父链」边；本文件同时钉住「未扁平化」与「已扁平化」两种形态。
 */
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => undefined,
  loadAssetBytesFs: async () => null,
  removeAssetBytesFs: async () => undefined,
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => undefined,
  removeQuickNoteAssetsDirFs: async () => undefined,
}));

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { trashTreeItem, purgeTreeItem } from "../data/trashRepository.js";

describe("purge 回收站子树（F-01 移动口径）", () => {
  it("分组进回收站后被扁平化的子文档也整棵彻底删除（notes 行清、每篇都有 note 墓碑）", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    const t = "2026-11-12T00:00:00.000Z";
    await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty,space) VALUES ('f1','组',NULL,0,'group',NULL,?,NULL,NULL,1,NULL)").run(t);
    await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty,space) VALUES ('f2','子组','f1',1,'group',NULL,?,NULL,NULL,1,NULL)").run(t);
    const insertNote = (id: string, parent: string | null, deletedFrom: string | null) =>
      db.prepare("INSERT INTO notes (id,title,parent_id,updated_at,created_at,content_hash,is_dirty,text_cache,doc_kind,trashed_at,deleted_from_parent_id) VALUES (?,?,?,?,?,?,1,NULL,'doc',?,?)").run(id, id, parent, t, t, "h-" + id, t, deletedFrom);
    // n1 = 未扁平化（parent 仍在子树内）；n2 = 已扁平化（parent 被归一成 null，原始父只剩 deleted_from_parent_id）
    await insertNote("n1", "f2", null);
    await insertNote("n2", null, "f2");

    await trashTreeItem(db, "f1", "folder");
    const purged = await purgeTreeItem(db, "f1", "folder");
    expect(purged.purged).toBe(true);
    expect(new Set(purged.noteIds)).toEqual(new Set(["n1", "n2"])); // G3：返回被物理删除 note ids（关标签用）

    const notes = await db.prepare("SELECT id FROM notes WHERE id IN ('n1','n2')").all() as Array<{ id: string }>;
    expect(notes).toHaveLength(0);
    const folders = await db.prepare("SELECT id FROM folders WHERE id IN ('f1','f2')").all() as Array<{ id: string }>;
    expect(folders).toHaveLength(0);
    // 每篇文档都要有 note 墓碑（云端索引才能删掉该 id）
    const tombstones = await db.prepare("SELECT id,node_type FROM deleted_notes WHERE id IN ('n1','n2') ORDER BY id").all() as Array<{ id: string; node_type: string }>;
    expect(tombstones.map((x) => x.id)).toEqual(["n1", "n2"]);
    expect(tombstones.every((x) => x.node_type === "note")).toBe(true);
    await db.close();
  }, 60_000);
});
