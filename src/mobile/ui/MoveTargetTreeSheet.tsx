/**
 * 批量「移动到…」目录树弹窗（261106 task-89，用户点单：像思源那样的层级选择）。
 *
 * 语义：
 * · 只展示**容器**（笔记本/分组；回收站节点已由 listTreeNodes 过滤掉，文档不在树里）；
 * · 行左侧箭头展开/收起（44 命中）；行本身 = 选目标；选中后底部「移动到此处」才可用；
 * · **当前位置高亮**（currentParentId → 标注「当前位置」），并**默认展开当前路径**（祖先链 + 自身）；
 * · 防环：excludedIds（选中项自身及其后代）显示禁用态 + 原因「不能移动到自身内部」；
 * · 返回键/遮罩/滑动关闭统一由 MobileSheet 负责（关闭 = 取消，不改动任何数据）。
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { MobileSheet } from "./MobileSheet";

export interface MoveTargetNode {
  id: string;
  title: string;
  parentId: string | null;
  nodeType: string;
}

export interface MoveTargetTreeSheetProps {
  open: boolean;
  /** 仅容器节点（笔记本/分组）。 */
  nodes: readonly MoveTargetNode[];
  /** 当前所在位置（高亮 + 默认展开路径）；null = 根层/未知。 */
  currentParentId: string | null;
  /** 不允许作为目标（选中项自身及后代）。 */
  excludedIds?: readonly string[];
  busy?: boolean;
  error?: string | null;
  onConfirm(parentId: string): void;
  onClose(): void;
}

interface Row { node: MoveTargetNode; depth: number; hasChildren: boolean }

