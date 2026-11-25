/**
 * Sidebar —— 桌面文档目录栏（D-04/D-13 头注释，261125）：目录树渲染 + 筛选 + 新建/重命名 + 置顶/已收起分区。
 *
 * 职责边界：导入状态机在 hooks/useSidebarImport、多选批量在 hooks/useTreeSelectionBatch、树拖拽 + ghost + FLIP
 * 在 hooks/useTreeDrag（261125 D-04 三步纯搬家）；目录行内部组件在 ./sidebar/（261112 R2）；本文件只留组合与布局。
 * 展开记忆语义（261121 口径反转）：设备本地记忆（features/sidebar/treeExpansion.ts；空数组 = 用户主动全部收起）；
 * **启动不跟随**（261122 用户裁决）：冷启动严格按上次记忆渲染，不替用户展开 active 文档祖先（要定位用「定位」按钮）。
 * 单一来源指针：展开/收起判据 = ./sidebar/treeExpandState.ts；置顶/收纳 = features/sidebar/{pinnedTree,collapsedNotebooks}；
 * 多选语义 = core/treeSelection；浮层走 components/ui/Overlay、二次确认走 useConfirm（不引第二套）。
 * 已知坑：滚动定位只动目录自己的滚动容器（禁 scrollIntoView，user 260917 实测整壳上移 42px）；
 * 新建/重命名只走统一弹窗（261105 用户验收，无内联创建行）。
 */
import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Book, ChevronsDownUp, Filter, Focus, Pin, Plus, RefreshCw } from "lucide-react";
import { DockFilterRow, useDockFilter } from "../ui/DockFilterBar";
import { escapeId } from "../../lib/cssEscape";
import type { TreeNode } from "../../lib/types";
import { buildTreeIndex, type TreeIndex } from "../../core/treeIndex";
import { subtreeIds } from "../../core/tree";
// D-04③（261125）：树拖拽状态机/ghost/FLIP 搬到 hooks/useTreeDrag.ts（纯搬家，本文件只接线）。
import { useTreeDrag } from "../../hooks/useTreeDrag";
import { getCreateMenuPosition, type CreateMenuPosition } from "../model/createMenuPosition";
import { SIDEBAR_DEFAULT_WIDTH } from "../../core/layoutConstants";
import { Menu } from "../ui/Overlay";
import type { ExportFormat } from "../ui/ExportSubmenuItem";
import { rubberBandWidth, SplitHandle } from "../ui/SplitHandle";

/** 261107：图标选择器 + 表情源表按需加载（入口不再静态背约 41KB gzip）。 */
const NodeIconPicker = lazy(() => import("./NodeIconPicker").then((m) => ({ default: m.NodeIconPicker })));
// 行内重命名的 Enter/Esc/空名口径统一走共用原语（DT-12；目录这里保留「弹窗 + 空名不提交」的现状）
import { SidebarTagFilter } from "./SidebarTagFilter";
import { NoteTagDialog } from "./NoteTagDialog";
import { NamePromptDialog } from "./NamePromptDialog";
import { ImportProgressDialog } from "./ImportProgressDialog";
import { ImportResultDialog } from "./ImportResultDialog";
// D-04①（261125）：导入状态机/动作搬到 hooks/useSidebarImport.ts（纯搬家，本文件只接线）。
import { useSidebarImport } from "../../hooks/useSidebarImport";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { MoveTargetTreeDialog } from "./MoveTargetTreeDialog";
import { BatchTagDialog } from "./BatchTagDialog";
import { TreeSelectionContextMenu } from "./TreeSelectionContextMenu";
import { SidebarPinnedSection } from "./SidebarPinnedSection";
import { SidebarCollapsedSection } from "./SidebarCollapsedSection";
import { pruneExpandedNodeIds, readExpandedNodeIds, writeExpandedNodeIds } from "../../features/sidebar/treeExpansion";
import {
  readCollapsedHeight,
  readCollapsedNotebookIds,
  readCollapsedOpen,
  toggleCollapsedNotebook,
  writeCollapsedHeight,
  writeCollapsedNotebookIds,
  writeCollapsedOpen,
} from "../../features/sidebar/collapsedNotebooks";
import { canCollapseNotebook, pruneCollapsedNotebookIds, splitCollapsedNotebooks } from "../../core/notebookCollapse";
import { toggleExpandedNode } from "./sidebar/treeExpandState";
import {
  readPinnedOpen,
  readPinnedTreeIds,
  togglePinnedTreeId,
  writePinnedOpen,
  writePinnedTreeIds,
} from "../../features/sidebar/pinnedTree";
// D-04②（261125）：多选/批量状态机与动作搬到 hooks/useTreeSelectionBatch.ts（纯搬家，本文件只接线）。
import { useTreeSelectionBatch } from "../../hooks/useTreeSelectionBatch";
import { isTagSelectionActive, type TagSelection } from "../../features/tags/tagsModel";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";

// 261112 R2 S6：目录行的 7 个内部组件搬到 ./sidebar/（纯搬移，不改 props/行为）。
import { TreeRow } from "./sidebar/TreeRow";
import { TreeRenameDialog } from "./sidebar/TreeRenameDialog";
import { CreateMenu } from "./sidebar/CreateMenu";
import type { CreateChildKind } from "./sidebar/CreateChildItems";
import { ContextMenu } from "./sidebar/ContextMenu";
import type { DropPosition } from "./sidebar/treeRowProps";
/** 兼容导出：DesktopOverlays 仍从 Sidebar 取它（组件本体在 ./sidebar/ConfirmDelete，单一实现）。 */
export { ConfirmDelete } from "./sidebar/ConfirmDelete";

