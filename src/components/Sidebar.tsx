import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronRight, ClipboardCopy, FilePlus2, FileText, FoldVertical, Folder, FolderPlus, History, Link2, LocateFixed, Package, Pencil, Plus, Search, SmilePlus, Trash2, X } from "lucide-react";
import { LAKE_EMOJIS } from "../lib/lakeEmojis";
import { LAKE_EMOJI_GROUPS } from "../lib/lakeEmojiGroups";
import type { TreeNode, TreeNodeType } from "../lib/types";

type CreateKind = "notebook" | "group" | "note";
type DropPosition = "before" | "inside" | "after";
export type SidebarMode = "docked" | "floating" | "collapsed";

interface SidebarProps {
  nodes: TreeNode[];
  activeId: string | null;
  search: string;
  mobileOpen: boolean;
  mode: SidebarMode;
  width: number;
  minWidth: number;
  maxWidth: number;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: (kind: CreateKind, parentId: string | null, title?: string) => void;
  onRename: (id: string, title: string) => void;
  onMoveNode: (id: string, targetId: string, position: DropPosition) => void;
  onRequestDelete: (node: TreeNode) => void;
  onCopyMarkdown: (node: TreeNode) => void;
  onExportAs: (node: TreeNode, format: "markdown" | "html" | "lake") => void;
  onCopyPaths: (node: TreeNode) => void;
  onSetIcon: (node: TreeNode, icon: string | null) => void;
  onOpenHistory: (node: TreeNode) => void;
  onOpenSearch: (query?: string) => void;
  pendingRenameId: string | null;
  onPendingRenameConsumed: () => void;
  onPreviewEnter: () => void;
  onPreviewLeave: () => void;
  onResizeActiveChange: (active: boolean) => void;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onCloseMobile: () => void;
}

