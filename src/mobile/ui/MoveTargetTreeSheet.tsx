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
  /** 默认展开当前路径（祖先 + 自身）；打开时重置。 */
  const [expanded, setExpanded] = useState<Set<string>>(() => ancestorsOf(currentParentId, byId));
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setExpanded(ancestorsOf(currentParentId, byId));
    setPicked(null);
  }, [open, currentParentId, byId]);

  const toggle = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of childrenOf.get(parentId) ?? []) {
      const kids = childrenOf.get(node.id) ?? [];
      rows.push({ node, depth, hasChildren: kids.length > 0 });
      if (kids.length > 0 && expanded.has(node.id)) walk(node.id, depth + 1);
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
      {nodes.length === 0 ? (
        <div className="mb-empty">还没有笔记本：先新建一个知识库</div>
      ) : (
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
                    className="mb-set-name"
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
      )}
    </MobileSheet>
  );
}
