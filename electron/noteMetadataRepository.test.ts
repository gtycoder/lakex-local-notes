import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { NoteMetadataRepository } from "./noteMetadataRepository.js";
import type { DbLike } from "./dbLike.js";
import type { TreeNode } from "./noteQueries.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

/**
 * C-01 / C-02 调用点钉（审计 261125 01-core-backend.md）：
 * - childrenOf 的回收站子树 CTE 参数占位符顺序 = [trashId, trashId, workspaceId, ...]（trashId×2 在前）；
 * - assertNodeWritable 拒写判据与 core/syncDecisions.isGoneRow 同源（261124 判据漂移实证的护栏）。
 * trashId 与 workspaceId 取不同值：占位符错位时 trash_ids 集合错 ⇒ 断言翻红。
 */
const SCHEMA =
  "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, workspace_id TEXT, parent_id TEXT, node_type TEXT, title TEXT, note_file_id TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT, is_conflict INTEGER, is_purged INTEGER, is_dirty INTEGER, cloud_deleted INTEGER, icon TEXT, space TEXT, deleted_at TEXT, trashed_at TEXT);" +
  "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, parent_id TEXT, sort_order INTEGER, updated_at TEXT, is_dirty INTEGER, deleted_at TEXT, is_purged INTEGER);";

function makeRepo() {
  const raw = new Database(":memory:");
  raw.exec(SCHEMA);
  const repo = new NoteMetadataRepository({
    db: raw as unknown as DbLike,
    workspaceId: "ws-1",
    trashNotebookId: TRASH_NOTEBOOK_ID,
    uuid: () => "generated-id",
    nowIso: () => "2026-01-02T00:00:00.000Z",
    ensureParent: () => {},
    assertParentCompatible: () => {},
    descendantIds: () => [],
    readTreeNode: (id: string) => ({ id } as TreeNode),
    upsertSearch: () => {},
  });
  const addNode = (id: string, parentId: string | null, nodeType = "note"): void => {
    raw.prepare(
      "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_conflict,is_purged,is_dirty,icon,deleted_at,trashed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)",
    ).run(id, "ws-1", parentId, nodeType, id, nodeType === "note" ? id : null, 0, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 0, 0, 1);
    if (nodeType === "note") {
      raw.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,is_dirty,deleted_at,is_purged) VALUES(?,?,?,?,?,?,NULL,0)")
        .run(id, id, parentId, 0, "2026-01-01T00:00:00Z", 1);
    }
  };
  return { raw, repo, addNode };
}

describe("NoteMetadataRepository.childrenOf（回收站子树 CTE 调用点，reorderTreeNodes 路径）", () => {
  it("回收站子树内的兄弟不进 childrenOf ⇒ 对回收站分组重排必拒（参数顺序 = trashId×2 在前、workspaceId 在后）", () => {
    const { repo, addNode } = makeRepo();
    addNode(TRASH_NOTEBOOK_ID, null, "notebook");
    addNode("g-trash", TRASH_NOTEBOOK_ID, "group");
    addNode("c1", "g-trash");
    addNode("c2", "g-trash");
    // g-trash 整组在回收站子树内 ⇒ childrenOf 应把它所有子节点都滤掉
    expect(() => repo.reorderTreeNodes("g-trash", ["c1", "c2"])).toThrow(/不属于该父节点|全部子节点/);
  });

  it("正常父节点重排照常成功（trashId/workspaceId 错位不得误伤正常节点）", () => {
    const { raw, repo, addNode } = makeRepo();
    addNode(TRASH_NOTEBOOK_ID, null, "notebook");
    addNode("g-normal", null, "group");
    addNode("c1", "g-normal");
    addNode("c2", "g-normal");
    repo.reorderTreeNodes("g-normal", ["c2", "c1"]);
    const order = raw.prepare("SELECT id FROM tree_nodes WHERE parent_id='g-normal' ORDER BY sort_order").all() as Array<{ id: string }>;
    expect(order.map((r) => r.id)).toEqual(["c2", "c1"]);
  });
});

describe("NoteMetadataRepository.assertNodeWritable（C-02：拒写判据与 isGoneRow 同源）", () => {
  it("parent=回收站容器但 trashed_at 空的行同样拒写（261124 判据漂移实证的钉）", () => {
    const { raw, repo, addNode } = makeRepo();
    addNode("n1", null);
    raw.prepare("UPDATE tree_nodes SET parent_id=? WHERE id='n1'").run(TRASH_NOTEBOOK_ID);
    raw.prepare("UPDATE notes SET parent_id=? WHERE id='n1'").run(TRASH_NOTEBOOK_ID);
    expect(() => repo.renameTreeNode("n1", "新标题")).toThrow(/回收站|已删除/);
  });

  it("trashed_at 非空 / is_purged=1（含 notes 侧）一律拒写；活跃节点可写", () => {
    const { raw, repo, addNode } = makeRepo();
    addNode("n-trash", null);
    raw.prepare("UPDATE tree_nodes SET trashed_at='2026-01-01T00:00:00Z' WHERE id='n-trash'").run();
    expect(() => repo.renameTreeNode("n-trash", "新标题")).toThrow(/回收站|已删除/);

    addNode("n-purged", null);
    raw.prepare("UPDATE notes SET is_purged=1 WHERE id='n-purged'").run();
    expect(() => repo.renameTreeNode("n-purged", "新标题")).toThrow(/回收站|已删除/);

    addNode("n-ok", null);
    expect(() => repo.renameTreeNode("n-ok", "新标题")).not.toThrow();
  });
});