/** 祖先链（含自身），用于默认展开当前路径。 */
function ancestorsOf(id: string | null, byId: ReadonlyMap<string, MoveTargetNode>): Set<string> {
  const out = new Set<string>();
  let cur = id;
  for (let hops = 0; cur && hops < 64; hops += 1) {
    if (out.has(cur)) break;
    out.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

/**
 * 默认展开集合（261106 task-94）：
 * · **所有根笔记本一层**（父级为 null 的笔记本/分组若有子级）——否则用户只看到几行、以为"没展示全部"；
 * · 当前路径的祖先链（当前位置可见）。
 */
function defaultExpanded(childrenOf: ReadonlyMap<string | null, MoveTargetNode[]>, byId: ReadonlyMap<string, MoveTargetNode>, currentParentId: string | null): Set<string> {
  const out = ancestorsOf(currentParentId, byId);
  for (const root of childrenOf.get(null) ?? []) {
    if ((childrenOf.get(root.id) ?? []).length > 0) out.add(root.id);
  }
  return out;
}

export function MoveTargetTreeSheet({ open, nodes, currentParentId, excludedIds, busy, error, onConfirm, onClose }: MoveTargetTreeSheetProps) {
  const { childrenOf, byId } = useMemo(() => {
    const children = new Map<string | null, MoveTargetNode[]>();
    const map = new Map<string, MoveTargetNode>();
    for (const node of nodes) {
      map.set(node.id, node);
      const key = node.parentId;
      const list = children.get(key);
      if (list) list.push(node);
      else children.set(key, [node]);
    }
    return { childrenOf: children, byId: map };
  }, [nodes]);

  const excluded = useMemo(() => new Set(excludedIds ?? []), [excludedIds]);
  /** 默认展开：所有根笔记本一层 + 当前路径；打开时重置。 */
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(childrenOf, byId, currentParentId));
  const [picked, setPicked] = useState<string | null>(null);
  /** 搜索（261106 task-94）：按名称过滤，命中项的祖先自动展开。 */
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setExpanded(defaultExpanded(childrenOf, byId, currentParentId));
    setPicked(null);
    setQuery("");
  }, [open, currentParentId, byId, childrenOf]);

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const needle = query.trim().toLocaleLowerCase();
  /** 搜索命中的节点 + 其祖先（用于过滤与自动展开）。 */
  const searchState = useMemo(() => {
    if (!needle) return { matches: null as Set<string> | null, ancestors: new Set<string>() };
    const matches = new Set<string>();
    for (const node of nodes) {
      if ((node.title || "未命名").toLocaleLowerCase().includes(needle)) matches.add(node.id);
    }
    const ancestors = new Set<string>();
    for (const id of matches) for (const ancestor of ancestorsOf(id, byId)) ancestors.add(ancestor);
    return { matches, ancestors };
  }, [needle, nodes, byId]);
  /** 渲染时展开集合 = 用户展开 ∪ 搜索命中的祖先（搜索时保证命中可见）。 */
  const renderExpanded = useMemo(() => {
    if (!needle || !searchState.matches) return expanded;
    const out = new Set(expanded);
    for (const id of searchState.ancestors) out.add(id);
    return out;
  }, [needle, searchState, expanded]);
  const visibleBySearch = (node: MoveTargetNode): boolean => {
    if (!needle || !searchState.matches) return true;
    if (searchState.matches.has(node.id)) return true;
    // 祖先节点：其子树里有命中项才保留（否则过滤掉）。
    const stack = [node.id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const kid of childrenOf.get(cur) ?? []) {
        if (searchState.matches.has(kid.id)) return true;
        stack.push(kid.id);
      }
    }
    return false;
  };

  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of childrenOf.get(parentId) ?? []) {
      if (!visibleBySearch(node)) continue;
      const kids = childrenOf.get(node.id) ?? [];
      rows.push({ node, depth, hasChildren: kids.length > 0 });
      if (kids.length > 0 && renderExpanded.has(node.id)) walk(node.id, depth + 1);
    }
  };
  if (open) walk(null, 0);

  const pickedNode = picked ? byId.get(picked) ?? null : null;
  const canConfirm = !!pickedNode && !excluded.has(pickedNode.id) && !busy;

  return (
    <MobileSheet
      open={open}
      title="移动到…"
      onClose={() => { if (!busy) onClose(); }}
      bodyClassName="mb-sheet__body--form"
      footer={<div className="mb-sheet__foot">
        <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={onClose}>取消</button>
        <button
          type="button"
          className="mb-btn mb-btn--primary"
          disabled={!canConfirm}
          onClick={() => { if (canConfirm && picked) onConfirm(picked); }}
        >移动到此处</button>
      </div>}
    >
      {error && <div className="qn-tag-sheet__error" role="alert">{error}</div>}
      {/* 搜索框：数据源是全部未回收容器，靠搜索快速定位（命中自动展开祖先）。 */}
      <span className="mb-input qn-tag-sheet__input">
        <input
          value={query}
          aria-label="搜索笔记本"
          placeholder="搜索笔记本/分组…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </span>
      {nodes.length === 0 ? (
        <div className="mb-empty">还没有笔记本：先新建一个知识库</div>
      ) : rows.length === 0 ? (
        <div className="mb-empty">没有匹配的笔记本</div>
      ) : (
        /* 列表自身可滚动：不依赖外层 Sheet 内容被矮屏/键盘裁掉（高度与滚动都在这里）。 */
        <div className="mb-tree-list">
        <div className="mb-set-items">
          {rows.map(({ node, depth, hasChildren }) => {
            const isCurrent = currentParentId === node.id;
            const isExcluded = excluded.has(node.id);
            const isPicked = picked === node.id;
            return (
              <div
                key={node.id}
                className={"mb-set-item" + (isPicked ? " is-selected" : "")}
                style={{ paddingLeft: 16 + depth * 16 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="mb-iconbtn mb-iconbtn--compact"
                    aria-label={(expanded.has(node.id) ? "收起 " : "展开 ") + (node.title || "未命名")}
                    aria-expanded={expanded.has(node.id)}
                    onClick={() => toggle(node.id)}
                  >
                    {expanded.has(node.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                ) : (
                  <span className="mb-row__icon" aria-hidden="true"><FolderOpen size={16} /></span>
                )}
                <div className="mb-set-item__main">
                  <button
                    type="button"
                    className="mb-set-name mb-ellipsis"
                    aria-label={"移动到 " + (node.title || "未命名")}
                    aria-pressed={isPicked}
                    disabled={isExcluded || busy}
                    onClick={() => setPicked(isExcluded ? null : node.id)}
                  >
                    {node.title || "未命名"}
                  </button>
                  <div className="mb-set-item__desc">
                    {isExcluded ? "不能移动到自身内部" : isCurrent ? "当前位置" : node.nodeType === "notebook" ? "笔记本" : "分组"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}
    </MobileSheet>
  );
}
