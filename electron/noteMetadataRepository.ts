import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { assertTreeNodeTitle } from "../src/core/treeRules.js";
import type { SyncFolder, TreeNode } from "./noteQueries.js";

interface MetadataRepositoryDeps {
  db: DbLike;
  workspaceId: string;
  trashNotebookId: string;
  uuid(): string;
  nowIso(): string;
  nextSortOrder(parentId: string | null): number;
  ensureParent(parentId: string | null): void;
  assertParentCompatible(parentId: string | null, childType: string): void;
  descendantIds(id: string): string[];
  readTreeNode(id: string): TreeNode;
  upsertSearch(noteId: string, title: string, body: string | null): void;
}

interface NoteTreeRow {
  note_file_id: string | null;
}

interface ExistingFolderRow {
  title: string;
  parent_id: string | null;
  sort_order: number;
  node_type: string;
  icon: string | null;
  updated_at: string;
}

/** Metadata writes only; note content, assets, history, and sync content stay in Store. */
export class NoteMetadataRepository {
  private readonly db: DbLike;
  private readonly workspaceId: string;
  private readonly trashNotebookId: string;
  private readonly deps: MetadataRepositoryDeps;

  constructor(deps: MetadataRepositoryDeps) {
    this.db = deps.db;
    this.workspaceId = deps.workspaceId;
    this.trashNotebookId = deps.trashNotebookId;
    this.deps = deps;
  }

  /** 审计 F04：元数据写边界——回收站条目 / 已 purge（含他端保留副本）节点一律 fail-closed。
   * 旧行为是 revivePurgedIfNeeded"编辑即隐式恢复"，违反"恢复是唯一显式例外"，已删除；
   * 这里明确拒绝，避免把 purged 行改成 local 却仍留在回收站产生脏态。 */
  private assertNodeWritable(id: string): void {
    const row = this.db.prepare(
      "SELECT t.parent_id AS parent_id, t.trashed_at AS trashed_at, t.sync_state AS node_sync, n.sync_state AS note_sync " +
      "FROM tree_nodes t LEFT JOIN notes n ON n.id = t.note_file_id WHERE t.id = ?"
    ).get(id) as { parent_id: string | null; trashed_at: string | null; node_sync: string | null; note_sync: string | null } | undefined;
    if (!row) throw new AppError("NotFound", `节点不存在: ${id}`);
    if (row.parent_id === this.trashNotebookId || row.trashed_at != null || row.node_sync === "purged" || row.note_sync === "purged") {
      throw new AppError("InvalidInput", `节点已在回收站或已被删除，不能修改；请先显式恢复: ${id}`);
    }
  }

