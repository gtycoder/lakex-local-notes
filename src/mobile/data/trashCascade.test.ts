/**
 * 261114 追加回归：带子级 / 多级子级的删除在移动端也必须是「整棵子树进回收站」。
 *
 * 桌面已由 electron/trashCascade.test.ts 钉住；移动端用户 261114 追问同类场景。
 * 注意：移动端 notes 与 folders 都可作为父节点（collectSubtree 明确支持「note 也可作为父节点」）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  statNoteAssetSizesFs: vi.fn(async () => null),
  removeAssetBytesFs: vi.fn(async () => {}),
  removeNoteAssetsDirFs: vi.fn(async () => {}),
}));

import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { listTrashTree, purgeTreeItem, restoreTreeItem, trashTreeItem } from "./trashRepository.js";
import { trashNote } from "./noteRepository.js";

const T = "2026-11-13T00:00:00.000Z";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertFolder(db: SqlJsAsyncDb, id: string, kind: "notebook" | "group", parentId: string | null): Promise<void> {
  await db.prepare("INSERT INTO folders(id,title,parent_id,sort_order,node_type,updated_at) VALUES(?,?,?,?,?,?)")
    .run(id, id, parentId, 0, kind, T);
}

async function insertNote(db: SqlJsAsyncDb, id: string, parentId: string | null): Promise<void> {
  await db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at) VALUES(?,?,?,?,?)")
    .run(id, id, parentId, 0, T);
}

/** nb1 > g1 > n1(根文档) > n2(子文档) > n3(孙文档)，另有旁观文档 nSibling。 */
async function seedNested(db: SqlJsAsyncDb): Promise<void> {
  await insertFolder(db, "nb1", "notebook", null);
  await insertFolder(db, "g1", "group", "nb1");
  await insertNote(db, "n1", "g1");
  await insertNote(db, "n2", "n1");
  await insertNote(db, "n3", "n2");
  await insertNote(db, "nSibling", "g1");
}

async function row(db: SqlJsAsyncDb, table: "notes" | "folders", id: string): Promise<{ trashed_at: string | null; parent_id: string | null } | undefined> {
  return await db.prepare(`SELECT trashed_at, parent_id FROM ${table} WHERE id=?`).get(id) as never;
}

describe("261114 移动端级联软删：文档下的多级子文档", () => {
  it("trashTreeItem(note)：根文档 + 多级子文档一起进回收站（不是只动根）", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n1", "note");
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    }
    expect((await row(db, "notes", "nSibling"))?.trashed_at ?? null).toBeNull();
    // 回收站树里能看到整棵（列表返回全部 trashed 行，UI 按 parent 组树）
    const tree = await listTrashTree(db);
    expect(tree.map((it) => it.id)).toEqual(expect.arrayContaining(["n1", "n2", "n3"]));
    await db.close();
  });

  it("noteRepository.trashNote：同样级联（批量删除/回滚等入口共用）", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashNote(db, "n1");
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    }
    expect((await row(db, "notes", "nSibling"))?.trashed_at ?? null).toBeNull();
    await db.close();
  });

  it("restoreTreeItem(note)：整棵子文档一起恢复，父链保持", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n1", "note");
    await restoreTreeItem(db, "n1", "note", async () => {});
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at ?? null).toBeNull();
    }
    expect((await row(db, "notes", "n1"))?.parent_id).toBe("g1");
    expect((await row(db, "notes", "n2"))?.parent_id).toBe("n1");
    expect((await row(db, "notes", "n3"))?.parent_id).toBe("n2");
    expect(await listTrashTree(db)).toHaveLength(0);
    await db.close();
  });

  it("purgeTreeItem(note)：整棵子文档一起物理删除并逐条写墓碑", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n1", "note");
    const purged = await purgeTreeItem(db, "n1", "note");
    expect(purged).toBe(true);
    for (const id of ["n1", "n2", "n3"]) {
      expect(await db.prepare("SELECT id FROM notes WHERE id=?").get(id)).toBeUndefined();
    }
    const tombstones = await db.prepare("SELECT id FROM deleted_notes WHERE id IN ('n1','n2','n3')").all() as Array<{ id: string }>;
    expect(tombstones.map((t) => t.id).sort()).toEqual(["n1", "n2", "n3"]);
    expect(await db.prepare("SELECT id FROM notes WHERE id='nSibling'").get()).toBeTruthy();
    await db.close();
  });

  it("批量删除顺序无关：子文档先删、根文档后删，恢复根时子文档跟随回原父", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n2", "note"); // 先删中间的子文档（成为回收站根）
    expect((await row(db, "notes", "n2"))?.parent_id).toBe("n1");
    await trashTreeItem(db, "n1", "note"); // 后删根文档：已 trashed 的子文档不被重复改写
    for (const id of ["n1", "n2", "n3"]) expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    await restoreTreeItem(db, "n1", "note", async () => {});
    for (const id of ["n1", "n2", "n3"]) expect((await row(db, "notes", id))?.trashed_at ?? null).toBeNull();
    expect((await row(db, "notes", "n2"))?.parent_id).toBe("n1");
    expect((await row(db, "notes", "n3"))?.parent_id).toBe("n2");
    await db.close();
  });

  it("删分组（folder）：嵌套在文档下的多级子文档也要一起进回收站", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "g1", "folder");
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    }
    expect((await row(db, "folders", "g1"))?.trashed_at).toBeTruthy();
    await db.close();
  });
});
