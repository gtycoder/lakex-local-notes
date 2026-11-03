/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Pencil, FolderOpen, Trash, SmilePlus, Move, History, Info, Book, Star } from "lucide-react";
import { useLongPress } from "../ui/useLongPress";
import { pushBackHandler } from "../ui/backStack";
import { MobileNodeIconGlyph } from "../ui/NodeIconGlyph";
import { bridge } from "../bridge";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { usePanelDrag, type PanelSide } from "../hooks/usePanelDrag";
import { computeDropPosition, createDragGhost, moveDragGhost, removeDragGhost, type DragGhost } from "../../components/model/treeDrag";
import type { MobileSheetItem } from "../ui/MobileSheetMenu";
import { showToast } from "../ui/toastBus";
import { reportMobileActionError } from "../lib/reportMobileActionError";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { successFeedback, warnFeedback } from "../ui/haptics";
import { useAutoSave } from "../hooks/useAutoSave";
import { chromeAfterScroll, type ChromeScrollState } from "./scrollChrome";
import { isFavorite, toggleFavorite } from "../data/favorites";
import { useNotebookTabs, type NotebookTab } from "./useNotebookTabs";
import { useNotebookTreeData, type NotebookTreeItem } from "./useNotebookTreeData";
import { useNotebookTreeActions } from "./useNotebookTreeActions";
import { SELF_REGISTERED_OVERLAY_KINDS, useWorkspaceOverlays } from "./useWorkspaceOverlays";
import { NotebookTreeList } from "./NotebookTreeList";
import { useFormFactor } from "../pad/useFormFactor";
import { WorkspaceCapsule } from "./WorkspaceCapsule";
import { WorkspaceTopBar } from "./WorkspaceTopBar";
import { WorkspaceOutlinePanel, WorkspaceTreePanel } from "./WorkspacePanels";
import { NotePaneHost } from "./NotePaneHost";
import { WorkspaceOverlayHost } from "./WorkspaceOverlayHost";
import { WorkspaceDrawers } from "./WorkspaceDrawers";
import {
  createPadShellState,
  isPadDocked,
  isPadPanelOpen,
  isPadPanelPinned,
  padEscapeTarget,
  padPinnedPrefs,
  padShellReducer,
} from "./shellModel";
import { readPadPanelPrefs, writePadPanelPrefs } from "../pad/padPanelPrefs";
import { usePadShortcuts } from "../pad/usePadShortcuts";
export type { NotebookTreeItem } from "./useNotebookTreeData";
export type { PadPanelMode } from "./shellModel";
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
    itemById,
    visibleRows,
    firstNote,
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
  const getTabTitle = useCallback((id: string) => itemById(id)?.title, [itemById]);
  const {
    tabs,
    tabsRef: tabsStateRef,
    savedTabIds,
    savedTabActiveId,
    active,
    activeId,
    mountedIds,
    freshId,
    openTab,
    restore,
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

  /**
   * 工作区浮层**唯一 owner**（MOB-02）：目录抽屉 / 大纲 / 查找条 / 标签全屏 / 切换笔记本 / 新建 /
   * 行菜单 / 属性 / 图标 / 历史版本都只是 `overlay` 的一个值；打开一个自动收掉其它的（互斥只在 owner 里）。
   * 下面这些布尔与节点是**派生值**（不是状态），只为让 JSX 与既有类名分支保持原样。
   */
  const { overlay, open: openOverlay, close: closeOverlay, toggle: toggleOverlay } = useWorkspaceOverlays();
  const overlayKind = overlay?.kind ?? null;
  const sidebarOpen = overlayKind === "sidebar";
  // 261102 pad：expanded = **更宽的移动端外壳**（胶囊/工具栏与手机完全一致），只有「树/大纲」是
  // 悬浮覆盖 + 可固定（十四批用户口径：桌面式工具栏不适合触屏）。
  const formFactor = useFormFactor();
  const padTwoPane = formFactor === "expanded";
  // 树/大纲默认收起、默认**悬浮**（不占布局）；固定 = 停靠进布局、可编辑区随之收窄。
  // 固定偏好**持久化**（设备本地 localStorage，不进正文/不进 S3）；冷启时曾固定的面板按固定态打开。
  // P4：状态收敛到纯 reducer（notebook/shellModel.ts）——closed/floating/pinned × 两侧，
  // 所有开合/固定/收起/手势/Esc 都只派发 action；组件只读 selector。行为由 shellModel.test 表驱动锁死。
  const [padPanelPrefs] = useState(readPadPanelPrefs);
  const [padShell, dispatchPadShell] = useReducer(padShellReducer, padPanelPrefs, createPadShellState);
  const padTreeOpen = isPadPanelOpen(padShell, "left");
  const padOutlineOpen = isPadPanelOpen(padShell, "right");
  const padTreePinned = isPadPanelPinned(padShell, "left");
  const padOutlinePinned = isPadPanelPinned(padShell, "right");
  const padDocked = padTwoPane && isPadDocked(padShell);
  // 只记 pinned（开合不记：冷启按 pinned 直接停靠展开）。
  useEffect(() => { writePadPanelPrefs(padPinnedPrefs(padShell)); }, [padShell]);
  const openPadTree = useCallback((open: boolean) => dispatchPadShell({ type: "setOpen", side: "left", open }), []);
  const openPadOutline = useCallback((open: boolean) => dispatchPadShell({ type: "setOpen", side: "right", open }), []);
  const togglePadTree = useCallback(() => dispatchPadShell({ type: "toggle", side: "left" }), []);
  const togglePadOutline = useCallback(() => dispatchPadShell({ type: "toggle", side: "right" }), []);
  const closePadTree = useCallback(() => dispatchPadShell({ type: "setOpen", side: "left", open: false }), []);
  const closePadOutline = useCallback(() => dispatchPadShell({ type: "setOpen", side: "right", open: false }), []);
  const togglePadTreePin = useCallback(() => dispatchPadShell({ type: "togglePin", side: "left" }), []);
  const togglePadOutlinePin = useCallback(() => dispatchPadShell({ type: "togglePin", side: "right" }), []);
  const closePadFloating = useCallback(() => dispatchPadShell({ type: "closeFloating" }), []);
  const outlineOpen = overlayKind === "outline";
  const findOpen = overlayKind === "find";
  const tabsOpen = overlayKind === "tabs";
  const notebookSwitchOpen = overlayKind === "notebookSwitch";
  const createOpen = overlayKind === "create";
  const menuFor = overlay?.kind === "menu" ? overlay.node : null;
  const infoFor = overlay?.kind === "info" ? overlay.node : null;
  const iconFor = overlay?.kind === "icon" ? overlay.node : null;
  const historyFor = overlay?.kind === "history" ? overlay.node : null;
  /** 目录「新建」建到哪个节点下：抽屉工具栏 ＋ = 笔记本根，行内 ＋ = 该行节点（复用同一个面板）。 */
  const createParent = overlay?.kind === "create" ? overlay.parentId : notebookId;
  /** 文档内查找条：只对 Lake 文档（doc）开放；切文档时自动收起（查找条绑定当前正文）。 */
  useEffect(() => { closeOverlay("find"); }, [activeId, closeOverlay]);

  // 抽屉开合（名字保留：调用点遍布拖拽/胶囊/遮罩）。互斥由 overlay owner 保证：打开时先收掉其它浮层。
  const openSidebar = useCallback((v: boolean) => {
    // 平板里「目录」= 悬浮左栏的开合，不再拉抽屉（避免两份树实例 / 全屏遮罩）。
    if (padTwoPane) { openPadTree(v); return; }
    if (v) openOverlay({ kind: "sidebar" }); else closeOverlay("sidebar");
  }, [closeOverlay, openOverlay, openPadTree, padTwoPane]);
  const openOutline = useCallback((v: boolean) => {
    // 平板里「大纲」= 悬浮右栏（与胶囊同一个组件）；手机才拉右侧抽屉。
    if (padTwoPane) { openPadOutline(v); return; }
    if (v) openOverlay({ kind: "outline" }); else closeOverlay("outline");
  }, [closeOverlay, openOverlay, openPadOutline, padTwoPane]);
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
  /** 子页全屏请求（261030：多维表「记录详情」这类页内整页）——独立于滚动 chrome，由子组件声明。 */
  const [subpageFullscreen, setSubpageFullscreen] = useState(false);
  const bodyRef = useRef<HTMLElement | null>(null);
  const activeMetaRef = useRef({ kind: "doc" as string, editing: false });
  activeMetaRef.current = { kind: active?.kind ?? "doc", editing: !!active?.editing };
  // 平板不自动收顶栏：顶栏里有文档页签，滚动时闪掉会晃眼（手机保持思源式自动收起）。
  const chromeHiddenNow = subpageFullscreen || (!padTwoPane && chrome.hidden && !active?.editing && (active?.kind ?? "doc") === "doc");
  // 261103 用户口径：**文档（Lake）编辑态也保留胶囊**（抬到底部 dock 上方）；表格/多维表/画板/手写板
  // 各自有底部工具条（sheet dock / bitable 工具条 / ink 工具坞）⇒ 编辑态仍隐藏胶囊。
  const capsuleInEdit = !!active?.editing && (active?.kind ?? "doc") === "doc";
  const capsuleHidden = chromeHiddenNow || (!!active?.editing && !capsuleInEdit);
  const showChrome = useCallback(() => {
    if (chromeRef.current.hidden || chromeRef.current.acc) setChrome({ hidden: false, acc: 0 });
  }, []);
  // 切文档 / 进出编辑 / 打开浮层：导航必须回来（否则用户要操作时看不见入口）
  useEffect(() => { setChrome({ hidden: false, acc: 0 }); }, [activeId]);
  useEffect(() => { if (active?.editing) setChrome({ hidden: false, acc: 0 }); }, [active?.editing]);
  // 切文档 / 进出编辑：子页全屏请求必须复位（否则换了文档顶栏还藏着）。
  useEffect(() => { setSubpageFullscreen(false); }, [activeId]);
  useEffect(() => { if (active?.editing) setSubpageFullscreen(false); }, [active?.editing]);
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
    // 平板没有手机抽屉：手势直接开合**悬浮左栏/右栏**（与胶囊同一个组件）——
    // 关闭态没有 DOM ⇒ 拖动时没有跟手预览（可接受），松手后面板以入场动画出现；打开态仍可跟手滑走。
    getPanel: (side: PanelSide) => padTwoPane
      ? document.querySelector<HTMLElement>(side === "left" ? ".pad-tree" : ".pad-outline")
      : document.querySelector<HTMLElement>(side === "left" ? ".side-panel--left" : ".side-panel--right"),
    getMask: (side: PanelSide) => (padTwoPane ? null : document.querySelector<HTMLElement>('[data-panel-mask="' + side + '"]')),
    // 261103：**固定（停靠）的面板不吃手势** —— isOpen 不把固定态算成"已展开"，手势就不会把它判成"关闭方向"。
    // （否则：大纲固定着，右划想开目录栏 → 被判成"关闭右栏" → 把固定的大纲滑没了。）
    isOpen: (side: PanelSide) => (padTwoPane
      ? (side === "left" ? padTreeOpen && !padTreePinned : padOutlineOpen && !padOutlinePinned)
      : (side === "left" ? sidebarOpen : outlineOpen)),
    commit: (side: PanelSide, open: boolean) => {
      if (padTwoPane && !open && (side === "left" ? padTreePinned : padOutlinePinned)) return; // 固定态拒绝手势关闭
      if (side === "left") openSidebar(open); else openOutline(open);
    },
    // 261103 用户口径：**只有文档**允许横向手势拉出侧栏（表格/多维表/画板/手写板自身有横滑语义 ⇒ 禁用）；
    // 没有大纲时左滑不再拉出空面板（右滑开目录不受影响）；已展开的大纲仍可滑走关闭。
    canOpen: (side: PanelSide) => activeMetaRef.current.kind === "doc" && (side === "left" || outlineAvailable),
    // 文档编辑态也允许从正文起手拉侧栏（Lake 文档不涉及左右横滑）；其他编辑器的正文区仍排除。
    allowFrom: (target: Element | null) =>
      activeMetaRef.current.kind === "doc" && !!target?.closest?.(".doc-pane.active"),
  });

  // 切到没有大纲的文档类型（表格 / 多维表 / 画板）时收掉已展开的大纲抽屉，别停在空面板上
  useEffect(() => { if (!outlineAvailable) closeOverlay("outline"); }, [outlineAvailable, closeOverlay]);
  // 平板悬浮大纲栏同理：切到没有大纲的文档类型时自动收起。
  useEffect(() => { if (!outlineAvailable) closePadOutline(); }, [outlineAvailable, closePadOutline]);
  // 「固定」偏好持久化后，冷启进工作区时往往**还没有活动文档**（大纲被上面的 auto-close 收掉）⇒
  // 切到一篇文章时把固定的大纲重新出现。用户在本次会话里手动收起的不会被立刻强开（只在换文档时补开）。
  const padOutlineOpenRef = useRef(padOutlineOpen);
  padOutlineOpenRef.current = padOutlineOpen;
  useEffect(() => {
    if (padTwoPane && padOutlinePinned && outlineAvailable && !padOutlineOpenRef.current) openPadOutline(true);
  }, [activeId, openPadOutline, padTwoPane, padOutlinePinned, outlineAvailable]);

  // 初次进入（仅一次）：
  //  - 显式指定了要打开的文档（首页/搜索/新建）→ 它排第一并激活（修"从首页点文档直达不了"），
  //    其余上次已存的标签（不含它）按原顺序跟在后面，不覆盖它的激活态；
  //  - 否则恢复上次打开的标签（本地持久化 ids + companion active：优先回到**上次退出的活动页**，
  //    旧存档没有 active 时回落「列表最后一个」—— 261102 用户回归「退出停在画板，重进却回到表格」）；
  //  - 否则开树中第一个。
  // 这里只做「按目录已知 id 过滤」，顺序/上限/激活页全部交给 hook 的 restore()（一次 dispatch，
  // 不再靠 openTab 的调用顺序 + effect 执行顺序这种隐式协议）。
  useEffect(() => {
    if (autoOpenedRef.current) return;
    const knownNoteIds = new Set(tree.filter((item) => item.kind === "note").map((item) => item.id));
    const saved = savedTabIds.filter((id) => knownNoteIds.has(id) || id === initialNoteId);
    if (initialNoteId) {
      autoOpenedRef.current = true;
      restore([initialNoteId, ...saved.filter((id) => id !== initialNoteId)], initialNoteId, { enterEditor: initialMode === "editor" });
      return;
    }
    if (saved.length > 0) {
      autoOpenedRef.current = true;
      // 活动页交给存档里的 active（restore 会校验它仍在这批 id 里，否则回落最后一个）。
      restore(saved, savedTabActiveId);
      return;
    }
    if (firstNote) {
      autoOpenedRef.current = true;
      restore([firstNote.id], firstNote.id);
      return;
    }
    // 目录里没有任何可用文档：把存档里已失效的占位清掉（hook 的 initial state 可能还带着它们）。
    if (savedTabIds.length > 0) restore([], null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, firstNote, savedTabIds, savedTabActiveId, initialNoteId, initialMode, restore]);

  // 已进入工作区后又被指定文档（新建 / 首页 / 搜索）：组件 key 是 notebookId，
  // 同一笔记本内再指定文档不会重挂载，「初次进入」那段被 autoOpenedRef 挡住 ⇒ 必须在这里显式打开，
  // 否则会"文档建好了但界面不跳转"。
  const handledInitialRef = useRef<string | null>(initialNoteId ?? null);
  useEffect(() => {
    if (!initialNoteId || handledInitialRef.current === initialNoteId) return;
    handledInitialRef.current = initialNoteId;
    void openTab(initialNoteId, { enterEditor: initialMode === "editor" });
  }, [initialNoteId, initialMode, openTab]);

  /** 活动占位页统一在这里补读正文；openTab / 自愈 / 恢复都共用同一条懒加载路径。
   *  恢复决策（autoOpenedRef）落定前不读：initial state 还带着未按目录过滤的存档 id，
   *  抢先读可能读到已删文档并误弹「不存在」。 */
  useEffect(() => {
    if (!autoOpenedRef.current) return;
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

  /** 现取 usheet/board/ink 最新正文并等待保存完成；成功前不释放实例 capture，也不关闭界面。 */
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
      closeOverlay("tabs");
    } catch (error) { /* useAutoSave.onError 已给出可见原因；保留全部标签供重试 */
      reportMobileActionError("关闭全部标签", error);
    }
    finally { closingRef.current = false; }
  }, [clearTabs, closeOverlay, flushAllTabs]);

  const closeTab = useCallback(async (id: string) => {
    if (closingRef.current) return;
    const closing = tabsStateRef.current.find((t) => t.id === id);
    if (!closing) return;
    closingRef.current = true;
    try {
      await captureAndSaveTab(closing);
      removeTab(id);
    } catch (error) { /* 保留当前 tab 与编辑器，允许重试 */
      reportMobileActionError("关闭标签", error);
    }
    finally { closingRef.current = false; }
  }, [captureAndSaveTab, removeTab]);

  /** 文档已进回收站后的关闭：不能再保存（写边界会正确拒绝），直接丢弃本地 tab。 */
  const discardTab = useCallback((id: string) => {
    removeTab(id);
  }, [removeTab]);

  const {
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    historyList,
    applyRename,
    applyIcon,
    applyDelete,
    applyMove,
    loadHistory,
    restoreHistory: restoreHistoryVersion,
    deleteHistory,
  } = useNotebookTreeActions({ tree, loadTree, discardTab });

  /** 历史版本面板 =「开面板」（overlay owner）+「读快照」（actions）两步；节点由调用方传，不在 hook 里存。 */
  const openHistorySheet = useCallback((node: NotebookTreeItem) => {
    openOverlay({ kind: "history", node });
    void loadHistory(node);
  }, [loadHistory, openOverlay]);

  /** 恢复历史版本：真的成功才收面板（失败保留面板让用户重试）。 */
  const applyRestoreHistory = useCallback(async (historyId: number) => {
    if (await restoreHistoryVersion(historyId)) closeOverlay("history");
  }, [closeOverlay, restoreHistoryVersion]);

  /**
   * 返回键（MOB-01）：工作区浮层必须自己消费返回，否则会落回父层「退出工作区」
   * （整轮 flushAllTabs + 出场转场回首页），用户以为只是关抽屉。
   * 浮层现在只有一个（MOB-02 的 overlay）⇒ 一次只可能关这一层。
   * 自带返回栈的种类（菜单 Sheet / 底部 Sheet 原语，见 SELF_REGISTERED_OVERLAY_KINDS）
   * 不在这里重复登记 —— 否则返回键会跳过子菜单下钻直接关面板。
   * 无浮层时不登记 ⇒ 返回键走原有「退工作区（含保存屏障）」。
   */
  useEffect(() => {
    // 单一 owner（MOB-02）之后只剩一条判据：overlay.kind。任一浮层打开就登记 ⇒ 返回键只关它。
    if (!overlayKind || SELF_REGISTERED_OVERLAY_KINDS.has(overlayKind)) return;
    return pushBackHandler(() => { closeOverlay(overlayKind); return true; });
  }, [overlayKind, closeOverlay]);

  /** 返回首页：等待所有正文与文档保存落盘后才交给路由转场；失败留在当前界面。 */
  const handleBack = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      onBack();
    } catch (error) { /* useAutoSave.onError 已给出可见原因 */
      reportMobileActionError("返回首页", error);
    }
    finally { closingRef.current = false; }
  }, [flushAllTabs, onBack]);

  /** 切换笔记本同属离开当前工作区，必须先过同一保存屏障。 */
  const switchNotebook = useCallback(async (id: string) => {
    if (id === notebookId || closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      onSwitchNotebook(id);
    } catch (error) { /* 保存失败时保持当前工作区 */
      reportMobileActionError("切换笔记本", error);
    }
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

  // 立即同步（思源顶栏右侧的云图标就是同步状态/触发器）
  const runSync = useCallback(async () => {
    try {
      const r = await bridge.syncNow();
      // 同步可能改了远端标题/正文：刷新目录，并在阅读态强制重读当前文档（编辑态不打断）。
      await loadTree();
      const activeTab = tabsStateRef.current.find((t) => t.id === activeId);
      if (activeTab && !activeTab.editing) await loadTabBody(activeTab.id, true);
      const w = r.warnings?.length ?? 0;
      showToast((r.message || "已同步") + (w > 0 ? `，${w} 项被跳过` : ""));
    } catch (e) { showToast("同步失败：" + (e as Error).message, { type: "error" }); }
  }, [loadTree, openTab, activeId]);

  // 活动文档上报（MobileApp 的定时自动快照按当前文档留档）
  useEffect(() => { onActiveNoteChange?.(activeId); }, [activeId, onActiveNoteChange]);

  const toggleEdit = useCallback(async () => {
    if (!active?.loaded) return;
    // usheet / board / ink 的正文在实例里；完成时同步 capture，不能只读父级 state
    // （可能还在 500ms/1s 防抖窗口内 —— 手写板「切完纸张立刻点完成」就会丢最后一笔纸张改动）。
    const captured = active.kind === "usheet" || active.kind === "board" || active.kind === "ink"
      ? liveBodyCapturesRef.current.get(active.id)?.() ?? null
      : null;
    const nextContent = captured ?? active.content;
    if (active.editing) {
      cancelAutoSave(active.id); // 旧 timer 里的 content 可能落后于 captured
      // 再等**在途**的自动保存落完，避免旧快照后落盘覆盖下面的新内容（261030 review）。
      try { await flushAutoSave(active.id); } catch { /* 旧快照失败已 toast；继续显式保存最新 */ }
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
      closeOverlay("sidebar");
      // 手写板沿用 remote ink 批的行为：建完停在阅读态（与文档一致），需要时再点顶栏「编辑」
      await openTab(n.id, { enterEditor: kind === "usheet" || kind === "bitable" || kind === "board" });
    } catch { showToast("新建失败", { type: "error" }); }
  }, [closeOverlay, loadTree, openTab, notebookId]);

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
    closeOverlay("menu");
    if (!node) return;
    const root = path[0]?.id;
    if (root === "move") { void applyMove(node, path[1]?.id === "__root" ? notebookId : String(path[1]?.id)); return; }
    // 互斥（MOB-02）：开行菜单时目录抽屉已经被收掉；重命名是**行内编辑**，必须把抽屉重新拉出来，
    // 否则输入框在关着的抽屉里（看不见的输入框 + autoFocus 抢焦点）。
    if (root === "rename") { if (!padTwoPane) openOverlay({ kind: "sidebar" }); setRenamingId(node.id); setRenameValue(node.title); return; }
    if (root === "icon") { openOverlay({ kind: "icon", node }); return; }
    if (root === "favorite") { const on = toggleFavorite(node.id); showToast(on ? "已设为常用" : "已取消常用"); return; }
    if (root === "history") { openHistorySheet(node); return; }
    if (root === "info") { openOverlay({ kind: "info", node }); return; }
    if (root === "delete") { void applyDelete(node); }
  };

  /**
   * 目录树 = 抽屉与平板悬浮左栏**共用同一份**（同一套 props / 虚拟化 / 拖拽 / 长按）。
   * 平板里点开文档后**收起左栏**（覆盖层会盖住刚打开的正文）；手机抽屉同理。
   */
  const treeList = (
    <NotebookTreeList
      rows={visibleRows}
      expanded={expanded}
      hasChildren={(id) => childrenOf(id).length > 0}
      activeId={activeId}
      drag={drag}
      renamingId={renamingId}
      renameValue={renameValue}
      onRenameChange={setRenameValue}
      onRenameCommit={() => void applyRename()}
      onRenameCancel={() => setRenamingId(null)}
      longPress={longPressRows}
      onPressRow={(item) => { pressedNode.current = item; }}
      onActivate={(item) => {
        // 与原实现同序：有子节点先展开/折叠；没有子的文档才打开。
        if (childrenOf(item.id).length > 0) { toggleGroup(item.id); return; }
        if (item.kind === "note") {
          if (padTwoPane) closePadTree(); else openSidebar(false);
          void openTab(item.id);
        }
      }}
      onOpenMenu={(item) => openOverlay({ kind: "menu", node: item })}
      onOpenCreate={(item) => openOverlay({ kind: "create", parentId: item.id })}
    />
  );

  // 平板外接键盘：⌘/Ctrl+F 查找、N 新建文档、Esc 关浮层（手机不挂）。
  usePadShortcuts(padTwoPane, {
    find: () => { if (active && (active.kind ?? "doc") === "doc") toggleOverlay("find"); },
    newNote: () => { void createChildDocument("doc", notebookId); },
    // Esc 逐层收：先收浮层，再收悬浮树/大纲（它们不是 overlay owner 的值，要单独处理）。
    // 逐层收；**没东西可关时必须 return false**，否则 hook 会 preventDefault，
    // 上一层（MobileApp 的 Esc）永远收不到（261103 评审 W2）。顺序单一来源 = padEscapeTarget。
    escape: () => {
      const target = padEscapeTarget(padShell, !!overlayKind);
      if (target === "overlay") { closeOverlay(); return true; }
      if (target === "left") { closePadTree(); return true; }
      if (target === "right") { closePadOutline(); return true; }
      return false;
    },
  });

  // ---- P9-5b：抽出的三块 JSX（NotePaneHost / WorkspaceOverlayHost / WorkspaceDrawers）的接线 ----
  // 全部是「同一行为的回调化」：写入边界、关闭/下钻顺序、自动保存时机与原内联实现逐字一致。
  const handlePaneBodyChange = useCallback((tab: NotebookTab, content: string, plain?: string) => {
    updateTab(tab.id, { content });
    if (tab.editing) scheduleAutoSave(tab.id, tab.title, content, plain);
  }, [scheduleAutoSave, updateTab]);
  const persistBitableNow = useCallback(async (tab: NotebookTab, content: string) => {
    updateTab(tab.id, { content });
    await bridge.saveNote(tab.id, tab.title, content);
  }, [updateTab]);
  const handlePaneCapture = useCallback((id: string, capture: (() => string | null) | null) => {
    if (capture) liveBodyCapturesRef.current.set(id, capture);
    else liveBodyCapturesRef.current.delete(id);
  }, []);
  const handleEditorInstance = useCallback((id: string, editor: LakeEditorInstance | null) => {
    if (editor) editorsRef.current.set(id, editor);
    else editorsRef.current.delete(id);
  }, []);
  const tabIconOf = useCallback((id: string) => itemById(id)?.icon ?? null, [itemById]);
  const selectCreateItem = useCallback((it: MobileSheetItem) => {
    closeOverlay("create");
    // 复用目录树的同一份创建通道（行内 ＋ / 抽屉「新建」同源），不新造第二条；作用域 = 本次打开它的那个节点
    const kind = CREATE_MENU_KINDS[it.id];
    if (kind) void createChildDocument(kind, createParent);
    else if (it.id === "group") void createChildGroup(createParent);
  }, [closeOverlay, createChildDocument, createChildGroup, createParent]);
  const handleOpenTabFromList = useCallback((id: string) => {
    void openTab(id);
    closeOverlay("tabs");
  }, [closeOverlay, openTab]);
  const handleSwitchNotebookItem = useCallback((it: MobileSheetItem) => {
    closeOverlay("notebookSwitch");
    if (it.id !== notebookId) void switchNotebook(it.id);
  }, [closeOverlay, notebookId, switchNotebook]);
  const handlePickIcon = useCallback((target: NotebookTreeItem, icon: string | null) => {
    void applyIcon(target, icon).then((next) => {
      // 面板开着时把选中的图标同步回 overlay 的载荷（否则 picker 仍显示旧值）
      if (next !== null) openOverlay({ kind: "icon", node: { ...target, icon: next } });
    });
  }, [applyIcon, openOverlay]);
  const openHistoryFromInfo = useCallback((node: NotebookTreeItem) => {
    closeOverlay("info");
    openHistorySheet(node);
  }, [closeOverlay, openHistorySheet]);

  return (
    <div className={"mobile-workspace" + (capsuleInEdit ? " mobile-workspace--capsule-edit" : "")}>
      <WorkspaceTopBar
        padTwoPane={padTwoPane}
        chromeHidden={chromeHiddenNow}
        title={title}
        active={active ?? null}
        activeId={activeId}
        tabs={tabs}
        findOpen={findOpen}
        onBack={handleBack}
        onOpenTab={(id) => { void openTab(id); }}
        onCloseTab={(id) => { void closeTab(id); }}
        onOpenTree={openPadTree}
        onToggleFind={() => toggleOverlay("find")}
        onToggleEdit={toggleEdit}
        onSync={() => void runSync()}
        onRename={(id, nextTitle) => {
          updateTab(id, { title: nextTitle });
          scheduleAutoSave(id, nextTitle, tabs.find((x) => x.id === id)?.content ?? "");
        }}
      />

      <div className={"mobile-workspace-main" + (padDocked ? " pad-main--docked" : "")}>
        {/* 平板（expanded）：悬浮左目录（覆盖层，不占布局）；手机不渲染这段（padTwoPane=false） */}
        {/* 261103 P1：面板**常驻 DOM**（与手机抽屉同构）——开合只切 class，
            滚动/展开/重命名状态不再因收起而丢、手势也不再「关闭态没有 DOM」。 */}
        {padTwoPane && (
          <WorkspaceTreePanel
            open={padTreeOpen}
            pinned={padTreePinned}
            title={title}
            nbIcon={nbIcon ? <MobileNodeIconGlyph value={nbIcon} /> : <Book size={16} />}
            list={treeList}
            onNew={() => openOverlay({ kind: "create", parentId: notebookId })}
            onTogglePin={togglePadTreePin}
            onClose={closePadTree}
          />
        )}

        {/* 文档层（正文） */}
        <section
          className="mobile-workspace-body"
          ref={bodyRef}
          // 悬浮树/大纲没有遮罩 ⇒ 点正文就收起（否则 280/240 宽会一直盖在正文上）。
          // ⚠️ 必须用 onClick 而不是 onPointerDown：横向手势也是从正文起手的，pointerdown 会先把面板收掉，
          // 随后同一手势又被判成"拉开另一侧"（261103 实测：滑走左栏 → 右大纲自己弹出来）。
          onClick={padTwoPane && ((padTreeOpen && !padTreePinned) || (padOutlineOpen && !padOutlinePinned))
            ? () => {
                closePadFloating();
              }
            : undefined}
        >
        <NotePaneHost
          tabs={tabs}
          active={active}
          activeId={activeId}
          freshId={freshId}
          mountedIds={mountedIds}
          findOpen={findOpen}
          onBodyChange={handlePaneBodyChange}
          onPersistBitableNow={persistBitableNow}
          onCapture={handlePaneCapture}
          onEditorInstance={handleEditorInstance}
          onFullscreenChange={setSubpageFullscreen}
          onCloseFind={() => closeOverlay("find")}
        />
        </section>

        {/* 平板：右侧大纲悬浮覆盖层（手机仍是 .side-panel--right 抽屉；rail 只在 expanded 渲染） */}
        {padTwoPane && (
          <WorkspaceOutlinePanel
            open={padOutlineOpen}
            pinned={padOutlinePinned}
            onTogglePin={togglePadOutlinePin}
            editor={activeId ? (editorsRef.current.get(activeId) ?? null) : null}
            onClose={closePadOutline}
          />
        )}
      </div>

      {/* 底部胶囊栏（思源 #mobileBottomBar：纯图标）——只放阅读相关（文档树/标签/大纲/更多）；
          编辑与同步在顶栏右侧，避免打字时误触（用户 260909）。编辑态整条下滑淡出而不是卸载。
          十四批（用户点单）：平板**也挂同一套胶囊**（文档树/标签页/大纲/切换笔记本），和手机一模一样；
          平板顶栏只保留「返回 + 文档页签 + 查找/编辑/同步」。 */}
      <WorkspaceCapsule
        hidden={capsuleHidden}
        aboveDock={capsuleInEdit}
        aboveSheet={active?.kind === "usheet"}
        treeActive={!!(padTwoPane ? padTreeOpen : sidebarOpen)}
        tabsActive={tabsOpen}
        outlineActive={!!(padTwoPane ? padOutlineOpen : outlineOpen)}
        outlineAvailable={outlineAvailable}
        tabCount={tabs.length}
        title={title}
        onTree={() => (padTwoPane ? togglePadTree() : openSidebar(!sidebarOpen))}
        onTabs={() => openOverlay({ kind: "tabs" })}
        onOutline={() => (padTwoPane ? togglePadOutline() : openOutline(!outlineOpen))}
        onSwitchNotebook={() => openOverlay({ kind: "notebookSwitch" })}
      />

      {/* P9-5b：浮层宿主（新建/标签列表/切换笔记本/行菜单/属性/图标/历史）。互斥仍由 useWorkspaceOverlays 保证 ⇒ 同一时刻只渲染一个。 */}
      <WorkspaceOverlayHost
        createOpen={createOpen}
        onCreateSelect={selectCreateItem}
        onCloseCreate={() => closeOverlay("create")}
        tabsOpen={tabsOpen}
        tabs={tabs}
        activeId={activeId}
        tabIconOf={tabIconOf}
        onOpenTab={handleOpenTabFromList}
        onCloseTab={(id) => { void closeTab(id); }}
        onCloseAllTabs={() => void closeAllTabs()}
        onCloseTabs={() => closeOverlay("tabs")}
        onOpenDocPicker={() => openSidebar(true)}
        notebookSwitchOpen={notebookSwitchOpen}
        notebooks={notebooks}
        notebookId={notebookId}
        onSwitchNotebook={handleSwitchNotebookItem}
        onCloseNotebookSwitch={() => closeOverlay("notebookSwitch")}
        menuFor={menuFor}
        treeMenuItemsFor={treeMenuItems}
        onTreeMenuSelect={onTreeMenuSelect}
        onCloseMenu={() => closeOverlay("menu")}
        infoFor={infoFor}
        onCloseInfo={() => closeOverlay("info")}
        onOpenHistoryFromInfo={openHistoryFromInfo}
        iconFor={iconFor}
        onPickIcon={handlePickIcon}
        onCloseIcon={() => closeOverlay("icon")}
        historyFor={historyFor}
        historyList={historyList}
        onRestoreHistory={(id) => void applyRestoreHistory(id)}
        onDeleteHistory={(id) => void deleteHistory(id)}
        onCloseHistory={() => closeOverlay("history")}
      />

      {!padTwoPane && (
        <WorkspaceDrawers
          sidebarOpen={sidebarOpen}
          outlineOpen={outlineOpen}
          title={title}
          nbIcon={nbIcon}
          renamingId={renamingId}
          notebookId={notebookId}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameCommit={() => void applyRename()}
          onRenameCancel={() => setRenamingId(null)}
          treeList={treeList}
          onOpenSidebar={openSidebar}
          onOpenCreate={() => openOverlay({ kind: "create", parentId: notebookId })}
          editor={activeId ? (editorsRef.current.get(activeId) ?? null) : null}
          onCloseOutline={() => closeOverlay("outline")}
        />
      )}
    </div>
  );
}
