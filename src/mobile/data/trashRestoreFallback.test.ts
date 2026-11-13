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

  it("G2：原父是**活跃文档**（note 可作父）→ 恢复子文档保持原父，不回落笔记本根", async () => {
    try {
      await insertFolder(db, "nb1", "notebook");
      await createNote(db, "parent-note", "父文档", "<p>p</p>", "nb1", new Map());
      await seedTrashedNote(db, "child", "parent-note");
      await restoreTreeItem(db, "child", "note", async () => undefined);
      const row = await db.prepare("SELECT parent_id, trashed_at FROM notes WHERE id='child'").get() as { parent_id: string | null; trashed_at: string | null };
      expect(row.trashed_at).toBeNull();
      expect(row.parent_id).toBe("parent-note");
    } finally { await db.close(); }
  });

  it("G2：原父是**活跃文档** → 恢复子分组保持原父（group 不挂错到笔记本根）", async () => {
    try {
      await insertFolder(db, "nb1", "notebook");
      await createNote(db, "parent-note", "父文档", "<p>p</p>", "nb1", new Map());
      // 模拟「从远端学到的删除」：子分组行 parent 被归一成 TRASH 容器、原父记在 deleted_from_parent_id。
      await db.prepare(
        "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty) VALUES (?,?,?,0,?,NULL,?,?,?,1)",
      ).run("g-child", "子分组", "trash-container", "group", NOW, NOW, "parent-note");
      await restoreTreeItem(db, "g-child", "folder", async () => undefined);
      const restored = await db.prepare("SELECT parent_id, trashed_at FROM folders WHERE id='g-child'").get() as { parent_id: string | null; trashed_at: string | null };
      expect(restored.trashed_at).toBeNull();
      expect(restored.parent_id).toBe("parent-note");
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

  it("日记条目：原父（月分组）也在回收站时，恢复回日记本而不是默认笔记本（261110）", async () => {
    await insertFolder(db, "nb-diary", "notebook");
    await db.prepare("UPDATE folders SET space='diary' WHERE id=?").run("nb-diary");
    await insertFolder(db, "y26", "group", "nb-diary");
    await insertFolder(db, "m11", "group", "y26", NOW); // 月分组已进回收站
    await seedTrashedNote(db, "dn", "m11");
    // 标题 = 日期（原路返回才能按日期补回年/月分组）
    await db.prepare("UPDATE notes SET title='2026-11-09' WHERE id=?").run("dn");
    await restoreTreeItem(db, "dn", "note", async () => undefined);
    const row = await db.prepare("SELECT parent_id, trashed_at FROM notes WHERE id='dn'").get() as { parent_id: string | null; trashed_at: string | null };
    expect(row.trashed_at).toBeNull();
    // 原路返回：月分组（11）被补回到年分组（2026）下，年分组在日记本下
    const month = await db.prepare("SELECT title, parent_id FROM folders WHERE id=?").get(row.parent_id) as { title: string; parent_id: string | null } | undefined;
    expect(month?.title).toBe("11");
    const year = await db.prepare("SELECT title, parent_id FROM folders WHERE id=?").get(month?.parent_id) as { title: string; parent_id: string | null } | undefined;
    expect(year?.title).toBe("2026");
    expect(year?.parent_id).toBe("nb-diary");
  });

  it("普通文档同样场景仍回落活跃笔记本（旧行为不变）", async () => {
    await insertFolder(db, "nb1", "notebook");
    await seedTrashedNote(db, "n2", "deleted-folder");
    await restoreTreeItem(db, "n2", "note", async () => undefined);
    const row = await db.prepare("SELECT parent_id FROM notes WHERE id='n2'").get() as { parent_id: string | null };
    expect(row.parent_id).toBe("nb1");
  });
});