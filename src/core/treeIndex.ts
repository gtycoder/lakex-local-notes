import type { TreeNode } from "./types.js";

export interface TreeIndex {
  childrenByParent: ReadonlyMap<string | null, readonly TreeNode[]>;
  visibleIds: ReadonlySet<string>;
}

/** Builds the sorted child index once per node/query change instead of scanning all nodes per row. */
export function buildTreeIndex(nodes: TreeNode[], query: string): TreeIndex {
  const children = new Map<string | null, TreeNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder);

  if (!query) return { childrenByParent: children, visibleIds: new Set(nodes.map((node) => node.id)) };

  const visibleIds = new Set<string>();
  const matchesMemo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const matches = (node: TreeNode): boolean => {
    const known = matchesMemo.get(node.id);
    if (known !== undefined) return known;
    if (visiting.has(node.id)) return false;
    visiting.add(node.id);
    const direct = node.title.toLocaleLowerCase().includes(query);
    const descendant = (children.get(node.id) ?? []).some(matches);
    visiting.delete(node.id);
    const result = direct || descendant;
    matchesMemo.set(node.id, result);
    if (result) visibleIds.add(node.id);
    return result;
  };

  for (const node of nodes) matches(node);
  return { childrenByParent: children, visibleIds };
}