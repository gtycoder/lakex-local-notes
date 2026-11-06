
/**
 * 桌面「移动…」目录树弹窗的**纯逻辑**（261106 task-90；思源式交互，单条与批量共用）。
 *
 * 口径：
 *  · 只列**容器**（笔记本/分组）——文档不是合法父级；
 *  · 层级 = 目录树顺序；默认展开「当前所在路径」，当前父级行标「当前位置」；
 *  · 搜索：按名称过滤，**命中项自动展开祖先**（祖先可见才能看见命中），命中文字高亮；
 *  · 防环：移动项**自身及其全部后代**禁用（不能移进自己内部）；
 *  · 回收站容器/回收站内节点禁用（本机目录树本身不含回收站节点，保留 trashedIds 入参以便两端同口径）。
 */
import type { TreeNode } from "../lib/types";

export const MOVE_TREE_DISABLED_REASON = {
  self: "不能移动到自身或子项内部",
  trashed: "目标在回收站里",
} as const;

export interface MoveTreeRow {
  id: string;
  title: string;
  nodeType: "notebook" | "group";
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  disabled: boolean;
  /** 禁用原因（只对禁用行有值） */
  reason: string | null;
  /** 当前父级行（移动项的现所在容器） */
  current: boolean;
  /** 搜索命中（高亮文字） */
  matched: boolean;
}

export interface MoveTreeInput {
  nodes: readonly TreeNode[];
  /** 正在移动的节点 id（单条 = 长度 1）。 */
  movingIds: readonly string[];
  /** 移动项的当前父级（同父级批量时给出；否则 null = 没有「当前位置」）。 */
  currentParentId: string | null;
  expanded: ReadonlySet<string>;
  query: string;
  /** 回收站内节点 id（可缺省；桌面目录树本身不含回收站节点）。 */
  trashedIds?: ReadonlySet<string>;
}

export interface MoveTreeResult {
  rows: MoveTreeRow[];
  /** 搜索命中的 id（UI 用来高亮/自动展开校验）。 */
  matchedIds: ReadonlySet<string>;
}

function childrenMap(nodes: readonly TreeNode[]): Map<string | null, TreeNode[]> {
  const children = new Map<string | null, TreeNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  return children;
}

/** 移动项自身 + 全部后代（这些都不能作为目标）。 */
export function moveForbiddenIds(nodes: readonly TreeNode[], movingIds: readonly string[]): Set<string> {
  const children = childrenMap(nodes);
  const banned = new Set<string>(movingIds);
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (banned.has(child.id)) continue;
      banned.add(child.id);
      walk(child.id);
    }
  };
  for (const id of movingIds) walk(id);
  return banned;
}

/** 默认展开：当前父级及其全部祖先（含父级自身，让「当前位置」直接可见）。 */
export function initialMoveTreeExpanded(nodes: readonly TreeNode[], currentParentId: string | null): Set<string> {
  const expanded = new Set<string>();
  if (!currentParentId) return expanded;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let cursor = byId.get(currentParentId);
  while (cursor) {
    expanded.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return expanded;
}

/** 移动项的当前父级：单条/同父级批量给出；不同父级 ⇒ null（不标「当前位置」）。 */
export function currentParentOf(nodes: readonly TreeNode[], movingIds: readonly string[]): string | null {
  if (movingIds.length === 0) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = movingIds.map((id) => byId.get(id)?.parentId ?? null);
  return parents.every((parent) => parent === parents[0]) ? parents[0] : null;
}

/**
 * 生成可见行（树形，父在前）：只含容器；expanded 控制子项可见性；
 * 搜索态下**祖先自动展开**（否则命中项看不见），命中行 matched=true。
 */
export function buildMoveTreeRows(input: MoveTreeInput): MoveTreeResult {
  const children = childrenMap(input.nodes);
  const forbidden = moveForbiddenIds(input.nodes, input.movingIds);
  const trashed = input.trashedIds ?? new Set<string>();
  const needle = input.query.trim().toLowerCase();
  const matchedIds = new Set<string>();
  const byId = new Map(input.nodes.map((node) => [node.id, node]));

  if (needle) {
    for (const node of input.nodes) {
      if (node.nodeType === "notebook" || node.nodeType === "group") {
        if ((node.title || "").toLowerCase().includes(needle)) matchedIds.add(node.id);
      }
    }
  }
  /** 命中项的祖先集合（搜索态下强制展开）。 */
  const ancestorOfMatch = new Set<string>();
  if (needle) {
    for (const id of matchedIds) {
      let cursor = byId.get(id)?.parentId ? byId.get(byId.get(id)!.parentId!) : undefined;
      while (cursor) {
        ancestorOfMatch.add(cursor.id);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
    }
  }

  const rows: MoveTreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (node.nodeType === "notebook" || node.nodeType === "group") {
        const matched = matchedIds.has(node.id);
        const disabled = forbidden.has(node.id) || trashed.has(node.id);
        const reason = disabled
          ? forbidden.has(node.id) ? MOVE_TREE_DISABLED_REASON.self : MOVE_TREE_DISABLED_REASON.trashed
          : null;
        const expanded = needle
          ? (matched || ancestorOfMatch.has(node.id) || input.expanded.has(node.id))
          : input.expanded.has(node.id);
        rows.push({
          id: node.id,
          title: node.title || "未命名",
          nodeType: node.nodeType,
          depth,
          expanded,
          hasChildren: (children.get(node.id) ?? []).some((child) => child.nodeType === "notebook" || child.nodeType === "group"),
          disabled,
          reason,
          current: node.id === input.currentParentId,
          matched,
        });
      }
      // 非容器节点不下发，但仍下钻（容器可能挂在文档下面）；深度按**完整树层级**算，缩进诚实
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);

  // 搜索态下只保留「命中行 + 命中行的祖先链」（其余分支折叠隐藏）
  if (needle) {
    const keep = new Set<string>();
    for (const id of matchedIds) {
      keep.add(id);
      let cursor = byId.get(id)?.parentId ? byId.get(byId.get(id)!.parentId!) : undefined;
      while (cursor) {
        if (cursor.nodeType === "notebook" || cursor.nodeType === "group") keep.add(cursor.id);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
    }
    return { rows: rows.filter((row) => keep.has(row.id)), matchedIds };
  }
  return { rows, matchedIds };
}

/** 按父链展开状态算出真正可见的行（搜索态调用方传 matched-only 结果时无需再用）。 */
export function visibleMoveTreeRows(rows: readonly MoveTreeRow[]): MoveTreeRow[] {
  const visible: MoveTreeRow[] = [];
  const stack: MoveTreeRow[] = [];
  for (const row of rows) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= row.depth) stack.pop();
    if (stack.length === 0) {
      visible.push(row);
      stack.push(row);
      continue;
    }
    const parent = stack[stack.length - 1];
    if (parent.expanded) {
      visible.push(row);
      stack.push(row);
    }
  }
  return visible;
}
