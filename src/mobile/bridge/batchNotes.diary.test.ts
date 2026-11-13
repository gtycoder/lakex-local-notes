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
import { applyBatchItems, runMobileBatchNotes } from "./batchNotes.js";

/**
 * 批量「移动到…」不得把文档移入日记空间（261113 用户裁决，AGENTS §3#25②）。
 *
 * 两道闸都要在，缺一就是「批量 UPDATE parent_id」绕过日记守卫：
 *  ① core 校验阶段 = `describeParent` 判日记本/日记子树不是容器 ⇒ 整批 parent-not-a-container；
 *  ② 落地阶段 = `applyBatchItems` 的 move 分支再判一次（防绕过 core 的直接调用），整批回滚。
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
  await folder("nb-work", "工作", null, "notebook", null);
  await db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,created_at,content_hash,is_dirty,doc_kind) VALUES ('n1','文档1','nb-work',0,?,?,'h-n1',1,'doc')")
    .run(T0, T0);
  return db;
}

const parentOf = async (db: SqlJsAsyncDb, id: string): Promise<string | null> =>
  (await db.prepare("SELECT parent_id FROM notes WHERE id=?").get(id) as { parent_id: string | null }).parent_id;

describe("批量移动到日记空间：core 校验阶段就整批拒绝", () => {
  it("目标 = 日记本本身 ⇒ parent-not-a-container（parent_id 不变）", async () => {
    const db = await setup();
    const result = await runMobileBatchNotes(db, { action: "move", ids: ["n1"], parentId: "nb-diary" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("parent-not-a-container");
    expect(await parentOf(db, "n1")).toBe("nb-work");
    await db.close();
  });

  it("目标 = 日记子树里的年分组 ⇒ 同样拒绝", async () => {
    const db = await setup();
    const result = await runMobileBatchNotes(db, { action: "move", ids: ["n1"], parentId: "g-year" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("parent-not-a-container");
    expect(await parentOf(db, "n1")).toBe("nb-work");
    await db.close();
  });

  it("普通笔记本仍是合法目标（回归，别误伤）", async () => {
    const db = await setup();
    await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty,space) VALUES ('nb-work2','工作2',NULL,1,'notebook',NULL,?,1,NULL)").run(T0);
    const result = await runMobileBatchNotes(db, { action: "move", ids: ["n1"], parentId: "nb-work2" });
    expect(result.ok).toBe(true);
    expect(await parentOf(db, "n1")).toBe("nb-work2");
    await db.close();
  });
});

describe("批量落地阶段：第二道闸（防绕过 core 的直接调用）", () => {
  it("move 的 parent_id 写日记本 ⇒ 抛错（整批回滚），行不动", async () => {
    const db = await setup();
    await expect(applyBatchItems(db, [{ id: "n1", action: "move", space: "lake", parentId: "nb-diary", tagIds: [] }]))
      .rejects.toThrow(/日记本不能作为移动目标/);
    expect(await parentOf(db, "n1")).toBe("nb-work");
    await db.close();
  });

  it("move 的 parent_id 写日记子树 ⇒ 同样抛错", async () => {
    const db = await setup();
    await expect(applyBatchItems(db, [{ id: "n1", action: "move", space: "lake", parentId: "g-year", tagIds: [] }]))
      .rejects.toThrow(/日记本不能作为移动目标/);
    expect(await parentOf(db, "n1")).toBe("nb-work");
    await db.close();
  });
});
