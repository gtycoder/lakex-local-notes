/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, List, Files, Pencil, X, ChevronRight, FolderOpen, FolderPlus, File, Plus, Check, ArrowLeftRight, Trash, SmilePlus, Move, History, CloudUpload, MoreHorizontal, MoreVertical, FilePlus, Search, Settings, Copy, Info } from "lucide-react";
import { NoteInfoDialog } from "../../components/NoteInfoDialog";
import { bridge } from "../bridge";
import { LAKE_EMOJIS } from "../../lib/lakeEmojis";
import { loadSettings } from "../../lib/settings";
import { selectEvictionIds } from "../../core/tabLimit";
import { DocumentEditor } from "../editor/DocumentEditor";
import { OutlineSheet } from "../editor/OutlineSheet";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { usePanelDrag, type PanelSide } from "../usePanelDrag";
import { computeDropPosition, createDragGhost, moveDragGhost, removeDragGhost, type DragGhost } from "../../components/treeDrag";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { useSwipeToClose } from "../ui/useSwipeToClose";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { longPressFeedback, successFeedback, warnFeedback } from "../ui/haptics";
import { useAutoSave } from "../useAutoSave";
import type { POCNote } from "../noteRepository";
/** 笔记本子树节点（原 NotebookPage 的类型，页面本体已随"两套壳"统一删除）。 */
export interface NotebookTreeItem {
  id: string;
  title: string;
  kind: "group" | "note";
  parentId: string | null;
  sortOrder: number;
  icon: string | null;
}
import type { TreeNode } from "../../lib/types";

/** 打开文档 tab 的内容状态（按 tab 缓存，切换不丢草稿） */
interface TabState { id: string; title: string; content: string; editing: boolean; lastAccessedAt: number; }

export interface NotebookWorkspaceProps {
  notebookId: string;
  initialNoteId?: string | null;
  /** 打开时直接进入编辑态（首页/搜索"新建文档"用） */
  initialMode?: "viewer" | "editor";
  onBack: () => void;
  /** 全部笔记本（切换笔记本用） */
  notebooks: TreeNode[];
  /** 切换到另一个笔记本 */
  onSwitchNotebook: (id: string) => void;
  /** 底部栏「更多」菜单要拉起的第一层浮层（思源：主菜单承担搜索/设置等入口） */
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onCreateNote: () => void;
  /** 当前活动文档变化（MobileApp 的定时快照要用） */
  onActiveNoteChange?: (id: string | null) => void;
}

