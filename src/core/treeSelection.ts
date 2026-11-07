
/**
 * 桌面目录树「多选」纯逻辑（261106 task-81）：⌘/Ctrl 点切换、Shift 区间、Esc 清空、全选、上限。
 *
 * 口径（用户定稿）：
 *  · **笔记本不可多选**：点笔记本仍是展开/选中；Shift 区间跨过笔记本时跳过（可见顺序里干脆不含它）；
 *  · 选择集合 = 设备本地视图：切换笔记本/筛选/搜索即清空（由调用方 effect 负责，本模块只提供 clear）；
 *  · 上限 500 与主进程 batch_notes 兜底一致，超出时不再加入并给调用方信号。
 *
 * 这里只做纯状态变换，不碰 DOM / IPC；行渲染与批量执行在 Sidebar / 多选条。
 */
import type { TreeIndex } from "./treeIndex";

/** 只依赖渲染所需的最小结构（core 不得 import lib/平台类型）。 */
export interface TreeNodeLike { id: string; nodeType: string; }

/** 与主进程 batch_notes 的 ids 上限一致（超过由主进程拒绝；UI 提前挡一下并提示分批）。 */
export const TREE_SELECTION_MAX = 500;

export interface TreeSelectionState {
  /** 已选节点 id（保持加入顺序；批量操作的顺序 = 这个顺序）。 */
  ids: readonly string[];
  /** Shift 区间的锚点（最近一次普通/⌘点击的行）。 */
  anchorId: string | null;
}

export const EMPTY_TREE_SELECTION: TreeSelectionState = { ids: [], anchorId: null };

export interface TreeSelectionActions {
  /** 移动…（文档与分组都有）。 */
  move: boolean;
  /** 删除（移入回收站；只有文档）。 */
  trash: boolean;
  /** 添加标签（只有文档；只追加）。 */
  tag: boolean;
  /** 置顶/取消置顶（261107，设备本地入口；所有可选节点都支持）。 */
  pin: boolean;
}

type NodeLike = TreeNodeLike;

/** 能否进多选集合：文档与分组可以，笔记本不可以。 */
export function isSelectableTreeNode(node: Pick<TreeNodeLike, "nodeType">): boolean {
  return node.nodeType !== "notebook";
}

/**
 * 当前**可见**的可多选行，按显示顺序（深度优先，父在前；笔记本跳过、但其子项照常下钻）。
 * 直接用 Sidebar 的 `displayIndex`（已含搜索/标签筛选收窄）。
 */
export function selectableVisibleOrder(index: TreeIndex): string[] {
  const order: string[] = [];
  const walk = (parentId: string | null) => {
    const children = index.childrenByParent.get(parentId) ?? [];
    for (const node of children) {
      if (!index.visibleIds.has(node.id)) continue;
      if (isSelectableTreeNode(node)) order.push(node.id);
      walk(node.id);
    }
  };
  walk(null);
  return order;
}

/** 普通点击：退出多选（但记锚点，方便紧接着 Shift 区间）。 */
export function plainClickSelection(id: string): TreeSelectionState {
  return { ids: [], anchorId: id };
}

/** ⌘/Ctrl 点击：切换一行（不改变锚点以外的行为；加入按点击顺序）。 */
export function toggleTreeSelection(state: TreeSelectionState, id: string): TreeSelectionState {
  if (state.ids.includes(id)) {
    return { anchorId: id, ids: state.ids.filter((item) => item !== id) };
  }
  if (state.ids.length >= TREE_SELECTION_MAX) return state;
  return { anchorId: id, ids: [...state.ids, id] };
}

/**
 * Shift 点击：以锚点为界取**可见顺序**里的闭区间（替换现有选择，符合列表多选习惯）。
 * 没有锚点/锚点已不可见 ⇒ 退化成只选这一行。
 */
export function rangeTreeSelection(state: TreeSelectionState, order: readonly string[], id: string): TreeSelectionState {
  const endIndex = order.indexOf(id);
  if (endIndex < 0) return state;
  const anchorIndex = state.anchorId ? order.indexOf(state.anchorId) : -1;
  if (anchorIndex < 0) {
    return { anchorId: state.anchorId ?? id, ids: [id] };
  }
  const from = Math.min(anchorIndex, endIndex);
  const to = Math.max(anchorIndex, endIndex);
  const ids = order.slice(from, to + 1).slice(0, TREE_SELECTION_MAX);
  return { anchorId: state.anchorId, ids };
}

/** 全选当前可见的可多选行（到上限即止）。 */
export function selectAllVisible(state: TreeSelectionState, order: readonly string[]): TreeSelectionState {
  const ids = order.slice(0, TREE_SELECTION_MAX);
  return { anchorId: state.anchorId ?? ids[0] ?? null, ids };
}

/** 清空（Esc / 点空白 / 操作完成）。 */
export function clearTreeSelection(): TreeSelectionState {
  return EMPTY_TREE_SELECTION;
}

/** 列表变化后剔除已不可选的行（切换笔记本/筛选/搜索/删除后都会用到）。 */
export function pruneTreeSelection(state: TreeSelectionState, order: readonly string[]): TreeSelectionState {
  const allowed = new Set(order);
  const ids = state.ids.filter((id) => allowed.has(id));
  if (ids.length === state.ids.length) return state;
  return { ids, anchorId: state.anchorId && allowed.has(state.anchorId) ? state.anchorId : null };
}

/** 是否已到上限（UI 用来给「最多 500 项…」提示）。 */
export function treeSelectionLimitReached(state: TreeSelectionState): boolean {
  return state.ids.length >= TREE_SELECTION_MAX;
}

/** 按选中项的类型决定右键菜单有哪些动作：混选（文档+分组）只剩「移动…」。 */
export function treeSelectionActions(nodes: ReadonlyMap<string, NodeLike>, state: TreeSelectionState): TreeSelectionActions {
  const selected = state.ids.map((id) => nodes.get(id)).filter((node): node is NodeLike => !!node);
  const notesOnly = selected.length > 0 && selected.every((node) => node.nodeType === "note");
  return { move: selected.length > 0, trash: notesOnly, tag: notesOnly, pin: selected.length > 0 };
}