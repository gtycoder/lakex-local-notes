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

  // 卸载清理
  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      if (sidebarPreviewTimer.current !== null) window.clearTimeout(sidebarPreviewTimer.current);
    };
  }, []);

  return {
    // sidebar
    sidebarMode, setSidebarMode, sidebarWidth, sidebarResizing, sidebarResizingRef,
    updateSidebarWidth, commitSidebarWidth, handleSidebarResizeActiveChange,
    showSidebarPreview, hideSidebarPreview, toggleSidebarDock, clearSidebarPreviewTimer,
    // outline
    outlineMode, setOutlineMode, activeOutlineEmpty, setActiveOutlineEmpty,
    outlineEmptyOverride, setOutlineEmptyOverride, outlineSwitching, setOutlineSwitching,
    outlineTabsVersion, outlineSidebarWidth, outlineResizing, setOutlineResizing,
    setOutlineModeForActive, collapseOutline, pinOutline,
    updateOutlineSidebarWidth, commitOutlineSidebarWidth,
    // workspace
    desktopWorkspace, setDesktopWorkspace, switchDesktopWorkspace,
    // panels & misc
    focusMode, setFocusMode, notice, setNotice, showNotice, error, setError,
    searchPanelOpen, setSearchPanelOpen, searchPanelQuery, setSearchPanelQuery,
    trashOpen, setTrashOpen, historyOpen, setHistoryOpen, historyNoteId, setHistoryNoteId,
    settingsOpen, setSettingsOpen, settingsCategory, setSettingsCategory,
    confirmDelete, setConfirmDelete,
  };
}
