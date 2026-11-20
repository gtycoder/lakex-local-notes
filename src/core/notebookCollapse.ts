/**
 * 「已收起」笔记本的**判定单一来源**（261120 用户点单，两端共用）。
 *
 * 语义：收起 = 给笔记本加一个**设备本地的归纳状态**——不移动、不改标题、不写库、不进 S3；
 * 收起后从主列表（桌面目录 / 移动知识库）里消失，只在底部「已收起」分区出现；两端各自独立。
 *
 * **逻辑上排除**（不只是 UI 不给入口）：
 * - 回收站（`notebook-trash`）：它是固定特殊区，收起等于让人找不到回收站；
 * - 「未分类」兜底本（`notebook-uncategorized`，见 core/syncDecisions）：它由同步回落惰性创建，
 *   两端必须始终可见，不能被用户藏起来；
 * - 日记本（`space === "diary"`）：日记是固定特殊笔记本（AGENTS §3#25），排序/收纳都不参与。
 *
 * 纯函数，无 storage 副作用 ⇒ 桌面与移动各自只负责「把 id 存到本机」。
 */
import { FALLBACK_NOTEBOOK_ID, TRASH_NOTEBOOK_ID } from "./syncDecisions";
import type { TreeNode } from "./sharedTypes";

/** 可收起的节点（只认笔记本；三类特殊本逻辑排除）。 */
export function canCollapseNotebook(node: Pick<TreeNode, "id" | "nodeType" | "space">): boolean {
  if (node.nodeType !== "notebook") return false;
  if (node.id === TRASH_NOTEBOOK_ID) return false;
  if (node.id === FALLBACK_NOTEBOOK_ID) return false;
  if (node.space === "diary") return false;
  return true;
}

/**
 * 清理「节点已知但不可收起」的历史 id（旧版本写入 / 笔记本变日记本 / 节点已删）。
 * 节点**未知**时保留（加载期/筛选期不误删；已删笔记本的残留 id 不可见、无害）。
 */
export function pruneCollapsedNotebookIds(
  ids: readonly string[],
  nodeById: ReadonlyMap<string, Pick<TreeNode, "id" | "nodeType" | "space">>,
): string[] {
  return ids.filter((id) => {
    const node = nodeById.get(id);
    if (!node) return true;
    return canCollapseNotebook(node);
  });
}

/**
 * 把笔记本列表按收起状态切成「主列表 / 已收起」两份（两端渲染共用）。
 * 只认**可收起**的项：非法 id（回收站/未分类/日记本/已删）即使残留在本地表里也留在主列表，不会凭空消失。
 */
export function splitCollapsedNotebooks<T extends Pick<TreeNode, "id" | "nodeType" | "space">>(
  notebooks: readonly T[],
  collapsedIds: readonly string[],
): { active: T[]; collapsed: T[] } {
  const collapsed = new Set(collapsedIds);
  const active: T[] = [];
  const hidden: T[] = [];
  for (const nb of notebooks) {
    (collapsed.has(nb.id) && canCollapseNotebook(nb) ? hidden : active).push(nb);
  }
  return { active, collapsed: hidden };
}

/** 两端共用的 id 表清洗（去重、只留非空字符串）：store 读写与清理都走这里。 */
export function normalizeCollapsedNotebookIds(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
