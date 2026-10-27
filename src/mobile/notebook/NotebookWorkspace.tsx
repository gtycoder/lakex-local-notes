/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, List, Files, Pencil, X, ChevronRight, FolderOpen, FolderPlus, File, Plus, Check, ArrowLeftRight, Trash, SmilePlus, Move, History, CloudUpload, MoreVertical, FilePlus, Info, Table, Database, PenTool, PenLine, Book, Search, Star } from "lucide-react";
import { useLongPress } from "../ui/useLongPress";
import { NoteInfoSheet } from "../ui/NoteInfoSheet";
import { MobileNodeIconPicker } from "../ui/NodeIconPicker";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import { bridge } from "../bridge";
import { DocumentEditor } from "../editor/DocumentEditor";
import { OutlineSheet } from "../editor/OutlineSheet";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { usePanelDrag, type PanelSide } from "../hooks/usePanelDrag";
import { computeDropPosition, createDragGhost, moveDragGhost, removeDragGhost, type DragGhost } from "../../components/model/treeDrag";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { useSwipeToClose } from "../ui/useSwipeToClose";
import { showToast } from "../ui/toastBus";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { successFeedback, warnFeedback } from "../ui/haptics";
import { useAutoSave } from "../hooks/useAutoSave";
import type { LocalNote } from "../data/noteRepository";
import { chromeAfterScroll, type ChromeScrollState } from "./scrollChrome";
import { isFavorite, toggleFavorite } from "../data/favorites";
import { MobileBoardViewer } from "../board/MobileBoardViewer";
import { notebookTabsStorageKey, useNotebookTabs, type NotebookTab } from "./useNotebookTabs";
import { useNotebookTreeData, type NotebookTreeItem } from "./useNotebookTreeData";
import { useNotebookTreeActions } from "./useNotebookTreeActions";
export type { NotebookTreeItem } from "./useNotebookTreeData";
/** 表格 / 多维表只读视图按需加载：只有真的打开这类文档才进分包（首屏不含它们）。 */
const MobileBitableViewer = lazy(() => import("../bitable/MobileBitableViewer").then((m) => ({ default: m.MobileBitableViewer })));
/** 表格（usheet）：与桌面同一套 Univer 内核的**只读**查看器（Univer 运行时随之按需加载）。 */
const MobileUsheetViewer = lazy(() => import("../usheet/MobileUsheetViewer").then((m) => ({ default: m.MobileUsheetViewer })));
/** 手写板：共享 InkPad + perfect-freehand，按需分包。 */
const MobileInkPad = lazy(() => import("../ink/MobileInkPad").then((m) => ({ default: m.MobileInkPad })));
import type { TreeNode } from "../../lib/types";

/** 「新建」清单 id → 文档 kind（清单与创建通道的唯一对应表；group 不走这里）。 */
const CREATE_MENU_KINDS: Record<string, "doc" | "usheet" | "bitable" | "board" | "ink"> = {
  note: "doc",
  usheet: "usheet",
  bitable: "bitable",
  board: "board",
  ink: "ink",
};

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

  /** 当前活动文档变化（MobileApp 的定时快照要用） */
  onActiveNoteChange?: (id: string | null) => void;
  /** Android 硬件返回键必须走工作区自己的可等待保存流程，不能由父层直接卸载。 */
  onRegisterBackHandler?: (handler: (() => Promise<void>) | null) => void;
}

