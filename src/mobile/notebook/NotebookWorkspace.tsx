/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { ArrowLeft, List, Files, Pencil, X, ChevronRight, FolderOpen, FolderPlus, File, Plus, Check, ArrowLeftRight, Trash, SmilePlus, Move, History, CloudUpload, MoreHorizontal, MoreVertical, FilePlus, Info, Table, Database, PenTool, Book } from "lucide-react";
import { useLongPress } from "../ui/useLongPress";
import { NoteInfoSheet } from "../ui/NoteInfoSheet";
import { EmojiPanel } from "../ui/EmojiPanel";
import { bridge } from "../bridge";
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
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { successFeedback, warnFeedback } from "../ui/haptics";
import { useAutoSave } from "../useAutoSave";
import type { LocalNote } from "../noteRepository";
import { MobileBoardViewer } from "../board/MobileBoardViewer";
/** 表格 / 多维表只读视图按需加载：只有真的打开这类文档才进分包（首屏不含它们）。 */
const MobileBitableViewer = lazy(() => import("../bitable/MobileBitableViewer").then((m) => ({ default: m.MobileBitableViewer })));
/** 表格（usheet）：与桌面同一套 Univer 内核的**只读**查看器（Univer 运行时随之按需加载）。 */
const MobileUsheetViewer = lazy(() => import("../usheet/MobileUsheetViewer").then((m) => ({ default: m.MobileUsheetViewer })));
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
interface TabState { id: string; title: string; content: string; editing: boolean; lastAccessedAt: number; kind: "doc" | "usheet" | "bitable" | "board"; }

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

  onCreateNote: () => void;
  /** 当前活动文档变化（MobileApp 的定时快照要用） */
  onActiveNoteChange?: (id: string | null) => void;
}