type CreateKind = "notebook" | "group" | "note" | "usheet" | "bitable" | "board" | "ink";
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
  /** 返回新节点 id（弹窗据此选中/滚动）；失败可抛错（弹窗内显示）。 */
  /** afterSortOrder（261120）= 目录右键「在上方/在下方新建文档」的同父级锚点（上方 = 锚点 sort_order - 1）。 */
  onCreate: (kind: CreateKind, parentId: string | null, title?: string, afterSortOrder?: number) => void | Promise<string | void>;
  onRename: (id: string, title: string) => void;
  onMoveNode: (id: string, targetId: string, position: DropPosition) => void;
  onRequestDelete: (node: TreeNode) => void;
  onCopyMarkdown: (node: TreeNode) => void;
  onExportAs: (node: TreeNode, format: ExportFormat) => void;
  onCopyPaths: (node: TreeNode) => void;
  /** 创建副本前先 flush 这些文档的未保存编辑（App 注入：dirty tab 先落盘，副本才拿到最新正文）。 */
  onBeforeDuplicate?: (ids: readonly string[]) => Promise<void> | void;
  onSetIcon: (node: TreeNode, icon: string | null) => void;
  /** 文档属性弹窗 */
  onShowInfo: (node: TreeNode) => void;
  /** 历史版本面板 */
  onOpenHistory: (node: TreeNode) => void;
  /** 已锁定（只读）的文档 id 集：目录行显示锁标识、右键菜单给「锁定/解锁」 */
  lockedNoteIds: ReadonlySet<string>;
  /** 锁定/解锁某一篇（可锁未打开的文档） */
  onToggleLockNote: (node: TreeNode) => void;
  /** 属性面板父级路径跳转：展开到该节点并滚动可见 */
  revealNodeId: string | null;
  onRevealConsumed: () => void;
  pendingRenameId: string | null;
  onPendingRenameConsumed: () => void;
  onPreviewEnter: () => void;
  /** 固定/取消固定目录栏（📌；S1 后由面板头提供，不再依赖活动栏） */
  onToggleDock?: () => void;
  docked?: boolean;
  onPreviewLeave: () => void;
  onResizeActiveChange: (active: boolean) => void;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  /** 重命名弹窗打开期间临时钉住目录栏展开（用户 261006：悬浮态下也不能收起） */
  onSidebarHold?: (active: boolean) => void;
  /**
   * P1 按标签筛选（可选）：selection/目录 chips 由 App 持有；
   * visibleIds = 命中文档 + 祖先链（只过滤**显示**，拖拽排序仍用完整兄弟集合）。
   */
  tagFilter?: {
    tags: readonly QuickNoteTagSummary[];
    selection: TagSelection;
    visibleIds: ReadonlySet<string>;
    onChange(next: TagSelection): void;
  };
  /** 右键「打标签…」保存后通知宿主（刷新标签空间/筛选数据；与属性面板同一条通路）。 */
  onTagsChanged?: () => void;
}

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextId, setContextId] = useState<string | null>(null);
  /**
   * 新建（全部 kind）= 同一个弹窗（261105 用户验收：所有「需要写名字」的新建统一体验）。
   * 内联创建行与「创建后自动打开重命名」都已移除，避免二次弹窗。
   */
  const [createDialog, setCreateDialog] = useState<{ kind: CreateKind; parentId: string | null; afterSortOrder?: number } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  // ===== 目录树展开记忆（261121 设备本地；启动不跟随 261122）=====
  /**
   * 目录树展开集（261121 **口径反转**：用户报「退出前收起所有笔记本，重开又全部展开」）。
   *
   * 261119 曾定「只活在会话内、重启回默认展开」；261121 用户明确这影响体验 ⇒ 改为**设备本地记忆**
   * （localStorage，不进 S3、各端独立）：记「当前展开的节点 id」，**空数组 = 用户主动全部收起**
   * （与"从没记过"区分）；节点删掉后的残留 id 按当前树裁剪。读写单一来源 = sidebar/treeExpansion.ts。
   * 收起清整棵子树、展开只开一级的语义不变（判据 = sidebar/treeExpandState.ts）。
   */
  const restoredExpandedRef = useRef<{ stored: string[] | null }>({ stored: null });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const stored = readExpandedNodeIds();
    restoredExpandedRef.current.stored = stored;
    return new Set(stored ?? autoExpanded(props.nodes));
  });
  /** 树是否已经拿到过真实节点（启动时 nodes 先空后到；在此之前**不许**把记忆写空）。 */
  const treeSyncedRef = useRef(false);

  // 首次拿到真实树：按记忆恢复（裁剪掉已删节点）；**没有记忆**才走默认展开（笔记本/分组）。
  // 之后的 refreshTree 只裁掉已删节点，绝不改写用户当前展开态。
  useEffect(() => {
    if (props.nodes.length === 0) return;
    if (!treeSyncedRef.current) {
      treeSyncedRef.current = true;
      const stored = restoredExpandedRef.current.stored;
      const base = stored === null ? autoExpanded(props.nodes) : new Set(stored);
      const next = new Set(pruneExpandedNodeIds([...base], props.nodes));
      setExpanded((current) => (sameIdSet(current, next) ? current : next));
      return;
    }
    setExpanded((current) => {
      const next = new Set(pruneExpandedNodeIds([...current], props.nodes));
      return sameIdSet(current, next) ? current : next;
    });
  }, [props.nodes]);

  // 记忆：树同步之后才写 —— 启动时 nodes 为空，此刻写 [] 会把「用户主动全部收起」和「从没记过」混为一谈。
  useEffect(() => {
    if (!treeSyncedRef.current) return;
    writeExpandedNodeIds([...expanded]);
  }, [expanded]);

  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** 右键「打标签…」：记录目标文档（id + 标题），用 NoteTagDialog 复用属性面板的标签编辑行。 */
  const [tagEditor, setTagEditor] = useState<{ noteId: string; title: string } | null>(null);
  /** 桌面「置顶」：纯设备本地的入口列表（不改原目录、不写库、不进 S3）。 */
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readPinnedTreeIds());
  const [pinnedOpen, setPinnedOpen] = useState<boolean>(() => readPinnedOpen());
  /** 桌面「已收起」笔记本：纯设备本地的归纳状态（默认收起；收起后从主列表消失，只在底部置底区出现）。 */
  const [collapsedNotebookIds, setCollapsedNotebookIds] = useState<string[]>(() => readCollapsedNotebookIds());
  const [collapsedOpen, setCollapsedOpen] = useState<boolean>(() => readCollapsedOpen());
  /** 分区手动高度（px；null = 自适应、最高 1/3 目录栏）。拖分隔条改高度，双击复位。 */
  const [collapsedHeight, setCollapsedHeight] = useState<number | null>(() => readCollapsedHeight());
  const sidebarRef = useRef<HTMLElement | null>(null);
  /** 目录行「＋」的快捷「新建」菜单（锚在该行按钮上） */
  const [createMenu, setCreateMenu] = useState<{ node: TreeNode; anchor: HTMLElement } | null>(null);
  const [iconPicker, setIconPicker] = useState<{ node: TreeNode; anchor: HTMLElement } | null>(null);
  const [createMenuPosition, setCreateMenuPosition] = useState<CreateMenuPosition | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLElement>(null);
  // 拖拽生命周期只用来决定 `onPreviewLeave` 的时序（拖拽中右缘跟着指针走，不能当"移出"处理）。
  const splitDraggingRef = useRef(false);
  /** 上一次见过的节点 id；**null = 还没建立基线**（启动首帧树是空的，不能把那一次当成"全是新节点"）。 */
  const prevNodeIds = useRef<Set<string> | null>(null);
  // ===== 筛选与显示索引 =====
  const query = props.search.trim().toLocaleLowerCase();
  // 目录筛选：图标按需展开输入框（交互与大纲筛选共用 dockFilterModel 状态机）
  const filter = useDockFilter(props.search, props.onSearch);
  const treeIndex = useMemo(() => buildTreeIndex(props.nodes, query), [props.nodes, query]);
  /** 显示用索引：标签筛选只收窄 visibleIds（childrenByParent 保持完整 ⇒ 拖拽排序的兄弟集合不受影响）。 */
  const displayIndex = useMemo<TreeIndex>(() => {
    const tagFilter = props.tagFilter;
    if (!tagFilter || !isTagSelectionActive(tagFilter.selection)) return treeIndex;
    const visibleIds = new Set([...treeIndex.visibleIds].filter((id) => tagFilter.visibleIds.has(id)));
    return { childrenByParent: treeIndex.childrenByParent, visibleIds };
  }, [treeIndex, props.tagFilter]);
  const roots = (displayIndex.childrenByParent.get(null) ?? []).filter((node) => displayIndex.visibleIds.has(node.id));
  // ===== 「已收起」笔记本分区（261120）=====
  /**
   * 「已收起」（261120 用户点单）：收起项从目录主列表消失、只在底部置底区出现。
   * 搜索/标签筛选期间**不做收纳**（与置顶区同一口径：筛选时底部区隐藏，免得「目录被筛掉、底部还在」）。
   */
  const collapseSectionHidden = !!query || (props.tagFilter ? isTagSelectionActive(props.tagFilter.selection) : false);
  const collapsedIdSet = useMemo(() => new Set(collapsedNotebookIds), [collapsedNotebookIds]);
  const { active: activeRoots, collapsed: collapsedRootsRaw } = useMemo(
    () => splitCollapsedNotebooks(roots, collapseSectionHidden ? [] : collapsedNotebookIds),
    [roots, collapsedNotebookIds, collapseSectionHidden],
  );
  const collapsedRoots = collapsedRootsRaw;

  const nodeById = useMemo(() => new Map(props.nodes.map((node) => [node.id, node])), [props.nodes]);
  // 「已收起」历史/异常写入清理：节点已加载且确认**不可收起**（回收站/未分类/日记本/非笔记本）才剔除。
  // 节点未知时保留（加载期/筛选期不误删），否则会在树还没到时把用户的收纳清空。
  useEffect(() => {
    const next = pruneCollapsedNotebookIds(collapsedNotebookIds, nodeById);
    if (next.length === collapsedNotebookIds.length) return;
    writeCollapsedNotebookIds(next);
    setCollapsedNotebookIds(next);
  }, [collapsedNotebookIds, nodeById]);
  // 点击展开/收起：收起清整棵子树的展开态，展开只开一级（261119 用户点单）。
  const toggleNode = useCallback((id: string) => setExpanded((current) => toggleExpandedNode(current, id, props.nodes)), [props.nodes]);
  /** 置顶状态读写（设备本地）；节点 id 与目录树同源。 */
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const refreshPinnedState = useCallback(() => setPinnedIds(readPinnedTreeIds()), []);

  // ---- 目录树多选 + 批量动作（261106 task-81/task-88；D-04② 状态机/动作在 hooks/useTreeSelectionBatch）----
  const {
    selection, selectedIdSet, selectionActions, selectionAllNotes, selectionAllPinned,
    batchBusy, batchNotice, setBatchNotice, batchNoticeAction, batchMenu, setBatchMenu,
    batchDialogError, setBatchDialogError, moveDialog, setMoveDialog, tagDialog, setTagDialog, tagCatalog,
    confirmElement, handleRowClick, runBatch, trashSelected, exportSelected,
    duplicateOne, duplicateSelected, pinSelected,
    openMoveDialog, openMoveForNode, openBatchTagDialog, confirmBatchTag, createBatchTag,
    selectAllVisibleRows, cancelSelection,
  } = useTreeSelectionBatch({
    nodes: props.nodes,
    nodeById,
    displayIndex,
    query,
    tagSelection: props.tagFilter?.selection,
    tagVisibleIds: props.tagFilter?.visibleIds,
    onRefreshTree: props.onRefreshTree,
    onTagsChanged: props.onTagsChanged,
    onBeforeDuplicate: props.onBeforeDuplicate,
    onSelect: props.onSelect,
    setContextId,
    toggleNode,
    pinnedSet,
    refreshPinnedState,
  });

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

  const softClampWidth = useCallback(
    (next: number) => rubberBandWidth(next, props.minWidth, props.maxWidth),
    [props.minWidth, props.maxWidth],
  );

  const handleSplitResizingChange = useCallback((active: boolean) => {
    splitDraggingRef.current = active;
    props.onResizeActiveChange(active);
  }, [props.onResizeActiveChange]);

  const commitSplitWidth = useCallback((next: number | null) => {
    props.onWidthCommit(next ?? SIDEBAR_DEFAULT_WIDTH);
  }, [props.onWidthCommit]);

  useEffect(() => {
    // 只自动展开**真正新出现**的容器节点（同步拉来 / 新建的笔记本、分组），不碰已有节点。
    if (props.nodes.length === 0) return;
    // 261122 用户报「每次打开还是全都展开」的真因：启动首帧树为空，第一次 effect 把所有笔记本都
    // 当成"新节点"全量展开，随后又被记忆持久化覆盖 ⇒ 记忆永远存不下"收起"。
    // ⇒ 第一次拿到真实树只**建立基线**、不展开。
    if (prevNodeIds.current === null) {
      prevNodeIds.current = new Set(props.nodes.map((n) => n.id));
      return;
    }
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

  // 重命名弹窗打开期间钉住目录栏展开（用户 261006）：悬浮态下指针移到弹窗上也不收起。
  useEffect(() => {
    props.onSidebarHold?.(editingId != null);
    return () => { props.onSidebarHold?.(false); };
  }, [editingId, props.onSidebarHold]);


  // 创建/上下文定位：直接用当前选中/右键的节点作为父节点（支持多层嵌套，
  // 文档也可作为父节点）；无选中时回退到第一个笔记本。
  const context = props.nodes.find((node) => node.id === contextId)
    ?? props.nodes.find((node) => node.id === props.activeId)
    ?? props.nodes.find((node) => node.nodeType === "notebook")
    ?? null;
  const defaultNotebookId = props.nodes.find((node) => node.nodeType === "notebook")?.id ?? null;
  const groupParent = context?.id ?? defaultNotebookId;
  const noteParent = context?.id ?? defaultNotebookId;

  // ===== 新建 / 重命名（统一弹窗，261105 用户验收）=====
  const openCreateDialog = useCallback((kind: CreateKind, parentId: string | null, afterSortOrder?: number) => {
    setCreateError(null);
    setCreateDialog({ kind, parentId, afterSortOrder });
  }, []);

  const create = (kind: CreateKind) => {
    setMenuOpen(false);
    const parentId = kind === "notebook" ? null : kind === "group" ? groupParent : noteParent;
    if (parentId) setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    openCreateDialog(kind, parentId);
  };

  /** 统一弹窗提交：创建 → 关闭 → 选中并滚动到新节点；失败在弹窗内显示且不关闭。 */
  const submitCreate = useCallback(async (title: string) => {
    if (!createDialog) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const kind = createDialog.kind;
      const parentId = createDialog.parentId;
      const afterSortOrder = createDialog.afterSortOrder;
      // 261120：显式锚点（在上方/在下方新建）优先于设置里的「新建文档位置」；
      // 没有锚点时仍按原 3 参契约调用（既有调用方/护栏都按 3 参断言，不制造无意义的 undefined 实参）。
      const id = await Promise.resolve(afterSortOrder === undefined
        ? props.onCreate(kind, parentId, title)
        : props.onCreate(kind, parentId, title, afterSortOrder));
      setCreateDialog(null);
      if (typeof id === "string" && id) {
        // 只有文档类新节点能以 noteId 打开；笔记本/分组返回的是树节点 id，
        // 调 onSelect 会走 openNote → 读不存在的笔记（用户报「新建笔记本 → 笔记不存在」）。
        if (kind !== "notebook" && kind !== "group") props.onSelect(id);
        else if (parentId) setExpanded((current) => expandAncestors(current, props.nodes, parentId));
        // 树刷新是异步 setState：等一帧再 reveal（目录栏自己的滚动容器，不用 scrollIntoView）。
        window.requestAnimationFrame(() => revealNodeRef.current(id));
      }
    } catch (reason) {
      setCreateError(getNativeErrorMessage(reason));
    } finally {
      setCreateBusy(false);
    }
  }, [createDialog, props.onCreate, props.onSelect]);

  const submitRename = useCallback((title: string) => {
    const next = title.trim();
    if (editingId && next) props.onRename(editingId, next);
    setEditingId(null);
    setEditingTitle("");
  }, [editingId, props.onRename]);

  const beginRename = useCallback((node: TreeNode) => {
    setEditingId(node.id);
    setEditingTitle(node.title);
  }, []);

  // ===== 右键菜单与行内「＋」快捷菜单 =====
  // 右键菜单：contextmenu 事件在桌面=右键、移动端=长按自动触发，无需手写长按定时器。
  const openContext = useCallback((event: React.MouseEvent, node: TreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setContextId(node.id);
    // 261106 task-88 + 副本：多选态右键 = 恰好四项（创建副本/移动…/导出…/移入回收站）；未多选时保持旧菜单不变。
    if (selection.ids.length > 0) {
      setContextMenu(null);
      setBatchMenu({ x: event.clientX, y: event.clientY });
      return;
    }
    setBatchMenu(null);
    setContextMenu({ id: node.id, x: event.clientX, y: event.clientY });
  }, [selection.ids.length]);

  /** 目录行「＋」：弹出「新建子项」快捷菜单（锚在该按钮上，定位走 usePopoverPosition）。 */
  const openCreateMenu = useCallback((event: React.MouseEvent, node: TreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setCreateMenu({ node, anchor: event.currentTarget as HTMLElement });
  }, []);

  /** 置顶区行右键：始终走单条菜单（不因目录里存在多选而变成批量菜单）。 */
  const openPinnedContext = useCallback((event: React.MouseEvent, node: TreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setBatchMenu(null);
    setContextId(node.id);
    setContextMenu({ id: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const contextNode = props.nodes.find((node) => node.id === contextMenu?.id) ?? null;

  // ===== 定位与滚动（reveal；只动目录自己的滚动容器）=====
  /** 把某一行滚进目录栏自己的可见区（已在视口内则不滚，只定位）。
   *  **只动目录栏自己的滚动容器，不能用 `scrollIntoView`**：它会连带滚动所有可滚动祖先，
   *  而 `body` 虽 `overflow:hidden` 仍可被程序化滚动（`.sidebar` 的 `margin-top: 42px`
   *  让外壳多出 42px 溢出）⇒ 实测整个 `.app-shell` 被顶上去 42px、顶栏让位失效、
   *  面包屑挤进 tab 行（user 260917 报）。 */
  const scrollRowIntoView = useCallback((id: string): boolean => {
    const list = treeRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-tree-node-id="${escapeId(id)}"]`);
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
  /** 冷启动的"跟随定位"只允许发生一次（之后用户切标签/切模式照常跟随）。 */
  const startupFollowRef = useRef(false);
  useEffect(() => {
    setContextId(props.activeId ?? null);
    if (props.mode === "collapsed") return;
    const startup = !startupFollowRef.current && treeSyncedRef.current;
    if (startup) {
      startupFollowRef.current = true;
      // 261122 用户报「退出前收起了所有笔记本，重开又自动展开」：冷启动没有"切换标签"这回事，
      // 目录**严格按上次记忆渲染**，不替用户展开 active 文档的祖先（要定位用工具条的「定位」按钮）。
      // 没有记忆（首次运行）时仍按默认展开，保持老观感。
      if (restoredExpandedRef.current.stored !== null) return;
    }
    revealNodeRef.current(props.activeId, { expandSelf: false });
  }, [props.activeId, props.mode]);

  // 属性面板父级路径点击 → 展开到目标节点并滚动可见（消费后清空，避免重复触发）
  useEffect(() => {
    const id = props.revealNodeId;
    if (!id) return;
    revealNodeRef.current(id);
    props.onRevealConsumed();
  }, [props.revealNodeId, props.onRevealConsumed]);

  /** 在 node 下创建子项（单一来源：右键菜单「新建」子菜单 + 目录行「＋」快捷菜单共用）。 */
  const createChild = (node: TreeNode | null, kind: "group" | "note" | "usheet" | "bitable" | "board" | "ink") => {
    if (!node) return;
    // 支持多层嵌套：在目标节点下直接创建（文档也可包含分组/文档/表格）；统一走同一个新建弹窗。
    const parentId = node.id;
    setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    setContextMenu(null);
    setCreateMenu(null);
    openCreateDialog(kind, parentId);
  };

  /** 261120 用户点单：目录右键「在上方新建 / 在下方新建」= 与当前**文档**同父级、紧邻上/下插入；
   *  二级菜单的六种子项复用我们自己的新建清单（CREATE_CHILD_ITEMS）。落位靠 afterSortOrder 锚点
   *  （上方 = 锚点 sortOrder-1，下方 = 锚点 sortOrder），由 store 在同一事务里挪开同级条目；
   *  显式锚点优先于设置里的「新建文档位置」。分组/笔记本行不提供（没有"文档兄弟"语义）。 */
  const createSibling = (node: TreeNode | null, position: "above" | "below", kind: CreateChildKind) => {
    if (!node || node.nodeType !== "note" || !node.parentId) return;
    const parentId = node.parentId;
    setExpanded((current) => expandAncestors(current, props.nodes, parentId));
    setContextMenu(null);
    setCreateMenu(null);
    openCreateDialog(kind, parentId, position === "above" ? node.sortOrder - 1 : node.sortOrder);
  };

  // ---- Markdown 导入（261106 task-85）：状态机/动作在 hooks/useSidebarImport（D-04① 纯搬家）----
  const closeImportOverlays = useCallback(() => {
    setMenuOpen(false);
    setCreateMenu(null);
    setContextMenu(null);
  }, []);
  const {
    importProgress, importStopping, importResult, setImportResult,
    containerAncestorOf, startImport, cancelMarkdownImport,
  } = useSidebarImport({
    nodes: props.nodes,
    onRefreshTree: props.onRefreshTree,
    revealNodeRef,
    closeImportOverlays,
  });

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

  const setContextNode = useCallback((id: string) => setContextId(id), []);
  const setTreeIcon = useCallback((node: TreeNode, event: React.MouseEvent<HTMLElement>) => {
    setIconPicker({ node, anchor: event.currentTarget.closest<HTMLElement>(".tree-row") ?? event.currentTarget });
  }, []);
  const cancelRename = useCallback(() => setEditingId(null), []);

  // ---- 树拖拽（D-04③ 状态机 + ghost + FLIP 在 hooks/useTreeDrag，纯搬家）----
  const {
    draggingId, dragMoved, dropTarget, dropParentId, draggedParentId, releasingId,
    beginTreeDrag, consumeSuppressedClick,
  } = useTreeDrag({
    nodes: props.nodes,
    treeIndex,
    onMoveNode: props.onMoveNode,
    treeRef,
    setExpanded,
  });

  // W-2-B：聚合对象 useMemo 化——props 稳定后 TreeRow memo 才能在按键路径命中

  /** 搜/筛选时隐藏置顶区：避免"目录被筛掉、置顶还在"的语义歧义。 */
  const showPinnedSection = useMemo(
    () => !query && !(props.tagFilter && isTagSelectionActive(props.tagFilter.selection)) && pinnedIds.some((id) => nodeById.has(id)),
    [query, props.tagFilter, pinnedIds, nodeById],
  );
  /** 「收起 / 取消收起」笔记本（261120 用户点单）：逻辑排除回收站/未分类/日记本，仅笔记本可收起。 */
  const toggleCollapseNode = useCallback((node: TreeNode) => {
    if (!canCollapseNotebook(node)) return;
    const nowCollapsed = toggleCollapsedNotebook(node.id);
    setCollapsedNotebookIds(readCollapsedNotebookIds());
    // 收起那一刻把该子树在分区内的展开记录清掉 ⇒ 下次进分区还是「默认收起」。
    setCollapsedZoneExpanded((current) => {
      const next = new Set(current);
      for (const id of subtreeIds(props.nodes, node.id)) next.delete(id);
      return next;
    });
    setBatchNotice((nowCollapsed ? "已收起《" : "已取消收起《") + node.title + "》");
  }, [props.nodes]);
  /**
   * 「已收起」分区内的子树展开态（261120 用户追加口径：**分区里的笔记本子级默认收起**）。
   * 与主列表的 expanded **完全隔离** ⇒ 收起前在主列表展开过的层级，进分区后不会自动摊开；
   * 分区内可手动逐级展开（复用同一套语义：展开只开一级、收起清整棵子树），但**不落盘、不回写主列表**。
   */
  const [collapsedZoneExpanded, setCollapsedZoneExpanded] = useState<Set<string>>(() => new Set());
  const toggleCollapsedZoneNode = useCallback((id: string) => {
    setCollapsedZoneExpanded((current) => toggleExpandedNode(current, id, props.nodes));
  }, [props.nodes]);
  const toggleCollapsedSection = useCallback(() => {
    setCollapsedOpen((open) => {
      writeCollapsedOpen(!open);
      return !open;
    });
  }, []);
  const togglePinNode = useCallback((node: TreeNode) => {
    // 笔记本不可置顶（用户 261107 明确）：只有文档 / 分组可以。
    if (node.nodeType === "notebook") return;
    const pinned = togglePinnedTreeId(node.id);
    refreshPinnedState();
    setBatchNotice((pinned ? "已置顶《" : "已取消置顶《") + node.title + "》");
  }, [refreshPinnedState]);
  // 历史/外部写入的"笔记本置顶"清理掉（节点已加载且确认是笔记本才删，避免加载期误删文档）。
  useEffect(() => {
    const notebookPinned = pinnedIds.filter((id) => nodeById.get(id)?.nodeType === "notebook");
    if (notebookPinned.length === 0) return;
    const next = pinnedIds.filter((id) => !notebookPinned.includes(id));
    writePinnedTreeIds(next);
    setPinnedIds(next);
  }, [pinnedIds, nodeById]);

  const reorderPinned = useCallback((next: string[]) => {
    writePinnedTreeIds(next);
    setPinnedIds(next);
  }, []);
  const togglePinnedOpen = useCallback(() => {
    setPinnedOpen((current) => {
      const next = !current;
      writePinnedOpen(next);
      return next;
    });
  }, []);

  const treeRowProps = useMemo(() => ({
    treeIndex: displayIndex,
    query,
    activeId: props.activeId,
    contextId: context?.id ?? null,
    expanded,
    draggingId,
    dragMoved,
    dropTarget,
    dropParentId,
    draggedParentId,
    releasingId,

    editingId,
    onBeginRename: beginRename,
    onPointerDown: beginTreeDrag,
    consumeSuppressedClick,
    onContext: setContextNode,
    onContextMenu: openContext,
    onCreateMenu: openCreateMenu,
    onToggle: toggleNode,
    onSelect: props.onSelect,
    onIconClick: setTreeIcon,
    lockedNoteIds: props.lockedNoteIds,
    selectedIds: selectedIdSet,
    onRowClick: handleRowClick,
  }), [displayIndex, query, props.activeId, context?.id ?? null, expanded, draggingId, dragMoved, dropTarget, dropParentId, draggedParentId, releasingId, editingId, beginRename, beginTreeDrag, setContextNode, openContext, openCreateMenu, toggleNode, props.onSelect, setTreeIcon, props.lockedNoteIds, selectedIdSet, handleRowClick]);
  /**
   * 「已收起」分区的行 props：把展开态/切换换成**分区自己那份**（默认空 = 子级默认收起）。
   * ⚠️ 三角（onToggle）和**行点击**（onRowClick）都要换 —— 目录里点笔记本行本身就是展开/收起，
   * 只换三角会导致「点行没反应」（261120 用户报障）。其余行为（选择/右键/拖拽/多选语义）与主列表一致。
   */
  const handleCollapsedZoneRowClick = useCallback((event: React.MouseEvent, node: TreeNode) => {
    handleRowClick(event, node, toggleCollapsedZoneNode);
  }, [handleRowClick, toggleCollapsedZoneNode]);
  const collapsedZoneRowProps = useMemo(
    () => ({
      ...treeRowProps,
      expanded: collapsedZoneExpanded,
      onToggle: toggleCollapsedZoneNode,
      onRowClick: handleCollapsedZoneRowClick,
    }),
    [treeRowProps, collapsedZoneExpanded, toggleCollapsedZoneNode, handleCollapsedZoneRowClick],
  );

  // ===== 渲染：目录栏布局 =====
  return (
    <aside
      ref={sidebarRef}
      className={`sidebar sidebar-${props.mode}`}
      onPointerEnter={props.onPreviewEnter}
      onPointerLeave={() => {
        // The panel's right edge moves with the pointer during resize. React
        // can therefore report a leave even though the user is still dragging
        // the handle; let the resize lifecycle decide when the preview closes.
        if (!splitDraggingRef.current) props.onPreviewLeave();
      }}
    >
      {/* 目录栏头部：左侧「目录」标题 + 右侧操作图标（与大纲栏 header 同一层视觉），筛选改为点击展开。 */}
      <div className="sidebar-toolbar-row desktop-only">
        <span className="sidebar-toolbar-title">目录</span>
        <div className="list-heading">
        {props.onToggleDock && (
          <button
            className={`dock-icon-btn ln-iconbtn ln-iconbtn--compact ln-iconbtn--accent pin-btn${props.docked ? " is-active" : ""}`}
            onClick={props.onToggleDock}
            title={props.docked ? "取消固定目录（⌘]）" : "固定目录（⌘]）"}
            aria-label={props.docked ? "取消固定目录" : "固定目录"}
            aria-keyshortcuts="Meta+]"
            aria-pressed={!!props.docked}
          ><Pin size={14} /></button>
        )}
        <button className="dock-icon-btn ln-iconbtn ln-iconbtn--compact ln-iconbtn--accent refresh-btn" onClick={() => void refreshTree()} title="刷新目录" aria-label="刷新目录" disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : undefined} /></button>
        <button className={`dock-icon-btn ln-iconbtn ln-iconbtn--compact ln-iconbtn--accent filter-btn${filter.active ? " is-active" : ""}`} onClick={filter.toggle}
          title="筛选目录" aria-label="筛选目录" aria-pressed={filter.open}><Filter size={14} /></button>
        <button className="dock-icon-btn ln-iconbtn ln-iconbtn--compact ln-iconbtn--accent collapse-all-btn" onClick={() => setExpanded(new Set())} title="全部收起" disabled={expanded.size === 0}><ChevronsDownUp size={14} /></button>
        <button className="dock-icon-btn ln-iconbtn ln-iconbtn--compact ln-iconbtn--accent locate-btn" onClick={locateActive} title="定位到当前文档" disabled={!props.activeId} aria-label="定位到当前文档"><Focus size={14} /></button>
        <div className="create-menu-wrap" ref={menuRef}>
          <button ref={createButtonRef} className={`dock-icon-btn ln-iconbtn ln-iconbtn--compact ln-iconbtn--accent create-btn${menuOpen ? " is-active" : ""}`} onClick={() => {
            if (menuOpen) setMenuOpen(false);
            else { updateCreateMenuPosition(); setMenuOpen(true); }
          }} title="新建" aria-label="新建" aria-pressed={menuOpen}><Plus size={14} /></button>
          {menuOpen && createMenuPosition && (
            /* 表面/条目规格与目录右键菜单**同款**（用户 261111）：context-menu 表面 + ln-menu__item + 15px 图标 + span；
               本菜单只保留「新建笔记本」（user 260918；文档/分组创建走选中节点的右键）。「导入」不属于这个位置（用户 261111 点单移除）。 */
            <Menu surfaceClassName="context-menu" onDismiss={() => setMenuOpen(false)} surfaceRef={createMenuRef}
              style={{ position: "fixed", top: createMenuPosition.top, left: createMenuPosition.left, width: createMenuPosition.width }}>
              <button className="ln-menu__item" role="menuitem" onClick={() => create("notebook")}><Book size={15} aria-hidden="true" /><span>新建笔记本</span></button>
            </Menu>
          )}
        </div>
      </div>
      </div>
      {/* 目录筛选：只有一个 Filter 按钮/一个浮层——上段名称筛选 + 下段标签含/排除（P1 三修合并） */}
      <DockFilterRow filter={filter} placeholder="筛选目录" className="desktop-only" />
      {filter.open && props.tagFilter && (
        <SidebarTagFilter tags={props.tagFilter.tags} selection={props.tagFilter.selection} onChange={props.tagFilter.onChange} />
      )}
      {showPinnedSection && (
        <SidebarPinnedSection
          nodes={props.nodes}
          pinnedIds={pinnedIds}
          activeId={props.activeId}
          lockedNoteIds={props.lockedNoteIds}
          open={pinnedOpen}
          onToggleOpen={togglePinnedOpen}
          onSelect={props.onSelect}
          onContextMenu={openPinnedContext}
          onReorder={reorderPinned}
        />
      )}
      <nav className="note-list tree-list" ref={treeRef} onClick={(event) => { if (event.target === event.currentTarget) cancelSelection(); }}>
        {activeRoots.map((node) => <TreeRow key={node.id} node={node} depth={0} {...treeRowProps} />)}
        {activeRoots.length === 0 && <div className="empty-list">{
          query
            ? "没有匹配的目录项，Esc 或再点筛选图标可清空"
            : props.tagFilter && isTagSelectionActive(props.tagFilter.selection)
              ? "没有符合标签筛选的文档，点标签上的 × 清除筛选"
              : collapsedRoots.length > 0
                // 用户 261120：所有笔记本都收起时主列表空着，但不代用户把任何本"救"回来
                ? "笔记本都在下方「已收起」里，展开分区查看"
                : "点击 + 新建第一个笔记本"
        }</div>}
      </nav>
      {collapsedRoots.length > 0 && (
        <SidebarCollapsedSection
          open={collapsedOpen}
          count={collapsedRoots.length}
          onToggle={toggleCollapsedSection}
          height={collapsedHeight}
          containerRef={sidebarRef}
          onPreviewHeight={setCollapsedHeight}
          onCommitHeight={(height) => { setCollapsedHeight(height); writeCollapsedHeight(height); }}
        >
          {collapsedRoots.map((node) => <TreeRow key={node.id} node={node} depth={0} {...collapsedZoneRowProps} />)}
        </SidebarCollapsedSection>
      )}
      {batchMenu && (
        <TreeSelectionContextMenu
          x={batchMenu.x}
          y={batchMenu.y}
          count={selection.ids.length}
          actions={{ duplicate: selectionAllNotes, trash: selectionActions.trash, move: selectionActions.move, export: selection.ids.length > 0, pin: selection.ids.length > 0, tag: selectionActions.tag }}
          pinnedAll={selectionAllPinned}
          busy={batchBusy}
          onPin={pinSelected}
          onDuplicate={duplicateSelected}
          onTrash={() => void trashSelected()}
          onMove={openMoveDialog}
          onExport={() => void exportSelected()}
          onTag={openBatchTagDialog}
          onSelectAll={selectAllVisibleRows}
          onClose={() => setBatchMenu(null)}
        />
      )}
      {contextMenu && contextNode && <ContextMenu node={contextNode} x={contextMenu.x} y={contextMenu.y} onRename={menuRename} onMove={() => { if (contextNode) openMoveForNode(contextNode); }} onDelete={menuDelete} onCopyMarkdown={() => props.onCopyMarkdown(contextNode)} onExportAs={(format) => props.onExportAs(contextNode, format)} onCopyPaths={() => props.onCopyPaths(contextNode)} onShowInfo={() => props.onShowInfo(contextNode)} onOpenHistory={() => props.onOpenHistory(contextNode)} locked={contextNode.noteFileId ? props.lockedNoteIds.has(contextNode.noteFileId) : false} onToggleLock={() => props.onToggleLockNote(contextNode)} onAddTags={() => setTagEditor({ noteId: contextNode.noteFileId ?? contextNode.id, title: contextNode.title })} onDuplicate={() => { if (contextNode) duplicateOne(contextNode); }} pinned={pinnedSet.has(contextNode.id)} onTogglePin={() => togglePinNode(contextNode)} collapsible={canCollapseNotebook(contextNode)} collapsed={collapsedIdSet.has(contextNode.id)} onToggleCollapse={() => toggleCollapseNode(contextNode)} onCreateSibling={(position, kind) => createSibling(contextNode, position, kind)} busy={batchBusy} onClose={() => setContextMenu(null)} />}
      {createMenu && <CreateMenu anchor={createMenu.anchor} onNewChild={(kind) => createChild(createMenu.node, kind)} importTarget={containerAncestorOf(createMenu.node.id)} onImport={(targetId, kind) => void startImport(targetId, kind)} onClose={() => setCreateMenu(null)} />}
      {editingId && <TreeRenameDialog key={editingId} initial={editingTitle} onCancel={cancelRename} onConfirm={submitRename} />}
      {createDialog && (() => {
        const preset = CREATE_DIALOG_PRESETS[createDialog.kind];
        return (
          <NamePromptDialog
            open
            title={preset.title}
            inputLabel={preset.inputLabel}
            placeholder={"输入" + preset.inputLabel}
            initialValue={preset.defaultName}
            busy={createBusy}
            error={createError}
            onSubmit={submitCreate}
            onClose={() => { if (!createBusy) setCreateDialog(null); }}
          />
        );
      })()}
      {tagEditor && (
        <NoteTagDialog open noteId={tagEditor.noteId} title={tagEditor.title}
          onClose={() => setTagEditor(null)}
          onChanged={() => props.onTagsChanged?.()} />
      )}
      {iconPicker && (
        <Suspense fallback={null}>
          <NodeIconPicker key={iconPicker.node.id} anchor={iconPicker.anchor} nodeType={iconPicker.node.nodeType} value={iconPicker.node.icon ?? null} onPick={(icon) => {
            props.onSetIcon(iconPicker.node, icon);
            // 保持面板与当前分类/颜色，立即更新选中格，方便连续试选。
            setIconPicker((current) => current && { ...current, node: { ...current.node, icon } });
          }} onClose={() => setIconPicker(null)} />
        </Suspense>
      )}
      <SplitHandle
        className="sidebar-resize-handle desktop-only"
        ariaLabel="调整文档目录宽度"
        minWidth={props.minWidth}
        maxWidth={props.maxWidth}
        width={props.width}
        softClamp={softClampWidth}
        keyStep={8}
        keyStepLarge={24}
        onPreview={props.onWidthChange}
        onCommit={commitSplitWidth}
        onResizingChange={handleSplitResizingChange}
      />
      {/* 多选操作已全部迁入右键菜单；这里只保留批量结果/进度提示，不再有多选工具条。 */}
      {batchNotice && (
        <div className="tree-batch-notice" role="status" aria-live="polite">
          <span className="tree-batch-notice__text">{batchNotice}</span>
          {batchNoticeAction && (
            <button type="button" className="ln-btn ln-btn--ghost ln-btn--compact" onClick={batchNoticeAction.onClick}>{batchNoticeAction.label}</button>
          )}
        </div>
      )}
      {moveDialog && (
        <MoveTargetTreeDialog
          open
          nodes={props.nodes}
          movingIds={moveDialog.ids}
          currentParentId={moveDialog.currentParentId}
          busy={batchBusy}
          error={batchDialogError}
          onConfirm={(parentId) => { if (moveDialog) void runBatch({ action: "move", ids: moveDialog.ids, parentId }); }}
          onClose={() => { if (!batchBusy) { setMoveDialog(null); setBatchDialogError(null); } }}
        />
      )}
      {tagDialog && (
        <BatchTagDialog
          key={tagDialog.ids.join(",")}
          open
          count={tagDialog.ids.length}
          tags={tagCatalog.tags}
          loading={tagCatalog.loading}
          error={tagCatalog.error ?? batchDialogError}
          busy={batchBusy}
          onCreateTag={createBatchTag}
          onConfirm={confirmBatchTag}
          onClose={() => { if (!batchBusy) { setTagDialog(null); setBatchDialogError(null); } }}
        />
      )}
      {confirmElement}
      {/* Markdown 导入（261106 task-85）：进度浮层 + 结果汇总 */}
      <ImportProgressDialog
        open={importProgress !== null}
        done={importProgress?.done ?? 0}
        total={importProgress?.total ?? 0}
        currentFile={importProgress?.current ?? null}
        stopping={importStopping}
        onCancel={cancelMarkdownImport}
      />
      <ImportResultDialog
        open={importResult !== null}
        success={importResult?.success ?? 0}
        skipped={importResult?.skipped ?? []}
        failed={importResult?.failed ?? []}
        warnings={importResult?.warnings ?? []}
        onClose={() => setImportResult(null)}
      />
    </aside>
  );
});

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

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
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

/**
 * 「需要写名字」的新建 kind → 弹窗预设（标题 / 输入框 aria / 预填默认名）。
 * notebook 不预填（用户自己起名）；其余六个 kind 预填默认名，可改或直接确认。
 */
const CREATE_DIALOG_PRESETS: Record<CreateKind, { title: string; inputLabel: string; defaultName: string }> = {
  notebook: { title: "新建笔记本", inputLabel: "笔记本名称", defaultName: "" },
  group: { title: "新建分组", inputLabel: "分组名称", defaultName: "新建分组" },
  note: { title: "新建文档", inputLabel: "文档名称", defaultName: "无标题文档" },
  usheet: { title: "新建表格", inputLabel: "表格名称", defaultName: "无标题表格" },
  bitable: { title: "新建多维表", inputLabel: "多维表名称", defaultName: "无标题多维表" },
  board: { title: "新建画板", inputLabel: "画板名称", defaultName: "无标题画板" },
  ink: { title: "新建手写板", inputLabel: "手写板名称", defaultName: "无标题手写板" },
};

/** M1.6：目录节点（笔记本/分组/文档）自定义图标选择器 —— **自有面板，不复用内核表情面板的类**（261014）。
 *
 *  为什么与内核分离（用户 261014：「这两个面板可以分离了，做到互不影响」）：内核在**文档里**也用同一套
 *  `.ne-ui-unicode-emoji-*` 渲染它自己的表情面板；我们过去借用那套类 ⇒ 只能靠在未分层文件里写全局覆盖
 *  （`.ne-ui-unicode-emoji-item > button` / `-search input` / `-tabs`）并给该表面钉 5 个 `--lakex-editor-*`
 *  token 才立得住，而那些规则**同时命中文档内的内核面板**（互相影响，且内核一升级就可能变样）。
 *  ⇒ 现在这是**我们自己的一等面板**：表面走 Overlay 默认的 `.ln-popover`、输入走 kit 的 `.ln-input`、
 *  顶部类型页签走 kit 的 `.ln-tabs`，emoji/图标两页的网格与几何由 components/ui/nodeIcon.css 定义。
 *  几何沿用原观感（418 宽 / 内距 16 / 正文 266 高 / 8 列 / 32 格），定位仍走 usePopoverPosition（禁自夹）。 */
/** 目录节点图标选择器（261020 精简）：**容器（笔记本/分组）→ 语雀那套彩色插画；所有文档类型 → 表情符号**。
 *
 * 旧实现有两页页签（表情符号 / 图标），图标页是 40 个 lucide 线性图标 + 8 档浅渐变底块。用户 261020 判定观感不好，
 * 要求「彻底清除原来的图标这一块的逻辑」，并且「文档/表格等内容不再展示图标类目、只保留表情符号；笔记本和分组用新的这套」。
 * 因此现在**没有类型页签**：每类节点只有一类资源，面板顶部只留标题与「移除」。
 *
 * 表面仍是 Overlay 默认的 `.ln-popover`、输入走 kit 的 `.ln-input`，几何由 components/ui/nodeIcon.css 定义（禁自夹）。 */
