import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { diaryNotebookOfNode, diaryNotebookOfNote } from "./diaryAncestry.js";
import type { DbLike } from "./dbLike.js";

/**
 * C-03 护栏（审计 261125 01-core-backend.md C-03，AGENTS §3#25）：日记子树归属判据单一实现。
 * 语义 = 沿 parent 链向上找 space='diary' 的笔记本（UNION 防环递归 CTE，原 store.ts 版）。
 * ⚠️ 变体勿合并：electron/trashDiaryOrigin.ts 的 resolveDiaryOriginNotebookId 沿「原始父链」
 *（deleted_from_parent_id ?? parent_id）走，回收站来源解析语义不同，保留独立实现。
 */
const SCHEMA =
  "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, parent_id TEXT, node_type TEXT, space TEXT, note_file_id TEXT, deleted_at TEXT);";

function makeDb() {
  const raw = new Database(":memory:");
  raw.exec(SCHEMA);
  const add = (id: string, parentId: string | null, nodeType = "note", space: string | null = null, noteFileId: string | null = null): void => {
    raw.prepare("INSERT INTO tree_nodes(id,parent_id,node_type,space,note_file_id,deleted_at) VALUES(?,?,?,?,?,NULL)")
      .run(id, parentId, nodeType, space, noteFileId);
  };
  return { raw, db: raw as unknown as DbLike, add };
}

describe("diaryAncestry.diaryNotebookOfNode / diaryNotebookOfNote（日记归属单一实现）", () => {
  it("日记本自身 / 年月分组 / 日记条目都归到日记本", () => {
    const { db, add } = makeDb();
    add("nb-diary", null, "notebook", "diary");
    add("y2026", "nb-diary", "group");
    add("m11", "y2026", "group");
    add("t-day", "m11", "note", null, "n-day");
    expect(diaryNotebookOfNode(db, "nb-diary")).toBe("nb-diary");
    expect(diaryNotebookOfNode(db, "y2026")).toBe("nb-diary");
    expect(diaryNotebookOfNode(db, "m11")).toBe("nb-diary");
    expect(diaryNotebookOfNode(db, "t-day")).toBe("nb-diary");
    // note 行 id 与 tree 节点 id 都能解析（note_file_id OR id 两路边）
    expect(diaryNotebookOfNote(db, "n-day")).toBe("nb-diary");
    expect(diaryNotebookOfNote(db, "t-day")).toBe("nb-diary");
  });

  it("非日记子树 / 不存在的节点返回 null", () => {
    const { db, add } = makeDb();
    add("nb-normal", null, "notebook");
    add("g1", "nb-normal", "group");
    expect(diaryNotebookOfNode(db, "g1")).toBeNull();
    expect(diaryNotebookOfNode(db, "nb-normal")).toBeNull();
    expect(diaryNotebookOfNode(db, "missing")).toBeNull();
    expect(diaryNotebookOfNote(db, "missing")).toBeNull();
  });

  it("space 非 diary（含未知值）不算日记本；只有 notebook 节点可命中", () => {
    const { db, add } = makeDb();
    add("nb-x", null, "notebook", "other");
    add("g1", "nb-x", "group", "diary"); // 分组带 space=diary 也不算（判据要求 node_type='notebook'）
    expect(diaryNotebookOfNode(db, "g1")).toBeNull();
  });

  it("UNION 防环：parent 环上递归收敛（UNION ALL 会无限展开）", () => {
    const { raw, db, add } = makeDb();
    add("a", null, "group");
    add("b", "a", "group");
    raw.prepare("UPDATE tree_nodes SET parent_id='b' WHERE id='a'").run(); // a↔b 环
    expect(diaryNotebookOfNode(db, "a")).toBeNull();
  });
});
