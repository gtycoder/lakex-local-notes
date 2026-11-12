/**
 * 移动端软删的「删除前父」列（261112 task-55 N2）。
 *
 * 桌面模型：回收站 = 隐藏笔记本（parent_id=notebook-trash + deleted_from_parent_id=原父）；
 * 移动模型：trashed_at + **原 parent_id 原样保留** + deleted_from_parent_id 记原父。
 * 判据：软删（单篇/子树）必须写 deleted_from_parent_id；显式恢复后清空且父级归位。
 * 为什么重要：恢复原路返回、跨端恢复位置、以及回收站行接收远端正文后的父归一都依赖它。
 */
import { describe, expect, it } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { createNote, trashNote } from "./noteRepository.js";
import { restoreTreeItem, trashTreeItem } from "./trashRepository.js";

const T = "2026-11-12T00:00:00.000Z";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertNotebook(db: SqlJsAsyncDb, id: string): Promise<void> {
  await db.prepare(
    "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty) VALUES (?,?,NULL,0,'notebook',NULL,?,NULL,NULL,1)",
  ).run(id, id, T);
}

const noteRow = async (db: SqlJsAsyncDb, id: string) =>
  await db.prepare("SELECT parent_id, trashed_at, deleted_from_parent_id FROM notes WHERE id=?").get(id) as
    | { parent_id: string | null; trashed_at: string | null; deleted_from_parent_id: string | null }
    | undefined;

describe("移动端软删写「删除前父」（task-55 N2）", () => {
  it("单篇 trashNote：记 deleted_from_parent_id=原父，parent_id 原样保留", async () => {
    const db = await freshDb();
    try {
      await insertNotebook(db, "nb1");
      await createNote(db, "n1", "文档", "<p>x</p>", "nb1", new Map());
      await trashNote(db, "n1");
      const row = (await noteRow(db, "n1"))!;
      expect(row.trashed_at).not.toBeNull();
      expect(row.parent_id).toBe("nb1"); // 移动端回收站不是 notebook-trash 目录
      expect(row.deleted_from_parent_id).toBe("nb1");
    } finally { await db.close(); }
  });

  it("子树 trashTreeItem：子文档同样记 deleted_from_parent_id", async () => {
    const db = await freshDb();
    try {
      await insertNotebook(db, "nb1");
      await db.prepare(
        "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty) VALUES ('g1','分组','nb1',0,'group',NULL,?,NULL,NULL,1)",
      ).run(T);
      await createNote(db, "n1", "子文档", "<p>x</p>", "g1", new Map());
      await trashTreeItem(db, "g1", "folder");
      const row = (await noteRow(db, "n1"))!;
      expect(row.trashed_at).not.toBeNull();
      expect(row.deleted_from_parent_id).toBe("g1");
    } finally { await db.close(); }
  });

  it("显式恢复：父级归位、deleted_from_parent_id 清空", async () => {
    const db = await freshDb();
    try {
      await insertNotebook(db, "nb1");
      await createNote(db, "n1", "文档", "<p>x</p>", "nb1", new Map());
      await trashNote(db, "n1");
      await restoreTreeItem(db, "n1", "note", async () => {});
      const row = (await noteRow(db, "n1"))!;
      expect(row.trashed_at).toBeNull();
      expect(row.parent_id).toBe("nb1");
      expect(row.deleted_from_parent_id).toBeNull();
    } finally { await db.close(); }
  });

  it("防御性归一：损坏行 parent_id=notebook-trash ⇒ 恢复时按「无原父」回落活跃笔记本（不卡死）", async () => {
    const db = await freshDb();
    try {
      await insertNotebook(db, "nb1");
      await createNote(db, "n1", "坏行", "<p>x</p>", "nb1", new Map());
      // 模拟旧 staged 缺陷写入的坏父（不写数据迁移，只在恢复路径防御）。
      await db.prepare("UPDATE notes SET parent_id='notebook-trash', trashed_at=?, deleted_from_parent_id=NULL WHERE id='n1'").run(T);
      await restoreTreeItem(db, "n1", "note", async () => {});
      const row = (await noteRow(db, "n1"))!;
      expect(row.trashed_at).toBeNull();
      expect(row.parent_id).toBe("nb1"); // 回落活跃笔记本，而不是不存在的容器 id
      expect(row.parent_id).not.toBe("notebook-trash");
    } finally { await db.close(); }
  });
});
