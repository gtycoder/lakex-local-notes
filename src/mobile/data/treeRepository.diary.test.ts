import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyMobileSchema } from "./schema.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import {
  diaryNotebookOf,
  moveTreeNodeOrdered,
  renameTreeNode,
  reorderSiblings,
  setNodeIcon,
} from "./treeRepository.js";

/**
 * 日记本：只开放「改名 / 换图标」（261113 用户裁决，AGENTS §3#25②）——移动端数据层。
 *
 * 判据单一来源 = `diaryNotebookOf(id)`：
 *  · === id ⇒ 日记本本身：改名 / 换图标放行；
 *  · !== null && !== id ⇒ 日记子树（年/月分组、日记条目）：改名 / 图标 / 移动 / 排序全部拒绝；
 * 其余红线不变：日记本不可移 / 不可作移动目标 / 不可排序；条目标题仍只能是日期；
 * 唯一放行 = 单篇日记整篇移出（出口①「转为文档」）。
 */
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

const T0 = "2026-11-09T00:00:00.000Z";

type Fixture = {
  db: SqlJsAsyncDb;
  ids: { diary: string; year: string; month: string; entry: string; work: string; workNote: string };
};

async function setup(): Promise<Fixture> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const folder = (id: string, title: string, parent: string | null, sort: number, nodeType: "notebook" | "group", space: string | null) =>
    db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty,space) VALUES (?,?,?,?,?,NULL,?,1,?)")
      .run(id, title, parent, sort, nodeType, T0, space);
  const note = (id: string, title: string, parent: string, sort: number) =>
    db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,created_at,content_hash,is_dirty,doc_kind) VALUES (?,?,?,?,?,?,?,1,'doc')")
      .run(id, title, parent, sort, T0, T0, "h-" + id);
  await folder("nb-diary", "日记", null, 0, "notebook", "diary");
  await folder("g-year", "2026", "nb-diary", 0, "group", null);
  await folder("g-month", "11", "g-year", 0, "group", null);
  await folder("nb-work", "工作", null, 1, "notebook", null);
  await note("n-diary", "2026-11-09", "g-month", 0);
  await note("n-work", "普通文档", "nb-work", 0);
  return { db, ids: { diary: "nb-diary", year: "g-year", month: "g-month", entry: "n-diary", work: "nb-work", workNote: "n-work" } };
}

const titleOf = async (db: SqlJsAsyncDb, id: string, table: "folders" | "notes"): Promise<string> =>
  (await db.prepare("SELECT title FROM " + table + " WHERE id=?").get(id) as { title: string }).title;
const iconOf = async (db: SqlJsAsyncDb, id: string): Promise<string | null> =>
  (await db.prepare("SELECT icon FROM folders WHERE id=?").get(id) as { icon: string | null }).icon;
const parentOf = async (db: SqlJsAsyncDb, id: string): Promise<string | null> =>
  (await db.prepare("SELECT parent_id FROM notes WHERE id=?").get(id) as { parent_id: string | null }).parent_id;
const spaceOf = async (db: SqlJsAsyncDb, id: string): Promise<string | null> =>
  (await db.prepare("SELECT space FROM folders WHERE id=?").get(id) as { space: string | null }).space;

describe("diaryNotebookOf：唯一判据（日记本本身 vs 子树）", () => {
  it("日记本 → 自身；年/月分组与条目 → 日记本；普通笔记本 → null", async () => {
    const { db, ids } = await setup();
    expect(await diaryNotebookOf(db, ids.diary)).toBe(ids.diary);
    for (const id of [ids.year, ids.month, ids.entry]) {
      expect(await diaryNotebookOf(db, id)).toBe(ids.diary);
    }
    expect(await diaryNotebookOf(db, ids.work)).toBeNull();
    expect(await diaryNotebookOf(db, "missing")).toBeNull();
    await db.close();
  });
});

describe("改名（移动端数据层）", () => {
  it("日记本本身放行：标题落库、space 与父级不变、标本地脏", async () => {
    const { db, ids } = await setup();
    const renamed = await renameTreeNode(db, ids.diary, "我的日记");
    expect(renamed.title).toBe("我的日记");
    expect(await titleOf(db, ids.diary, "folders")).toBe("我的日记");
    expect(await spaceOf(db, ids.diary)).toBe("diary");
    const row = await db.prepare("SELECT is_dirty, parent_id FROM folders WHERE id=?").get(ids.diary) as { is_dirty: number; parent_id: string | null };
    expect(row.is_dirty).toBe(1);
    expect(row.parent_id).toBeNull();
    await db.close();
  });

  it("年/月分组仍拒绝（顺序与标题由日期派生）", async () => {
    const { db, ids } = await setup();
    for (const id of [ids.year, ids.month]) {
      await expect(renameTreeNode(db, id, "改名")).rejects.toThrow(/日记里的分组不能改名/);
    }
    expect(await titleOf(db, ids.year, "folders")).toBe("2026");
    expect(await titleOf(db, ids.month, "folders")).toBe("11");
    await db.close();
  });

  it("日记条目仍只能是日期（标题锁）", async () => {
    const { db, ids } = await setup();
    await expect(renameTreeNode(db, ids.entry, "随笔")).rejects.toThrow(/日记标题就是日期，不能改/);
    expect(await titleOf(db, ids.entry, "notes")).toBe("2026-11-09");
    await db.close();
  });
});

