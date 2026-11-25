/**
 * 树形 SQL 片段单一来源（审计 261125 01-core-backend.md C-01；AGENTS §3#15 删除传播）。
 *
 * 背景：「回收站子树 id 集」递归 CTE 此前 5 处各写一份，且防环语义分叉——
 * 4 处 UNION ALL（树里出现 parent 环时递归无限展开）、1 处 UNION（去重收敛，P1-6）。
 * 这里统一成 **UNION 防环版**：去重后环上节点各纳入一次、递归必然收敛。
 * 行为变化仅 UNION ALL → UNION（环上从「可能无限递归」变「收敛」），其余逐位等价。
 *
 * ⚠️ 不并入 electron/trashLifecycle.ts 的 flattenedSubtreeIds：那是「parent_id ∪
 * deleted_from_parent_id+trashed_at 两条边并集」的原始父链变体，语义不同，禁止合并。
 *
 * 参数约定：CTE 锚点两个占位符 = [trashId, trashId]（trashId×2 在前），
 * 外层查询参数随后——各调用点参数不同，错位不会报错、只会静默错结果，
 * 由每个调用点的单测钉死（见本目录 treeFragments.test.ts 与各调用点测试）。
 */

/** 统一「UNION 防环」回收站子树 CTE：trash_ids = 锚点节点 ∪ 沿 parent_id 递归的全部后代。
 *  锚点形态 SELECT ? FROM tree_nodes WHERE id=?（列值 + 行过滤两个占位符）。
 *  调用点用法：TRASH_SUBTREE_CTE 拼上外层查询，条件用 id NOT IN (SELECT id FROM trash_ids)。 */
export const TRASH_SUBTREE_CTE =
  "WITH RECURSIVE trash_ids(id) AS (" +
  " SELECT ? FROM tree_nodes WHERE id=?" +
  " UNION SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id" +
  ")";

/** CTE 参数助手：trashId×2 在前（锚点列值 + 锚点行过滤），外层参数随后。 */
export function trashSubtreeParams(trashId: string): [string, string] {
  return [trashId, trashId];
}

/** purge 落库（notes 行）：移入回收站 + 标 purged + 清恢复标记。
 *  参数顺序 = [回收站 id, 时间, 时间, noteId]；trashed_at / deleted_from_parent_id 走 COALESCE 保留既有值。 */
export const PURGE_NOTE_SQL =
  "UPDATE notes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,is_purged=1,is_dirty=0,restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL";

/** purge 落库（tree_nodes 行）：与 PURGE_NOTE_SQL 同语义（无恢复标记列）。
 *  参数顺序 = [回收站 id, 时间, 时间, nodeId]。 */
export const PURGE_NODE_SQL =
  "UPDATE tree_nodes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,is_purged=1,is_dirty=0 WHERE id=? AND deleted_at IS NULL";
