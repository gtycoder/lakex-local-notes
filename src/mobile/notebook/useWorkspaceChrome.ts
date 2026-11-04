import { useCallback, useEffect, useRef, useState } from "react";
import { useKeyboard } from "../hooks/useKeyboard";
import { usePanelDrag, type PanelSide } from "../hooks/usePanelDrag";
import { chromeAfterScroll, type ChromeScrollState } from "./scrollChrome";
import { useDockPanelPhase } from "../editor/dockPanelPhase";
import { baseCapsuleHidden, capsuleHiddenFor } from "./capsuleVisibility";
import type { NotebookTab } from "./useNotebookTabs";
import type { WorkspaceOverlay } from "./useWorkspaceOverlays";

/**
 * 工作区「壳层 chrome」逻辑（261103 P10-①，原 NotebookWorkspace 内联代码逐字搬移，未改行为）：
 * 阅读态自动收顶栏/胶囊、浮层打开复位、子页全屏、正文滚动监听、跟手开合侧栏（usePanelDrag 接线）、
 * 平板固定大纲的自动补开。纯逻辑：所有输入由显式 props 注入，不读全局单例。
 */
export interface UseWorkspaceChromeOptions {
  active: NotebookTab | null;
  activeId: string | null;
  padTwoPane: boolean;
  padTreeOpen: boolean;
  padTreePinned: boolean;
  padOutlineOpen: boolean;
  padOutlinePinned: boolean;
  sidebarOpen: boolean;
  outlineOpen: boolean;
  tabsOpen: boolean;
  notebookSwitchOpen: boolean;
  openOverlay: (overlay: WorkspaceOverlay) => void;
  openPadTree: (open: boolean) => void;
  openPadOutline: (open: boolean) => void;
  closePadOutline: () => void;
  closePadFloating: () => void;
  closeOverlay: (kind: "outline" | "sidebar") => void;
}

export function useWorkspaceChrome(options: UseWorkspaceChromeOptions) {
  const {
    active,
    activeId,
    padTwoPane,
    padTreeOpen,
    padTreePinned,
    padOutlineOpen,
    padOutlinePinned,
    sidebarOpen,
    outlineOpen,
    tabsOpen,
    notebookSwitchOpen,
    openOverlay,
    openPadTree,
    openPadOutline,
    closePadOutline,
    closePadFloating,
    closeOverlay,
  } = options;

  // 抽屉开合（名字保留：调用点遍布拖拽/胶囊/遮罩）。互斥由 overlay owner 保证：打开时先收掉其它浮层。
  // 261103 P11-②：从工作区搬入本 hook（与 usePanelDrag 接线同一职责），行为逐字不变。
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
  // 261103 二轮定稿（用户）：**文档编辑态也要常显胶囊**（编辑态也可能没光标、键盘/二级面板都没展开，
  // 此时要能切目录 / 看大纲 / 换标签 / 切笔记本）；但允许被覆盖 ——
  //   ① 键盘弹起：直接隐藏（fixed 元素会跟着视口上浮，露在上面只会挡输入区）；
  //   ② dock 二级工具栏展开：胶囊层级低于 dock（mobile.css 的 --above-dock 与 editor-dock 的 z-index），面板从上面盖过来。
  // 表格/多维表/画板/手写板编辑态仍隐藏（各自底部工具条占位，没有"无光标但仍要导航"的同款场景）。
  const { keyboardOpen } = useKeyboard();
  const dockPanelPhase = useDockPanelPhase();
  const capsuleInEdit = !!active?.editing && (active?.kind ?? "doc") === "doc";
  // 判据唯一来源见 ./capsuleVisibility。261104：面板开合会顺带切 IME（开：收；关：放回），
  // 键盘判据在过渡里抖一次 ⇒ 胶囊闪入闪出。做法 = **面板阶段冻结可见性**：打开前是什么就保持什么，
  // 面板关完再按键盘判据；编辑态胶囊的 CSS 过渡也已改成 none（mobile.css）。
  const baseHidden = baseCapsuleHidden({
    chromeHidden: chromeHiddenNow,
    editing: !!active?.editing,
    capsuleInEdit,
    keyboardOpen,
  });
  const frozenHiddenRef = useRef(baseHidden);
  const prevDockPhaseRef = useRef(dockPanelPhase);
  if (prevDockPhaseRef.current !== dockPanelPhase) {
    // 只在「面板打开」与「面板关完」两个边界取值；open↔closing 之间保持冻结（否则过渡里又会被键盘判据改写）。
    if (dockPanelPhase !== "closing") frozenHiddenRef.current = baseHidden;
    prevDockPhaseRef.current = dockPanelPhase;
  }
  const capsuleHidden = capsuleHiddenFor({
    chromeHidden: chromeHiddenNow,
    editing: !!active?.editing,
    capsuleInEdit,
    keyboardOpen,
    dockPanelPhase,
    frozenHidden: frozenHiddenRef.current,
  });
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

  // 点正文收起悬浮树/大纲（父层 onClick 用）；与旧内联判据逐字一致。
  const bodyClickClosesFloating = padTwoPane && ((padTreeOpen && !padTreePinned) || (padOutlineOpen && !padOutlinePinned))
    ? closePadFloating
    : undefined;

  return {
    bodyRef,
    outlineAvailable,
    chromeHiddenNow,
    capsuleInEdit,
    capsuleHidden,
    setSubpageFullscreen,
    bodyClickClosesFloating,
    openSidebar,
    openOutline,
  };
}
