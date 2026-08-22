import { rowToLocalState } from "./syncDecisions.js";
import type { DbLike } from "./dbLike.js";

export interface NoteSummary {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  syncState: string;
  isConflict: boolean;
  isLocked?: boolean;
  lockedAt?: string | null;
}

export interface TreeNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  nodeType: string;
  title: string;
  noteFileId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  syncState: string;
  isConflict: boolean;
  icon: string | null;
}

export interface SyncNote {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  /** Only local listNotesForSync supplies this field. */
  syncState?: string;
  isConflict: boolean;
  isLocked?: boolean;
  lockedAt?: string | null;
  icon?: string | null;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
}

export interface SyncFolder {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  nodeType: "notebook" | "group";
  icon: string | null;
  updatedAt: string;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
}

export interface SummaryRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  updated_at: string;
  sync_state: string;
  is_conflict: number;
  is_locked: number;
  locked_at: string | null;
}

export interface TreeNodeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  node_type: string;
  title: string;
  note_file_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_state: string;
  is_conflict: number;
  icon: string | null;
}

interface SyncNoteRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  updated_at: string;
  sync_state: string;
  is_conflict: number;
  is_locked: number;
  locked_at: string | null;
  icon: string | null;
  trashed_at: string | null;
  deleted_from_parent_id: string | null;
}

interface SyncFolderRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  node_type: "notebook" | "group";
  icon: string | null;
  updated_at: string;
  trashed_at: string | null;
  deleted_from_parent_id: string | null;
}

/** Read-only note/tree queries; metadata and content writes remain in Store. */
export class NoteQueries {
  constructor(
    private readonly db: DbLike,
    private readonly workspaceId: string,
    private readonly trashNotebookId: string,
  ) {}

  mapSummary(row: SummaryRow): NoteSummary {
    return {
      id: row.id,
      title: row.title,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      updatedAt: row.updated_at,
      syncState: row.sync_state,
      isConflict: !!row.is_conflict,
      isLocked: !!row.is_locked,
      lockedAt: row.locked_at ?? null,
    };
  }

  mapTreeNode(row: TreeNodeRow): TreeNode {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      parentId: row.parent_id,
      nodeType: row.node_type,
      title: row.title,
      noteFileId: row.note_file_id,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      syncState: row.sync_state,
      isConflict: !!row.is_conflict,
      icon: row.icon ?? null,
    };
  }

  listTreeNodes(): TreeNode[] {
    const rows = this.db.prepare(
      `WITH RECURSIVE trash_ids(id) AS (
         SELECT ? FROM tree_nodes WHERE id=?
         UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
       )
       SELECT t.* FROM tree_nodes t
       WHERE t.workspace_id=? AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)
       ORDER BY t.sort_order`
    ).all(this.trashNotebookId, this.trashNotebookId, this.workspaceId) as TreeNodeRow[];
    return rows.map((row) => this.mapTreeNode(row));
  }

  listNoteSummaries(): NoteSummary[] {
    const rows = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at FROM notes WHERE deleted_at IS NULL ORDER BY sort_order"
    ).all() as SummaryRow[];
    return rows.map((row) => this.mapSummary(row));
  }

  listNotesForSync(): SyncNote[] {
    const rows = this.db.prepare(
      `SELECT n.id,n.title,n.parent_id,n.sort_order,n.updated_at,n.sync_state,n.is_conflict,n.is_locked,n.locked_at,t.icon,n.trashed_at,n.deleted_from_parent_id
       FROM notes n LEFT JOIN tree_nodes t ON t.note_file_id = n.id
       WHERE n.deleted_at IS NULL ORDER BY n.sort_order`
    ).all() as SyncNoteRow[];
    // Step B G5：行映射统一走 core rowToLocalState（两端同一映射，避免"同一状态两种解读"）
    return rows.map((row) => rowToLocalState(row));
  }

  listFoldersForSync(): SyncFolder[] {
    const rows = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id FROM tree_nodes WHERE node_type IN ('notebook','group') AND deleted_at IS NULL AND id != ? ORDER BY sort_order"
    ).all(this.trashNotebookId) as SyncFolderRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      nodeType: row.node_type,
      icon: row.icon ?? null,
      updatedAt: row.updated_at,
      trashedAt: row.trashed_at ?? null,
      deletedFromParentId: row.deleted_from_parent_id ?? null,
    }));
  }
}