export function NotebookWorkspace(props: NotebookWorkspaceProps) {
  const { notebookId, initialNoteId, initialMode, onBack, notebooks, onSwitchNotebook, onCreateNote, onActiveNoteChange } = props;
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
  /** 目录抽屉的「新建」菜单（与桌面同一份清单；移动端只有文档/分组能落地，其余置灰）。
   *  `createParent` = 建到哪个节点下：抽屉工具栏的 ＋ = 笔记本根，行内 ＋ = 该行节点（复用同一个面板）。 */
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<string>(notebookId);
  /** 笔记本自己的图标（抽屉首行要展示 + 可点改名图标，桌面同款手势）。 */
  const [nbIcon, setNbIcon] = useState<string | null>(null);

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
  /** 设置图标的目标（行/分组/笔记本都走这一个面板；只用到 id）。 */
  const [iconFor, setIconFor] = useState<{ id: string; title: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<NotebookTreeItem | null>(null);
  const [historyList, setHistoryList] = useState<Array<{ id: number; title: string; createdAt: string }>>([]);
  /** 长按目标（hook 只能挂一次 ⇒ 用 ref 传"当前按下的那一行"）。 */
  const pressedNode = useRef<NotebookTreeItem | null>(null);
  const iconSheetRef = useRef<HTMLDivElement>(null);
  const historySheetRef = useRef<HTMLDivElement>(null);
  useSwipeToClose(iconSheetRef, () => setIconFor(null), !!iconFor);
  useSwipeToClose(historySheetRef, () => setHistoryFor(null), !!historyFor);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  /** 大纲只属于 Lake 文档：表格 / 多维表 / 画板没有大纲（与顶栏「编辑」按钮同一口径）。 */
  const outlineAvailable = !!active && (active.kind ?? "doc") === "doc";

  // 跟手开合抽屉（思源 touch.ts 口径：内容区任意横滑、面板跟手、释放按 1/3 屏宽提交）
  usePanelDrag({
    getPanel: (side: PanelSide) => document.querySelector<HTMLElement>(side === "left" ? ".side-panel--left" : ".side-panel--right"),
    getMask: (side: PanelSide) => document.querySelector<HTMLElement>('[data-panel-mask="' + side + '"]'),
    isOpen: (side: PanelSide) => (side === "left" ? sidebarOpen : outlineOpen),
    commit: (side: PanelSide, open: boolean) => { if (side === "left") openSidebar(open); else openOutline(open); },
    // 没有大纲时左滑不再拉出空面板（右滑开目录不受影响）；已展开的大纲仍可滑走关闭
    canOpen: (side: PanelSide) => side === "left" || outlineAvailable,
  });

  // 切到没有大纲的文档类型（表格 / 多维表 / 画板）时收掉已展开的大纲抽屉，别停在空面板上
  useEffect(() => { if (!outlineAvailable) setOutlineOpen(false); }, [outlineAvailable]);

  const loadTree = useCallback(async () => {
    const [treeArr, nodes] = await Promise.all([bridge.listNotebookTree(notebookId), bridge.listTreeNodes()]);
    setTree(treeArr);
    const nb = nodes.find((n) => n.id === notebookId);
    if (nb) { setTitle(nb.title); setNbIcon(nb.icon ?? null); }
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
    writeLocalStorage(TABS_KEY, JSON.stringify(tabs.map((t) => t.id)));
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
        const added = [...prev, { id, title: n.title, content: n.content, editing: pendingEditRef.current, lastAccessedAt: Date.now(), kind: n.kind }];
        pendingEditRef.current = false;
        const evicted = selectEvictionIds(added.map((t) => ({ noteId: t.id, lastAccessedAt: t.lastAccessedAt })), { limit: loadSettings().maxOpenTabs, activeNoteId: id, pinnedNoteIds: new Set() });
        if (evicted.length === 0) return added;
        const evictedSet = new Set(evicted);
        // LRU 驱逐同样要丢编辑器句柄（与 closeTab 对称）
        for (const ev of evicted) editorsRef.current.delete(ev);
        return added.filter((t) => !evictedSet.has(t.id));
      });
    }).catch((reason) => showToast("打开文档失败：" + getNativeErrorMessage(reason), { type: "error" }));
  }, [tabs]);

  // 已进入工作区后又被指定文档（新建 / 首页「最近文档」/ 搜索）：组件 key 是 notebookId，
  // 同一笔记本内再指定文档不会重挂载，「初次进入」那段被 autoOpenedRef 挡住 ⇒ 必须在这里显式打开，
  // 否则会"文档建好了但界面不跳转"。
  const handledInitialRef = useRef<string | null>(initialNoteId ?? null);
  useEffect(() => {
    if (!initialNoteId || handledInitialRef.current === initialNoteId) return;
    handledInitialRef.current = initialNoteId;
    pendingEditRef.current = initialMode === "editor";
    void openTab(initialNoteId);
  }, [initialNoteId, initialMode, openTab]);

  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    // keep-alive 编辑器实例句柄：关闭 tab 必须同步丢弃，否则 Map 只增不删 → 泄漏
    editorsRef.current.delete(id);
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

  // 立即同步（思源顶栏右侧的云图标就是同步状态/触发器）
  const runSync = useCallback(async () => {
    try { const r = await bridge.syncNow(); const w = r.notes?.warnings?.length ?? 0; showToast((r.message || "已同步") + (w > 0 ? `，${w} 项被跳过` : "")); }
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

  const toggleEdit = useCallback(async () => {
    if (!active) return;
    if (active.editing) {
      flushAutoSave();
      try {
        await bridge.saveNote(active.id, active.title, active.content);
      } catch (reason) {
        showToast("保存失败：" + getNativeErrorMessage(reason), { type: "error" });
        return;
      }
      successFeedback(); // 只有真正落盘后才提示完成
    }
    setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, editing: !t.editing } : t)));
  }, [active, flushAutoSave]);

  /** 行内 ＋ → 新建文档：在该节点下建子文档（对齐思源 .mb-iconbtn mb-row__action[data-type=new]）。 */
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

  // ---- 目录树长按管理（计时/阈值/反馈 = 共用 hook，见 ui/useLongPress.ts）----
  /** 长按 = 进入拖拽排序（菜单走行内 ⋯）。移动取消阈值取 0：目录行上一动就是要滚动，不能误判成长按。 */
  const longPressRows = useLongPress((touch) => {
    const node = pressedNode.current;
    if (!node) return;
    {
      const startX = touch.clientX;
      const startY = touch.clientY;
      // 关键：标记拖拽中 → CSS 给面板 touch-action:none，避免 WebView 把纵向手势判给滚动并 touchcancel 掉拖拽
      document.body.classList.add("nb-drag-active");
      // 长按 = 进入拖拽排序（菜单改由行内 ⋯ 触发）：克隆源行做跟手浮层，源行留在原位只降透明度（对齐思源）
      const sourceEl = document.querySelector<HTMLElement>('.side-panel-body [data-node-id="' + node.id + '"]');
      ghostRef.current = sourceEl ? createDragGhost(sourceEl, startX, startY) : null;
      setDrag({ id: node.id, overId: null, position: null, scrollDir: 0 });
    }
  }, { moveCancelPx: 0 });
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
  // 菜单是针对 menuFor 这个节点打开的（sheet 传进来的 item 就是它的根项），所以直接读 menuFor
  const onTreeMenuSelect = (_item: MobileSheetItem, path: MobileSheetItem[]) => {
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
            className={"mb-row mb-indent" + (activeId === it.id ? " is-selected" : "") + (drag?.id === it.id ? " nb-dragging" : "") + (drag?.overId === it.id && drag.position ? (drag.position === "inside" ? " drop-parent" : " drop-line-" + drag.position) : "")}
            data-depth={depth}
            data-node-id={it.id}
            onClick={() => {
              if (renamingId) return;
              if (hasChildren) { toggleGroup(it.id); return; }
              if (isNote) { openSidebar(false); void openTab(it.id); }
            }}
            onTouchStart={(e) => { pressedNode.current = it; longPressRows.onTouchStart(e); }}
            onTouchMove={longPressRows.onTouchMove}
            onTouchEnd={longPressRows.onTouchEnd}
            onTouchCancel={longPressRows.onTouchCancel}
            onContextMenu={(e) => e.preventDefault()}
          >
            {hasChildren ? <ChevronRight size={16} className={expanded.has(it.id) ? "mb-chevron open" : "mb-chevron"} /> : <span className="mb-chevron-spacer" />}
            {renamingId === it.id ? (
              <input
                className="mb-input"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => void applyRename()}
                onKeyDown={(e) => { if (e.key === "Enter") void applyRename(); if (e.key === "Escape") setRenamingId(null); }}
              />
            ) : (
              <>
                {it.icon ? <span className="mb-tree-icon">{it.icon}</span> : <NodeIcon size={16} className="mb-tree-icon" />}
                <span className="mb-row__title">{it.title}</span>
                {/* 移动端无 hover：动作常显（对齐思源移动端 .b3-list-item 不带 --hide-action）。
                    ⋯ = 右键菜单，＋ = 新建子文档。 */}
                <span className="nb-tree-actions">
                  <span role="button" tabIndex={0} className="nb-tree-action mb-tap" aria-label="更多" onClick={(e) => { e.stopPropagation(); setMenuFor(it); }}><MoreVertical size={17} /></span>
                  {/* 新建子项（用户 261014：**每一行都要有**，不只是笔记本根）——与工具栏 ＋ 共用同一个面板，
                      只是把作用域换成这一行；桌面同一个语义是"行右键 → 新建文档/分组"。 */}
                  <span role="button" tabIndex={0} className="nb-tree-action mb-tap" aria-label="新建子项" title="新建子项" onClick={(e) => { e.stopPropagation(); setCreateParent(it.id); setCreateOpen(true); }}><Plus size={17} /></span>
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
        {/* 只有 doc 可编辑：表格 / 多维表 / 画板在移动端都是只读查看器（usheet / bitable / board 各一个） */}
        <button
          className={"toolbar__button" + (active?.editing ? " toolbar__icon--active" : "")}
          onClick={toggleEdit}
          disabled={!active || (active.kind ?? "doc") !== "doc"}
          aria-label={active?.editing ? "完成" : "编辑"}
          title={(active?.kind ?? "doc") !== "doc" ? "该文档类型在移动端只读" : active?.editing ? "完成" : "编辑"}
        >{active?.editing ? <Check /> : <Pencil />}</button>
        <button className="toolbar__button" onClick={() => void runSync()} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
      </header>

      {/* 文档层（正文） */}
      <section className="mobile-workspace-body">
        {tabs.length === 0 ? (
          <div className="mb-empty">暂无打开的文档，点左目录或底部打开</div>
        ) : tabs.map((t) => (
          <div key={t.id} className={"doc-pane" + (t.id === activeId ? " active" : "")}>
            {/* 标题只在顶栏（思源 #toolbarName 口径）；正文区不再重复一个标题输入框 */}
            {t.kind === "board" ? (
              // 画板：移动端只读查看（同一套 Drawnix 引擎，绝不给 Lake 编辑器；也不保存）
              <MobileBoardViewer content={t.content} active={t.id === activeId} />
            ) : t.kind === "bitable" ? (
              // 多维表：移动端只读视图（同一份 core 数据模型求值，绝不写库）
              <Suspense fallback={<div className="mb-empty">正在加载多维表…</div>}>
                <MobileBitableViewer noteId={t.id} content={t.content} />
              </Suspense>
            ) : t.kind === "usheet" ? (
              // 表格：移动端只读呈现（同一套 Univer 内核；只读、不保存，正文 JSON 绝不喂 Lake 编辑器）
              <Suspense fallback={<div className="mb-empty">正在加载表格…</div>}>
                <MobileUsheetViewer noteId={t.id} content={t.content} active={t.id === activeId} />
              </Suspense>
            ) : t.kind !== "doc" ? (
              // 兜底防腐坏（AGENTS §3）：未知类型的正文不是 Lake HTML，**绝不允许** Lake 编辑器打开/保存。
              <div className="mb-empty">
                {t.title || "此文档"}：该类型暂不支持在移动端查看，请在桌面端打开。
              </div>
            ) : (
            <DocumentEditor
              note={{ id: t.id, title: t.title, content: t.content } as LocalNote}
              content={t.content}
              editing={t.editing}
              onContentChange={(c, plain) => { setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, content: c } : x))); if (t.editing) scheduleAutoSave(t.id, t.title, c, plain); }}
              documents={[]}
              hidePanels
              onEditorInstance={(ed) => {
                // DS 复核 A2：卸载时 onEditorReady(noteId, null) —— 必须 delete，不能 set(null)
                // （否则 closeTab 里 delete 后又会被 set 写回键）。get(activeId) ?? null 已兼容 undefined。
                if (ed) editorsRef.current.set(t.id, ed);
                else editorsRef.current.delete(t.id);
              }}
            />
            )}
          </div>
        ))}
      </section>

      {/* 底部胶囊栏（思源 #mobileBottomBar：纯图标）——只放阅读相关（文档树/标签/大纲/更多）；
          编辑与同步在顶栏右侧，避免打字时误触（用户 260909）。编辑态整条下滑淡出而不是卸载。 */}
      <nav className={"mobile-bottom-bar" + ((active?.editing || navHidden) ? " mobile-bottom-bar--hidden" : "")} data-prevent-swipe aria-hidden={(active?.editing || navHidden) ? "true" : "false"}>
        <button className={"mobile-bottom-bar__item" + (sidebarOpen ? " active" : "")} onClick={() => openSidebar(!sidebarOpen)} aria-label="文档树" title="文档树"><Files /></button>
        <button className={"mobile-bottom-bar__item" + (tabsOpen ? " active" : "")} onClick={() => setTabsOpen(true)} aria-label="标签页" title="标签页"><File />{tabs.length > 0 && <span className="bottom-bar-count">{tabs.length}</span>}</button>
        <button className={"mobile-bottom-bar__item" + (outlineOpen ? " active" : "")} onClick={() => openOutline(!outlineOpen)} disabled={!outlineAvailable} aria-label="大纲" title={outlineAvailable ? "大纲" : "该文档类型没有大纲"}><List /></button>
        <button className={"mobile-bottom-bar__item" + (moreOpen ? " active" : "")} onClick={() => setMoreOpen(true)} aria-label="更多" title="更多"><MoreHorizontal /></button>
      </nav>

      {/* 目录抽屉「新建」（261014 用户点单）：**清单与桌面 Sidebar 的 CREATE_CHILD_ITEMS 同款同序**
          （文档 / 表格 / 数据表 / 画板 / 分组）。移动端只有 **Lake 文档**与**分组**能落地 ——
          表格/数据表/画板需要各自的编辑器，移动端是只读查看 ⇒ **置灰并写明理由**（没有 hover，必须给一行文字）。
          不要在移动端偷偷建出"打不开的文档"。 */}
      <MobileSheetMenu
        open={createOpen}
        items={[
          { id: "note", label: "新建文档", icon: FilePlus },
          { id: "usheet", label: "新建表格", icon: Table, disabled: true, note: "移动端暂不支持编辑" },
          { id: "bitable", label: "新建数据表", icon: Database, disabled: true, note: "移动端暂不支持编辑" },
          { id: "board", label: "新建画板", icon: PenTool, disabled: true, note: "移动端暂不支持编辑" },
          { id: "group", label: "新建分组", icon: FolderPlus },
        ]}
        onClose={() => setCreateOpen(false)}
        onSelect={(it) => {
          setCreateOpen(false);
          // 复用目录树的同一份创建通道（行内 ＋ / 长按菜单同源），不新造第二条；作用域 = 本次打开它的那个节点
          if (it.id === "note") void createChildDoc(createParent);
          else if (it.id === "group") void createChildGroup(createParent);
        }}
      />

      {/* 更多（思源 #menu）。**不要**再把「搜索」「设置」放回来 —— 用户 261014 点单删掉：
          设置 = 首页左上齿轮（统一入口）；搜索 = 首页底部胶囊（同一份全局搜索 Sheet，且是全库范围、
          不是"笔记本内搜索"）⇒ 工作区里再放一份只是重复。本菜单只留"新建文档 / 切换笔记本 / 编辑本文"。 */}
      <MobileSheetMenu
        open={moreOpen}
        items={[
          { id: "new-doc", label: "新建文档", icon: FilePlus },
          { id: "switch-nb", label: "切换笔记本", icon: ArrowLeftRight, note: title },
          ...(active ? [{ id: "toggle-edit", label: active.editing ? "完成编辑" : "编辑本文", icon: Pencil }] : []),
        ]}
        onClose={() => setMoreOpen(false)}
        onSelect={(it) => {
          setMoreOpen(false);
          if (it.id === "toggle-edit") { toggleEdit(); return; }
          if (it.id === "new-doc") onCreateNote();
          else if (it.id === "switch-nb") setNotebookSwitchOpen(true);
        }}
      />

      {/* 左目录抽屉 (.side-panel) */}
      <div className={"side-mask" + (sidebarOpen ? " on" : "")} data-panel-mask="left" onClick={() => openSidebar(false)} />
      <aside className={"side-panel side-panel--left" + (sidebarOpen ? " on" : "")} aria-label="目录">
        <div className="toolbar toolbar--border toolbar--dark" data-prevent-swipe>
          <div className="toolbar__scroll">
            {/* 笔记本自己也是一行（用户 261014）：**图标 + 标题**；图标可点 = 设置图标（桌面 .tree-row-icon 同款手势） */}
            <span className="mb-tree-icon" aria-hidden="true">{nbIcon ? nbIcon : <Book size={16} />}</span>
            {renamingId === notebookId ? (
              <input
                className="mb-input"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => void applyRename()}
                onKeyDown={(e) => { if (e.key === "Enter") void applyRename(); if (e.key === "Escape") setRenamingId(null); }}
              />
            ) : (
              <span className="toolbar__text">{title}</span>
            )}
          </div>
          {/* 笔记本这一层**不放** ⋮（用户 261014：抽屉里的编辑入口去掉，改到首页「知识库」长按卡片） */}
          {/* 261014 用户点单：目录栏加「新建」（桌面同款清单） */}
          <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => { setCreateParent(notebookId); setCreateOpen(true); }} aria-label="新建" title="新建"><Plus /></span>
          <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => openSidebar(false)} aria-label="收起"><ChevronRight /></span>
        </div>
        <div className="side-panel-body">
          {childrenOf(notebookId).length === 0 && <div className="mb-empty">暂无文档，点右上新建</div>}
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
              {tabs.length === 0 && <div className="mb-empty">暂无打开的文档</div>}
              {tabs.map((t) => (
                <div key={t.id} className={"mb-row" + (t.id === activeId ? " is-selected" : "")} onClick={() => { openTab(t.id); setTabsOpen(false); }}>
                  <span className="mb-row__title">{t.title || "无标题"}</span>
                  <button className="mb-iconbtn mb-row__action" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} aria-label="关闭"><X size={16} /></button>
                </div>
              ))}
              <button className="mb-btn mb-btn--secondary model-add" onClick={() => { setTabsOpen(false); openSidebar(true); }}><Plus size={16} />打开文档</button>
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
        <NoteInfoSheet
          noteFileId={infoFor.id}
          title={infoFor.title}
          onClose={() => setInfoFor(null)}
          onOpenHistory={() => { const n = infoFor; setInfoFor(null); void openHistory(n); }}
        />
      )}

      {/* 图标选择器 */}
      {iconFor && (
        <div className="mb-scrim" data-prevent-swipe onClick={() => setIconFor(null)}>
          <div ref={iconSheetRef} className="mb-sheet" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
            <div className="mb-sheet__head">
              <span className="mb-sheet__title">设置图标</span>
              <button className="mobile-icon-btn" onClick={() => setIconFor(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mb-sheet__body">
              <EmojiPanel onPick={(icon) => void applyIcon(icon)} onClear={() => void applyIcon(null)} />
            </div>
          </div>
        </div>
      )}

      {/* 历史版本 sheet */}
      {historyFor && (
        <div className="mb-scrim" data-prevent-swipe onClick={() => setHistoryFor(null)}>
          <div ref={historySheetRef} className="mb-sheet" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
            <div className="mb-sheet__head">
              <span className="mb-sheet__title">历史版本</span>
              <button className="mobile-icon-btn" onClick={() => setHistoryFor(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mb-sheet__body mb-list">
              {historyList.length === 0 && <p className="mb-empty mb-empty--inset">暂无历史版本</p>}
              {historyList.map((h) => (
                <div key={h.id} className="mb-row" onClick={() => void applyRestoreHistory(h.id)}>
                  <span className="mb-row__title">{h.title || "无标题"}</span>
                  <span className="mb-row__meta">{new Date(h.createdAt).toLocaleString("zh-CN")}</span>
                  <button className="mb-iconbtn mb-row__action" onClick={(e) => { e.stopPropagation(); void deleteHistory(h.id); }} aria-label="删除"><X size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
