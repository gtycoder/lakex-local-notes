/**
 * 回收站查询（lake-core 共享层，V5 Phase 2）。
 * 桌面 = electron/store.ts 包装；同步数据库形态是桌面私有契约。
 *
 * 设计语义（与普通笔记本树同构）：
 * - 回收站是隐藏笔记本；删除 = 把根节点移入回收站笔记本（parentId=notebook-trash），
 *   子节点随父（parentId 链保留，不递归改写）——所以回收站树 = trash 笔记本下的完整子树。
 * - 树查询用 WITH RECURSIVE（SQLite 3.8.3+），返回全部节点含 parentId，
 *   前端/执行壳按 parentId 组树。
 * - 恢复：仅对被删树的根（parent_id=trash）开放，整棵连带移回（restore 属写操作，留在各端 store）。
 * - 彻底删除：回收站树内任意节点可 purge（该节点及其子树），写操作留在各端 store。
 */

import type { DbLike } from "./dbLike.js";
import type { TrashItem, TrashReminderItem } from "../src/core/trashPolicy.js";

export type { TrashItem, TrashReminderItem };

export { trashDaysUntilPurge } from "../src/core/trashPolicy.js";

interface TrashRow {
  id: string;
  title: string;
  node_type: string;
  note_file_id: string | null;
  parent_id: string | null;
  trashed_at: string | null;
  updated_at: string;
  is_purged?: number;
  cloud_deleted?: number;
}

/** 只读回收站查询（restore/purge 写操作在各端 store 实现）。 */
export class TrashRepository {
  constructor(private readonly db: DbLike, private readonly trashNotebookId: string) {}

  /** 回收站树：trash 笔记本下的完整子树（含嵌套分组/文档，含 parentId 供组树）。
   * 与普通笔记本树同一套父子关系，只是根固定在回收站笔记本。 */
  list(): TrashItem[] {
    const rows = this.db.prepare(
      `WITH RECURSIVE trash_tree(id) AS (
         SELECT t.id FROM tree_nodes t WHERE t.parent_id=? AND t.deleted_at IS NULL
         UNION ALL
         SELECT c.id FROM tree_nodes c JOIN trash_tree tt ON c.parent_id=tt.id AND c.deleted_at IS NULL
       )
       SELECT t.id,t.title,t.node_type,t.note_file_id,t.parent_id,t.trashed_at,t.updated_at,t.is_purged,t.cloud_deleted
       FROM tree_nodes t JOIN trash_tree tt ON t.id=tt.id
       ORDER BY t.sort_order`
    ).all(this.trashNotebookId) as TrashRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      nodeType: row.node_type,
      noteFileId: row.note_file_id,
      parentId: row.parent_id,
      deletedAt: row.trashed_at,
      updatedAt: row.updated_at,
      hasFile: !!row.note_file_id,
      purged: row.is_purged === 1,
      cloudDeleted: row.cloud_deleted === 1,
    }));
  }

  listReminder(days: number): TrashReminderItem[] {
    if (!Number.isFinite(days) || days <= 0) return [];
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    return this.list()
      .filter((item) => item.deletedAt !== null && item.deletedAt < cutoff)
      .map((item) => ({ id: item.id, title: item.title, deletedAt: item.deletedAt as string }));
  }
}