  createNotebook(title: string): TreeNode {
    let trimmed: string;
    try { trimmed = assertTreeNodeTitle(title); }
    catch { throw new AppError("InvalidInput", "名称不能为空"); }
    const id = this.deps.uuid();
    const now = this.deps.nowIso();
    const sortOrder = this.deps.nextSortOrder(null);
    this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,NULL,'notebook',?,NULL,?,?,?,'local',0)")
      .run(id, this.workspaceId, trimmed, sortOrder, now, now);
    return this.deps.readTreeNode(id);
  }

  createGroup(parentId: string, title: string): TreeNode {
    let trimmed: string;
    try { trimmed = assertTreeNodeTitle(title); }
    catch { throw new AppError("InvalidInput", "名称不能为空"); }
    this.deps.ensureParent(parentId);
    this.deps.assertParentCompatible(parentId, "group");
    const id = this.deps.uuid();
    const now = this.deps.nowIso();
    const sortOrder = this.deps.nextSortOrder(parentId);
    this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'group',?,NULL,?,?,?,'local',0)")
      .run(id, this.workspaceId, parentId, trimmed, sortOrder, now, now);
    return this.deps.readTreeNode(id);
  }

  renameTreeNode(id: string, title: string): TreeNode {
    const trimmed = title.trim();
    if (!trimmed) throw new AppError("InvalidInput", "名称不能为空");
    this.assertNodeWritable(id);
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE tree_nodes SET title=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL").run(trimmed, now, id).changes;
      if (changed === 0) throw new AppError("NotFound", `节点不存在: ${id}`);
      this.db.prepare("UPDATE notes SET title=?,updated_at=?,sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL").run(trimmed, now, id);
      const node = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?").get(id) as NoteTreeRow | undefined;
      if (node?.note_file_id) this.deps.upsertSearch(node.note_file_id, trimmed, null);
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  setNodeIcon(id: string, icon: string | null): TreeNode {
    if (icon !== null && (typeof icon !== "string" || icon.length > 16)) {
      throw new AppError("InvalidInput", "无效的图标");
    }
    const now = this.deps.nowIso();
    this.assertNodeWritable(id);
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
      this.db.prepare("UPDATE notes SET updated_at=?, sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL")
        .run(now, id);
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  moveTreeNode(id: string, parentId: string | null, sortOrder: number): TreeNode {
    const moving = this.deps.readTreeNode(id);
    if (parentId) {
      if (parentId === id) throw new AppError("InvalidInput", "不能移动到自身");
      if (new Set(this.deps.descendantIds(id)).has(parentId)) throw new AppError("InvalidInput", "不能移动到子节点");
      this.deps.ensureParent(parentId);
    }
    this.deps.assertParentCompatible(parentId, moving.nodeType);
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
        .run(parentId, sortOrder, now, id);
      if (moving.noteFileId) {
        this.db.prepare("UPDATE notes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
          .run(parentId, sortOrder, now, moving.noteFileId);
      }
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): TreeNode {
    const moving = this.deps.readTreeNode(id);
    if (parentId) {
      if (parentId === id) throw new AppError("InvalidInput", "不能移动到自身");
      if (new Set(this.deps.descendantIds(id)).has(parentId)) throw new AppError("InvalidInput", "不能移动到子节点");
      this.deps.ensureParent(parentId);
    }
    this.deps.assertParentCompatible(parentId, moving.nodeType);
    const children = this.childrenOf(parentId);
    // 跨父移动：目标父节点的现有子列表 children 尚不含被移动的 id，
    // 前端 orderedIds = 目标父现有子节点（排除 id）+ 插入位置的 id。
    // 校验允许集合 = children ∪ {id}（同父重排时 id 已在 children 内，等价于原校验）。
    const allowed = children.includes(id) ? children : [...children, id];
    this.validateOrder(orderedIds, allowed);
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
        .run(parentId, orderedIds.indexOf(id), now, id);
      const treeStatement = this.db.prepare("UPDATE tree_nodes SET sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL");
      orderedIds.forEach((childId, index) => treeStatement.run(index, now, childId));
      const noteStatement = this.db.prepare("UPDATE notes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL");
      orderedIds.forEach((childId, index) => noteStatement.run(parentId, index, now, childId));
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  reorderTreeNodes(parentId: string | null, orderedIds: string[]): void {
    const children = this.childrenOf(parentId);
    this.validateOrder(orderedIds, children);
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      const treeStatement = this.db.prepare("UPDATE tree_nodes SET sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL");
      const noteStatement = this.db.prepare("UPDATE notes SET sort_order=?,updated_at=?,sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL");
      orderedIds.forEach((childId, index) => { treeStatement.run(index, now, childId); noteStatement.run(index, now, childId); });
    });
    transaction();
  }

  setNoteLocked(id: string, locked: boolean): void {
    const now = this.deps.nowIso();
    this.assertNodeWritable(id);
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE notes SET is_locked=?, locked_at=?, sync_state='local' WHERE id=? AND deleted_at IS NULL")
        .run(locked ? 1 : 0, now, id);
      this.db.prepare("UPDATE tree_nodes SET sync_state='local' WHERE note_file_id=? AND deleted_at IS NULL").run(id);
    });
    transaction();
  }

  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): void {
    this.db.prepare("UPDATE notes SET is_locked=?, locked_at=? WHERE id=? AND deleted_at IS NULL")
      .run(locked ? 1 : 0, lockedAt, id);
  }

  importRemoteFolder(folder: SyncFolder): void {
    if (folder.id === this.trashNotebookId) return;
    const existing = this.db.prepare("SELECT title,parent_id,sort_order,node_type,icon,updated_at FROM tree_nodes WHERE id=?").get(folder.id) as ExistingFolderRow | undefined;
    if (!existing) {
      this.db.prepare(
        `INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict,icon,trashed_at,deleted_from_parent_id)
         VALUES(?,?,?,?,?,NULL,?,?,?,NULL,'synced',0,?,?,?)`
      ).run(folder.id, this.workspaceId, folder.parentId, folder.nodeType, folder.title, folder.sortOrder, folder.updatedAt, folder.updatedAt, folder.icon ?? null,
        folder.parentId === this.trashNotebookId ? (folder.trashedAt ?? null) : null,
        folder.parentId === this.trashNotebookId ? (folder.deletedFromParentId ?? null) : null);
      return;
    }
    if (folder.updatedAt > existing.updated_at) {
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?, title=?, sort_order=?, updated_at=?, icon=?, sync_state='synced', node_type=?, trashed_at=?, deleted_from_parent_id=? WHERE id=?"
      ).run(folder.parentId, folder.title, folder.sortOrder, folder.updatedAt, folder.icon ?? null, folder.nodeType,
        folder.parentId === this.trashNotebookId ? (folder.trashedAt ?? null) : null,
        folder.parentId === this.trashNotebookId ? (folder.deletedFromParentId ?? null) : null,
        folder.id);
    }
  }

  hasTreeNode(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(id);
  }

  /** 该父节点的有效子节点（排除回收站子树，对齐 listTreeNodes 的 UI 语义；用于移动/重排校验）。
   * SQLite 中 parent_id = NULL 恒不成立：根层（parentId=null）必须用 IS NULL（桌面根层笔记本排序修复）。 */
  private childrenOf(parentId: string | null): string[] {
    const base = parentId === null
      ? "SELECT id FROM tree_nodes WHERE workspace_id=? AND parent_id IS NULL AND deleted_at IS NULL"
      : "SELECT id FROM tree_nodes WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL";
    // 参数顺序必须与 SQL 占位符一致：WITH trash_ids 的 2 个 ?（trashId）在前，base 的 ?（workspaceId[, parentId]）在后
    const params: unknown[] = [this.deps.trashNotebookId, this.deps.trashNotebookId, this.workspaceId];
    if (parentId !== null) params.push(parentId);
    const rows = this.db.prepare(
      "WITH RECURSIVE trash_ids(id) AS (SELECT ? FROM tree_nodes WHERE id=? UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id) SELECT id FROM (" + base + ") WHERE id NOT IN (SELECT id FROM trash_ids)"
    ).all(...params) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private validateOrder(orderedIds: string[], children: string[]): void {
    if (new Set(orderedIds).size !== orderedIds.length) throw new AppError("InvalidInput", "重排列表包含重复节点");
    const childSet = new Set(children);
    for (const childId of orderedIds) {
      if (!childSet.has(childId)) throw new AppError("InvalidInput", `重排列表包含不属于该父节点的节点: ${childId}`);
    }
    if (orderedIds.length !== children.length) throw new AppError("InvalidInput", "重排列表必须包含该父节点的全部子节点");
  }
}