export function NotebookWorkspace(props: NotebookWorkspaceProps) {
  const { notebookId, initialNoteId, initialMode, onBack, notebooks, onSwitchNotebook, onOpenSearch, onOpenSettings, onCreateNote, onActiveNoteChange } = props;
  const [title, setTitle] = useState("知识库");
  const [tree, setTree] = useState<NotebookTreeItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([notebookId]));
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialNoteId ?? null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [notebookSwitchOpen, setNotebookSwitchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  // 思源：左右两侧面板互斥（都是 100vw 全屏抽屉，同时开会互相盖住）
  const openSidebar = useCallback((v: boolean) => { setSidebarOpen(v); if (v) { setOutlineOpen(false); setTabsOpen(false); } }, []);
  const openOutline = useCallback((v: boolean) => { setOutlineOpen(v); if (v) { setSidebarOpen(false); setTabsOpen(false); } }, []);
  const editorsRef = useRef<Map<string, LakeEditorInstance | null>>(new Map());
  const autoOpenedRef = useRef(false);
  const pendingEditRef = useRef(initialMode === "editor");
  // 标签保持：本地记录上次打开的标签（按笔记本隔离）
  const TABS_KEY = "lake-notes-mobile.tabs." + notebookId;

  // 目录树长按管理：思源 sheet 菜单 / 内联重命名 / 图标 / 移动（菜单子层）/ 删除（确认框）
  const [menuFor, setMenuFor] = useState<NotebookTreeItem | null>(null);
  /** 长按拖拽排序（思源口径）：长按进入拖拽，跟手位移 + 落点（前/后/内），松手重排或移入分组。 */
  const [drag, setDrag] = useState<{
    id: string;
    overId: string | null; position: "before" | "after" | "inside" | null;
    /** 边缘自动滚动方向 */
    scrollDir: -1 | 0 | 1;
  } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;
  const ghostRef = useRef<DragGhost | null>(null);
  const [infoFor, setInfoFor] = useState<NotebookTreeItem | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [iconFor, setIconFor] = useState<NotebookTreeItem | null>(null);
  const [historyFor, setHistoryFor] = useState<NotebookTreeItem | null>(null);
  const [historyList, setHistoryList] = useState<Array<{ id: number; title: string; createdAt: string }>>([]);
  const longPressTimer = useRef<number | null>(null);
  const iconSheetRef = useRef<HTMLDivElement>(null);
  const historySheetRef = useRef<HTMLDivElement>(null);
  useSwipeToClose(iconSheetRef, () => setIconFor(null), !!iconFor);
  useSwipeToClose(historySheetRef, () => setHistoryFor(null), !!historyFor);

  // 跟手开合抽屉（思源 touch.ts 口径：内容区任意横滑、面板跟手、释放按 1/3 屏宽提交）
  usePanelDrag({
    getPanel: (side: PanelSide) => document.querySelector<HTMLElement>(side === "left" ? ".side-panel--left" : ".side-panel--right"),
    getMask: (side: PanelSide) => document.querySelector<HTMLElement>('[data-panel-mask="' + side + '"]'),
    isOpen: (side: PanelSide) => (side === "left" ? sidebarOpen : outlineOpen),
    commit: (side: PanelSide, open: boolean) => { if (side === "left") openSidebar(open); else openOutline(open); },
  });

  const loadTree = useCallback(async () => {
    const [treeArr, nodes] = await Promise.all([bridge.listNotebookTree(notebookId), bridge.listTreeNodes()]);
    setTree(treeArr);
    const nb = nodes.find((n) => n.id === notebookId);
    if (nb) setTitle(nb.title);
    return treeArr;
  }, [notebookId]);

  useEffect(() => { void loadTree(); }, [loadTree]);

  // 初次进入（仅一次）：
  //  - 显式指定了要打开的文档（首页「最近文档」/搜索/新建）→ 优先开它并置为活动标签（修"点最近文档直达不了"）；
  //    其余上次已存的标签（不含它）补开，不覆盖它的激活态；
  //  - 否则恢复上次打开的标签（本地持久化）；
  //  - 否则开树中第一个。
  useEffect(() => {
    if (autoOpenedRef.current) return;
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? "[]") as string[]; } catch { saved = []; }
    if (initialNoteId) {
      autoOpenedRef.current = true;
      saved.filter((id) => id !== initialNoteId).forEach((id) => void openTab(id));
      void openTab(initialNoteId);
      return;
    }
    if (saved.length > 0) { autoOpenedRef.current = true; saved.forEach((id) => void openTab(id)); return; }
    const first = findFirstNote(tree);
    if (first) { autoOpenedRef.current = true; void openTab(first.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // 标签保持：打开标签变化即落本地（仅本机，不参与同步）
  useEffect(() => {
    try { localStorage.setItem(TABS_KEY, JSON.stringify(tabs.map((t) => t.id))); } catch { /* 忽略 */ }
  }, [tabs, TABS_KEY]);

  const openTab = useCallback((id: string) => {
    setActiveId(id);
    // 已打开：仅刷新 LRU 时间戳，不重读正文（keep-alive）
    setTabs((prev) => prev.some((t) => t.id === id) ? prev.map((t) => (t.id === id ? { ...t, lastAccessedAt: Date.now() } : t)) : prev);
    if (tabs.some((t) => t.id === id)) return;
    void bridge.readNote(id).then((n) => {
      if (!n) return;
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        const added = [...prev, { id, title: n.title, content: n.content, editing: pendingEditRef.current, lastAccessedAt: Date.now() }];
        pendingEditRef.current = false;
        const evicted = selectEvictionIds(added.map((t) => ({ noteId: t.id, lastAccessedAt: t.lastAccessedAt })), { limit: loadSettings().maxOpenTabs, activeNoteId: id, pinnedNoteIds: new Set() });
        if (evicted.length === 0) return added;
        const evictedSet = new Set(evicted);
        return added.filter((t) => !evictedSet.has(t.id));
      });
    });
  }, [tabs]);

  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) setActiveId(next.length ? next[Math.min(idx, next.length - 1)].id : null);
  }, [tabs, activeId]);

  const toggleGroup = (id: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  // 必须按 sortOrder 排序：否则拖拽的乐观重排（只改 sortOrder 不动数组顺序）看不出效果——
  // 同级拖动会"没反应"，而 inside（改了 parentId）却能立刻显示。这是同级拖不动的真因。
  const childrenOf = (parentId: string) => tree.filter((it) => it.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const findFirstNote = (arr: NotebookTreeItem[]): NotebookTreeItem | null => {
    for (const it of arr) {
      if (it.kind === "note") return it;
      const sub = findFirstNote(childrenOf(it.id));
      if (sub) return sub;
    }
    return null;
  };

  // 编辑：保存当前 tab
  const active = tabs.find((t) => t.id === activeId) ?? null;

  // 立即同步（思源顶栏右侧的云图标就是同步状态/触发器）
  const runSync = useCallback(async () => {
    try { const r = await bridge.syncNow(); showToast(r.message || "已同步"); }
    catch (e) { showToast("同步失败：" + (e as Error).message, { type: "error" }); }
  }, []);

  // 活动文档上报（MobileApp 的定时自动快照按当前文档留档）
  useEffect(() => { onActiveNoteChange?.(activeId); }, [activeId, onActiveNoteChange]);

  // 自动保存：编辑态内容变化防抖 1s 落盘
  const { schedule: scheduleAutoSave, flush: flushAutoSave } = useAutoSave(async (id, title, content, plain) => {
    await bridge.saveNote(id, title, content, null, plain);
  });

  // 阅读态：文档下滑 → 底栏隐藏；上滑 → 弹出（思源设计，修"阅读时底部悬浮框消失后不再出现"）
  useEffect(() => {
    if (active?.editing) { setNavHidden(false); return; }
    const scroller = document.querySelector<HTMLElement>(".doc-pane.active .mobile-doc-body");
    if (!scroller) return;
    setNavHidden(false);
    let last = scroller.scrollTop;
    const onScroll = () => {
      const cur = scroller.scrollTop;
      if (cur - last > 8) setNavHidden(true);
      else if (last - cur > 8) setNavHidden(false);
      last = cur;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [activeId, active?.editing, tabs.length]);

  const toggleEdit = useCallback(() => {
    if (!active) return;
    if (active.editing) {
      flushAutoSave();
      void bridge.saveNote(active.id, active.title, active.content);
      successFeedback(); // 完成编辑（保存落盘）
    } else {
    }
    setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, editing: !t.editing } : t)));
  }, [active, flushAutoSave]);

  /** 行内 ＋ → 新建文档：在该节点下建子文档（对齐思源 .b3-list-item__action[data-type=new]）。 */
  const createChildDoc = useCallback(async (parentId: string) => {
    try {
      const n = await bridge.createNote("无标题文档", parentId);
      await loadTree();
      await openTab(n.id);
    } catch { showToast("新建失败", { type: "error" }); }
  }, [loadTree, openTab]);

  /** 行内 ＋ → 新建分组：在该节点下建子分组并展开父节点。 */
  const createChildGroup = useCallback(async (parentId: string) => {
    try {
      await bridge.createGroup(parentId, "新建分组");
      await loadTree();
      setExpanded((prev) => new Set(prev).add(parentId));
    } catch { showToast("新建失败", { type: "error" }); }
  }, [loadTree]);

  // ---- 目录树长按管理 ----
  const clearLongPress = () => {
    if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  const startLongPress = (e: React.TouchEvent, node: NotebookTreeItem) => {
    clearLongPress();
    const touch = e.touches[0];
    if (!touch) return;
    const startX = touch.clientX;
    const startY = touch.clientY;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      longPressFeedback();
      // 关键：标记拖拽中 → CSS 给面板 touch-action:none，避免 WebView 把纵向手势判给滚动并 touchcancel 掉拖拽
      document.body.classList.add("nb-drag-active");
      // 长按 = 进入拖拽排序（菜单改由行内 ⋯ 触发）：克隆源行做跟手浮层，源行留在原位只降透明度（对齐思源）
      const sourceEl = document.querySelector<HTMLElement>('.side-panel-body [data-node-id="' + node.id + '"]');
      ghostRef.current = sourceEl ? createDragGhost(sourceEl, startX, startY) : null;
      setDrag({ id: node.id, overId: null, position: null, scrollDir: 0 });
    }, 350);
  };
  /** 提交拖拽：同父 → reorderSiblings；跨父/拖入分组 → moveTreeNodeOrdered。 */
  const commitDrag = useCallback(async () => {
    const d = dragRef.current;
    setDrag(null);
    removeDragGhost(ghostRef.current);
    ghostRef.current = null;
    document.body.classList.remove("nb-drag-active");
    if (!d || !d.overId || d.overId === d.id) return;
    const dragged = tree.find((x) => x.id === d.id);
    const over = tree.find((x) => x.id === d.overId);
    if (!dragged || !over) return;
    // inside → 成为该节点的子文档（移动端 notes 也能作父，不止分组）；before/after → 与目标同级
    const targetParent = d.position === "inside" ? over.id : over.parentId;
    const siblings = tree.filter((x) => (x.parentId ?? null) === (targetParent ?? null) && x.id !== d.id);
    let insertAt = siblings.length;
    if (d.position !== "inside") {
      const idx = siblings.findIndex((x) => x.id === over.id);
      insertAt = idx < 0 ? siblings.length : (d.position === "after" ? idx + 1 : idx);
    }
    const orderedIds = [...siblings.slice(0, insertAt).map((x) => x.id), d.id, ...siblings.slice(insertAt).map((x) => x.id)];
    const orderIndex = new Map(orderedIds.map((id, i) => [id, i] as const));
    const before = document.querySelector('.side-panel-body [data-node-id="' + d.id + '"]')?.getBoundingClientRect();
    // 乐观更新：本地立即重排，松手即生效（不等 loadTree 读库 → 修掉 ~2s 延迟）
    setTree(tree.map((x) => {
      const moved = x.id === d.id ? { ...x, parentId: targetParent } : x;
      const i = orderIndex.get(moved.id);
      return i === undefined ? moved : { ...moved, sortOrder: i };
    }));
    if (d.position === "inside") setExpanded((prev) => new Set(prev).add(over.id));
    // FLIP：重排后从旧位置平移到新位置（松手回弹）
    window.requestAnimationFrame(() => {
      const el = document.querySelector('.side-panel-body [data-node-id="' + d.id + '"]') as HTMLElement | null;
      const after = el?.getBoundingClientRect();
      if (!el || !before || !after) return;
      const fromDy = before.top - after.top;
      if (Math.abs(fromDy) <= 1) return;
      el.style.transition = "none";
      el.style.transform = "translateY(" + fromDy + "px)";
      window.requestAnimationFrame(() => {
        el.style.transition = "transform 180ms cubic-bezier(.2,.8,.2,1)";
        el.style.transform = "";
        window.setTimeout(() => { el.style.transition = ""; el.style.transform = ""; }, 220);
      });
    });
    // 持久化（仅在失败时重读纠正）
    try {
      if (d.position === "inside") await bridge.moveTreeNodeOrdered(d.id, targetParent!, orderedIds);
      else if ((dragged.parentId ?? null) === (targetParent ?? null)) await bridge.reorderSiblings(targetParent, orderedIds);
      else await bridge.moveTreeNodeOrdered(d.id, targetParent, orderedIds);
      successFeedback(); // 拖拽落点提交成功
    } catch { showToast("移动失败", { type: "error" }); warnFeedback(); void loadTree(); }
  }, [tree, loadTree]);

  useEffect(() => {
    if (!drag) return;
    const panel = document.querySelector(".side-panel-body") as HTMLElement | null;
    let raf = 0;
    /** 由手指位置算出落点（overId/position）与边缘滚动方向；源行留在原位不参与让位（对齐思源）。 */
    const compute = (clientX: number, clientY: number, d: NonNullable<typeof dragRef.current>) => {
      const hit = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest("[data-node-id]") as HTMLElement | null;
      const hitId = hit?.getAttribute("data-node-id") ?? null;
      let overId: string | null = null;
      let position: "before" | "after" | "inside" | null = null;
      if (hit && hitId && hitId !== d.id) {
        overId = hitId;
        position = computeDropPosition(hit.getBoundingClientRect(), clientY) ?? "inside";
      }
      // 边缘自动滚动：靠近面板上/下沿 64px 内 → 持续滚动
      let scrollDir: -1 | 0 | 1 = 0;
      if (panel) {
        const pr = panel.getBoundingClientRect();
        if (clientY < pr.top + 64) scrollDir = -1;
        else if (clientY > pr.bottom - 64) scrollDir = 1;
      }
      return { overId, position, scrollDir };
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      const d = dragRef.current;
      if (!d) return;
      moveDragGhost(ghostRef.current, t.clientX, t.clientY);
      const next = compute(t.clientX, t.clientY, d);
      if (d.overId === next.overId && d.position === next.position && d.scrollDir === next.scrollDir) return;
      setDrag({ ...d, ...next });
    };
    const tick = () => {
      const d = dragRef.current;
      if (!d || !panel) { raf = 0; return; }
      if (d.scrollDir && panel.scrollHeight > panel.clientHeight) panel.scrollTop += d.scrollDir * 8;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    const onEnd = () => { removeDragGhost(ghostRef.current); ghostRef.current = null; void commitDrag(); };
    const onCancel = () => { removeDragGhost(ghostRef.current); ghostRef.current = null; document.body.classList.remove("nb-drag-active"); void commitDrag(); };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      document.body.classList.remove("nb-drag-active");
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [drag !== null, commitDrag]);

  // 组件卸载时清掉可能残留的拖拽浮层
  useEffect(() => () => { removeDragGhost(ghostRef.current); ghostRef.current = null; }, []);

  const applyRename = useCallback(async () => {
    const id = renamingId; const v = renameValue.trim();
    setRenamingId(null);
    if (id && v) { try { await bridge.renameTreeNode(id, v); await loadTree(); } catch { /* 忽略 */ } }
  }, [renamingId, renameValue, loadTree]);
  const applyIcon = useCallback(async (icon: string | null) => {
    const n = iconFor; setIconFor(null);
    if (n) { try { await bridge.setNodeIcon(n.id, icon); await loadTree(); } catch { /* 忽略 */ } }
  }, [iconFor, loadTree]);
  const applyDelete = useCallback(async (node: NotebookTreeItem) => {
    const ok = await confirmMobile({
      title: node.kind === "note" ? "移入回收站？" : "删除分组？",
      body: node.title || "无标题",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await bridge.trashTreeItem(node.id, node.kind === "note" ? "note" : "folder");
      await loadTree();
      // 已打开的标签必须一起关掉：否则回收站文档仍留在 tab 里可继续编辑（AGENTS §3 #16）
      closeTab(node.id);
      showToast("已移入回收站");
    } catch { showToast("删除失败", { type: "error" }); }
  }, [loadTree, closeTab]);
  const applyMove = useCallback(async (n: NotebookTreeItem, targetParentId: string) => {
    if (!n || n.parentId === targetParentId || n.id === targetParentId) return;
    try {
      const siblings = tree.filter((x) => x.parentId === targetParentId && x.id !== n.id).map((x) => x.id);
      await bridge.moveTreeNodeOrdered(n.id, targetParentId, [...siblings, n.id]);
      await loadTree();
      showToast("已移动");
    } catch { showToast("移动失败", { type: "error" }); }
  }, [tree, loadTree]);


  const openHistory = useCallback(async (node: NotebookTreeItem) => {
    setHistoryFor(node);
    try { setHistoryList(await bridge.listNoteHistory(node.id)); } catch { setHistoryList([]); }
  }, []);
  const applyRestoreHistory = useCallback(async (id: number) => {
    const ok = await confirmMobile({ title: "恢复此版本？", body: "将用该历史版本覆盖当前正文（当前正文会先自动留档）。", confirmText: "恢复", danger: true });
    if (!ok) return;
    try {
      await bridge.restoreHistory(id);
      setHistoryFor(null);
      await loadTree();
      showToast("已恢复历史版本");
    } catch { showToast("恢复失败", { type: "error" }); }
  }, [loadTree]);
  const deleteHistory = useCallback(async (historyId: number) => {
    try {
      await bridge.deleteHistory(historyId);
      setHistoryList((prev) => prev.filter((h) => h.id !== historyId));
    } catch { /* 忽略 */ }
  }, []);

  /** 目录树长按菜单（思源 .b3-menu--sheet 口径）：移动到… 用子层下钻，删除走危险项 + 确认框 */
  const treeMenuItems = (node: NotebookTreeItem): MobileSheetItem[] => {
    const groups = tree.filter((x) => x.kind === "group" && x.id !== node.id);
    return [
      { id: "new-note", label: "新建文档", icon: File },
      { id: "new-group", label: "新建分组", icon: FolderPlus },
      ...(node.kind === "note" ? [
        { id: "duplicate", label: "复制", icon: Copy },
        { id: "rename", label: "重命名", icon: Pencil },
      ] : [{ id: "rename", label: "重命名", icon: Pencil }]),
      { id: "icon", label: "设置图标", icon: SmilePlus },
      {
        id: "move", label: "移动到…", icon: Move,
        children: [
          { id: "__root", label: title, icon: FolderOpen, note: "笔记本根目录" },
          ...groups.map((g) => ({ id: g.id, label: g.title, icon: FolderOpen })),
        ],
      },
      ...(node.kind === "note" ? [
        { id: "history", label: "历史版本", icon: History },
        { id: "info", label: "属性", icon: Info },
      ] : []),
      { id: "delete", label: node.kind === "note" ? "移入回收站" : "删除分组", icon: Trash, danger: true },
    ];
  };
  const onTreeMenuSelect = (item: MobileSheetItem, path: MobileSheetItem[]) => {
    const node = menuFor;
    setMenuFor(null);
    if (!node) return;
    const root = path[0]?.id;
    if (root === "new-note") { void createChildDoc(node.id); return; }
    if (root === "new-group") { void createChildGroup(node.id); return; }
    if (root === "move") { void applyMove(node, path[1]?.id === "__root" ? notebookId : String(path[1]?.id)); return; }
    if (root === "rename") { setRenamingId(node.id); setRenameValue(node.title); return; }
    if (root === "icon") { setIconFor(node); return; }
    if (root === "history") { void openHistory(node); return; }
    if (root === "duplicate") {
      void (async () => {
        try { const created = await bridge.duplicateNote(node.id); await loadTree(); void openTab(created.id); showToast("已复制为「" + created.title + "」"); }
        catch { showToast("复制失败"); }
      })();
      return;
    }
    if (root === "info") { setInfoFor(node); return; }
    if (root === "delete") { void applyDelete(node); }
  };

  const renderBranch = (parentId: string, depth: number) => {
    const children = childrenOf(parentId);
    return children.map((it) => {
      const hasChildren = childrenOf(it.id).length > 0;
      const NodeIcon = it.kind === "group" ? FolderOpen : File;
      const isNote = it.kind === "note";
      return (
        <div key={it.kind + "-" + it.id}>
          <button
            className={"b3-list-item ln-indent" + (activeId === it.id ? " b3-list-item--selected" : "") + (drag?.id === it.id ? " nb-dragging" : "") + (drag?.overId === it.id && drag.position ? (drag.position === "inside" ? " drop-parent" : " drop-line-" + drag.position) : "")}
            data-depth={depth}
            data-node-id={it.id}
            onClick={() => {
              if (renamingId) return;
              if (hasChildren) { toggleGroup(it.id); return; }
              if (isNote) { openSidebar(false); void openTab(it.id); }
            }}
            onTouchStart={(e) => startLongPress(e, it)}
            onTouchMove={clearLongPress}
            onTouchEnd={clearLongPress}
            onTouchCancel={clearLongPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            {hasChildren ? <ChevronRight size={16} className={expanded.has(it.id) ? "ln-chevron open" : "ln-chevron"} /> : <span className="ln-chevron-spacer" />}
            {renamingId === it.id ? (
              <input
                className="b3-text-field"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => void applyRename()}
                onKeyDown={(e) => { if (e.key === "Enter") void applyRename(); if (e.key === "Escape") setRenamingId(null); }}
              />
            ) : (
              <>
                {it.icon ? <span className="ln-tree-icon">{it.icon}</span> : <NodeIcon size={16} className="ln-tree-icon" />}
                <span className="b3-list-item__text">{it.title}</span>
                {/* 移动端无 hover：动作常显（对齐思源移动端 .b3-list-item 不带 --hide-action）。
                    ⋯ = 右键菜单，＋ = 新建子文档。 */}
                <span className="nb-tree-actions">
                  <span role="button" tabIndex={0} className="nb-tree-action" aria-label="更多" onClick={(e) => { e.stopPropagation(); setMenuFor(it); }}><MoreVertical size={17} /></span>
                </span>
              </>
            )}
          </button>
          {hasChildren && expanded.has(it.id) && renderBranch(it.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="mobile-workspace">
      {/* 顶部栏（思源 #mobileTopBar：.toolbar--border + .toolbar__title 左对齐 + 右侧同步状态） */}
      <header className="toolbar toolbar--border mobile-topbar">
        <button className="toolbar__button" onClick={onBack} aria-label="返回"><ArrowLeft /></button>
        <input
          className={"toolbar__title" + (active?.editing ? "" : " toolbar__title--readonly")}
          value={active?.title ?? title}
          readOnly={!active?.editing}
          placeholder={active ? "" : title}
          aria-label="文档标题"
          onChange={(e) => {
            const t = e.target.value;
            const id = activeId;
            if (!id) return;
            setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, title: t } : x)));
            scheduleAutoSave(id, t, tabs.find((x) => x.id === id)?.content ?? "");
          }}
        />
        <button className={"toolbar__button" + (active?.editing ? " toolbar__icon--active" : "")} onClick={toggleEdit} disabled={!active}
          aria-label={active?.editing ? "完成" : "编辑"} title={active?.editing ? "完成" : "编辑"}>{active?.editing ? <Check /> : <Pencil />}</button>
        <button className="toolbar__button" onClick={() => void runSync()} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
      </header>

      {/* 文档层（正文） */}
      <section className="mobile-workspace-body">
        {tabs.length === 0 ? (
          <div className="mobile-empty">暂无打开的文档，点左目录或底部打开</div>
        ) : tabs.map((t) => (
          <div key={t.id} className={"doc-pane" + (t.id === activeId ? " active" : "")}>
            {/* 标题只在顶栏（思源 #toolbarName 口径）；正文区不再重复一个标题输入框 */}
            <DocumentEditor
              note={{ id: t.id, title: t.title, content: t.content } as POCNote}
              content={t.content}
              title={t.title}
              editing={t.editing}
              onContentChange={(c, plain) => { setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, content: c } : x))); if (t.editing) scheduleAutoSave(t.id, t.title, c, plain); }}
              onToggleEdit={toggleEdit}
              documents={[]}
              hidePanels
              onEditorInstance={(ed) => { editorsRef.current.set(t.id, ed); }}
            />
          </div>
        ))}
      </section>

      {/* 底部胶囊栏（思源 #mobileBottomBar：纯图标）——只放阅读相关（文档树/标签/大纲/更多）；
          编辑与同步在顶栏右侧，避免打字时误触（用户 260909）。编辑态整条下滑淡出而不是卸载。 */}
      <nav className={"mobile-bottom-bar" + ((active?.editing || navHidden) ? " mobile-bottom-bar--hidden" : "")} data-prevent-swipe aria-hidden={(active?.editing || navHidden) ? "true" : "false"}>
        <button className={"mobile-bottom-bar__item" + (sidebarOpen ? " active" : "")} onClick={() => openSidebar(!sidebarOpen)} aria-label="文档树" title="文档树"><Files /></button>
        <button className={"mobile-bottom-bar__item" + (tabsOpen ? " active" : "")} onClick={() => setTabsOpen(true)} aria-label="标签页" title="标签页"><File />{tabs.length > 0 && <span className="bottom-bar-count">{tabs.length}</span>}</button>
        <button className={"mobile-bottom-bar__item" + (outlineOpen ? " active" : "")} onClick={() => openOutline(!outlineOpen)} aria-label="大纲" title="大纲"><List /></button>
        <button className={"mobile-bottom-bar__item" + (moreOpen ? " active" : "")} onClick={() => setMoreOpen(true)} aria-label="更多" title="更多"><MoreHorizontal /></button>
      </nav>

      {/* 更多（思源 #menu：主菜单承担搜索/设置等次级入口） */}
      <MobileSheetMenu
        open={moreOpen}
        items={[
          { id: "new-doc", label: "新建文档", icon: FilePlus },
          { id: "switch-nb", label: "切换笔记本", icon: ArrowLeftRight, note: title },
          { id: "search", label: "搜索", icon: Search },
          { id: "settings", label: "设置", icon: Settings },
          ...(active ? [{ id: "toggle-edit", label: active.editing ? "完成编辑" : "编辑本文", icon: Pencil }] : []),
        ]}
        onClose={() => setMoreOpen(false)}
        onSelect={(it) => {
          setMoreOpen(false);
          if (it.id === "toggle-edit") { toggleEdit(); return; }
          if (it.id === "new-doc") onCreateNote();
          else if (it.id === "switch-nb") setNotebookSwitchOpen(true);
          else if (it.id === "search") onOpenSearch();
          else if (it.id === "settings") onOpenSettings();
        }}
      />

      {/* 左目录抽屉 (.side-panel) */}
      <div className={"side-mask" + (sidebarOpen ? " on" : "")} data-panel-mask="left" onClick={() => openSidebar(false)} />
      <aside className={"side-panel side-panel--left" + (sidebarOpen ? " on" : "")} aria-label="目录">
        <div className="toolbar toolbar--border toolbar--dark" data-prevent-swipe>
          <div className="toolbar__scroll"><span className="toolbar__text">{title}</span></div>
          <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => openSidebar(false)} aria-label="收起"><ChevronRight /></span>
        </div>
        <div className="side-panel-body">
          {childrenOf(notebookId).length === 0 && <div className="mobile-empty">暂无文档，点右上新建</div>}
          {renderBranch(notebookId, 0)}
        </div>
      </aside>

      {/* 右大纲抽屉 (.side-panel--right) */}
      <OutlineSheet side open={outlineOpen} editor={activeId ? (editorsRef.current.get(activeId) ?? null) : null} onClose={() => setOutlineOpen(false)} />

      {/* 全屏 tab 列表 (.model，思源 #toolbarTabs → #model) */}
      {tabsOpen && (
        <div className="mobile-model-mask" onClick={() => setTabsOpen(false)}>
          <div className="mobile-model" onClick={(e) => e.stopPropagation()}>
            <div className="toolbar toolbar--border mobile-model-head">
              <span className="toolbar__text">标签页</span>
              <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => setTabsOpen(false)} aria-label="关闭"><X /></span>
            </div>
            <div className="mobile-model-body">
              {tabs.length === 0 && <div className="mobile-empty">暂无打开的文档</div>}
              {tabs.map((t) => (
                <div key={t.id} className={"b3-list-item" + (t.id === activeId ? " b3-list-item--selected" : "")} onClick={() => { openTab(t.id); setTabsOpen(false); }}>
                  <span className="b3-list-item__text">{t.title || "无标题"}</span>
                  <button className="b3-list-item__action" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} aria-label="关闭"><X size={16} /></button>
                </div>
              ))}
              <button className="b3-button b3-button--outline model-add" onClick={() => { setTabsOpen(false); openSidebar(true); }}><Plus size={16} />打开文档</button>
            </div>
          </div>
        </div>
      )}

      {/* 笔记本切换（思源 sheet 菜单：贴底、56dvh、下钻即整屏平移） */}
      <MobileSheetMenu
        open={notebookSwitchOpen}
        items={notebooks.map((nb) => ({ id: nb.id, label: nb.title, icon: FolderOpen, note: nb.id === notebookId ? "当前" : undefined }))}
        onClose={() => setNotebookSwitchOpen(false)}
        onSelect={(it) => { setNotebookSwitchOpen(false); if (it.id !== notebookId) { onSwitchNotebook(it.id); } }}
      />

      {/* 目录树长按菜单 */}
      <MobileSheetMenu
        open={!!menuFor}
        items={menuFor ? treeMenuItems(menuFor) : []}
        onClose={() => setMenuFor(null)}
        onSelect={onTreeMenuSelect}
      />


      {/* 文档属性（长按 → 属性） */}
      {infoFor && (
        <NoteInfoDialog
          note={{ noteFileId: infoFor.id, title: infoFor.title }}
          onClose={() => setInfoFor(null)}
          onOpenHistory={() => { const n = infoFor; setInfoFor(null); void openHistory(n); }}
        />
      )}

      {/* 图标选择器 */}
      {iconFor && (
        <div className="mobile-sheet-mask" data-prevent-swipe onClick={() => setIconFor(null)}>
          <div ref={iconSheetRef} className="mobile-sheet" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <span className="mobile-sheet-title">设置图标</span>
              <button className="mobile-icon-btn" onClick={() => setIconFor(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-sheet-body">
              <div className="mobile-emoji-grid">
                {LAKE_EMOJIS.map((e) => (
                  <button key={e.name + e.char} className="mobile-emoji-cell" onClick={() => void applyIcon(e.char)} title={e.name}>{e.char}</button>
                ))}
              </div>
              <button className="b3-button b3-button--outline" onClick={() => void applyIcon(null)}>清除图标</button>
            </div>
          </div>
        </div>
      )}

      {/* 历史版本 sheet */}
      {historyFor && (
        <div className="mobile-sheet-mask" data-prevent-swipe onClick={() => setHistoryFor(null)}>
          <div ref={historySheetRef} className="mobile-sheet" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <span className="mobile-sheet-title">历史版本</span>
              <button className="mobile-icon-btn" onClick={() => setHistoryFor(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-sheet-body b3-list--mobile">
              {historyList.length === 0 && <p className="mobile-sheet-empty">暂无历史版本</p>}
              {historyList.map((h) => (
                <div key={h.id} className="b3-list-item" onClick={() => void applyRestoreHistory(h.id)}>
                  <span className="b3-list-item__text">{h.title || "无标题"}</span>
                  <span className="b3-list-item__meta">{new Date(h.createdAt).toLocaleString("zh-CN")}</span>
                  <button className="b3-list-item__action" onClick={(e) => { e.stopPropagation(); void deleteHistory(h.id); }} aria-label="删除"><X size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
