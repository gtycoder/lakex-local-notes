/**
 * 移动端目录树的索引与可见行（纯函数，不碰 React / DOM）。
 *
 * 为什么需要：旧实现的 childrenOf = tree.filter(...).sort(...)，每调用一次 O(n)；
 * NotebookWorkspace 的 renderBranch 对**每个可见节点**都调 childrenOf(parent) 与
 * childrenOf(it.id) ⇒ 2000 节点平铺时每次渲染 ≈ 400 万次比较 + 一次 2000 项排序，
 * 且抽屉一开 / 树一变 / 工作区任意一次重渲染都整份重算。这里改成：
 *   buildNotebookTreeIndex(tree)  一次 O(n) 分桶 + 每组一次排序（tree 不变就复用）；
 *   flattenVisibleRows(...)       只走展开分支，O(可见行)（expanded 变只重算这一份）；
 *   firstNoteInTree(...)          进入工作区自动开第一篇（替代原递归 childrenOf）。
 */
import type { NotebookTreeItem } from "../data/notebookTreeRepository";

/** 扁平行 = 节点 + 缩进层级；抽屉虚拟滚动只消费这份数组。 */
export interface NotebookTreeRow {
  item: NotebookTreeItem;
  depth: number;
}

export interface NotebookTreeIndex {
  /** id → 节点（重复 id 取第一个，与旧的 tree.find 语义一致）。 */
  byId: ReadonlyMap<string, NotebookTreeItem>;
  /** 某个父节点的子节点（已按 sortOrder 稳定排序；无子返回共享空数组）。 */
  childrenOf(parentId: string): readonly NotebookTreeItem[];
}

const EMPTY_CHILDREN: readonly NotebookTreeItem[] = Object.freeze([]);

/** 一次 O(n)：父→子分桶 + 组内按 sortOrder 稳定排序。 */
export function buildNotebookTreeIndex(tree: readonly NotebookTreeItem[]): NotebookTreeIndex {
  const byId = new Map<string, NotebookTreeItem>();
  const grouped = new Map<string, NotebookTreeItem[]>();
  for (const item of tree) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  for (const item of tree) {
    const key = item.parentId ?? "";
    const siblings = grouped.get(key);
    if (siblings) siblings.push(item);
    else grouped.set(key, [item]);
  }
  // Array#sort 在现代 JS 引擎是稳定排序；仓储已按 (parentId, sortOrder) 预排，
  // 这里只补「同一父内 sortOrder 变化后（拖拽乐观重排）仍按 sortOrder」这一层。
  for (const siblings of grouped.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    byId,
    childrenOf: (parentId: string) => grouped.get(parentId) ?? EMPTY_CHILDREN,
  };
}

/**
 * 展开集合下的可见扁平行（深度优先、只进 expanded 的分支）。
 * 脏数据成环时靠 visited 兜底（旧递归实现会栈溢出）。
 */
export function flattenVisibleRows(
  index: NotebookTreeIndex,
  rootId: string,
  expanded: ReadonlySet<string>,
): NotebookTreeRow[] {
  const rows: NotebookTreeRow[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string, depth: number): void => {
    for (const item of index.childrenOf(parentId)) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      rows.push({ item, depth });
      if (expanded.has(item.id)) walk(item.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return rows;
}

/** 深度优先找第一篇可打开的文档（与旧 findFirstNote 同序）；只有分组/空树返回 null。 */
export function firstNoteInTree(index: NotebookTreeIndex, rootId: string): NotebookTreeItem | null {
  const stack = index.childrenOf(rootId).slice().reverse();
  while (stack.length > 0) {
    const item = stack.pop() as NotebookTreeItem;
    if (item.kind === "note") return item;
    const children = index.childrenOf(item.id);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return null;
}
