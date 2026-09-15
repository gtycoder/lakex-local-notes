/**
 * 桌面 Shell 状态（§20 Phase C：从 src/App.tsx 收拢布局/面板状态与回调）。
 * - 布局（sidebar/outline/desktopWorkspace）+ 面板（search/trash/history/settings/focus/notice/error/confirmDelete）；
 * - 数据状态（workspace/notes/treeNodes/openTabs/sync）与树/文档操作回调仍留在 App（依赖复杂，后续再评估）；
 * - 与数据无关的纯壳状态收进本 hook，组件从返回值取 props，App 只做装配。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { OutlineMode } from "../features/outline/OutlineController";
import { getOutlineTabsVersion, subscribeOutlineTabs } from "../features/outline/registry";
import type { SidebarMode } from "../components/Sidebar";
import type { SettingsCategory } from "../components/SettingsPanel";
import type { TreeNode } from "../lib/types";
import { initialOutlineMode, initialOutlineSidebarWidth, initialSidebarMode, initialSidebarWidth, OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_HOVER_HIDE_DELAY_MS, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, type DesktopWorkspace, type NoticeState } from "./desktopTypes";
import { shouldCollapseSidebarOnHoverLeave, shouldKeepSidebarPreviewOpen } from "../components/sidebarInteraction";

/** 视口窄于此宽度时，桌面壳层强制按"收起态"渲染（右侧开 DevTools 也会触发）。 */
const NARROW_SHELL_WIDTH = 900;

export interface UseDesktopShellOptions {
  /** 小记工作区句柄（离开小记工作区前 confirmLeave）。 */
  quickNotesRef: RefObject<{ confirmLeave(): Promise<boolean> } | null>;
}

