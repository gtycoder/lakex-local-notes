
/**
 * 「移动到…」目标候选（261106 task-81）：只列**笔记本与分组**（目标父级必须是容器），
 * 并**排除已选中节点及其全部后代**（把分组移进自己的子项 = 环，主进程也会拒绝，UI 先挡掉）。
 *
 * 纯函数；深度用于缩进展示，顺序 = 目录树顺序（sortOrder）。
 */
import type { TreeNode } from "../lib/types";

export interface MoveTarget {
  id: string;
  title: string;
  nodeType: "notebook" | "group";
  depth: number;
}

export function buildMoveTargets(nodes: readonly TreeNode[], excludeIds: readonly string[]): MoveTarget[] {
  const children = new Map<string | null, TreeNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder);

  /** 排除集 = 选中项 + 它们的全部后代（DFS）。 */
  const banned = new Set<string>(excludeIds);
  const banSubtree = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (banned.has(child.id)) continue;
      banned.add(child.id);
      banSubtree(child.id);
    }
  };
  for (const id of excludeIds) banSubtree(id);

  const targets: MoveTarget[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (banned.has(node.id)) continue;
      if (node.nodeType === "notebook" || node.nodeType === "group") {
        targets.push({ id: node.id, title: node.title || "未命名", nodeType: node.nodeType, depth });
      }
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return targets;
}
