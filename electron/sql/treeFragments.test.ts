import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { PURGE_NODE_SQL, PURGE_NOTE_SQL, trashSubtreeParams, TRASH_SUBTREE_CTE } from "./treeFragments.js";

/**
 * C-01 护栏（审计 261125 01-core-backend.md C-01，AGENTS §3#15 删除传播）：
 * 钉住统一 SQL 片段的「参数占位符顺序」与 UNION 防环收敛语义——
 * 片段被 5+ 个调用点共用，占位符错位不会报错、只会静默错结果，必须逐项钉死。
 */
function makeDb() {
  const raw = new Database(":memory:");
  raw.exec(
    "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, parent_id TEXT, note_file_id TEXT, node_type TEXT, deleted_at TEXT, trashed_at TEXT, deleted_from_parent_id TEXT, updated_at TEXT, is_purged INTEGER, is_dirty INTEGER);" +
    "CREATE TABLE notes (id TEXT PRIMARY KEY, parent_id TEXT, deleted_at TEXT, trashed_at TEXT, deleted_from_parent_id TEXT, updated_at TEXT, is_purged INTEGER, is_dirty INTEGER, restore_pending_at TEXT);",
  );
  return raw;
}

describe("treeFragments：TRASH_SUBTREE_CTE（统一 UNION 防环版回收站子树）", () => {
  it("占位符恰为 2 个；trashSubtreeParams 收口「trashId×2 在前」约定", () => {
    expect(TRASH_SUBTREE_CTE.split("?").length - 1).toBe(2);
    expect(trashSubtreeParams("trash-x")).toEqual(["trash-x", "trash-x"]);
    // 防环分叉判据：统一版必须是 UNION（去重收敛），不得退回 UNION ALL
    expect(TRASH_SUBTREE_CTE).toContain("UNION");
    expect(TRASH_SUBTREE_CTE).not.toContain("UNION ALL");
  });

  it("UNION 防环：parent 环上递归收敛、节点各出现一次（UNION ALL 会无限展开）", () => {
    const db = makeDb();
    // trash → a → b → a（b 的 parent 指回 a，形成环）
    db.prepare("INSERT INTO tree_nodes(id,parent_id,node_type) VALUES(?,?,?)").run("trash", null, "notebook");
    db.prepare("INSERT INTO tree_nodes(id,parent_id,node_type) VALUES(?,?,?)").run("a", "trash", "group");
    db.prepare("INSERT INTO tree_nodes(id,parent_id,node_type) VALUES(?,?,?)").run("b", "a", "group");
    db.prepare("UPDATE tree_nodes SET parent_id='b' WHERE id='a'");
    const rows = db.prepare(`${TRASH_SUBTREE_CTE} SELECT id FROM trash_ids`).all(...trashSubtreeParams("trash")) as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b", "trash"]);
    expect(rows.length).toBe(3); // 去重收敛：环上节点各纳入一次
  });
});

describe("treeFragments：PURGE_NODE_SQL / PURGE_NOTE_SQL（清掉重复 SET 复制粘贴残留）", () => {
  it("占位符恰为 4 个；is_purged 只 SET 一次（复制粘贴残留清零判据）", () => {
    for (const sql of [PURGE_NOTE_SQL, PURGE_NODE_SQL]) {
      expect(sql.split("?").length - 1).toBe(4);
      expect(sql.match(/is_purged=/g)?.length).toBe(1);
    }
  });

  it("PURGE_NOTE_SQL 参数顺序 = [回收站, 时间, 时间, noteId]：四个占位符各归其位", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO notes(id,parent_id,trashed_at,deleted_from_parent_id,updated_at,is_purged,is_dirty,restore_pending_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run("n1", "g1", null, null, "2026-01-01T00:00:00.000Z", 0, 1, "restore-x");
    const at = "2026-01-02T00:00:00.000Z";
    db.prepare(PURGE_NOTE_SQL).run("trash", at, at, "n1");
    const row = db.prepare("SELECT * FROM notes WHERE id='n1'").get() as Record<string, unknown>;
    // 占位符错位（例如时间与 id 互换）会让列值张冠李戴 ⇒ 下面逐列断言即顺序钉
    expect(row.parent_id).toBe("trash");
    expect(row.trashed_at).toBe(at);
    expect(row.deleted_from_parent_id).toBe("g1"); // COALESCE(deleted_from_parent_id,parent_id)：保留原始父
    expect(row.updated_at).toBe(at);
    expect(row.is_purged).toBe(1);
    expect(row.is_dirty).toBe(0);
    expect(row.restore_pending_at).toBeNull();
  });

  it("PURGE_NOTE_SQL：已有 trashed_at / deleted_from_parent_id 保留不清（COALESCE 语义不变）", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO notes(id,parent_id,trashed_at,deleted_from_parent_id,updated_at,is_purged,is_dirty,restore_pending_at) VALUES(?,?,?,?,?,?,?,NULL)",
    ).run("n1", "trash", "2026-01-01T00:00:00.000Z", "g-orig", "2026-01-01T00:00:00.000Z", 0, 1);
    db.prepare(PURGE_NOTE_SQL).run("trash", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "n1");
    const row = db.prepare("SELECT * FROM notes WHERE id='n1'").get() as Record<string, unknown>;
    expect(row.trashed_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.deleted_from_parent_id).toBe("g-orig");
  });

  it("PURGE_NODE_SQL 参数顺序 = [回收站, 时间, 时间, nodeId]（按 tree_nodes.id 命中）", () => {
    const db = makeDb();
    db.prepare(
      "INSERT INTO tree_nodes(id,parent_id,note_file_id,node_type,trashed_at,deleted_from_parent_id,updated_at,is_purged,is_dirty) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run("t1", "g1", "n1", "note", null, null, "2026-01-01T00:00:00.000Z", 0, 1);
    const at = "2026-01-02T00:00:00.000Z";
    db.prepare(PURGE_NODE_SQL).run("trash", at, at, "t1");
    const row = db.prepare("SELECT * FROM tree_nodes WHERE id='t1'").get() as Record<string, unknown>;
    expect(row.parent_id).toBe("trash");
    expect(row.trashed_at).toBe(at);
    expect(row.deleted_from_parent_id).toBe("g1");
    expect(row.updated_at).toBe(at);
    expect(row.is_purged).toBe(1);
    expect(row.is_dirty).toBe(0);
  });
});