export function Sidebar(props: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextId, setContextId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ kind: CreateKind; parentId: string | null } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => autoExpanded(props.nodes));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [iconPicker, setIconPicker] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; currentWidth: number } | null>(null);
  const suppressClickRef = useRef(false);
  const prevNodeIds = useRef<Set<string>>(new Set());
  const query = props.search.trim().toLocaleLowerCase();
  const roots = childrenOf(props.nodes, null, query);

  const rubberBandWidth = (width: number) => {
    if (width < props.minWidth) return props.minWidth - (props.minWidth - width) * 0.16;
    if (width > props.maxWidth) return props.maxWidth + (width - props.maxWidth) * 0.16;
    return width;
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: props.width, currentWidth: props.width };
    props.onResizeActiveChange(true);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const next = rubberBandWidth(resize.startWidth + event.clientX - resize.startX);
    resize.currentWidth = next;
    props.onWidthChange(next);
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    props.onResizeActiveChange(false);
    props.onWidthCommit(resize.currentWidth);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next = props.width;
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "ArrowLeft") next -= step;
    else if (event.key === "ArrowRight") next += step;
    else if (event.key === "Home") next = props.minWidth;
    else if (event.key === "End") next = props.maxWidth;
    else return;
    event.preventDefault();
    props.onWidthCommit(next);
  };

  useEffect(() => {
    // 只自动展开新出现的容器节点（笔记本/分组），不碰已有节点的展开状态
    const prevIds = prevNodeIds.current;
    const newContainerIds = props.nodes
      .filter((n) => n.nodeType !== "note" && !prevIds.has(n.id))
      .map((n) => n.id);
    if (newContainerIds.length > 0) {
      setExpanded((current) => {
      const next = new Set(current);
        newContainerIds.forEach((id) => next.add(id));
      return next;
    });
    }
    prevNodeIds.current = new Set(props.nodes.map((n) => n.id));
}, [props.nodes]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
      if (!(event.target as HTMLElement).closest("[data-context-menu]")) setContextMenu(null);
    };
    const closeContextMenu = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-context-menu]")) setContextMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("contextmenu", closeContextMenu);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("contextmenu", closeContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  useEffect(() => {
    if (!props.pendingRenameId) return;
    const target = props.nodes.find((node) => node.id === props.pendingRenameId);
    if (!target) return;
    setEditingId(target.id);
    setEditingTitle(target.title);
    props.onPendingRenameConsumed();
  }, [props.pendingRenameId, props.nodes, props.onPendingRenameConsumed]);

  useEffect(() => {
    if (!draggingId) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) drag.moved = true;
      if (!drag.moved) return;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-tree-node-id]");
      if (!row || row.dataset.treeNodeId === drag.id) { setDropTarget(null); return; }
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      const position: DropPosition = ratio < .25 ? "before" : ratio > .75 ? "after" : "inside";
      setDropTarget({ id: row.dataset.treeNodeId!, position });
    };
    const up = () => {
      const drag = dragRef.current;
      if (drag?.moved && dropTarget) {
        suppressClickRef.current = true;
        props.onMoveNode(drag.id, dropTarget.id, dropTarget.position);
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
      dragRef.current = null;
      setDraggingId(null);
      setDropTarget(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [draggingId, dropTarget, props]);

  // 创建/上下文定位：直接用当前选中/右键的节点作为父节点（支持多层嵌套，
  // 文档也可作为父节点）；无选中时回退到第一个笔记本。
  const context = props.nodes.find((node) => node.id === contextId)
    ?? props.nodes.find((node) => node.id === props.activeId)
    ?? props.nodes.find((node) => node.nodeType === "notebook")
    ?? null;
  const groupParent = context?.id ?? props.nodes.find((node) => node.nodeType === "notebook")?.id ?? null;
  const noteParent = context?.id ?? props.nodes.find((node) => node.nodeType === "notebook")?.id ?? null;

  const create = (kind: CreateKind) => {
    setMenuOpen(false);
    const parentId = kind === "notebook" ? null : kind === "group" ? groupParent : noteParent;
    if (kind === "note") {
      props.onCreate(kind, parentId);
      if (parentId) setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    } else {
      setPendingCreate({ kind, parentId });
      setNewTitle(kind === "notebook" ? "新建笔记本" : "新建分组");
      if (parentId) setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    }
  };
  const submitCreate = () => {
    const title = newTitle.trim();
    if (!pendingCreate || !title) return;
    props.onCreate(pendingCreate.kind, pendingCreate.parentId, title);
    setPendingCreate(null);
    setNewTitle("");
  };

  const submitRename = () => {
    const title = editingTitle.trim();
    if (editingId && title) props.onRename(editingId, title);
    setEditingId(null);
    setEditingTitle("");
  };

  const beginRename = (node: TreeNode) => {
    setEditingId(node.id);
    setEditingTitle(node.title);
  };

  // 右键菜单：contextmenu 事件在桌面=右键、移动端=长按自动触发，无需手写长按定时器。
  const openContext = (event: React.MouseEvent, node: TreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setContextId(node.id);
    setContextMenu({ id: node.id, x: event.clientX, y: event.clientY });
  };

  const contextNode = props.nodes.find((node) => node.id === contextMenu?.id) ?? null;

  /** M1.5：定位到当前打开的文档：展开祖先 + 高亮 + 滚动到可见 */
  const locateActive = () => {
    const id = props.activeId;
    if (!id) return;
    setExpanded((current) => expandAncestors(current, props.nodes, id));
    // 展开是异步渲染，滚动等下一帧
    window.setTimeout(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(`[data-tree-node-id="${CSS.escape(id)}"]`);
      row?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 60);
  };

  const menuNewChild = (kind: "group" | "note") => {
    if (!contextNode) return;
    // 支持多层嵌套：在目标节点下直接创建（文档也可包含分组/文档）。
    const parentId = contextNode.id;
    if (kind === "note") { props.onCreate("note", parentId); setExpanded((current) => expandAncestors(current, props.nodes, parentId)); setContextMenu(null); return; }
    setPendingCreate({ kind, parentId });
    setNewTitle("新建分组");
    setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    setContextMenu(null);
  };

  const menuRename = () => {
    if (!contextNode) return;
    beginRename(contextNode);
    setContextMenu(null);
  };

  const menuDelete = () => {
    if (!contextNode) return;
    props.onRequestDelete(contextNode);
    setContextMenu(null);
  };

  // depth 不再用于定位：缩进由 .tree-children margin-left + border-left 实现
  const createField = (_depth: number) => pendingCreate && <div className="inline-create" style={{ marginLeft: 8 }}>
    {pendingCreate.kind === "notebook" ? <BookOpen size={14} /> : <FolderPlus size={14} />}
    <input autoFocus aria-label={pendingCreate.kind === "notebook" ? "笔记本名称" : "分组名称"} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { if (event.key === "Enter") submitCreate(); if (event.key === "Escape") setPendingCreate(null); }} />
    <button onClick={submitCreate}>创建</button>
  </div>;

  return (
    <aside className={`sidebar sidebar-${props.mode} ${props.mobileOpen ? "sidebar-open" : ""}`} onPointerEnter={props.onPreviewEnter} onPointerLeave={props.onPreviewLeave}>
      <button className="icon-button mobile-only sidebar-mobile-close" onClick={props.onCloseMobile} title="关闭"><X size={18} /></button>
      <header className="sidebar-header desktop-only">
        <div className="sidebar-heading-copy"><strong>资料库</strong></div>
      </header>
      <div className="search-box"><Search size={14} /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索" /></div>
      <div className="list-heading">
        <button className="icon-button collapse-all-btn" onClick={() => setExpanded(new Set())} title="全部收起" disabled={expanded.size === 0}><FoldVertical size={16} /></button>
        <button className="icon-button locate-btn" onClick={locateActive} title="定位到当前文档" disabled={!props.activeId} aria-label="定位到当前文档"><LocateFixed size={16} /></button>
        <button className="icon-button fulltext-btn" onClick={() => props.onOpenSearch(props.search)} title="全文搜索（⇧⌘F）" aria-label="全文搜索"><Search size={16} /></button>
        <div className="create-menu-wrap" ref={menuRef}>
          <button className={`icon-button create-btn ${menuOpen ? "selected" : ""}`} onClick={() => setMenuOpen((open) => !open)} title="新建"><Plus size={18} /></button>
          {menuOpen && <div className="create-menu">
            <button onClick={() => create("note")} disabled={!noteParent}><FilePlus2 size={16} /><span><strong>新建文档</strong><small>{context ? `在“${context.title}”下` : "选择笔记本后创建"}</small></span></button>
            <button onClick={() => create("group")} disabled={!groupParent}><FolderPlus size={16} /><span><strong>新建分组</strong><small>{context ? `在“${context.title}”下` : "请先新建笔记本"}</small></span></button>
            <button onClick={() => create("notebook")}><BookOpen size={16} /><span><strong>新建笔记本</strong><small>创建顶层笔记本</small></span></button>
          </div>}
        </div>
      </div>
      <nav className="note-list tree-list" ref={treeRef}>
        {pendingCreate?.kind === "notebook" && createField(0)}
        {roots.map((node) => <TreeRow key={node.id} node={node} depth={0} nodes={props.nodes} query={query} activeId={props.activeId} contextId={context?.id ?? null} expanded={expanded} draggingId={draggingId} dropTarget={dropTarget} pendingCreate={pendingCreate} editingId={editingId} editingTitle={editingTitle} createField={createField} onEditingTitle={setEditingTitle} onSubmitRename={submitRename} onCancelRename={() => setEditingId(null)} onBeginRename={beginRename} onPointerDown={(event, id) => { if (event.button !== 0 || (event.target as HTMLElement).closest("input")) return; dragRef.current = { id, startX: event.clientX, startY: event.clientY, moved: false }; setDraggingId(id); }} consumeSuppressedClick={() => suppressClickRef.current} onContext={setContextId} onContextMenu={openContext} onToggle={(id) => setExpanded((current) => toggleSet(current, id))} onSelect={props.onSelect} onIconClick={(node, event) => setIconPicker({ node, x: event.clientX, y: event.clientY })} />)}
        {roots.length === 0 && <div className="empty-list">点击 + 新建第一个笔记本</div>}
      </nav>
      {contextMenu && contextNode && <ContextMenu node={contextNode} x={contextMenu.x} y={contextMenu.y} onNewChild={menuNewChild} onRename={menuRename} onDelete={menuDelete} onCopyMarkdown={() => props.onCopyMarkdown(contextNode)} onExportAs={(format) => props.onExportAs(contextNode, format)} onCopyPaths={() => props.onCopyPaths(contextNode)} onSetIconRequest={() => setIconPicker({ node: contextNode, x: contextMenu!.x, y: contextMenu!.y })} onOpenHistory={() => props.onOpenHistory(contextNode)} onClose={() => setContextMenu(null)} />}
      {iconPicker && <EmojiIconPicker x={iconPicker.x} y={iconPicker.y} onPick={(icon) => { props.onSetIcon(iconPicker.node, icon); setIconPicker(null); }} onClose={() => setIconPicker(null)} />}
      <div className="sidebar-resize-handle desktop-only" role="separator" aria-label="调整资料库宽度" aria-orientation="vertical" aria-valuemin={props.minWidth} aria-valuemax={props.maxWidth} aria-valuenow={Math.round(props.width)} tabIndex={0} onPointerDown={handleResizePointerDown} onPointerMove={handleResizePointerMove} onPointerUp={finishResize} onPointerCancel={finishResize} onKeyDown={handleResizeKeyDown} />
    </aside>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  nodes: TreeNode[];
  query: string;
  activeId: string | null;
  contextId: string | null;
  expanded: Set<string>;
  draggingId: string | null;
  dropTarget: { id: string; position: DropPosition } | null;
  pendingCreate: { kind: CreateKind; parentId: string | null } | null;
  editingId: string | null;
  editingTitle: string;
  createField: (depth: number) => React.ReactNode;
  onEditingTitle: (title: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onBeginRename: (node: TreeNode) => void;
  onPointerDown: (event: React.PointerEvent, id: string) => void;
  consumeSuppressedClick: () => boolean;
  onContext: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode) => void;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onIconClick?: (node: TreeNode, event: React.MouseEvent) => void;
}

function TreeRow(props: TreeRowProps) {
  const children = childrenOf(props.nodes, props.node.id, props.query);
  const expandable = children.length > 0 || props.node.nodeType !== "note";
  const open = props.expanded.has(props.node.id) || Boolean(props.query);
  const icon = nodeIcon(props.node.nodeType, open, props.node.icon);

  const dropPosition = props.dropTarget?.id === props.node.id ? props.dropTarget.position : null;

  return <div className="tree-item">
    <div
      role="treeitem"
      tabIndex={0}
      data-tree-node-id={props.node.id}
      className={`note-row tree-row type-${props.node.nodeType} ${props.node.id === props.activeId ? "active" : ""} ${props.node.id === props.contextId ? "context" : ""} ${props.draggingId === props.node.id ? "dragging" : ""} ${dropPosition ? `drop-${dropPosition}` : ""}`}
      style={{ paddingLeft: 8 }}
      onClick={() => {
        if (props.consumeSuppressedClick()) return;
        props.onContext(props.node.id);
        if (props.node.nodeType === "note") props.onSelect(props.node.id);
        else props.onToggle(props.node.id);
      }}
      onKeyDown={(event) => { if (event.key === "Enter") props.node.nodeType === "note" ? props.onSelect(props.node.id) : props.onToggle(props.node.id); }}
      onPointerDown={(event) => props.onPointerDown(event, props.node.id)}
      onContextMenu={(event) => props.onContextMenu(event, props.node)}
    >
      <button type="button" className={`tree-chevron ${open && expandable ? "open" : ""}`} disabled={!expandable} onClick={(event) => { event.stopPropagation(); if (expandable) props.onToggle(props.node.id); }} aria-label={open ? "收起" : "展开"}>{expandable ? <ChevronRight size={14} /> : null}</button>
      <span className="tree-row-icon" title="设置图标" onClick={(event) => { event.stopPropagation(); props.onIconClick?.(props.node, event); }}>{icon}</span>
      <span className="note-row-copy">
        {props.editingId === props.node.id
          ? <input className="tree-rename-input" autoFocus aria-label="节点名称" value={props.editingTitle} onChange={(event) => props.onEditingTitle(event.target.value)} onClick={(event) => event.stopPropagation()} onFocus={(event) => event.currentTarget.select()} onBlur={props.onSubmitRename} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") props.onSubmitRename(); if (event.key === "Escape") props.onCancelRename(); }} />
          : <strong>{props.node.title}</strong>}
      </span>
      {props.node.nodeType === "note" ? <span className={`sync-dot ${props.node.syncState}`} /> : null}
    </div>
    {open && <div className="tree-children">
      {props.pendingCreate?.parentId === props.node.id && props.createField(props.depth + 1)}
      {children.map((child) => <TreeRow key={child.id} {...props} node={child} depth={props.depth + 1} />)}
    </div>}
  </div>;
}

function nodeIcon(type: TreeNodeType, open: boolean, customIcon?: string | null) {
  if (customIcon) return <span className="tree-node-custom-icon">{customIcon}</span>;
  if (type === "notebook") return <BookOpen size={17} />;
  if (type === "group") return <Folder size={16} fill={open ? "currentColor" : "none"} />;
  return <FileText size={16} />;
}

function childrenOf(nodes: TreeNode[], parentId: string | null, query: string): TreeNode[] {
  return nodes.filter((node) => node.parentId === parentId).filter((node) => matches(node, nodes, query)).sort((a, b) => a.sortOrder - b.sortOrder);
}

function matches(node: TreeNode, nodes: TreeNode[], query: string): boolean {
  if (!query || node.title.toLocaleLowerCase().includes(query)) return true;
  return nodes.some((child) => child.parentId === node.id && matches(child, nodes, query));
}

function toggleSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}

