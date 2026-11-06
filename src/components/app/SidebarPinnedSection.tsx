/**
 * 桌面目录「置顶」区（261107 用户点单）——顶部独立分组 + 分隔线：
 *
 * · 数据只来自设备本地（features/sidebar/pinnedTree），**不写库、不进 S3、不改原目录**；
 * · 每个置顶项 = 原目录节点的一个**入口**；分组/笔记本/含子文档的父节点连同子级一起显示（只读递归）。
 * · 置顶区内部可拖拽重排（只排顶层置顶项；子级顺序沿用原目录）。
 * · 分组可整段折叠；默认展开。
 */
import { useMemo, useState } from "react";
import { ChevronRight, Lock, Pin } from "lucide-react";
import { buildTreeIndex } from "../../core/treeIndex";
import type { TreeNode } from "../../lib/types";
import { nodeIcon } from "./treeIcons";
import { reorderPinnedTreeIds } from "../../features/sidebar/pinnedTree";
import "./sidebarPinned.css";

interface SidebarPinnedSectionProps {
  nodes: TreeNode[];
  pinnedIds: readonly string[];
  activeId: string | null;
  lockedNoteIds: ReadonlySet<string>;
  open: boolean;
  onToggleOpen(): void;
  onSelect(id: string): void;
  onContextMenu(event: React.MouseEvent, node: TreeNode): void;
  onReorder(nextIds: string[]): void;
}

export function SidebarPinnedSection(props: SidebarPinnedSectionProps) {
  const { nodes, pinnedIds, activeId, lockedNoteIds, open, onToggleOpen, onSelect, onContextMenu, onReorder } = props;
  const index = useMemo(() => buildTreeIndex(nodes, ""), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  /** 置顶根集合：子级渲染时遇到"自己也被单独置顶"的节点要跳过，避免重复出现。 */
  const rootSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const roots = useMemo(
    // 笔记本不可置顶（用户 261107）：组件层再兜一道，防止外部直接传错。
    () => pinnedIds.map((id) => nodeById.get(id)).filter((node): node is TreeNode => !!node && node.nodeType !== "notebook"),
    [pinnedIds, nodeById],
  );
  /** 收起集合（默认全展开；置顶按"连同子级"语义展示）。 */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);

  if (roots.length === 0) return null;
  const toggleCollapsed = (id: string): void => setCollapsed((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const renderRow = (node: TreeNode, isRoot: boolean): React.ReactNode => {
    const children = (index.childrenByParent.get(node.id) ?? []).filter((child) => !rootSet.has(child.id));
    const expandable = children.length > 0 || node.nodeType !== "note";
    const expanded = !collapsed.has(node.id);
    const locked = Boolean(node.nodeType === "note" && node.noteFileId && lockedNoteIds.has(node.noteFileId));
    const active = node.nodeType === "note" && node.id === activeId;
    const dropClass = dropTarget?.id === node.id ? (dropTarget.position === "before" ? "is-drop-before" : "is-drop-after") : "";
    return (
      <div className="tree-item" key={node.id}>
        <div
          role="treeitem"
          tabIndex={0}
          aria-selected={active || undefined}
          data-pinned-node-id={node.id}
          className={"note-row tree-row pinned-row type-" + node.nodeType + (active ? " active" : "") + (dragId === node.id ? " is-dragging" : "") + (dropClass ? " " + dropClass : "")}
          draggable={isRoot}
          title="拖拽可调整置顶顺序"
          onClick={() => { if (node.nodeType === "note") onSelect(node.id); else if (expandable) toggleCollapsed(node.id); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (node.nodeType === "note") onSelect(node.id);
            else if (expandable) toggleCollapsed(node.id);
          }}
          onContextMenu={(event) => onContextMenu(event, node)}
          onDragStart={(event) => {
            if (!isRoot) return;
            setDragId(node.id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", node.id);
          }}
          onDragOver={(event) => {
            if (!isRoot || !dragId || dragId === node.id) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
            setDropTarget((current) => (current?.id === node.id && current.position === position ? current : { id: node.id, position }));
          }}
          onDrop={(event) => {
            if (!isRoot || !dragId || dragId === node.id) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
            onReorder(reorderPinnedTreeIds(pinnedIds, dragId, node.id, position));
            setDragId(null);
            setDropTarget(null);
          }}
          onDragEnd={() => { setDragId(null); setDropTarget(null); }}
        >
          <button
            type="button"
            className={"tree-chevron" + (expanded && expandable ? " open" : "")}
            disabled={!expandable}
            onClick={(event) => { event.stopPropagation(); if (expandable) toggleCollapsed(node.id); }}
            aria-label={expanded ? "收起" : "展开"}
          >{expandable ? <ChevronRight size={14} /> : null}</button>
          <span className="tree-row-icon">{nodeIcon(node.nodeType, expanded, node.icon, node.kind ?? "doc")}</span>
          <span className="note-row-copy"><strong>{node.title}</strong></span>
          {locked ? <span className="tree-row-lock" title="已锁定（只读）" aria-label="已锁定"><Lock size={12} /></span> : <span className="tree-row-lock" aria-hidden="true" />}
          <span className="tree-row-actions" aria-hidden="true" />
        </div>
        {expandable && expanded && children.length > 0 && (
          <div className="tree-children">
            {children.map((child) => renderRow(child, false))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar-pinned">
      <div
        className="sidebar-pinned__header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggleOpen}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onToggleOpen(); } }}
      >
        <span className={"tree-chevron" + (open ? " open" : "")} aria-hidden="true"><ChevronRight size={14} /></span>
        {/* 与标签页「钉住」同一个图标（用户 261107 定稿）。 */}
        <Pin size={16} aria-hidden="true" />
        <strong>置顶</strong>
        <span className="sidebar-pinned__count" aria-hidden="true">{roots.length}</span>
      </div>
      {open && <div className="sidebar-pinned__body">{roots.map((node) => renderRow(node, true))}</div>}
      <div className="sidebar-pinned__divider" aria-hidden="true" />
    </div>
  );
}
