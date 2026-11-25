import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { NoteQueries } from "./noteQueries.js";
import type { DbLike } from "./dbLike.js";

/**
 * C-01 调用点钉（审计 261125 01-core-backend.md C-01）：listTreeNodes 的回收站子树 CTE
 * 参数占位符顺序 = [trashId, trashId, workspaceId]（trashId×2 在前，见 electron/sql/treeFragments.ts）。
 * trashId 与 workspaceId 取不同值：占位符错位时 trash_ids 集合错、回收站子树泄漏或正常节点消失 ⇒ 断言翻红。
 */
const SCHEMA =
  "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, workspace_id TEXT, parent_id TEXT, node_type TEXT, title TEXT, note_file_id TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT, is_conflict INTEGER, is_purged INTEGER, is_dirty INTEGER, cloud_deleted INTEGER, icon TEXT, space TEXT, deleted_at TEXT);" +
  "CREATE TABLE notes (id TEXT PRIMARY KEY, kind TEXT);";

function makeRepo() {
  const raw = new Database(":memory:");
  raw.exec(SCHEMA);
  const repo = new NoteQueries(raw as unknown as DbLike, "ws-1", "trash-x");
  let tick = 0;
  const addNode = (id: string, parentId: string | null, nodeType = "note"): void => {
    tick += 1;
    raw.prepare(
      "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_conflict,is_dirty,icon,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)",
    ).run(id, "ws-1", parentId, nodeType, id, nodeType === "note" ? id : null, tick, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 0, 1);
    if (nodeType === "note") raw.prepare("INSERT INTO notes(id,kind) VALUES(?,?)").run(id, "doc");
  };
  return { raw, repo, addNode };
}

describe("NoteQueries.listTreeNodes（回收站子树 CTE 调用点）", () => {
  it("排除回收站子树（含深层后代）；参数顺序 = trashId×2 在前、workspaceId 在后", () => {
    const { repo, addNode } = makeRepo();
    addNode("trash-x", null, "notebook");
    addNode("g-trash", "trash-x", "group");
    addNode("n-deep", "g-trash"); // 回收站深层后代：必须排除
    addNode("g-normal", null, "group");
    addNode("n-out", "g-normal"); // 正常节点：必须保留
    const ids = repo.listTreeNodes().map((n) => n.id);
    expect(ids.sort()).toEqual(["g-normal", "n-out"]);
    expect(ids).not.toContain("n-deep");
    expect(ids).not.toContain("g-trash");
    expect(ids).not.toContain("trash-x"); // 回收站容器自身也是子树成员
  });

  it("UNION 防环：回收站容器卷入 parent 环时不挂死（UNION ALL 会无限展开）", () => {
    const { raw, repo, addNode } = makeRepo();
    addNode("trash-x", null, "notebook");
    addNode("a", "trash-x", "group");
    addNode("n-deep", "a");
    addNode("n-out", null);
    // 坏数据：回收站容器的 parent 指向自己的后代 a ⇒ 子树递归成环（单亲边下环必含锚点才可从锚点进入）
    raw.prepare("UPDATE tree_nodes SET parent_id='a' WHERE id='trash-x'").run();
    const ids = repo.listTreeNodes().map((n) => n.id);
    expect(ids).toEqual(["n-out"]); // 环上节点都在回收站子树内、递归收敛
  });
});
