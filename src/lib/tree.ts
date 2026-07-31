import type { TreeNode } from "./types";

export function subtreeIds(nodes: TreeNode[], rootId: string): Set<string> {
  const result = new Set([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    for (const node of nodes) {
      if (node.parentId === parentId && !result.has(node.id)) {
        result.add(node.id);
        pending.push(node.id);
      }
    }
  }
  return result;
}
