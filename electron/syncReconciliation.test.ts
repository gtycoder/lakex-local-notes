import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SyncReconciliation } from "./syncReconciliation.js";
import type { DbLike } from "./dbLike.js";

/**
 * C-01 调用点钉（审计 261125 01-core-backend.md C-01）：
 * - applyRemotePurge / applyRemoteFolderDelete 的 4 条 purge UPDATE 统一走
 *   electron/sql/treeFragments.ts 的 PURGE_NOTE_SQL / PURGE_NODE_SQL，
 *   参数占位符顺序 = [trashId, 时间, 时间, 行 id]（错位 = 列值张冠李戴，逐列断言即顺序钉）；
 * - applyRemoteFolderDelete 的子树 CTE（原 sub）复用统一「UNION 防环」片段，环上收敛。
 */
const SCHEMA =
  "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, parent_id TEXT, note_file_id TEXT, node_type TEXT, deleted_at TEXT, trashed_at TEXT, deleted_from_parent_id TEXT, updated_at TEXT, is_purged INTEGER, is_dirty INTEGER);" +
  "CREATE TABLE notes (id TEXT PRIMARY KEY, parent_id TEXT, deleted_at TEXT, trashed_at TEXT, deleted_from_parent_id TEXT, updated_at TEXT, is_purged INTEGER, is_dirty INTEGER, restore_pending_at TEXT);";

function makeSut() {
  const raw = new Database(":memory:");
  raw.exec(SCHEMA);
  const removedSearch: string[][] = [];
  const sut = new SyncReconciliation({
    db: raw as unknown as DbLike,
    trashNotebookId: "trash-x",
    notePathFor: () => "/nonexistent.lake",
    readNoteCaches: () => ({ markdown: null, plain: null }),
    upsertSearch: () => {},
    removeSearch: (ids) => { removedSearch.push([...ids]); },
    listNotesForSync: () => [],
  });
  const addNoteRow = (id: string, parentId: string | null): void => {
    raw.prepare(
      "INSERT INTO notes(id,parent_id,trashed_at,deleted_from_parent_id,updated_at,is_purged,is_dirty,restore_pending_at) VALUES(?,?,NULL,NULL,?,?,?,?)",
    ).run(id, parentId, "2026-01-01T00:00:00.000Z", 0, 1, id === "n1" ? "restore-x" : null);
  };
  const addNodeRow = (id: string, parentId: string | null, noteFileId: string | null, nodeType = "note"): void => {
    raw.prepare(
      "INSERT INTO tree_nodes(id,parent_id,note_file_id,node_type,trashed_at,deleted_from_parent_id,updated_at,is_purged,is_dirty) VALUES(?,?,?,?,NULL,NULL,?,0,1)",
    ).run(id, parentId, noteFileId, nodeType, "2026-01-01T00:00:00.000Z");
    if (noteFileId) addNoteRow(noteFileId, parentId);
  };
  return { raw, sut, addNodeRow, removedSearch };
}

describe("SyncReconciliation.applyRemotePurge（purge UPDATE 调用点×2）", () => {
  it("notes/tree_nodes 两行同语义落库；参数顺序 = [trashId, 时间, 时间, id]、restore_pending_at 一并清", () => {
    const { raw, sut, addNodeRow, removedSearch } = makeSut();
    addNodeRow("t1", "g1", "n1");
    sut.applyRemotePurge("n1");
    const note = raw.prepare("SELECT * FROM notes WHERE id='n1'").get() as Record<string, unknown>;
    expect(note.parent_id).toBe("trash-x");
    expect(note.deleted_from_parent_id).toBe("g1"); // COALESCE(deleted_from_parent_id,parent_id)：保留原始父
    expect(typeof note.trashed_at).toBe("string");
    expect(note.updated_at).toBe(note.trashed_at); // 两个时间占位符同值：错位会让 updated_at 与 trashed_at 分叉
    expect(note.is_purged).toBe(1);
    expect(note.is_dirty).toBe(0);
    expect(note.restore_pending_at).toBeNull();
    const node = raw.prepare("SELECT * FROM tree_nodes WHERE id='t1'").get() as Record<string, unknown>;
    expect(node.parent_id).toBe("trash-x");
    expect(node.deleted_from_parent_id).toBe("g1");
    expect(node.updated_at).toBe(node.trashed_at);
    expect(node.is_purged).toBe(1);
    expect(node.is_dirty).toBe(0);
    expect(removedSearch).toEqual([["n1"]]);
  });
});

describe("SyncReconciliation.applyRemoteFolderDelete（子树 CTE 调用点 + purge UPDATE 调用点×2）", () => {
  it("整棵 folder 子树（含 note 节点）purge 进回收站，子树外不动；removeSearch 只收命中的 note", () => {
    const { raw, sut, addNodeRow, removedSearch } = makeSut();
    addNodeRow("f1", null, null, "group");
    addNodeRow("t1", "f1", "n1");
    addNodeRow("g-deep", "f1", null, "group");
    addNodeRow("t2", "g-deep", "n2");
    addNodeRow("t-out", null, "n-out"); // 子树外对照
    sut.applyRemoteFolderDelete("f1", "2026-01-05T00:00:00.000Z");
    for (const id of ["f1", "t1", "g-deep", "t2"]) {
      const row = raw.prepare("SELECT * FROM tree_nodes WHERE id=?").get(id) as Record<string, unknown>;
      expect(row.parent_id, id).toBe("trash-x");
      expect(row.is_purged, id).toBe(1);
      expect(row.is_dirty, id).toBe(0);
    }
    const out = raw.prepare("SELECT * FROM tree_nodes WHERE id='t-out'").get() as Record<string, unknown>;
    expect(out.is_purged).toBe(0);
    expect(out.parent_id).toBeNull();
    expect(removedSearch).toEqual([["n1", "n2"]]);
  });

  it("UNION 防环：folder 卷入 parent 环时子树递归收敛（UNION ALL 会无限展开）", () => {
    const { raw, sut, addNodeRow } = makeSut();
    addNodeRow("f1", null, null, "group");
    addNodeRow("c1", "f1", null, "group");
    // 坏数据：f1 的 parent 指回自己的后代 c1 ⇒ 子树递归成环（单亲边下环必含锚点才可从锚点进入）
    raw.prepare("UPDATE tree_nodes SET parent_id='c1' WHERE id='f1'").run();
    sut.applyRemoteFolderDelete("f1", "2026-01-05T00:00:00.000Z");
    for (const id of ["f1", "c1"]) {
      const row = raw.prepare("SELECT * FROM tree_nodes WHERE id=?").get(id) as Record<string, unknown>;
      expect(row.is_purged, id).toBe(1);
      expect(row.parent_id, id).toBe("trash-x");
    }
  });
});