// 展开目标节点及其全部祖先，确保新创建的子节点可见
function expandAncestors(current: Set<string>, nodes: TreeNode[], targetId: string): Set<string> {
  const next = new Set(current);
  let cursor = nodes.find((n) => n.id === targetId);
  while (cursor) {
    next.add(cursor.id);
    cursor = cursor.parentId ? nodes.find((n) => n.id === cursor!.parentId) : undefined;
  }
  return next;
}

function autoExpanded(nodes: TreeNode[]): Set<string> {
  // 默认展开笔记本和有子项的分组/文档，首帧即正确，避免 effect 回填闪烁。
  const next = new Set<string>();
  nodes.forEach((node) => {
    if (node.nodeType !== "note" || nodes.some((child) => child.parentId === node.id)) next.add(node.id);
  });
  return next;
}

interface ContextMenuProps {
  node: TreeNode;
  x: number;
  y: number;
  onNewChild: (kind: "group" | "note") => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyMarkdown: () => void;
  onExportAs: (format: "markdown" | "html" | "lake") => void;
  onCopyPaths: () => void;
  onSetIconRequest: () => void;
  onOpenHistory: () => void;
  onClose: () => void;
}

const ContextMenu = ({ node, x, y, onNewChild, onRename, onDelete, onCopyMarkdown, onExportAs, onCopyPaths, onSetIconRequest, onOpenHistory, onClose }: ContextMenuProps) => {
  const [exportOpen, setExportOpen] = useState(false);
  const isNotebook = node.nodeType === "notebook";
  // 视口边缘翻转，避免菜单溢出屏幕
  const left = Math.min(x, window.innerWidth - 232);
  const top = Math.min(y, window.innerHeight - 220);
  // 一级菜单靠右时二级子菜单往左弹，避免溢出屏幕右侧
  const submenuLeft = left + 232 + 230 <= window.innerWidth;
  // Portal 到 body：侧边栏带 transform（含 translateX(0)）时，position: fixed 会退化为
  // 相对侧边栏定位，导致菜单偏离光标右下；挂到 body 后恢复真正的视口固定定位。
  return createPortal(
    <div className="context-menu" style={{ left, top }} role="menu" data-context-menu>
      <button role="menuitem" onClick={() => { onNewChild("note"); onClose(); }}><FilePlus2 size={15} /><span>新建文档</span></button>
      {!isNotebook && <button role="menuitem" onClick={() => { onNewChild("group"); onClose(); }}><FolderPlus size={15} /><span>新建分组</span></button>}
      <button role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={15} /><span>重命名</span></button>
      {node.nodeType !== "notebook" && <button role="menuitem" onClick={() => { onSetIconRequest(); onClose(); }}><SmilePlus size={15} /><span>设置图标</span></button>}
      {node.nodeType === "note" && (
        <>
          <button role="menuitem" onClick={() => { onOpenHistory(); onClose(); }}><History size={15} /><span>历史版本</span></button>
          <div className="context-menu-sep" />
          <div className="context-menu-item has-submenu" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
            <span className="context-menu-item-label"><Package size={15} /><span>导出</span></span><ChevronRight size={14} />
            {exportOpen && (
              <div className={`context-menu-submenu${submenuLeft ? "" : " open-left"}`} role="menu">
                <button role="menuitem" onClick={() => { onExportAs("markdown"); onClose(); }}>导出为 Markdown 资料包</button>
                <button role="menuitem" onClick={() => { onCopyMarkdown(); onClose(); }}>导出为 Markdown 文本（复制）</button>
                <button role="menuitem" onClick={() => { onExportAs("html"); onClose(); }}>导出为 HTML</button>
                <button role="menuitem" disabled title="开发中">导出为 Word（开发中）</button>
                <button role="menuitem" disabled title="开发中">导出为 PDF（开发中）</button>
                <div className="context-menu-sep" />
                <button role="menuitem" onClick={() => { onExportAs("lake"); onClose(); }}>导出为原生 Lake（图片内嵌）</button>
                <button role="menuitem" onClick={() => { onCopyPaths(); onClose(); }}>导出资料路径（本机 AI）</button>
              </div>
            )}
          </div>
        </>
      )}
      <div className="context-menu-sep" />
      <button role="menuitem" className="danger" onClick={() => { onDelete(); onClose(); }}><Trash2 size={15} /><span>删除</span></button>
    </div>,
    document.body
  );
};

