import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyMobileSchema } from "./schema.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { moveTreeNodeOrdered, reorderSiblings } from "./treeRepository.js";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

const T0 = "2026-01-01T00:00:00.000Z";

async function setup() {
  const raw = await SqlJsDb.open();
  const db = new SqlJsAsyncDb(raw);
  await applyMobileSchema(db);
  const insertFolder = "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,sync_state) VALUES (?,?,?,?,?,?,?,?)";
  raw.prepare(insertFolder).run("nb1", "本1", null, 10, "notebook", null, T0, "synced");
  raw.prepare(insertFolder).run("nb2", "本2", null, 11, "notebook", null, T0, "synced");
  // 261019：正文不再在 notes 表（文件由 noteBodies 读写）；目录操作只关心元数据。
  const insertNote = "INSERT INTO notes (id,title,parent_id,sort_order,updated_at,sync_state,is_conflict) VALUES (?,?,?,?,?,?,0)";
  raw.prepare(insertNote).run("n1", "文档1", "nb1", 0, T0, "synced");
  raw.prepare(insertNote).run("n2", "文档2", "nb1", 1, T0, "synced");
  raw.prepare(insertNote).run("n3", "文档3", "nb2", 0, T0, "synced");
  return { raw, db };
}

describe("mobile treeRepository：文档移动 / 混合排序", () => {
  it("moveTreeNodeOrdered 支持文档（此前只查 folders 必抛错），并抬 updated_at + 标本地脏", async () => {
    const { raw, db } = await setup();
    const moved = await moveTreeNodeOrdered(db, "n1", "nb2", ["n3", "n1"]);
    expect(moved.parentId).toBe("nb2");
    expect(moved.nodeType).toBe("note");
    const row = raw.prepare("SELECT parent_id, sort_order, sync_state, updated_at FROM notes WHERE id=?").get("n1") as {
      parent_id: string; sort_order: number; sync_state: string; updated_at: string;
    };
    expect(row.parent_id).toBe("nb2");
    expect(row.sort_order).toBe(1);
    expect(row.sync_state).toBe("local");
    expect(row.updated_at).not.toBe(T0);
  });

  it("moveTreeNodeOrdered 仍支持分组（回归）", async () => {
    const { raw, db } = await setup();
    raw.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,sync_state) VALUES (?,?,?,?,?,?,?,?)")
      .run("g1", "分组", "nb1", 2, "group", null, T0, "synced");
    const moved = await moveTreeNodeOrdered(db, "g1", "nb2", ["n3", "g1"]);
    expect(moved.parentId).toBe("nb2");
    expect((raw.prepare("SELECT parent_id FROM folders WHERE id=?").get("g1") as { parent_id: string }).parent_id).toBe("nb2");
  });

  it("reorderSiblings 同时写回 folders 与 notes 两表（此前只写 folders）", async () => {
    const { raw, db } = await setup();
    raw.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,sync_state) VALUES (?,?,?,?,?,?,?,?)")
      .run("g1", "分组", "nb1", 2, "group", null, T0, "synced");
    await reorderSiblings(db, "nb1", ["n2", "g1", "n1"]);
    const g = raw.prepare("SELECT sort_order, sync_state FROM folders WHERE id=?").get("g1") as { sort_order: number; sync_state: string };
    const n2 = raw.prepare("SELECT sort_order, sync_state FROM notes WHERE id=?").get("n2") as { sort_order: number; sync_state: string };
    const n1 = raw.prepare("SELECT sort_order FROM notes WHERE id=?").get("n1") as { sort_order: number };
    expect(g.sort_order).toBe(1);
    expect(n2.sort_order).toBe(0);
    expect(n1.sort_order).toBe(2);
    expect(g.sync_state).toBe("local");
    expect(n2.sync_state).toBe("local");
  });

  it("moveTreeNodeOrdered 不能移到自身/后代（校验仍在）", async () => {
    const { db } = await setup();
    await expect(moveTreeNodeOrdered(db, "n1", "n1", ["n1"])).rejects.toThrow();
  });

  it("reorderSiblings 服务端校验：跨父 / 重复 / 不完整都抛错", async () => {
    const { db } = await setup();
    await expect(reorderSiblings(db, "nb1", ["n3"])).rejects.toThrow();          // n3 属 nb2
    await expect(reorderSiblings(db, "nb1", ["n1", "n1", "n2"])).rejects.toThrow(); // 重复
    await expect(reorderSiblings(db, "nb1", ["n1"])).rejects.toThrow();          // 不完整（缺 n2）
    await expect(reorderSiblings(db, "nb1", ["n2", "n1"])).resolves.toBeUndefined(); // 完整合法
  });
});