export function useDesktopShell(options: UseDesktopShellOptions) {
  const { quickNotesRef } = options;

  // ---- 布局：sidebar ----
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(initialSidebarMode);
  const sidebarModeRef = useRef<SidebarMode>(sidebarMode);
  sidebarModeRef.current = sidebarMode;
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarResizingRef = useRef(false);
  const sidebarPreviewTimer = useRef<number | null>(null);

  // ---- 窄窗自适应（260915 用户报的"右侧开 DevTools 就把窗口挤乱"）----
  // 桌面壳层的几何（停靠边距、状态栏、顶栏等）都写在 `@media (min-width: 761px)` 里，视口一窄整套失效；
  // 而侧栏在"停靠"态必须占一整列（265px），416px 视口下会把工作区挤没。
  // 处理：视口 ≤900px 一律**按收起态渲染**（左轨 + 44px 侧栏条 + 工作区，侧栏 hover 时以浮层展开，
  // 这套交互本来就存在）。只覆盖本次渲染，不写 localStorage —— 窗口拉宽后用户原偏好原样恢复。
  const [narrowViewport, setNarrowViewport] = useState(() => typeof window !== "undefined" && window.innerWidth <= NARROW_SHELL_WIDTH);
  useEffect(() => {
    const onResize = () => setNarrowViewport(window.innerWidth <= NARROW_SHELL_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  /** 窄窗下是否把目录树"拉出来"（点左轨切换）。窄窗默认收起 = 左轨 + 工作区。 */
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false);
  useEffect(() => { if (!narrowViewport) setNarrowSidebarOpen(false); }, [narrowViewport]);

  // ---- 布局：outline ----
  const [outlineMode, setOutlineMode] = useState<OutlineMode>(initialOutlineMode);
  const [activeOutlineEmpty, setActiveOutlineEmpty] = useState(false);
  const [outlineEmptyOverride, setOutlineEmptyOverride] = useState(false);
  const [outlineSwitching, setOutlineSwitching] = useState(false);
  const outlineTabsVersion = useSyncExternalStore(subscribeOutlineTabs, getOutlineTabsVersion, getOutlineTabsVersion);
  const [outlineSidebarWidth, setOutlineSidebarWidth] = useState(initialOutlineSidebarWidth);
  const [outlineResizing, setOutlineResizing] = useState(false);

  // ---- 工作区切换 ----
  const [desktopWorkspace, setDesktopWorkspace] = useState<DesktopWorkspace>("library");

  // ---- 面板与杂项 ----
  const [focusMode, setFocusMode] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);
  const [searchPanelQuery, setSearchPanelQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("editor");
  const [confirmDelete, setConfirmDelete] = useState<TreeNode | null>(null);

  // sidebar 模式持久化
  useEffect(() => {
    if (sidebarMode !== "floating") localStorage.setItem("lake-notes-v2.sidebar-mode", sidebarMode);
  }, [sidebarMode]);

  const updateSidebarWidth = useCallback((width: number) => { setSidebarWidth(width); }, []);
  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
    setSidebarWidth(clamped);
    localStorage.setItem("lake-notes-v3.sidebar-width", String(Math.round(clamped)));
  }, []);
  const handleSidebarResizeActiveChange = useCallback((active: boolean) => {
    sidebarResizingRef.current = active;
    setSidebarResizing(active);
  }, []);

  const clearSidebarPreviewTimer = useCallback(() => {
    if (sidebarPreviewTimer.current !== null) {
      window.clearTimeout(sidebarPreviewTimer.current);
      sidebarPreviewTimer.current = null;
    }
  }, []);
  const showSidebarPreview = useCallback(() => {
    clearSidebarPreviewTimer();
    setSidebarMode((current) => current === "collapsed" ? "floating" : current);
  }, [clearSidebarPreviewTimer]);
  const hideSidebarPreview = useCallback(() => {
    if (shouldKeepSidebarPreviewOpen(sidebarModeRef.current, sidebarResizingRef.current)) return;
    if (!shouldCollapseSidebarOnHoverLeave(sidebarModeRef.current)) return;
    if (sidebarPreviewTimer.current !== null) return;
    sidebarPreviewTimer.current = window.setTimeout(() => {
      if (shouldCollapseSidebarOnHoverLeave(sidebarModeRef.current)) setSidebarMode("collapsed");
      sidebarPreviewTimer.current = null;
    }, SIDEBAR_HOVER_HIDE_DELAY_MS);
  }, []);
  const toggleSidebarDock = useCallback(() => {
    clearSidebarPreviewTimer();
    setSidebarMode((current) => current === "docked" ? "collapsed" : "docked");
  }, [clearSidebarPreviewTimer]);

  // outline 状态
  const setOutlineModeForActive = useCallback((mode: OutlineMode) => {
    setOutlineMode(mode);
    localStorage.setItem("lake-notes-v2.outline-sidebar-mode", mode);
    if (mode === "docked" && activeOutlineEmpty) setOutlineEmptyOverride(true);
    else if (mode === "collapsed") setOutlineEmptyOverride(false);
  }, [activeOutlineEmpty]);
  const collapseOutline = useCallback(() => { setOutlineModeForActive("collapsed"); }, [setOutlineModeForActive]);
  const pinOutline = useCallback(() => { setOutlineModeForActive("docked"); }, [setOutlineModeForActive]);
  const updateOutlineSidebarWidth = useCallback((width: number) => { setOutlineSidebarWidth(width); }, []);
  const commitOutlineSidebarWidth = useCallback((width: number) => {
    const clamped = Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, width));
    setOutlineSidebarWidth(clamped);
    localStorage.setItem("lake-notes-v3.outline-sidebar-width", String(Math.round(clamped)));
  }, []);

  // 工作区切换（原语义：先判同值；离开小记工作区前 confirmLeave）
  const desktopWorkspaceRef = useRef<DesktopWorkspace>("library");
  desktopWorkspaceRef.current = desktopWorkspace;
  const switchDesktopWorkspace = useCallback(async (next: DesktopWorkspace) => {
    if (next === desktopWorkspaceRef.current) return;
    if (desktopWorkspaceRef.current === "quick-notes") {
      const canLeave = await quickNotesRef.current?.confirmLeave() ?? true;
      if (!canLeave) return;
    }
    setDesktopWorkspace(next);
  }, [quickNotesRef]);

  const showNotice = useCallback((text: string) => {
    setNotice({ text });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200);
  }, []);

  /** 带动作的通知（同步冲突/删除提示）：8s 自动消失 + 卸载清理（复用 noticeTimer）。 */
  const showNoticeWithAction = useCallback((text: string, action: NoticeState["action"]) => {
    setNotice({ text, action });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 8000);
  }, []);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      if (sidebarPreviewTimer.current !== null) window.clearTimeout(sidebarPreviewTimer.current);
    };
  }, []);

  return {
    // sidebar
    // **不再在阈值处切换侧栏状态**（曾用 ≤900px 强制收起）：那会让"宽→窄"时左轨、文档宽度、
    // 标签条在同一个瞬间整片重排，用户 260915 反馈的"跳动/不像一套 UI"主要来自这里。
    // 现在窄窗纯靠 CSS 压缩（弹性列 + 正文 148px 下限），侧栏始终是用户自己选的模式；
    // 想要更多正文宽度，用户点左轨收起即可（这是已有交互，不再由代码替他决定）。
    sidebarMode,
    setSidebarMode, sidebarWidth, sidebarResizing, sidebarResizingRef,
    updateSidebarWidth, commitSidebarWidth, handleSidebarResizeActiveChange,
    showSidebarPreview, hideSidebarPreview, clearSidebarPreviewTimer,
    // 窄窗：左轨按钮退化为"把目录树拉出来 / 收回去"（此时没有并排空间，停靠/浮动语义无意义）
    toggleSidebarDock: useCallback(() => {
      if (narrowViewport) { setNarrowSidebarOpen((v) => !v); return; }
      toggleSidebarDock();
    }, [narrowViewport, toggleSidebarDock]),
    // outline
    outlineMode, setOutlineMode, activeOutlineEmpty, setActiveOutlineEmpty,
    outlineEmptyOverride, setOutlineEmptyOverride, outlineSwitching, setOutlineSwitching,
    outlineTabsVersion, outlineSidebarWidth, outlineResizing, setOutlineResizing,
    setOutlineModeForActive, collapseOutline, pinOutline,
    updateOutlineSidebarWidth, commitOutlineSidebarWidth,
    // workspace
    desktopWorkspace, setDesktopWorkspace, switchDesktopWorkspace,
    // panels & misc
    focusMode, setFocusMode, notice, setNotice, showNotice, showNoticeWithAction, error, setError,
    searchPanelOpen, setSearchPanelOpen, searchPanelQuery, setSearchPanelQuery,
    trashOpen, setTrashOpen, historyOpen, setHistoryOpen, historyNoteId, setHistoryNoteId,
    settingsOpen, setSettingsOpen, settingsCategory, setSettingsCategory,
    confirmDelete, setConfirmDelete,
  };
}
