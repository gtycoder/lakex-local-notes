import { beforeEach, describe, expect, it } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { createNote } from "./noteRepository.js";
import { restoreTreeItem } from "./trashRepository.js";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

const NOW = "2026-10-27T00:00:00.000Z";

async function insertFolder(db: SqlJsAsyncDb, id: string, nodeType: string, parentId: string | null = null, trashedAt: string | null = null): Promise<void> {
  await db.prepare(
    "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty) VALUES (?,?,?,0,?,NULL,?,?,NULL,1)"
  ).run(id, id, parentId, nodeType, NOW, trashedAt);
}

/** 模拟「从远端学到的删除」：行仍在，trashed_at 有值、deleted_from_parent_id = 删除时原父。 */
async function seedTrashedNote(db: SqlJsAsyncDb, id: string, deletedFromParentId: string | null): Promise<void> {
  await createNote(db, id, "标题" + id, "<p>正文</p>", null, new Map());
  await db.prepare("UPDATE notes SET trashed_at=?, deleted_from_parent_id=?, parent_id='trash-container' WHERE id=?").run(NOW, deletedFromParentId, id);
}

describe("回收站恢复：原父缺失回落兜底笔记本（261027）", () => {
  let db: SqlJsAsyncDb;
  beforeEach(async () => { db = await freshDb(); });

  it("原父已删 → 落到活跃笔记本，行不再悬空", async () => {
    try {
      await insertFolder(db, "nb1", "notebook");
      await seedTrashedNote(db, "n1", "deleted-folder");
      await restoreTreeItem(db, "n1", "note", async () => undefined);
      const row = await db.prepare("SELECT parent_id, trashed_at FROM notes WHERE id='n1'").get() as { parent_id: string | null; trashed_at: string | null };
      expect(row.trashed_at).toBeNull();
      expect(row.parent_id).toBe("nb1");
      const parent = await db.prepare("SELECT trashed_at FROM folders WHERE id=?").get(row.parent_id) as { trashed_at: string | null } | undefined;
      expect(parent?.trashed_at ?? null).toBeNull();
    } finally { await db.close(); }
  });

  it("没有任何活跃笔记本 → 懒建「未分类」并把文档放进去", async () => {
    try {
      await insertFolder(db, "gone-nb", "notebook", null, NOW);
      await seedTrashedNote(db, "n1", "gone-nb");
      await restoreTreeItem(db, "n1", "note", async () => undefined);
      const row = await db.prepare("SELECT parent_id FROM notes WHERE id='n1'").get() as { parent_id: string };
      const parent = await db.prepare("SELECT title, node_type, trashed_at FROM folders WHERE id=?").get(row.parent_id) as { title: string; node_type: string; trashed_at: string | null } | undefined;
      expect(parent).toBeTruthy();
      expect(parent!.node_type).toBe("notebook");
      expect(parent!.title).toBe("未分类");
      expect(parent!.trashed_at).toBeNull();
    } finally { await db.close(); }
  });

  it("原父仍活跃 → 保持原父（不误回落）", async () => {
    try {
      await insertFolder(db, "nb1", "notebook");
      await insertFolder(db, "f2", "folder", "nb1");
      await seedTrashedNote(db, "n1", "f2");
      await restoreTreeItem(db, "n1", "note", async () => undefined);
      const row = await db.prepare("SELECT parent_id FROM notes WHERE id='n1'").get() as { parent_id: string | null };
      expect(row.parent_id).toBe("f2");
    } finally { await db.close(); }
  });

  it("分组恢复：原父已删同样回落，笔记本恢复回根层", async () => {
    try {
      await insertFolder(db, "nb1", "notebook");
      await insertFolder(db, "f-gone", "folder", "nbX", NOW);
      await insertFolder(db, "f2", "folder", "f-gone", NOW);
      await restoreTreeItem(db, "f2", "folder", async () => undefined);
      const restored = await db.prepare("SELECT parent_id, trashed_at FROM folders WHERE id='f2'").get() as { parent_id: string | null; trashed_at: string | null };
      expect(restored.trashed_at).toBeNull();
      expect(restored.parent_id).toBe("nb1");
    } finally { await db.close(); }
  });
});