export function NotebookWorkspace(props: NotebookWorkspaceProps) {
  const { notebookId, initialNoteId, initialMode, onBack, notebooks, onSwitchNotebook, onActiveNoteChange, onRegisterBackHandler } = props;
  const {
    tree,
    setTree,
    title,
    notebookIcon: nbIcon,
    expanded,
    toggleGroup,
    expandGroup,
    childrenOf,
    loadTree,
  } = useNotebookTreeData(notebookId);
  const editorsRef = useRef<Map<string, LakeEditorInstance | null>>(new Map());
  /** 实例内正文（usheet / board）的同步 capture：完成/关标签前现取最新 body，绕过防抖。 */
  const liveBodyCapturesRef = useRef<Map<string, () => string | null>>(new Map());
  const reportReadError = useCallback((reason: unknown) => {
    showToast("打开文档失败：" + getNativeErrorMessage(reason), { type: "error" });
  }, []);
  const reportReadMissing = useCallback(() => {
    showToast("文档不存在或正文文件缺失", { type: "error" });
  }, []);
  const dropTabResources = useCallback((id: string) => {
    editorsRef.current.delete(id);
    liveBodyCapturesRef.current.delete(id);
  }, []);
  const getTabTitle = useCallback((id: string) => tree.find((item) => item.id === id)?.title, [tree]);
  const {
    tabs,
    tabsRef: tabsStateRef,
    active,
    activeId,
    mountedIds,
    freshId,
    openTab,
    loadTabBody,
    removeTab,
    clearTabs,
    updateTab,
  } = useNotebookTabs({
    notebookId,
    initialNoteId,
    getTitle: getTabTitle,
    readBody: (id) => bridge.readNote(id),
    onReadError: reportReadError,
    onMissing: reportReadMissing,
    onDrop: dropTabResources,
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** 文档内查找条：只对 Lake 文档（doc）开放；切文档时自动收起（查找条绑定当前正文）。 */
  const [findOpen, setFindOpen] = useState(false);
  useEffect(() => { setFindOpen(false); }, [activeId]);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [notebookSwitchOpen, setNotebookSwitchOpen] = useState(false);
  /** 目录抽屉的「新建」菜单（与桌面同一份清单；移动端只有文档/分组能落地，其余置灰）。
   *  `createParent` = 建到哪个节点下：抽屉工具栏的 ＋ = 笔记本根，行内 ＋ = 该行节点（复用同一个面板）。 */
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<string>(notebookId);

  // 思源：左右两侧面板互斥（都是 100vw 全屏抽屉，同时开会互相盖住）
  const openSidebar = useCallback((v: boolean) => { setSidebarOpen(v); if (v) { setOutlineOpen(false); setTabsOpen(false); } }, []);
  const openOutline = useCallback((v: boolean) => { setOutlineOpen(v); if (v) { setSidebarOpen(false); setTabsOpen(false); } }, []);
  const autoOpenedRef = useRef(false);
  const closingRef = useRef(false);

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
  /** 长按目标（hook 只能挂一次 ⇒ 用 ref 传"当前按下的那一行"）。 */
  const pressedNode = useRef<NotebookTreeItem | null>(null);
  const iconSheetRef = useRef<HTMLDivElement>(null);
  const historySheetRef = useRef<HTMLDivElement>(null);

  /** 大纲只属于 Lake 文档：表格 / 多维表 / 画板没有大纲（与顶栏「编辑」按钮同一口径）。 */
  const outlineAvailable = !!active && (active.kind ?? "doc") === "doc";
  /**
   * 阅读态「顶栏 / 底栏自动收起」（261019，对齐思源 .mobile-chrome--hidden 手感）：
   * 判据在 ./scrollChrome（纯函数），这里只接 DOM：只认当前活动 .mobile-doc-body 的滚动，且只在
   * kind=doc 且非编辑态生效（编辑态有 dock/键盘，不能动）。切文档 / 进出编辑 / 打开任意浮层 → 复位展开。
   */
  const [chrome, setChrome] = useState<ChromeScrollState>({ hidden: false, acc: 0 });
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const bodyRef = useRef<HTMLElement | null>(null);
  const activeMetaRef = useRef({ kind: "doc" as string, editing: false });
  activeMetaRef.current = { kind: active?.kind ?? "doc", editing: !!active?.editing };
  const chromeHiddenNow = chrome.hidden && !active?.editing && (active?.kind ?? "doc") === "doc";
  const showChrome = useCallback(() => {
    if (chromeRef.current.hidden || chromeRef.current.acc) setChrome({ hidden: false, acc: 0 });
  }, []);
  // 切文档 / 进出编辑 / 打开浮层：导航必须回来（否则用户要操作时看不见入口）
  useEffect(() => { setChrome({ hidden: false, acc: 0 }); }, [activeId]);
  useEffect(() => { if (active?.editing) setChrome({ hidden: false, acc: 0 }); }, [active?.editing]);
  useEffect(() => {
    if (sidebarOpen || outlineOpen || tabsOpen || notebookSwitchOpen) showChrome();
  }, [sidebarOpen, outlineOpen, tabsOpen, notebookSwitchOpen, showChrome]);

  // 滚动监听：scroll 事件不冒泡，用**捕获**在正文容器上拿；只有 .mobile-doc-body（文字阅读）参与。
  const lastScrollRef = useRef(0);
  useEffect(() => { lastScrollRef.current = 0; }, [activeId]);
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const onScroll = (e: Event): void => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.classList?.contains("mobile-doc-body")) return;
      const meta = activeMetaRef.current;
      if (meta.kind !== "doc" || meta.editing) return;
      const top = el.scrollTop;
      const dy = top - lastScrollRef.current;
      lastScrollRef.current = top;
      const cur = chromeRef.current;
      const next = chromeAfterScroll(cur, top, dy);
      if (next.hidden !== cur.hidden || next.acc !== cur.acc) setChrome(next);
    };
    root.addEventListener("scroll", onScroll, true);
    return () => root.removeEventListener("scroll", onScroll, true);
  }, []);

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

  // 初次进入（仅一次）：
  //  - 显式指定了要打开的文档（首页/搜索/新建）→ 优先开它并置为活动标签（修"从首页点文档直达不了"）；
  //    其余上次已存的标签（不含它）补开，不覆盖它的激活态；
  //  - 否则恢复上次打开的标签（本地持久化）；
  //  - 否则开树中第一个。
  useEffect(() => {
    if (autoOpenedRef.current) return;
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(notebookTabsStorageKey(notebookId)) ?? "[]") as string[]; } catch { saved = []; }
    const knownNoteIds = new Set(tree.filter((item) => item.kind === "note").map((item) => item.id));
    saved = saved.filter((id) => knownNoteIds.has(id) || id === initialNoteId);
    if (initialNoteId) {
      autoOpenedRef.current = true;
      // 先把当前文档的读取发出去（其它历史标签排后面，避免它的 readNote 被队头拖慢）
      void openTab(initialNoteId, { enterEditor: initialMode === "editor" });
      saved.filter((id) => id !== initialNoteId).forEach((id) => void openTab(id, { activate: false, load: false }));
      return;
    }
    if (saved.length > 0) {
      autoOpenedRef.current = true;
      // 只让最后一个历史标签成为活动页，其余只登记（避免一上来挂载全部编辑器）；
      // 活动页的读取排在第一个，别被其它历史标签拖慢
      void openTab(saved[saved.length - 1], { activate: true });
      saved.slice(0, -1).forEach((id) => void openTab(id, { activate: false, load: false }));
      return;
    }
    const first = findFirstNote(tree);
    if (first) { autoOpenedRef.current = true; void openTab(first.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // 已进入工作区后又被指定文档（新建 / 首页 / 搜索）：组件 key 是 notebookId，
  // 同一笔记本内再指定文档不会重挂载，「初次进入」那段被 autoOpenedRef 挡住 ⇒ 必须在这里显式打开，
  // 否则会"文档建好了但界面不跳转"。
  const handledInitialRef = useRef<string | null>(initialNoteId ?? null);
  useEffect(() => {
    if (!initialNoteId || handledInitialRef.current === initialNoteId) return;
    handledInitialRef.current = initialNoteId;
    void openTab(initialNoteId, { enterEditor: initialMode === "editor" });
  }, [initialNoteId, initialMode, openTab]);

  /** 活动占位页统一在这里补读正文；openTab / 自愈 / 恢复都共用同一条懒加载路径。 */
  useEffect(() => {
    if (!active || active.loaded) return;
    void loadTabBody(active.id);
  }, [active?.id, active?.loaded, loadTabBody]);

  // 自动保存：编辑态内容变化防抖 1s 落盘；flush 返回真实写盘 Promise，失败保留界面并提示。
  const reportAutoSaveError = useCallback((_id: string, reason: unknown) => {
    showToast("保存失败：" + getNativeErrorMessage(reason), { type: "error" });
  }, []);
  const { schedule: scheduleAutoSave, flush: flushAutoSave, cancel: cancelAutoSave } = useAutoSave(async (id, title, content, plain) => {
    await bridge.saveNote(id, title, content, null, plain);
  }, { onError: reportAutoSaveError });

  /** 现取 usheet/board 最新正文并等待保存完成；成功前不释放实例 capture，也不关闭界面。 */
  const captureAndSaveTab = useCallback(async (tab: NotebookTab): Promise<void> => {
    const captured = liveBodyCapturesRef.current.get(tab.id)?.();
    if (captured && captured !== tab.content) {
      scheduleAutoSave(tab.id, tab.title, captured);
    }
    await flushAutoSave(tab.id);
  }, [flushAutoSave, scheduleAutoSave]);

  /** 返回首页 / 切换笔记本 / 关闭全部前的统一保存屏障。 */
  const flushAllTabs = useCallback(async (): Promise<void> => {
    await Promise.all(tabsStateRef.current.map((tab) => captureAndSaveTab(tab)));
    await flushAutoSave();
  }, [captureAndSaveTab, flushAutoSave]);

  /** 关闭全部标签：任一保存失败都不清空界面，避免 UI 先假装成功。 */
  const closeAllTabs = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      clearTabs();
      setTabsOpen(false);
    } catch { /* useAutoSave.onError 已给出可见原因；保留全部标签供重试 */ }
    finally { closingRef.current = false; }
  }, [clearTabs, flushAllTabs]);

  const closeTab = useCallback(async (id: string) => {
    if (closingRef.current) return;
    const closing = tabsStateRef.current.find((t) => t.id === id);
    if (!closing) return;
    closingRef.current = true;
    try {
      await captureAndSaveTab(closing);
      removeTab(id);
    } catch { /* 保留当前 tab 与编辑器，允许重试 */ }
    finally { closingRef.current = false; }
  }, [captureAndSaveTab, removeTab]);

  /** 文档已进回收站后的关闭：不能再保存（写边界会正确拒绝），直接丢弃本地 tab。 */
  const discardTab = useCallback((id: string) => {
    removeTab(id);
  }, [removeTab]);

  const {
    menuFor,
    setMenuFor,
    infoFor,
    setInfoFor,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    iconFor,
    setIconFor,
    historyFor,
    setHistoryFor,
    historyList,
    applyRename,
    applyIcon,
    applyDelete,
    applyMove,
    openHistory,
    restoreHistory: applyRestoreHistory,
    deleteHistory,
  } = useNotebookTreeActions({ tree, loadTree, discardTab });
  useSwipeToClose(iconSheetRef, () => setIconFor(null), !!iconFor);
  useSwipeToClose(historySheetRef, () => setHistoryFor(null), !!historyFor);

  /** 返回首页：等待所有正文与文档保存落盘后才交给路由转场；失败留在当前界面。 */
  const handleBack = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      onBack();
    } catch { /* useAutoSave.onError 已给出可见原因 */ }
    finally { closingRef.current = false; }
  }, [flushAllTabs, onBack]);

  /** 切换笔记本同属离开当前工作区，必须先过同一保存屏障。 */
  const switchNotebook = useCallback(async (id: string) => {
    if (id === notebookId || closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      onSwitchNotebook(id);
    } catch { /* 保存失败时保持当前工作区 */ }
    finally { closingRef.current = false; }
  }, [notebookId, flushAllTabs, onSwitchNotebook]);

  // Android 返回键由父层转交给这里（不能直接 closeWorkspace，否则异步保存会被卸载打断）。
  useEffect(() => {
    onRegisterBackHandler?.(handleBack);
    return () => onRegisterBackHandler?.(null);
  }, [handleBack, onRegisterBackHandler]);

  // 进后台是 WebView 可能被冻结前最后一次可靠落盘时机；只 best-effort，不销毁 capture/界面。
  const flushAllTabsRef = useRef(flushAllTabs);
  flushAllTabsRef.current = flushAllTabs;
  useEffect(() => {
    let remove: (() => void) | null = null;
    void import("@capacitor/app").then(async ({ App }) => {
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) void flushAllTabsRef.current().catch(() => undefined);
      });
      remove = () => { void handle.remove(); };
    }).catch(() => undefined);
    return () => remove?.();
  }, []);

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
    try {
      const r = await bridge.syncNow();
      // 同步可能改了远端标题/正文：刷新目录，并在阅读态强制重读当前文档（编辑态不打断）。
      await loadTree();
      const activeTab = tabsStateRef.current.find((t) => t.id === activeId);
      if (activeTab && !activeTab.editing) await loadTabBody(activeTab.id, true);
      const w = r.notes?.warnings?.length ?? 0;
      showToast((r.message || "已同步") + (w > 0 ? `，${w} 项被跳过` : ""));
    } catch (e) { showToast("同步失败：" + (e as Error).message, { type: "error" }); }
  }, [loadTree, openTab, activeId]);

  // 活动文档上报（MobileApp 的定时自动快照按当前文档留档）
  useEffect(() => { onActiveNoteChange?.(activeId); }, [activeId, onActiveNoteChange]);

  const toggleEdit = useCallback(async () => {
    if (!active?.loaded) return;
    // usheet / board 的正文在实例里；完成时同步 capture，不能只读父级 state（可能还在防抖窗口内）。
    const captured = active.kind === "usheet" || active.kind === "board"
      ? liveBodyCapturesRef.current.get(active.id)?.() ?? null
      : null;
    const nextContent = captured ?? active.content;
    if (active.editing) {
      cancelAutoSave(active.id); // 旧 timer 里的 content 可能落后于 captured
      try {
        await bridge.saveNote(active.id, active.title, nextContent);
      } catch (reason) {
        showToast("保存失败：" + getNativeErrorMessage(reason), { type: "error" });
        return;
      }
      successFeedback(); // 只有真正落盘后才提示完成
    }
    updateTab(active.id, { content: nextContent, editing: !active.editing });
  }, [active, cancelAutoSave, updateTab]);

  /**
   * 行内 ＋ / 抽屉「新建」→ 建子节点（同一条创建管线：建库 → 刷新目录 → 收抽屉 → 打开标签）。
   * 文档/手写板建完停在阅读态；表格/数据表/画板建完直接进编辑态。
   * createParent 理论上总是当前节点；空串兜底回当前笔记本，避免建出 parent_id="" 的孤儿。
   */
  const createChildDocument = useCallback(async (kind: "doc" | "usheet" | "bitable" | "board" | "ink", parentId: string) => {
    try {
      const pid = parentId || notebookId;
      const n = kind === "doc" ? await bridge.createNote("无标题文档", pid)
        : kind === "usheet" ? await bridge.createUsheet("无标题表格", pid)
          : kind === "bitable" ? await bridge.createBitable("无标题多维表", pid)
            : kind === "board" ? await bridge.createBoard("无标题画板", pid)
              : await bridge.createInk("无标题手写板", pid);
      await loadTree();
      setSidebarOpen(false);
      // 手写板沿用 remote ink 批的行为：建完停在阅读态（与文档一致），需要时再点顶栏「编辑」
      await openTab(n.id, { enterEditor: kind === "usheet" || kind === "bitable" || kind === "board" });
    } catch { showToast("新建失败", { type: "error" }); }
  }, [loadTree, openTab, notebookId]);

  /** 行内 ＋ → 新建分组：在该节点下建子分组并展开父节点。 */
  const createChildGroup = useCallback(async (parentId: string) => {
    try {
      await bridge.createGroup(parentId || notebookId, "新建分组");
      await loadTree();
      expandGroup(parentId || notebookId);
    } catch { showToast("新建失败", { type: "error" }); }
  }, [loadTree, notebookId]);

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
    if (d.position === "inside") expandGroup(over.id);
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

  /** 目录树长按菜单（思源 .b3-menu--sheet 口径）：移动到… 用子层下钻，删除走危险项 + 确认框 */
  const treeMenuItems = (node: NotebookTreeItem): MobileSheetItem[] => {
    const groups = tree.filter((x) => x.kind === "group" && x.id !== node.id);
    return [
      // 261019 用户点单：**菜单里不再放「新建文档 / 新建分组」** —— 行内 ＋（新建子项）与抽屉工具栏「新建」
      // 已经提供同一份创建清单，菜单只保留「对这一行本身的动作」，不再重复创建入口。
      ...(node.kind === "note" ? [
        { id: "rename", label: "重命名", icon: Pencil },
      ] : [{ id: "rename", label: "重命名", icon: Pencil }]),
      { id: "icon", label: "设置图标", icon: SmilePlus },
      // 「常用」：只对文档开放（分组/笔记本没有卡片入口）；仅本机，不同步（用户 261019 点单）
      ...(node.kind === "note" ? [
        { id: "favorite", label: isFavorite(node.id) ? "取消常用" : "设为常用", icon: Star },
      ] : []),
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
    if (root === "move") { void applyMove(node, path[1]?.id === "__root" ? notebookId : String(path[1]?.id)); return; }
    if (root === "rename") { setRenamingId(node.id); setRenameValue(node.title); return; }
    if (root === "icon") { setIconFor(node); return; }
    if (root === "favorite") { const on = toggleFavorite(node.id); showToast(on ? "已设为常用" : "已取消常用"); return; }
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
                {it.icon ? <span className="mb-tree-icon"><MobileNodeIconGlyph value={it.icon} /></span> : <NodeIcon size={16} className="mb-tree-icon" />}
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
      <header
        className={"toolbar toolbar--border mobile-topbar" + (chromeHiddenNow ? " mobile-topbar--auto-hidden" : "")}
        aria-hidden={chromeHiddenNow ? "true" : "false"}
      >
        <button className="toolbar__button" onClick={handleBack} aria-label="返回"><ArrowLeft /></button>
        <input
          className={"toolbar__title" + (active?.editing && active.loaded ? "" : " toolbar__title--readonly")}
          value={active?.title ?? title}
          readOnly={!active?.editing || !active.loaded}
          placeholder={active ? "" : title}
          aria-label="文档标题"
          onChange={(e) => {
            const t = e.target.value;
            const id = activeId;
            if (!id || !active?.loaded) return;
            updateTab(id, { title: t });
            scheduleAutoSave(id, t, tabs.find((x) => x.id === id)?.content ?? "");
          }}
        />
        {/* doc / 表格 / 数据表 / 画板 / 手写板都可编辑（261020 起数据表不再只读；各自一个专用 viewer/editor）。 */}
        <button
          className={"toolbar__button" + (active?.editing ? " toolbar__icon--active" : "")}
          onClick={toggleEdit}
          disabled={!active?.loaded || ((active.kind ?? "doc") !== "doc" && active.kind !== "usheet" && active.kind !== "bitable" && active.kind !== "board" && active.kind !== "ink")}
          aria-label={active?.editing ? "完成" : "编辑"}
          title={!active || ((active.kind ?? "doc") !== "doc" && active.kind !== "usheet" && active.kind !== "bitable" && active.kind !== "board" && active.kind !== "ink")
            ? "该文档类型在移动端只读"
            : active.editing ? "完成" : "编辑"}
        >{active?.editing ? <Check /> : <Pencil />}</button>
        {/* 文档内查找（移动端）：内核查找面板在移动端不存在（工具栏插件被关），
            故入口收在这里、由 MobileFindBar 做 DOM 内查找；工作区胶囊是定稿四格、不放搜索。 */}
        <button
          className={"toolbar__button" + (findOpen ? " toolbar__icon--active" : "")}
          onClick={() => setFindOpen((v) => !v)}
          disabled={!active?.loaded || (active.kind ?? "doc") !== "doc"}
          aria-label="在文档中查找"
          title={(active?.kind ?? "doc") !== "doc" ? "该文档类型不支持查找" : "在文档中查找"}
        ><Search /></button>
        <button className="toolbar__button" onClick={() => void runSync()} aria-label="立即同步" title="立即同步"><CloudUpload /></button>
      </header>

      {/* 文档层（正文） */}
      <section className="mobile-workspace-body" ref={bodyRef}>
        {/* 正在异步读回（刚点开、还没进 tabs）时先画骨架：避免转场落位后先闪一块空白再蹦出正文。 */}
        {!active || !mountedIds.has(active.id) ? (
          activeId ? (
            <div className="mb-doc-skeleton" aria-busy="true" aria-label="正在打开文档">
              <span className="mb-skel mb-doc-skeleton__title" />
              <span className="mb-skel mb-doc-skeleton__line" />
              <span className="mb-skel mb-doc-skeleton__line" />
              <span className="mb-skel mb-doc-skeleton__line" />
              <span className="mb-skel mb-doc-skeleton__line" />
              <span className="mb-skel mb-doc-skeleton__line mb-doc-skeleton__line--short" />
            </div>
          ) : (
            <div className="mb-empty">暂无打开的文档，点左目录或底部打开</div>
          )
        ) : tabs.map((t) => (
          <div key={t.id} className={"doc-pane" + (t.id === activeId ? " active" : "") + (t.id === freshId ? " doc-pane--fresh" : "")}>
            {/* 未挂载的 keep-alive tab 只占位、不起编辑器（首次切到它时才挂载，见 mountedIds） */}
            {!mountedIds.has(t.id) ? null : (
            <>
            {/* 标题只在顶栏（思源 #toolbarName 口径）；正文区不再重复一个标题输入框 */}
            {t.kind === "board" ? (
              // 画板：移动端只读查看（同一套 Drawnix 引擎，绝不给 Lake 编辑器；也不保存）
              <MobileBoardViewer
                noteId={t.id}
                content={t.content}
                active={t.id === activeId}
                editing={t.editing}
                onChange={(c) => {
                  updateTab(t.id, { content: c });
                  if (t.editing) scheduleAutoSave(t.id, t.title, c);
                }}
                onCapture={(capture) => {
                  if (capture) liveBodyCapturesRef.current.set(t.id, capture);
                  else liveBodyCapturesRef.current.delete(t.id);
                }}
              />
            ) : t.kind === "ink" ? (
              <Suspense fallback={<div className="mb-empty">正在加载手写板…</div>}>
                <MobileInkPad
                  content={t.content}
                  active={t.id === activeId}
                  readOnly={!t.editing}
                  onChange={(c) => { updateTab(t.id, { content: c }); if (t.editing) scheduleAutoSave(t.id, t.title, c); }}
                />
              </Suspense>
            ) : t.kind === "bitable" ? (
              // 多维表：移动端查看/编辑（同一份 core 数据模型与写入纯函数；正文 JSON 绝不给 Lake 编辑器）。
              // 只有当前活动页可编辑：切走后自动收起记录/字段面板，回来再恢复编辑态。
              <Suspense fallback={<div className="mb-empty">正在加载多维表…</div>}>
                <MobileBitableViewer
                  noteId={t.id}
                  content={t.content}
                  editing={t.editing && t.id === activeId}
                  onChange={(c) => {
                    updateTab(t.id, { content: c });
                    if (t.editing) scheduleAutoSave(t.id, t.title, c);
                  }}
                />
              </Suspense>
            ) : t.kind === "usheet" ? (
              // 表格：移动端只读呈现（同一套 Univer 内核；只读、不保存，正文 JSON 绝不喂 Lake 编辑器）
              <Suspense fallback={<div className="mb-empty">正在加载表格…</div>}>
                <MobileUsheetViewer
                  noteId={t.id}
                  content={t.content}
                  active={t.id === activeId}
                  editing={t.editing}
                  onChange={(c) => {
                    updateTab(t.id, { content: c });
                    if (t.editing) scheduleAutoSave(t.id, t.title, c);
                  }}
                  onCapture={(capture) => {
                    if (capture) liveBodyCapturesRef.current.set(t.id, capture);
                    else liveBodyCapturesRef.current.delete(t.id);
                  }}
                />
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
              onContentChange={(c, plain) => { updateTab(t.id, { content: c }); if (t.editing) scheduleAutoSave(t.id, t.title, c, plain); }}
              documents={[]}
              hidePanels
              findOpen={findOpen && t.id === activeId}
              onCloseFind={() => setFindOpen(false)}
              onEditorInstance={(ed) => {
                // DS 复核 A2：卸载时 onEditorReady(noteId, null) —— 必须 delete，不能 set(null)
                // （否则 closeTab 里 delete 后又会被 set 写回键）。get(activeId) ?? null 已兼容 undefined。
                if (ed) editorsRef.current.set(t.id, ed);
                else editorsRef.current.delete(t.id);
              }}
            />
            )}
            </>
            )}
          </div>
        ))}
      </section>

      {/* 底部胶囊栏（思源 #mobileBottomBar：纯图标）——只放阅读相关（文档树/标签/大纲/更多）；
          编辑与同步在顶栏右侧，避免打字时误触（用户 260909）。编辑态整条下滑淡出而不是卸载。 */}
      <nav
        className={"mobile-bottom-bar"
          + ((active?.editing || chromeHiddenNow) ? " mobile-bottom-bar--hidden" : "")
          // 表格（usheet）页底部有自己的 Univer 工具条（工作表标签/缩放/求和）⇒ 胶囊上移让位（261019）
          + (active?.kind === "usheet" ? " mobile-bottom-bar--above-sheet" : "")}
        data-prevent-swipe
        aria-hidden={(active?.editing || chromeHiddenNow) ? "true" : "false"}
      >
        <button className={"mobile-bottom-bar__item" + (sidebarOpen ? " active" : "")} onClick={() => openSidebar(!sidebarOpen)} aria-label="文档树" title="文档树"><Files /></button>
        <button className={"mobile-bottom-bar__item" + (tabsOpen ? " active" : "")} onClick={() => setTabsOpen(true)} aria-label="标签页" title="标签页"><File />{tabs.length > 0 && <span className="bottom-bar-count">{tabs.length}</span>}</button>
        <button className={"mobile-bottom-bar__item" + (outlineOpen ? " active" : "")} onClick={() => openOutline(!outlineOpen)} disabled={!outlineAvailable} aria-label="大纲" title={outlineAvailable ? "大纲" : "该文档类型没有大纲"}><List /></button>
        {/* 261014 用户点单：最后一格「更多」已无意义（编辑在顶栏、新建在抽屉/行内）⇒ 直接把「切换笔记本」做成这一格 */}
        <button className="mobile-bottom-bar__item" onClick={() => setNotebookSwitchOpen(true)} aria-label="切换笔记本" title={"切换笔记本（当前：" + title + "）"}><ArrowLeftRight /></button>
      </nav>

      {/* 目录抽屉「新建」（261014 用户点单）：**清单与桌面 Sidebar 的 CREATE_CHILD_ITEMS 同款同序**
          （文档 / 表格 / 多维表 / 画板 / 分组）。261020 起四类文档都有移动端编辑器（可直接新建并进入编辑），
          分组走目录树创建。不要在移动端建出"打不开的文档"。 */}
      <MobileSheetMenu
        open={createOpen}
        items={[
          { id: "note", label: "新建文档", icon: FilePlus },
          { id: "usheet", label: "新建表格", icon: Table },
          { id: "bitable", label: "新建多维表", icon: Database },
          { id: "board", label: "新建画板", icon: PenTool },
          { id: "ink", label: "新建手写板", icon: PenLine },
          { id: "group", label: "新建分组", icon: FolderPlus },
        ]}
        onClose={() => setCreateOpen(false)}
        onSelect={(it) => {
          setCreateOpen(false);
          // 复用目录树的同一份创建通道（行内 ＋ / 抽屉「新建」同源），不新造第二条；作用域 = 本次打开它的那个节点
          const kind = CREATE_MENU_KINDS[it.id];
          if (kind) void createChildDocument(kind, createParent);
          else if (it.id === "group") void createChildGroup(createParent);
        }}
      />

      {/* 左目录抽屉 (.side-panel) */}
      <div className={"side-mask" + (sidebarOpen ? " on" : "")} data-panel-mask="left" onClick={() => openSidebar(false)} />
      <aside className={"side-panel side-panel--left" + (sidebarOpen ? " on" : "")} aria-label="目录">
        <div className="toolbar toolbar--border toolbar--dark" data-prevent-swipe>
          <div className="toolbar__scroll">
            {/* 笔记本自己也是一行（用户 261014）：**图标 + 标题**；图标可点 = 设置图标（桌面 .tree-row-icon 同款手势） */}
            <span className="mb-tree-icon" aria-hidden="true">{nbIcon ? <MobileNodeIconGlyph value={nbIcon} /> : <Book size={16} />}</span>
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
              {tabs.length > 0 && (
                <button className="mobile-model-closeall" onClick={closeAllTabs} aria-label="关闭全部标签页">关闭全部</button>
              )}
              <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => setTabsOpen(false)} aria-label="关闭"><X /></span>
            </div>
            <div className="mobile-model-body">
              {tabs.length === 0 && <div className="mb-empty">暂无打开的文档</div>}
              {tabs.map((t) => (
                <div key={t.id} className={"mb-row" + (t.id === activeId ? " is-selected" : "")} onClick={() => { void openTab(t.id); setTabsOpen(false); }}>
                  {tree.find((node) => node.id === t.id)?.icon && <span className="mb-tree-icon"><MobileNodeIconGlyph value={tree.find((node) => node.id === t.id)?.icon} /></span>}
                  <span className="mb-row__title">{t.title || "无标题"}</span>
                  <button className="mb-iconbtn mb-row__action" onClick={(e) => { e.stopPropagation(); void closeTab(t.id); }} aria-label="关闭"><X size={16} /></button>
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
        onSelect={(it) => { setNotebookSwitchOpen(false); if (it.id !== notebookId) void switchNotebook(it.id); }}
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
              <MobileNodeIconPicker key={iconFor.id} nodeType={iconFor.kind} value={iconFor.icon} onPick={(icon) => void applyIcon(icon)} />
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
