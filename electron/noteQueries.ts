import { rowToLocalState } from "../src/core/syncDecisions.js";
import { AppError } from "../src/core/storeErrors.js";
import type { DbLike, DbLikeStatement } from "./dbLike.js";

export interface NoteSummary {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  syncState: string;
  isConflict: boolean;
  isLocked?: boolean;
  /** v6/v7 文档类型（缺省 doc；渲染层据此选择编辑器）。 */
  kind?: "doc" | "sheet" | "bitable" | "board";
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
  /** v6/v7 文档类型（doc | sheet | bitable | board；缺省 doc）。 */
  kind?: "doc" | "sheet" | "bitable" | "board";
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
  /** v6/v7 文档类型（listNotesForSync/getNoteForSync 提供；缺省 doc）。 */
  kind?: "doc" | "sheet" | "bitable" | "board";
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
  kind?: string | null;
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
  /** LEFT JOIN notes 带来的文档类型（v6）；非 note 节点为 undefined。 */
  note_kind?: string | null;
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
  kind: string | null;
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
  /** P3-1：同步热路径 SQL 的 prepared statement 缓存（better-sqlite3 prepare 复用，省去每次重新编译）。 */
  private stmtListNotesForSync: DbLikeStatement | null = null;
  private stmtGetNoteForSync: DbLikeStatement | null = null;

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
      // v6/v7 文档类型（渲染层据此选择编辑器；缺省 doc）
      kind: (row.kind === "sheet" ? "sheet" : row.kind === "bitable" ? "bitable" : row.kind === "board" ? "board" : "doc") as "doc" | "sheet" | "bitable" | "board",
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
      // v6/v7：渲染层据此对非 doc 隐藏导出/大纲等（缺省 doc）
      kind: (row.note_kind === "sheet" ? "sheet" : row.note_kind === "bitable" ? "bitable" : row.note_kind === "board" ? "board" : "doc") as "doc" | "sheet" | "bitable" | "board",
    };
  }

  /** 单节点读取：与 listTreeNodes 使用同一 row 形状（LEFT JOIN notes 取 kind）。
   *  元数据写操作（rename/setNodeIcon/move）回传给渲染层的就是这个节点；
   *  若只查 tree_nodes（缺 note_kind），mapTreeNode 会把 kind 兜底成 "doc"，
   *  渲染层 replaceTreeNode(返回值) 就把 board/sheet/bitable 换成了文档图标。 */
  readTreeNode(id: string): TreeNode {
    const row = this.db.prepare(
      "SELECT t.*, n.kind AS note_kind FROM tree_nodes t LEFT JOIN notes n ON n.id = t.note_file_id WHERE t.id=? AND t.deleted_at IS NULL"
    ).get(id) as TreeNodeRow | undefined;
    if (!row) throw new AppError("NotFound", `节点不存在: ${id}`);
    return this.mapTreeNode(row);
  }

  listTreeNodes(): TreeNode[] {
    const rows = this.db.prepare(
      `WITH RECURSIVE trash_ids(id) AS (
         SELECT ? FROM tree_nodes WHERE id=?
         UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
       )
       SELECT t.*, n.kind AS note_kind FROM tree_nodes t
       LEFT JOIN notes n ON n.id = t.note_file_id
       WHERE t.workspace_id=? AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)
       ORDER BY t.sort_order`
    ).all(this.trashNotebookId, this.trashNotebookId, this.workspaceId) as TreeNodeRow[];
    return rows.map((row) => this.mapTreeNode(row));
  }

  listNoteSummaries(): NoteSummary[] {
    const rows = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at,kind FROM notes WHERE deleted_at IS NULL ORDER BY sort_order"
    ).all() as SummaryRow[];
    return rows.map((row) => this.mapSummary(row));
  }

  private static readonly SYNC_NOTE_COLUMNS =
    `SELECT n.id,n.title,n.parent_id,n.sort_order,n.updated_at,n.sync_state,n.is_conflict,n.is_locked,n.locked_at,t.icon,n.trashed_at,n.deleted_from_parent_id,n.kind
     FROM notes n LEFT JOIN tree_nodes t ON t.note_file_id = n.id`;

  listNotesForSync(): SyncNote[] {
    // P3-1：statement 缓存——本方法在同步周期内被多次调用（全表列出 + 单行 getNoteForSync），
    // 不再每次 prepare。
    this.stmtListNotesForSync ??= this.db.prepare(
      `${NoteQueries.SYNC_NOTE_COLUMNS} WHERE n.deleted_at IS NULL ORDER BY n.sort_order`
    );
    const rows = this.stmtListNotesForSync.all() as SyncNoteRow[];
    // Step B G5：行映射统一走 core rowToLocalState（两端同一映射，避免"同一状态两种解读"）
    return rows.map((row) => rowToLocalState(row));
  }

  /** P3-1：单行查询（与 listNotesForSync 同列同 WHERE 语义），替代 getNote/记账路径的全表 .find()。 */
  getNoteForSync(id: string): SyncNote | null {
    this.stmtGetNoteForSync ??= this.db.prepare(
      `${NoteQueries.SYNC_NOTE_COLUMNS} WHERE n.deleted_at IS NULL AND n.id = ?`
    );
    const row = this.stmtGetNoteForSync.get(id) as SyncNoteRow | undefined;
    return row ? rowToLocalState(row) : null;
  }

  listFoldersForSync(): SyncFolder[] {
    // v5：排除 sync_state='purged'（收到他端 folder 墓碑后保留的回收站副本）——学习端不回填，
    // 对齐 notes 上传环的 purged continue；否则每端都会把已删目录当活跃条目重新发布 → manifest 震荡。
    const rows = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id FROM tree_nodes WHERE node_type IN ('notebook','group') AND deleted_at IS NULL AND sync_state != 'purged' AND id != ? ORDER BY sort_order"
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
