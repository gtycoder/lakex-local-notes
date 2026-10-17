/**
 * 桌面 Shell 状态（§20 Phase C：从 src/App.tsx 收拢布局/面板状态与回调）。
 * - 布局（sidebar/outline/desktopWorkspace）+ 面板（search/trash/history/settings/focus/notice/error/confirmDelete）；
 * - 数据状态（workspace/notes/treeNodes/openTabs/sync）与树/文档操作回调仍留在 App（依赖复杂，后续再评估）；
 * - 与数据无关的纯壳状态收进本 hook，组件从返回值取 props，App 只做装配。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { writeLocalStorage } from "../lib/localStorageSafe";
import type { RefObject } from "react";
import type { OutlineMode } from "../features/outline/OutlineController";
import { getOutlineTabsVersion, subscribeOutlineTabs } from "../features/outline/registry";
import type { SidebarMode } from "../components/app/Sidebar";
import type { SettingsCategory } from "../components/app/SettingsPanel";
import type { TreeNode } from "../lib/types";
import { initialOutlineMode, initialOutlineSidebarWidth, initialSidebarMode, initialSidebarWidth, OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_HOVER_HIDE_DELAY_MS, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, type DesktopWorkspace, type NoticeState } from "./desktopTypes";
import { shouldCollapseSidebarOnHoverLeave, shouldKeepSidebarPreviewOpen } from "../components/model/sidebarInteraction";

/** 窄窗断点：与 `styles.css` 的 `@media (max-width: 760px)` **严格一致**（改一处必须改另一处）。
 *  窄窗下目录栏/大纲一律以浮层呈现，不再占一列——用户 260915 定稿（"窄窗不能出现固定目录栏"）。 */
const NARROW_OVERLAY_MEDIA = "(max-width: 760px)";

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
  // ---- 窄窗（≤760px）：目录栏/大纲不占列，一律浮层 ----
  // 只影响**渲染用的类名**（几何），用户真实选择（sidebarMode / localStorage）与
  // "悬停预览延时收起"、"点正文收起"等交互语义仍按 sidebarMode 走，避免状态漂移。
  const [narrowOverlay, setNarrowOverlay] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_OVERLAY_MEDIA).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW_OVERLAY_MEDIA);
    const onChange = () => setNarrowOverlay(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ---- 布局：outline ----
  const [outlineMode, setOutlineMode] = useState<OutlineMode>(initialOutlineMode);
  const [activeOutlineEmpty, setActiveOutlineEmpty] = useState(false);
  const [outlineEmptyOverride, setOutlineEmptyOverride] = useState(false);
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
    if (sidebarMode !== "floating") writeLocalStorage("lake-notes-v2.sidebar-mode", sidebarMode);
  }, [sidebarMode]);

  const updateSidebarWidth = useCallback((width: number) => { setSidebarWidth(width); }, []);
  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
    setSidebarWidth(clamped);
    writeLocalStorage("lake-notes-v3.sidebar-width", String(Math.round(clamped)));
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
  /** 临时「钉住」目录栏展开（用户 261006：重命名弹窗打开期间，指针移到弹窗上也不能收起目录）。 */
  const sidebarHoldRef = useRef(false);
  const holdSidebarExpanded = useCallback((active: boolean) => {
    sidebarHoldRef.current = active;
    if (active) showSidebarPreview();
  }, [showSidebarPreview]);
  const hideSidebarPreview = useCallback(() => {
    if (sidebarHoldRef.current) return;
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
    writeLocalStorage("lake-notes-v2.outline-sidebar-mode", mode);
    if (mode === "docked" && activeOutlineEmpty) setOutlineEmptyOverride(true);
    else if (mode === "collapsed") setOutlineEmptyOverride(false);
  }, [activeOutlineEmpty]);
  const collapseOutline = useCallback(() => { setOutlineModeForActive("collapsed"); }, [setOutlineModeForActive]);
  const pinOutline = useCallback(() => { setOutlineModeForActive("docked"); }, [setOutlineModeForActive]);
  const updateOutlineSidebarWidth = useCallback((width: number) => { setOutlineSidebarWidth(width); }, []);
  const commitOutlineSidebarWidth = useCallback((width: number) => {
    const clamped = Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, width));
    setOutlineSidebarWidth(clamped);
    writeLocalStorage("lake-notes-v3.outline-sidebar-width", String(Math.round(clamped)));
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
    // 渲染用的侧栏模式：窄窗下"停靠"按"浮动"呈现（几何 = 悬浮带，不占列）。
    sidebarRenderMode: narrowOverlay && sidebarMode === "docked" ? "floating" : sidebarMode,
    /** 窄窗（≤760px）：目录/大纲一律浮层呈现（大纲的"锁定"在窄窗按收起渲染）。 */
    narrowOverlay,
    sidebarMode,
    setSidebarMode, sidebarWidth, sidebarResizing, sidebarResizingRef,
    updateSidebarWidth, commitSidebarWidth, handleSidebarResizeActiveChange,
    showSidebarPreview, hideSidebarPreview, clearSidebarPreviewTimer, holdSidebarExpanded,
    // 左轨按钮：停靠 ↔ 收起。窄窗下停靠态渲染成悬浮抽屉，所以这一个按钮就是"抽屉开/关"。
    toggleSidebarDock,
    // outline
    outlineMode, setOutlineMode, activeOutlineEmpty, setActiveOutlineEmpty,
    outlineEmptyOverride, setOutlineEmptyOverride,
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