describe("换图标（移动端数据层）", () => {
  it("日记本本身放行；年/月分组与日记条目仍拒绝", async () => {
    const { db, ids } = await setup();
    const updated = await setNodeIcon(db, ids.diary, "📔");
    expect(updated.icon).toBe("📔");
    expect(await iconOf(db, ids.diary)).toBe("📔");
    await expect(setNodeIcon(db, ids.year, "X")).rejects.toThrow(/日记里的分组不能换图标/);
    await expect(setNodeIcon(db, ids.month, "X")).rejects.toThrow(/日记里的分组不能换图标/);
    await expect(setNodeIcon(db, ids.entry, "X")).rejects.toThrow(/日记条目不能换图标/);
    expect(await iconOf(db, ids.year)).toBeNull();
    await db.close();
  });
});

describe("移动（移动端数据层）：日记本不可移、不可作目标；条目只能整篇移出", () => {
  it("日记本本身不能移动", async () => {
    const { db, ids } = await setup();
    await expect(moveTreeNodeOrdered(db, ids.diary, ids.work, [ids.workNote, ids.diary])).rejects.toThrow(/日记本.*不能移动/);
    await db.close();
  });

  it("年/月分组不能移动", async () => {
    const { db, ids } = await setup();
    await expect(moveTreeNodeOrdered(db, ids.year, ids.work, [ids.workNote, ids.year])).rejects.toThrow(/日记里的分组不能移动/);
    await db.close();
  });

  it("日记本与日记子树都不能作为移动目标（含以日记条目为父）", async () => {
    const { db, ids } = await setup();
    for (const target of [ids.diary, ids.year, ids.month, ids.entry]) {
      await expect(
        moveTreeNodeOrdered(db, ids.workNote, target, [ids.workNote]),
        "目标不能是日记空间: " + target,
      ).rejects.toThrow(/日记本不能作为移动目标/);
    }
    expect(await parentOf(db, ids.workNote)).toBe(ids.work);
    await db.close();
  });

  it("日记条目在日记内部换组 = 改位置/排序，拒绝", async () => {
    const { db, ids } = await setup();
    await expect(moveTreeNodeOrdered(db, ids.entry, ids.year, [ids.year])).rejects.toThrow(/日记内容顺序是派生的/);
    await db.close();
  });

  it("唯一放行：单篇日记整篇移出到普通笔记本（出口①「转为文档」）", async () => {
    const { db, ids } = await setup();
    const moved = await moveTreeNodeOrdered(db, ids.entry, ids.work, [ids.workNote, ids.entry]);
    expect(moved.parentId).toBe(ids.work);
    expect(await parentOf(db, ids.entry)).toBe(ids.work);
    // 未删除、日记本不受影响
    const trashed = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get(ids.entry) as { trashed_at: string | null };
    expect(trashed.trashed_at).toBeNull();
    expect(await spaceOf(db, ids.diary)).toBe("diary");
    await db.close();
  });
});

describe("排序（移动端数据层）", () => {
  it("父级在日记子树（日记本本身 / 年 / 月）⇒ 拒绝", async () => {
    const { db, ids } = await setup();
    await expect(reorderSiblings(db, ids.diary, [ids.year])).rejects.toThrow(/日记内容顺序是派生的，不能排序/);
    await expect(reorderSiblings(db, ids.year, [ids.month])).rejects.toThrow(/日记内容顺序是派生的，不能排序/);
    await expect(reorderSiblings(db, ids.month, [ids.entry])).rejects.toThrow(/日记内容顺序是派生的，不能排序/);
    await db.close();
  });

  it("根层排序列表里带日记本 ⇒ 拒绝（日记本不参与任何排序）", async () => {
    const { db, ids } = await setup();
    await expect(reorderSiblings(db, null, [ids.work, ids.diary])).rejects.toThrow(/日记本.*不能参与排序/);
    await db.close();
  });

  it("普通空间排序照常可写（回归，别误伤）", async () => {
    const { db, ids } = await setup();
    await db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,created_at,content_hash,is_dirty,doc_kind) VALUES ('n-work2','第二篇',?,1,?,?,'h-n-work2',1,'doc')")
      .run(ids.work, T0, T0);
    await reorderSiblings(db, ids.work, ["n-work2", ids.workNote]);
    const first = await db.prepare("SELECT sort_order FROM notes WHERE id=?").get("n-work2") as { sort_order: number };
    expect(first.sort_order).toBe(0);
    await db.close();
  });
});
