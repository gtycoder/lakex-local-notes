import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Book, ChevronRight, ChevronsDownUp, Copy, FilePlus, File, Filter, Focus, Folder, FolderOpen, FolderPlus, History, Info, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash, X } from "lucide-react";
import { DockFilterRow, useDockFilter } from "./DockFilterBar";
import { LAKE_EMOJIS } from "../lib/lakeEmojis";
import { LAKE_EMOJI_GROUPS } from "../lib/lakeEmojiGroups";
import type { TreeNode, TreeNodeType } from "../lib/types";
import { buildTreeIndex, type TreeIndex } from "../core/treeIndex";
import { computeDropPosition, createDragGhost, isValidTreeDrop, moveDragGhost, removeDragGhost, type DragGhost } from "./treeDrag";
import { Table } from "lucide-react";
import { getCreateMenuPosition, type CreateMenuPosition } from "./createMenuPosition";
import { ExportSubmenuItem } from "./ExportSubmenuItem";
import { SIDEBAR_DEFAULT_WIDTH } from "../desktop/desktopTypes";

type CreateKind = "notebook" | "group" | "note" | "sheet";
type DropPosition = "before" | "inside" | "after";
export type SidebarMode = "docked" | "floating" | "collapsed";

/** 定位时的上下余量：不把选中行正好贴在可视边界上 —— 目录栏一"变矮"（停靠↔浮动）就会立刻又掉出去。 */
const REVEAL_SLACK = 16;