interface ConfirmDeleteProps {
  node: TreeNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDelete = ({ node, onConfirm, onCancel }: ConfirmDeleteProps) => (
  <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
    <section className="confirm-dialog" role="dialog" aria-modal="true">
      <h3>删除“{node.title}”？</h3>
      <p>将删除该节点及其所有子项，移入本地回收站（可在回收站中恢复或彻底删除）。</p>
      <footer>
        <button className="secondary-button" onClick={onCancel}>取消</button>
        <button className="primary-button danger-button" onClick={onConfirm}>删除</button>
      </footer>
    </section>
  </div>
);

/** M1.6：文档/分组自定义图标选择器（Lake unicodeEmoji 表情资源 + 分组 + 搜索 + 清除） */
export const EmojiIconPicker = ({ x, y, onPick, onClose }: { x: number; y: number; onPick: (icon: string | null) => void; onClose: () => void }) => {
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState("全部");
  const q = filter.trim().toLowerCase();
  const groupNames = ["全部", ...LAKE_EMOJI_GROUPS.map((g) => g.name)];
  const list: Array<{ char: string; name?: string }> = q
    ? LAKE_EMOJIS.filter((e) => e.name.toLowerCase().includes(q) || e.char === filter.trim()).map((e) => ({ char: e.char, name: e.name }))
    : group === "全部"
      ? LAKE_EMOJIS.map((e) => ({ char: e.char, name: e.name }))
      : (LAKE_EMOJI_GROUPS.find((g) => g.name === group)?.emojis ?? []).map((char) => ({ char }));
  const left = Math.max(8, Math.min(x, window.innerWidth - 558));
  const top = Math.max(8, Math.min(y, window.innerHeight - 378));
  return createPortal(
    <div className="emoji-picker-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="emoji-picker" style={{ left, top }} data-context-menu>
        <div className="emoji-picker-search">
          <Search size={13} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索表情（如 smile / 名称）" autoFocus />
        </div>
        <div className="emoji-picker-tabs">
          {groupNames.map((g) => (
            <button key={g} className={`emoji-picker-tab${g === group ? " active" : ""}`} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
        <div className="emoji-picker-grid">
          {list.map((e) => (
            <button key={(e.name ?? "") + e.char} className="emoji-picker-cell" onClick={() => onPick(e.char)} title={e.name ?? e.char}>{e.char}</button>
          ))}
          {list.length === 0 && <div className="emoji-picker-empty">无匹配表情</div>}
        </div>
        <button className="emoji-picker-clear" onClick={() => onPick(null)}>清除图标</button>
      </div>
    </div>,
    document.body
  );
};
