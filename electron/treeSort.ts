/**
 * 树同级排序的**单一实现**（261117 用户点单「新建文档位置」）。
 *
 * 为什么抽出来：这套「顶部 = 同级整体后移再插 0；末尾 = MAX+1」的 SQL 原先有两份 ——
 * 文档（notes + tree_nodes 两表，见 store.createNoteInWithContent）与目录/笔记本（只有 tree_nodes，
 * 见 NoteMetadataRepository）。两处各写一份，任何一处改排序语义（例如未来加本地化排序、位置合并协议
 * 调整）都会漂移。这里只保留一份，store 与 noteMetadataRepository 都调它。
 *
 * 约定：
 * - `parent_id IS ?` 同时覆盖根层（null）与子级（具体 id）；
 * - 文档的 top 必须**两表同事务**一起后移（tree_nodes 与 notes 各有一份 sort_order，只动一张会错位）；
 * - 只做「排序值计算 / 后移」，插入行本身仍由调用方负责（文档要写正文/索引，分组只有 tree_nodes）。
 */
import { nextSortOrder } from "../src/core/treeRules.js";

/** 只依赖 prepare().run/get 的最小 DB 形状（store 用 better-sqlite3，测试可用 fake）。 */
export interface SortDb {
  prepare(sql: string): {
    run(...params: readonly unknown[]): unknown;
    get(...params: readonly unknown[]): unknown;
  };
}

/** 同级下一个排序值（= MAX(sort_order)+1；空父级为 0）。 */
export function nextSiblingSortOrder(db: SortDb, workspaceId: string, parentId: string | null): number {
  const row = db.prepare(
    "SELECT COALESCE(MAX(sort_order),-1) AS max_order FROM tree_nodes WHERE workspace_id=? AND parent_id IS ? AND deleted_at IS NULL",
  ).get(workspaceId, parentId) as { max_order: number | null } | undefined;
  return nextSortOrder(row?.max_order ?? null);
}

/**
 * 顶部新增：同一事务内把同级整体后移一位。
 * - `withNotes`：文档创建传 true（notes 表也有一份 sort_order）；分组/笔记本传 false（只有 tree_nodes 行）。
 */
export function shiftSiblingsForTop(
  db: SortDb,
  input: { workspaceId: string; parentId: string | null; updatedAt: string; withNotes: boolean },
): void {
  const { workspaceId, parentId, updatedAt, withNotes } = input;
  db.prepare(
    "UPDATE tree_nodes SET sort_order=sort_order+1, updated_at=?, is_dirty=1 WHERE workspace_id=? AND parent_id IS ? AND deleted_at IS NULL",
  ).run(updatedAt, workspaceId, parentId);
  if (withNotes) {
    db.prepare(
      "UPDATE notes SET sort_order=sort_order+1, updated_at=?, is_dirty=1 WHERE parent_id IS ? AND deleted_at IS NULL",
    ).run(updatedAt, parentId);
  }
}

/**
 * 插到指定排序值之后（复制文档用）：只把「源之后的同级条目」后移一位，文档同样两表一起动。
 * 语义与顶部新增同源，只是起点不是 0。
 */
export function shiftSiblingsAfter(
  db: SortDb,
  input: { workspaceId: string; parentId: string | null; afterSortOrder: number; updatedAt: string },
): void {
  const { workspaceId, parentId, afterSortOrder, updatedAt } = input;
  db.prepare(
    "UPDATE tree_nodes SET sort_order=sort_order+1, updated_at=?, is_dirty=1 WHERE workspace_id=? AND parent_id IS ? AND sort_order>? AND deleted_at IS NULL",
  ).run(updatedAt, workspaceId, parentId, afterSortOrder);
  db.prepare(
    "UPDATE notes SET sort_order=sort_order+1, updated_at=?, is_dirty=1 WHERE parent_id IS ? AND sort_order>? AND deleted_at IS NULL",
  ).run(updatedAt, parentId, afterSortOrder);
}
