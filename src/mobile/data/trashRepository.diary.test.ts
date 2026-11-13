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

import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { purgeTreeItem, trashTreeItem } from "./trashRepository.js";

/**
 * 日记本不可删除（261113 用户裁决，AGENTS §3#25②）——移动端与桌面
 * `trashLifecycle.assertNotDiaryNotebook` 同口径：
 *  · 只拦**日记本节点**（node_type='notebook' + space='diary'）：软删与彻底删除都拒绝；
 *  · 日记**条目**与年/月分组照常软删/彻底删除（软删可恢复；「删除这篇日记」是既有能力，别误伤）；
 *  · 后台自动过期任务按「跳过」处理（返回 false），绝不因脏数据抛错。
 */
const T0 = "2026-11-09T00:00:00.000Z";

async function setup(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const folder = (id: string, title: string, parent: string | null, nodeType: "notebook" | "group", space: string | null) =>
    db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty,space) VALUES (?,?,?,0,?,NULL,?,1,?)")
      .run(id, title, parent, nodeType, T0, space);
  await folder("nb-diary", "日记", null, "notebook", "diary");
  await folder("g-year", "2026", "nb-diary", "group", null);
  await db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,created_at,content_hash,is_dirty,doc_kind) VALUES ('n-diary','2026-11-09','g-year',0,?,?,'h-n-diary',1,'doc')")
    .run(T0, T0);
  return db;
}

const trashedAtOf = async (db: SqlJsAsyncDb, id: string): Promise<string | null> =>
  (await db.prepare("SELECT trashed_at FROM folders WHERE id=?").get(id) as { trashed_at: string | null } | undefined)?.trashed_at ?? null;
const exists = async (db: SqlJsAsyncDb, id: string): Promise<boolean> =>
  !!(await db.prepare("SELECT 1 AS one FROM folders WHERE id=?").get(id));

describe("日记本不可删除（移动端 data/trashRepository）", () => {
  it("软删日记本被拒（明确文案），行原地未动", async () => {
    const db = await setup();
    await expect(trashTreeItem(db, "nb-diary", "folder")).rejects.toThrow(/日记本.*不能删除/);
    expect(await exists(db, "nb-diary")).toBe(true);
    expect(await trashedAtOf(db, "nb-diary")).toBeNull();
    await db.close();
  });

  it("彻底删除日记本被拒：返回 false（后台过期任务不抛错），行仍在", async () => {
    const db = await setup();
    expect((await purgeTreeItem(db, "nb-diary", "folder")).purged).toBe(false);
    expect(await exists(db, "nb-diary")).toBe(true);
    // 自动过期守卫路径同样跳过
    expect((await purgeTreeItem(db, "nb-diary", "folder", { expiredBefore: "2099-01-01T00:00:00.000Z" })).purged).toBe(false);
    expect(await exists(db, "nb-diary")).toBe(true);
    await db.close();
  });

  it("日记条目照常可软删（回收站可恢复）——别把子树一起拦死", async () => {
    const db = await setup();
    await trashTreeItem(db, "n-diary", "note");
    const row = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get("n-diary") as { trashed_at: string | null };
    expect(row.trashed_at).toBeTruthy();
    await db.close();
  });
});
