/**
 * 桌面目录树「展开状态」的切换语义（261119 用户点单）：
 *
 * · **收起某节点 ⇒ 整棵子树的展开状态全部清除**（后代一律收起，不记忆上次展开的层级）；
 * · **再点展开 ⇒ 只开一级**：自身展开、直接子级可见，子级自身保持收起（逐级按需展开）。
 *   展开侧同样先清一遍子树再加自身：即便其它入口（同步新增容器的自动展开、定位回填等）
 *   曾把后代写回展开集，点击展开也只会开一级。
 * · 子树集合复用 `core/tree.subtreeIds`（自带 visited，防环/防深树重复遍历），不另造遍历。
 * · 展开态只活在会话内（Sidebar 的 useState）：**不持久化** —— 不写 localStorage / device_state、不进 S3，
 *   重启回到默认展开（笔记本/分组）。这是有意的 —— 用户要的就是「不记录上次展开的层级」。
 */
import { subtreeIds } from "../../../core/tree";
import type { TreeNode } from "../../../lib/types";

/**
 * 切换一个节点的展开态。
 * - 原本收起 → 展开：清掉整棵子树的展开记录，只把自身加入 ⇒ 只开一级；
 * - 原本展开 → 收起：清掉整棵子树（含自身）的展开记录 ⇒ 后代一律收起。
 */
export function toggleExpandedNode(current: ReadonlySet<string>, id: string, nodes: TreeNode[]): Set<string> {
  const subtree = subtreeIds(nodes, id);
  const wasExpanded = current.has(id);
  const next = new Set(current);
  for (const nodeId of subtree) next.delete(nodeId);
  if (!wasExpanded) next.add(id);
  return next;
}
