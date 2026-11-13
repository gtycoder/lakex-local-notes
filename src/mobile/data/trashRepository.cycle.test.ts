import { describe, expect, it } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { createNote } from "./noteRepository.js";
import { purgeTreeItem, trashTreeItem } from "./trashRepository.js";

/**
 * P1-6 父环防护（移动端）：坏库/远端注入的父环下，回收站删除/彻底删除必须有限完成。
 * collectSubtree 本来就是 visited（subtree.allIds）+ 防御上限，这里用真实 schema 造环守住回归。
 */

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

const NOW = "2026-11-05T00:00:00.000Z";

async function insertFolder(db: SqlJsAsyncDb, id: string, parentId: string | null, nodeType = "folder"): Promise<void> {
  await db.prepare(
    "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty) VALUES (?,?,?,0,?,NULL,?,NULL,NULL,1)",
  ).run(id, id, parentId, nodeType, NOW);
}

describe("P1-6 移动端父环防护", () => {
  it("trashTreeItem/purgeTreeItem：f1↔f2 环 + 挂环上的文档，有限时间完成", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb", null, "notebook");
      await insertFolder(db, "f1", "f2");
      await insertFolder(db, "f2", "f1");
      await createNote(db, "n1", "挂在环上的文档", "<p>x</p>", "f1", new Map());

      const t0 = Date.now();
      await trashTreeItem(db, "f1", "folder");
      expect(Date.now() - t0).toBeLessThan(5_000);

      const trashed = await db.prepare("SELECT COUNT(*) AS c FROM folders WHERE id IN ('f1','f2') AND trashed_at IS NOT NULL").get() as { c: number };
      expect(trashed.c).toBe(2);
      const trashedNote = await db.prepare("SELECT trashed_at FROM notes WHERE id='n1'").get() as { trashed_at: string | null };
      expect(trashedNote.trashed_at).not.toBeNull();

      const t1 = Date.now();
      const purged = await purgeTreeItem(db, "f1", "folder");
      expect(Date.now() - t1).toBeLessThan(5_000);
      expect(purged.purged).toBe(true);
      const left = await db.prepare("SELECT COUNT(*) AS c FROM folders WHERE id IN ('f1','f2')").get() as { c: number };
      expect(left.c).toBe(0);
    } finally {
      await db.close();
    }
  }, 20_000);

  it("自指目录（parent_id = 自身）也有限收敛", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb", null, "notebook");
      await insertFolder(db, "self", "self");
      const t0 = Date.now();
      await trashTreeItem(db, "self", "folder");
      expect(Date.now() - t0).toBeLessThan(5_000);
      const row = await db.prepare("SELECT trashed_at FROM folders WHERE id='self'").get() as { trashed_at: string | null };
      expect(row.trashed_at).not.toBeNull();
    } finally {
      await db.close();
    }
  }, 20_000);
});