interface SidebarProps {
  nodes: TreeNode[];
  activeId: string | null;
  search: string;
  mode: SidebarMode;
  width: number;
  minWidth: number;
  maxWidth: number;
  onSearch: (value: string) => void;
  /** 刷新目录树（从库里重读整棵树）：外部命令改动过库后，UI 目录可能滞后。 */
  onRefreshTree: () => void | Promise<void>;
  onSelect: (id: string) => void;
  onCreate: (kind: CreateKind, parentId: string | null, title?: string) => void;
  onRename: (id: string, title: string) => void;
  onMoveNode: (id: string, targetId: string, position: DropPosition) => void;
  onRequestDelete: (node: TreeNode) => void;
  onCopyMarkdown: (node: TreeNode) => void;
  onExportAs: (node: TreeNode, format: "markdown" | "html" | "lake" | "pdf") => void;
  onCopyPaths: (node: TreeNode) => void;
  onSetIcon: (node: TreeNode, icon: string | null) => void;
  /** 复制文档（含附件） */
  onDuplicate: (node: TreeNode) => void;
  /** 文档属性弹窗 */
  onShowInfo: (node: TreeNode) => void;
  /** 历史版本面板 */
  onOpenHistory: (node: TreeNode) => void;
  /** 在文件管理器中显示笔记 .lake */
  onRevealNoteFile: (node: TreeNode) => void;
  /** 属性面板父级路径跳转：展开到该节点并滚动可见 */
  revealNodeId: string | null;
  onRevealConsumed: () => void;
  pendingRenameId: string | null;
  onPendingRenameConsumed: () => void;
  onPreviewEnter: () => void;
  onPreviewLeave: () => void;
  onResizeActiveChange: (active: boolean) => void;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextId, setContextId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ kind: CreateKind; parentId: string | null } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => autoExpanded(props.nodes));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);
  const [releaseState, setReleaseState] = useState<{
    id: string;
    target: { id: string; position: DropPosition };
    expectedParentId: string | null;
    expectedOrder: string[];
    positions: Record<string, number>;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [iconPicker, setIconPicker] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const [createMenuPosition, setCreateMenuPosition] = useState<CreateMenuPosition | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const ghostRef = useRef<DragGhost | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const dropTargetRef = useRef<{ id: string; position: DropPosition } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; currentWidth: number } | null>(null);
  const suppressClickRef = useRef(false);
  const prevNodeIds = useRef<Set<string>>(new Set());
  const query = props.search.trim().toLocaleLowerCase();
  // 目录筛选：图标按需展开输入框（交互与大纲筛选共用 dockFilterModel 状态机）
  const filter = useDockFilter(props.search, props.onSearch);
  const treeIndex = useMemo(() => buildTreeIndex(props.nodes, query), [props.nodes, query]);
  const roots = (treeIndex.childrenByParent.get(null) ?? []).filter((node) => treeIndex.visibleIds.has(node.id));

  /** 目录刷新（右上角刷新按钮）：重读整棵树，进行中把图标转起来并禁用，避免连点。 */
  const refreshTree = useCallback(async () => {
    setRefreshing(true);
    try { await props.onRefreshTree(); } finally { setRefreshing(false); }
  }, [props.onRefreshTree]);

  const updateCreateMenuPosition = useCallback(() => {
    const button = createButtonRef.current;
    const sidebar = button?.closest<HTMLElement>(".sidebar");
    if (!button || !sidebar) return;
    const buttonRect = button.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    setCreateMenuPosition(getCreateMenuPosition(buttonRect, sidebarRect, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setCreateMenuPosition(null);
      return;
    }
    updateCreateMenuPosition();
    const onViewportChange = () => updateCreateMenuPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [menuOpen, updateCreateMenuPosition]);

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
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !createMenuRef.current?.contains(target)) setMenuOpen(false);
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

  const buildExpectedOrder = (movingId: string, target: { id: string; position: DropPosition }): { parentId: string | null; order: string[] } | null => {
    const moving = props.nodes.find((node) => node.id === movingId);
    const targetNode = props.nodes.find((node) => node.id === target.id);
    if (!moving || !targetNode) return null;
    const parentId = target.position === "inside" ? targetNode.id : targetNode.parentId;
    const siblings = (treeIndex.childrenByParent.get(parentId) ?? []).map((node) => node.id).filter((id) => id !== movingId);
    if (target.position === "inside") return { parentId, order: [...siblings, movingId] };
    const targetIndex = siblings.indexOf(target.id);
    if (targetIndex < 0) return { parentId, order: [...siblings, movingId] };
    siblings.splice(target.position === "after" ? targetIndex + 1 : targetIndex, 0, movingId);
    return { parentId, order: siblings };
  };

  useEffect(() => {
    if (!draggingId || releaseState) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 5) return;
        drag.moved = true;
        const sourceEl = treeRef.current?.querySelector<HTMLElement>(`[data-tree-node-id="${CSS.escape(drag.id)}"]`);
        ghostRef.current = sourceEl ? createDragGhost(sourceEl, event.clientX, event.clientY) : null;
      }
      pointerRef.current = { x: event.clientX, y: event.clientY };
      moveDragGhost(ghostRef.current, event.clientX, event.clientY);
      // 被拖动项本身会随指针移动，elementFromPoint 可能持续命中它，
      // 尤其是向上越过兄弟项时会导致永远无法得到真实落点。先排除源行，
      // 再从当前可见行中选出指针所在/最近的一行。
      // 浮层 pointer-events:none，elementFromPoint 直接命中真实行；只有命中失败才回退到就近行，
      // 避免每次 pointermove 对全表做 getClientRects/getBoundingClientRect（实测 28ms/帧）。
      const hit = document.elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>("[data-tree-node-id]"))
        .find((candidate) => candidate && candidate.dataset.treeNodeId !== drag.id);
      let row = hit ?? null;
      if (!row) {
        let bestDist = Infinity;
        document.querySelectorAll<HTMLElement>("[data-tree-node-id]").forEach((candidate) => {
          if (candidate.dataset.treeNodeId === drag.id) return;
          const box = candidate.getBoundingClientRect();
          if (box.height <= 0) return;
          const distance = Math.abs(box.top + box.height / 2 - event.clientY);
          if (distance < bestDist) { bestDist = distance; row = candidate; }
        });
      }
      if (!row) {
        dropTargetRef.current = null;
        setDropTarget(null);
        return;
      }
      const rowNodeId = row.dataset.treeNodeId;
      const rect = row.getBoundingClientRect();
      let position = computeDropPosition(rect, event.clientY) ?? (dropTargetRef.current?.position ?? "inside");
      const movingNode = props.nodes.find((node) => node.id === drag.id) ?? null;
      const targetNode = props.nodes.find((node) => node.id === rowNodeId) ?? null;
      // 目标不支持 inside（如笔记本只能排序）→ 退化为上下半区 before/after，避免中段无落点（对齐思源根节点）
      if (position === "inside" && !isValidTreeDrop(movingNode, targetNode, "inside")) {
        position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      }
      const nextTarget = { id: rowNodeId!, position };
      if (!isValidTreeDrop(movingNode, targetNode, nextTarget.position)) {
        dropTargetRef.current = null;
        setDropTarget(null);
        return;
      }
      if (dropTargetRef.current?.id === nextTarget.id && dropTargetRef.current?.position === nextTarget.position) return;
      dropTargetRef.current = nextTarget;
      setDropTarget(nextTarget);
    };
    const up = () => {
      removeDragGhost(ghostRef.current);
      ghostRef.current = null;
      const drag = dragRef.current;
      const finalDropTarget = dropTargetRef.current;
      if (drag?.moved && finalDropTarget) {
        const expected = buildExpectedOrder(drag.id, finalDropTarget);
        if (expected) {
          const positions: Record<string, number> = {};
          document.querySelectorAll<HTMLElement>("[data-tree-node-id]").forEach((row) => {
            const id = row.dataset.treeNodeId;
            if (id) positions[id] = row.getBoundingClientRect().top;
          });
          setReleaseState({ id: drag.id, target: finalDropTarget, expectedParentId: expected.parentId, expectedOrder: expected.order, positions });
          if (finalDropTarget.position === "inside") {
            setExpanded((current) => {
              const next = new Set(current);
              next.add(finalDropTarget.id);
              return next;
            });
          }
          suppressClickRef.current = true;
          props.onMoveNode(drag.id, finalDropTarget.id, finalDropTarget.position);
          window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        }
      }
      if (!drag?.moved || !finalDropTarget) {
        setDraggingId(null);
      }
      dragRef.current = null;
      dropTargetRef.current = null;
      setDropTarget(null);
    };
    // 拖拽中边缘自动滚动（对齐思源 dragOverScroll）
    let scrollRaf = 0;
    const tick = () => {
      const scroller = treeRef.current;
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        const y = pointerRef.current.y;
        const edge = 44;
        if (y > 0 && y < box.top + edge) scroller.scrollTop -= 8;
        else if (y > box.bottom - edge) scroller.scrollTop += 8;
      }
      scrollRaf = window.requestAnimationFrame(tick);
    };
    scrollRaf = window.requestAnimationFrame(tick);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.cancelAnimationFrame(scrollRaf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [draggingId, releaseState, props.onMoveNode, props.nodes]);

  // 组件卸载时清掉可能残留的拖拽浮层
  useEffect(() => () => { removeDragGhost(ghostRef.current); ghostRef.current = null; }, []);

  // 创建/上下文定位：直接用当前选中/右键的节点作为父节点（支持多层嵌套，
  // 文档也可作为父节点）；无选中时回退到第一个笔记本。
  const context = props.nodes.find((node) => node.id === contextId)
    ?? props.nodes.find((node) => node.id === props.activeId)
    ?? props.nodes.find((node) => node.nodeType === "notebook")
    ?? null;
  const defaultNotebookId = props.nodes.find((node) => node.nodeType === "notebook")?.id ?? null;
  const groupParent = context?.id ?? defaultNotebookId;
  const noteParent = context?.id ?? defaultNotebookId;

  const create = (kind: CreateKind) => {
    setMenuOpen(false);
    const parentId = kind === "notebook" ? null : kind === "group" ? groupParent : noteParent;
    if (kind === "note" || kind === "sheet") {
      props.onCreate(kind, parentId);
      if (parentId) setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    } else {
      setPendingCreate({ kind, parentId });
      setNewTitle(kind === "notebook" ? "新建笔记本" : "新建分组");
      if (parentId) setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    }
  };
  const submitCreate = useCallback(() => {
    const title = newTitle.trim();
    if (!pendingCreate || !title) return;
    props.onCreate(pendingCreate.kind, pendingCreate.parentId, title);
    setPendingCreate(null);
    setNewTitle("");
  }, [newTitle, pendingCreate, props.onCreate]);

  const submitRename = useCallback(() => {
    const title = editingTitle.trim();
    if (editingId && title) props.onRename(editingId, title);
    setEditingId(null);
    setEditingTitle("");
  }, [editingId, editingTitle, props.onRename]);

  const beginRename = useCallback((node: TreeNode) => {
    setEditingId(node.id);
    setEditingTitle(node.title);
  }, []);

  // 右键菜单：contextmenu 事件在桌面=右键、移动端=长按自动触发，无需手写长按定时器。
  const openContext = useCallback((event: React.MouseEvent, node: TreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setContextId(node.id);
    setContextMenu({ id: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const contextNode = props.nodes.find((node) => node.id === contextMenu?.id) ?? null;

  /** 把某一行滚进目录栏自己的可见区（已在视口内则不滚，只定位）。
   *  **只动目录栏自己的滚动容器，不能用 `scrollIntoView`**：它会连带滚动所有可滚动祖先，
   *  而 `body` 虽 `overflow:hidden` 仍可被程序化滚动（`.sidebar` 的 `margin-top: 42px`
   *  让外壳多出 42px 溢出）⇒ 实测整个 `.app-shell` 被顶上去 42px、顶栏让位失效、
   *  面包屑挤进 tab 行（user 260917 报）。 */
  const scrollRowIntoView = useCallback((id: string): boolean => {
    const list = treeRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-tree-node-id="${CSS.escape(id)}"]`);
    if (!list || !row) return false;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    // 可见区 = 「列表矩形 ∩ 窗口」。停靠目录的底边落在窗口外（.sidebar 的 height:100% 没补偿
    // 自己 42px 的 margin-top ⇒ 底边溢出 42px），只按 listRect.bottom 判断会少滚 42px ——
    // 表现为「向上定位正常、向下定位永远差一截」（user 260917 报）。
    const visibleTop = Math.max(listRect.top, 0);
    const visibleBottom = Math.min(listRect.bottom, window.innerHeight);
    // 再留半行余量（不贴边）：停靠栏可视 ~767px，浮动栏 top/bottom 各 72px ⇒ 只有 ~699px，
    // 贴边的行切过去会立刻掉出可见区。余量封顶为可见区一半，避免抖动。
    const slack = Math.max(0, Math.min(REVEAL_SLACK, Math.floor((visibleBottom - visibleTop - rowRect.height) / 2)));
    if (rowRect.top < visibleTop + slack) list.scrollTop -= (visibleTop + slack) - rowRect.top;
    else if (rowRect.bottom > visibleBottom - slack) list.scrollTop += rowRect.bottom - (visibleBottom - slack);
    return true;
  }, []);

  /**
   * 展开（默认含自身）+ 滚动定位到某节点。
   *
   * 滚动**放在 useLayoutEffect 里**（提交 DOM 后、浏览器绘制前）由 `revealNonce` 驱动，
   * 不再用 `setTimeout(60)`：展开会重排上面的行，若「先绘制未滚动状态、再跳过去」，
   * 用户看到的就是闪一下/跳一下（user 260918 报）；同帧完成则中间态从不绘制，也没有固定延迟。
   *
   * `expandSelf: false` 用于「跟随当前文档」——只展开祖先让目标可见，**不展开文档自身的子项**
   * （user 260918：点文档不该自动展开子项；要展开用下拉箭头或「定位到当前文档」按钮）。
   */
  const pendingRevealRef = useRef<string | null>(null);
  const [revealNonce, setRevealNonce] = useState(0);
  const revealNode = useCallback((id: string | null, options?: { expandSelf?: boolean }) => {
    if (!id) return;
    pendingRevealRef.current = id;
    const expandSelf = options?.expandSelf !== false;
    setExpanded((current) => (expandSelf
      ? expandAncestors(current, props.nodes, id)
      : expandAncestorChain(current, props.nodes, id)));
    // 祖先本来就都展开时 expanded 不变 ⇒ 用 nonce 保证布局滚动仍然跑一次
    setRevealNonce((n) => n + 1);
  }, [props.nodes]);

  useLayoutEffect(() => {
    const id = pendingRevealRef.current;
    if (!id) return undefined;
    pendingRevealRef.current = null;
    if (scrollRowIntoView(id)) return undefined;
    // 行还没进 DOM（可能还要再渲染一层）：下一帧补一次；rAF 仍在绘制前，不会闪
    const raf = window.requestAnimationFrame(() => { scrollRowIntoView(id); });
    return () => window.cancelAnimationFrame(raf);
  }, [revealNonce, expanded, scrollRowIntoView]);
  // 供「只认 activeId 变化」的 effect 调用（目录树因同步刷新换引用时不该跟着乱滚）
  const revealNodeRef = useRef(revealNode);
  useEffect(() => { revealNodeRef.current = revealNode; }, [revealNode]);

  /** M1.5：定位到当前打开的文档 */
  const locateActive = useCallback(() => revealNode(props.activeId), [revealNode, props.activeId]);

  // 目录栏跟随定位：① 多 tab 切换（activeId 变化）；② 停靠 ↔ 浮动切换（mode 变化）。
  // ② 是必须的：浮动栏比停靠栏矮 ~68px，不重定位的话「原先停在最下方的选中文档」会掉出可见区、
  // 蓝色高亮看不见（user 260917 报）。收起态没有可见列表，跳过。
  // 同时把上一次点击留下的 context 复位：它已不是"当前文档"了，再留主色内描边是残留。
  // `expandSelf: false`：点开一个带子项的文档只**打开它**，不顺手把它的子项摊开（user 260918）。
  useEffect(() => {
    setContextId(props.activeId ?? null);
    if (props.mode === "collapsed") return;
    revealNodeRef.current(props.activeId, { expandSelf: false });
  }, [props.activeId, props.mode]);

  // 属性面板父级路径点击 → 展开到目标节点并滚动可见（消费后清空，避免重复触发）
  useEffect(() => {
    const id = props.revealNodeId;
    if (!id) return;
    revealNodeRef.current(id);
    props.onRevealConsumed();
  }, [props.revealNodeId, props.onRevealConsumed]);

  const menuNewChild = (kind: "group" | "note" | "sheet") => {
    if (!contextNode) return;
    // 支持多层嵌套：在目标节点下直接创建（文档也可包含分组/文档/表格）。
    const parentId = contextNode.id;
    if (kind === "sheet") { props.onCreate("sheet", parentId); setExpanded((current) => expandAncestors(current, props.nodes, parentId)); setContextMenu(null); return; }
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
  const createField = useCallback((_depth: number) => pendingCreate && <div className="inline-create" style={{ marginLeft: 8 }}>
    {pendingCreate.kind === "notebook" ? <Book size={14} /> : <FolderPlus size={14} />}
    <input autoFocus aria-label={pendingCreate.kind === "notebook" ? "笔记本名称" : "分组名称"} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { if (event.key === "Enter") submitCreate(); if (event.key === "Escape") setPendingCreate(null); }} />
    <button onClick={submitCreate}>创建</button>
  </div>, [newTitle, pendingCreate, submitCreate]);

  const beginTreeDrag = useCallback((event: React.PointerEvent, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("input")) return;
    dragRef.current = { id, startX: event.clientX, startY: event.clientY, moved: false };
    setReleaseState(null);
    dropTargetRef.current = null;
    setDropTarget(null);
    setDraggingId(id);
  }, []);
  const toggleNode = useCallback((id: string) => setExpanded((current) => toggleSet(current, id)), []);
  const setContextNode = useCallback((id: string) => setContextId(id), []);
  const consumeSuppressedClick = useCallback(() => suppressClickRef.current, []);
  const setTreeIcon = useCallback((node: TreeNode, event: React.MouseEvent) => {
    setIconPicker({ node, x: event.clientX, y: event.clientY });
  }, []);
  const cancelRename = useCallback(() => setEditingId(null), []);
  useLayoutEffect(() => {
    if (!releaseState) return;
    const rows = [...document.querySelectorAll<HTMLElement>("[data-tree-node-id]")];
    const currentOrder = props.nodes
      .filter((item) => item.parentId === releaseState.expectedParentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => item.id);
    const settled = currentOrder.join("|") === releaseState.expectedOrder.join("|");
    if (!settled) return;

    // 先读后写：一次性读取所有行位置（单次布局），再统一写 transform。
    // 原实现边写 style 边读 getBoundingClientRect → 每行强制重排一次，500+ 行时拖一次要 2s+。
    const currentTops: Array<{ row: HTMLElement; top: number }> = [];
    rows.forEach((row) => {
      const id = row.dataset.treeNodeId;
      if (!id || releaseState.positions[id] === undefined) return;
      currentTops.push({ row, top: row.getBoundingClientRect().top });
    });
    const animated: HTMLElement[] = [];
    currentTops.forEach(({ row, top }) => {
      const id = row.dataset.treeNodeId!;
      const delta = releaseState.positions[id] - top;
      if (Math.abs(delta) < 1) return;
      row.style.transition = "none";
      row.style.transform = `translateY(${delta}px)`;
      animated.push(row);
    });
    const frame = window.requestAnimationFrame(() => {
      animated.forEach((row) => {
        row.style.transition = "transform 250ms ease";
        row.style.transform = "translateY(0px)";
      });
    });
    const clear = () => {
      rows.forEach((row) => { row.style.transition = ""; row.style.transform = ""; });
      setReleaseState(null);
      setDraggingId(null);
      setDropTarget(null);
    };
    const timer = window.setTimeout(clear, 280);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [props.nodes, releaseState]);

  useEffect(() => {
    if (!releaseState) return;
    const timer = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>("[data-tree-node-id]").forEach((row) => { row.style.transition = ""; row.style.transform = ""; });
      setReleaseState(null);
      setDraggingId(null);
      setDropTarget(null);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [releaseState]);

  const draggedNode = draggingId ? props.nodes.find((node) => node.id === draggingId) ?? null : null;


  const dropNode = dropTarget ? props.nodes.find((node) => node.id === dropTarget.id) ?? null : null;
  const dropParentId = dropTarget && dropNode
    ? dropTarget.position === "inside" ? dropNode.id : dropNode.parentId
    : null;
  const draggedParentId = draggedNode?.parentId ?? null;

  // W-2-B：聚合对象 useMemo 化——props 稳定后 TreeRow memo 才能在按键路径命中
  const treeRowProps = useMemo(() => ({
    treeIndex,
    query,
    activeId: props.activeId,
    contextId: context?.id ?? null,
    expanded,
    draggingId,
    dropTarget,
    dropParentId,
    draggedParentId,
    releasingId: releaseState?.id ?? null,
    pendingCreate,
    editingId,
    editingTitle,
    createField,
    onEditingTitle: setEditingTitle,
    onSubmitRename: submitRename,
    onCancelRename: cancelRename,
    onBeginRename: beginRename,
    onPointerDown: beginTreeDrag,
    consumeSuppressedClick,
    onContext: setContextNode,
    onContextMenu: openContext,
    onToggle: toggleNode,
    onSelect: props.onSelect,
    onIconClick: setTreeIcon,
  }), [treeIndex, query, props.activeId, context?.id ?? null, expanded, draggingId, dropTarget, dropParentId, draggedParentId, releaseState, pendingCreate, editingId, editingTitle, createField, submitRename, cancelRename, beginRename, beginTreeDrag, setContextNode, openContext, toggleNode, props.onSelect, setTreeIcon]);

  return (
    <aside
      className={`sidebar sidebar-${props.mode}`}
      onPointerEnter={props.onPreviewEnter}
      onPointerLeave={() => {
        // The panel's right edge moves with the pointer during resize. React
        // can therefore report a leave even though the user is still dragging
        // the handle; let the resize lifecycle decide when the preview closes.
        if (!resizeRef.current) props.onPreviewLeave();
      }}
    >
      {/* 目录栏头部：左侧「目录」标题 + 右侧操作图标（与大纲栏 header 同一层视觉），筛选改为点击展开。 */}
      <div className="sidebar-toolbar-row desktop-only">
        <span className="sidebar-toolbar-title">目录</span>
        <div className="list-heading">
        <button className="dock-icon-btn refresh-btn" onClick={() => void refreshTree()} title="刷新目录" aria-label="刷新目录" disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : undefined} /></button>
        <button className={`dock-icon-btn filter-btn${filter.active ? " is-active" : ""}`} onClick={filter.toggle}
          title="筛选目录" aria-label="筛选目录" aria-pressed={filter.open}><Filter size={14} /></button>
        <button className="dock-icon-btn collapse-all-btn" onClick={() => setExpanded(new Set())} title="全部收起" disabled={expanded.size === 0}><ChevronsDownUp size={14} /></button>
        <button className="dock-icon-btn locate-btn" onClick={locateActive} title="定位到当前文档" disabled={!props.activeId} aria-label="定位到当前文档"><Focus size={14} /></button>
        <div className="create-menu-wrap" ref={menuRef}>
          <button ref={createButtonRef} className={`dock-icon-btn create-btn${menuOpen ? " is-active" : ""}`} onClick={() => {
            if (menuOpen) setMenuOpen(false);
            else { updateCreateMenuPosition(); setMenuOpen(true); }
          }} title="新建" aria-label="新建" aria-pressed={menuOpen}><Plus size={14} /></button>
          {menuOpen && createMenuPosition && createPortal(<div ref={createMenuRef} className="create-menu" style={{ position: "fixed", top: createMenuPosition.top, left: createMenuPosition.left, width: createMenuPosition.width, zIndex: 1000 }}>
            {/* 「+」只保留新建笔记本（user 260918）：文档/分组的创建走选中节点后的右键「新建文档/新建分组」。 */}
            <button onClick={() => create("notebook")}><Book size={16} /><span><strong>新建笔记本</strong></span></button>
          </div>, document.body)}
        </div>
      </div>
      </div>
      <DockFilterRow filter={filter} placeholder="筛选目录" className="desktop-only" />
      <nav className="note-list tree-list" ref={treeRef}>
        {pendingCreate?.kind === "notebook" && createField(0)}
        {roots.map((node) => <TreeRow key={node.id} node={node} depth={0} {...treeRowProps} />)}
        {roots.length === 0 && <div className="empty-list">{query ? "没有匹配的目录项，Esc 或再点筛选图标可清空" : "点击 + 新建第一个笔记本"}</div>}
      </nav>
      {contextMenu && contextNode && <ContextMenu node={contextNode} x={contextMenu.x} y={contextMenu.y} onNewChild={menuNewChild} onRename={menuRename} onDelete={menuDelete} onCopyMarkdown={() => props.onCopyMarkdown(contextNode)} onExportAs={(format) => props.onExportAs(contextNode, format)} onCopyPaths={() => props.onCopyPaths(contextNode)} onDuplicate={() => props.onDuplicate(contextNode)} onShowInfo={() => props.onShowInfo(contextNode)} onOpenHistory={() => props.onOpenHistory(contextNode)} onRevealNoteFile={() => props.onRevealNoteFile(contextNode)} onClose={() => setContextMenu(null)} />}
      {iconPicker && <EmojiIconPicker x={iconPicker.x} y={iconPicker.y} onPick={(icon) => { props.onSetIcon(iconPicker.node, icon); setIconPicker(null); }} onClose={() => setIconPicker(null)} />}
      <div className="sidebar-resize-handle desktop-only" role="separator" aria-label="调整资料库宽度" aria-orientation="vertical" aria-valuemin={props.minWidth} aria-valuemax={props.maxWidth} aria-valuenow={Math.round(props.width)} tabIndex={0} onPointerDown={handleResizePointerDown} onPointerMove={handleResizePointerMove} onPointerUp={finishResize} onPointerCancel={finishResize} onKeyDown={handleResizeKeyDown} onDoubleClick={() => props.onWidthCommit(SIDEBAR_DEFAULT_WIDTH)} />
    </aside>
  );
});

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  treeIndex: TreeIndex;
  query: string;
  activeId: string | null;
  contextId: string | null;
  expanded: Set<string>;
  draggingId: string | null;
  dropParentId: string | null;
  draggedParentId: string | null;
  releasingId: string | null;
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

const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const children = (props.treeIndex.childrenByParent.get(props.node.id) ?? []).filter((node) => props.treeIndex.visibleIds.has(node.id));
  const expandable = children.length > 0 || props.node.nodeType !== "note";
  const open = props.expanded.has(props.node.id) || Boolean(props.query);
  const icon = nodeIcon(props.node.nodeType, open, props.node.icon);

  const dropPosition = props.dropTarget?.id === props.node.id ? props.dropTarget.position : null;
  const isDragging = props.draggingId === props.node.id;
  // 只有“放入”才标记目标父项蓝框；before/after 永远表示最终插入线，
  // 即使跨级把子项拖到父项同级，也要把线画在父项实际目标边缘。
  const isDropParent = dropPosition === "inside" && props.dropParentId === props.node.id;
  const sameLevelLine = Boolean(dropPosition && dropPosition !== "inside");

  return <div className="tree-item">
    <div
      role="treeitem"
      tabIndex={0}
      data-tree-node-id={props.node.id}
      className={`note-row tree-row type-${props.node.nodeType} ${props.node.id === props.activeId ? "active" : ""} ${props.node.id === props.contextId && props.editingId !== props.node.id ? "context" : ""} ${isDragging ? "dragging" : ""} ${props.releasingId === props.node.id ? "releasing" : ""} ${isDropParent ? "drop-parent" : ""} ${sameLevelLine ? `drop-line-${dropPosition}` : ""}`}
      style={{ paddingLeft: 8 }}
      onClick={() => {
        if (props.consumeSuppressedClick()) return;
        props.onContext(props.node.id);
        if (props.node.nodeType === "note") props.onSelect(props.node.id);
        else {
          // 选中笔记本后保持其可见，方便立即在顶部 + 菜单中创建分组。
          props.onToggle(props.node.id);
        }
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
      {/* 行内悬浮动作（对齐思源：⋯ = more-root 弹右键菜单，＋ = new 新建子文档）。
          悬浮才显形（选中态不常驻）；标题恒单行、列宽处直接裁切，不打省略号。 */}
      <span className="tree-row-actions">
        <button
          type="button"
          className="tree-row-action"
          aria-label="更多操作"
          title="更多"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); props.onContextMenu(event, props.node); }}
        >
          <MoreVertical size={15} />
        </button>
      </span>
    </div>
    {open && <div className="tree-children">
      {props.pendingCreate?.parentId === props.node.id && props.createField(props.depth + 1)}
      {children.map((child) => <TreeRow key={child.id} {...props} node={child} depth={props.depth + 1} />)}
    </div>}
  </div>;
});

function nodeIcon(type: TreeNodeType, open: boolean, customIcon?: string | null) {
  if (customIcon) return <span className="tree-node-custom-icon">{customIcon}</span>;
  if (type === "notebook") return <Book size={16} />;
  if (type === "group") return open ? <FolderOpen size={16} /> : <Folder size={16} />;
  return <File size={16} />;
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
  // 默认只展开笔记本/分组（首帧即正确，避免 effect 回填闪烁）。
  // **文档不自动展开子项**（user 260918）：文档的子项只在「点下拉箭头」或「自动定位」时展开。
  const next = new Set<string>();
  nodes.forEach((node) => { if (node.nodeType !== "note") next.add(node.id); });
  return next;
}

/** 只展开 targetId 的**祖先**（不含自身）：点击文档时保证它可见，但不展开它的子项（user 260918）。 */
function expandAncestorChain(current: Set<string>, nodes: TreeNode[], targetId: string): Set<string> {
  const next = new Set(current);
  const target = nodes.find((n) => n.id === targetId);
  let cursor = target?.parentId ? nodes.find((n) => n.id === target.parentId) : undefined;
  while (cursor) {
    next.add(cursor.id);
    cursor = cursor.parentId ? nodes.find((n) => n.id === cursor!.parentId) : undefined;
  }
  return next;
}

interface ContextMenuProps {
  node: TreeNode;
  x: number;
  y: number;
  onNewChild: (kind: "group" | "note" | "sheet") => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyMarkdown: () => void;
  onExportAs: (format: "markdown" | "html" | "lake" | "pdf") => void;
  onCopyPaths: () => void;
  onDuplicate: () => void;
  onShowInfo: () => void;
  onOpenHistory: () => void;
  onRevealNoteFile: () => void;
  onClose: () => void;
}

const ContextMenu = ({ node, x, y, onNewChild, onRename, onDelete, onCopyMarkdown, onExportAs, onCopyPaths, onDuplicate, onShowInfo, onOpenHistory, onRevealNoteFile, onClose }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 视口边缘翻转：按光标先挂载，量出菜单真实尺寸后再定位——下方放不下就向上展开，保证整张菜单可点。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    if (left + w + margin > window.innerWidth) left = window.innerWidth - w - margin;
    left = Math.max(margin, left);
    let top = y;
    if (top + h + margin > window.innerHeight) {
      const above = y - h;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - h - margin);
    }
    top = Math.max(margin, top);
    setPos({ left, top });
  }, [x, y]);
  // Portal 到 body：侧边栏带 transform（含 translateX(0)）时，position: fixed 会退化为
  // 相对侧边栏定位，导致菜单偏离光标右下；挂到 body 后恢复真正的视口固定定位。
  return createPortal(
    <div ref={menuRef} className="context-menu" style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: "hidden" }} role="menu" data-context-menu>
      <button role="menuitem" onClick={() => { onNewChild("note"); onClose(); }}><FilePlus size={15} /><span>新建文档</span></button>
      <button role="menuitem" onClick={() => { onNewChild("sheet"); onClose(); }}><Table size={15} /><span>新建表格</span></button>
      <button role="menuitem" onClick={() => { onNewChild("group"); onClose(); }}><FolderPlus size={15} /><span>新建分组</span></button>
      <div className="context-menu-sep" />
      {node.nodeType === "note" ? (
        <>
          <button role="menuitem" onClick={() => { onDuplicate(); onClose(); }}><Copy size={15} /><span>复制</span></button>
          <button role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={15} /><span>重命名</span></button>
          <button role="menuitem" onClick={() => { onOpenHistory(); onClose(); }}><History size={15} /><span>历史版本</span></button>
          <button role="menuitem" onClick={() => { onRevealNoteFile(); onClose(); }}><FolderOpen size={15} /><span>打开文件位置</span></button>
          <button role="menuitem" onClick={() => { onShowInfo(); onClose(); }}><Info size={15} /><span>属性</span></button>
          {/* v6：非 doc（表格/多维表）正文不是 Lake 文档格式，导出会产出坏文件 → 隐藏入口 */}
          {(node.kind ?? "doc") === "doc" && (
            <ExportSubmenuItem onExportAs={onExportAs} onCopyMarkdown={onCopyMarkdown} onCopyPaths={onCopyPaths} onClose={onClose} />
          )}
        </>
      ) : (
        <button role="menuitem" onClick={() => { onRename(); onClose(); }}><Pencil size={15} /><span>重命名</span></button>
      )}
      <div className="context-menu-sep" />
      <button role="menuitem" className="danger" onClick={() => { onDelete(); onClose(); }}><Trash size={15} /><span>删除</span></button>
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
        <button className="b3-button b3-button--cancel" onClick={onCancel}>取消</button>
        <button className="b3-button danger-button" onClick={onConfirm}>删除</button>
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
