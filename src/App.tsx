import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, PanelLeft } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { SIDEBAR_CORRIDOR_SELECTORS, isInSidebarCorridor, reduceHover, type HoverEffect, type HoverEvent } from "./components/sidebarHoverMachine";
import { useWindowShortcuts } from "./hooks/useWindowShortcuts";
import { useTopMenus } from "./hooks/useTopMenus";
import { DesktopStatusBar } from "./components/DesktopStatusBar";
import { getDocumentStatus } from "./components/documentStatusModel";
import { clearScrollMemory } from "./features/editor/EditorTab";
import { OutlineSidebar } from "./features/outline/OutlineSidebar";

import { useDocumentStats } from "./hooks/useDocumentStats";
import { useNoteActions } from "./hooks/useNoteActions";
import { useSyncRefresh } from "./hooks/useSyncRefresh";
import { useSyncProgress } from "./hooks/useSyncProgress";
import { deriveDesktopView } from "./hooks/desktopDerivedState";
import { useDesktopLifecycle } from "./hooks/useDesktopLifecycle";
import { useOutlineSync } from "./hooks/useOutlineSync";
import { useWorkspaceState } from "./hooks/useWorkspaceState";
import { useSavePipelineGlue } from "./hooks/useSavePipelineGlue";
import { useDesktopHandlers } from "./hooks/useDesktopHandlers";
import { useBootstrap } from "./hooks/useBootstrap";
import { useTreeActions } from "./hooks/useTreeActions";
import { useTabLifecycle } from "./hooks/useTabLifecycle";
import { useNoteLifecycle } from "./hooks/useNoteLifecycle";
import { useSavePipeline } from "./hooks/useSavePipeline";
import { useSyncShell } from "./hooks/useSyncShell";
import { useSyncController } from "./hooks/useSyncController";
import { useDocumentTabs } from "./hooks/useDocumentTabs";
import { ImageLightbox } from "./features/editor/ImageLightbox";
import { AttachmentPreview } from "./features/attachment/AttachmentPreview";
import { native } from "./lib/native";
import { getNativeErrorMessage } from "./lib/nativeErrors";
import type { TreeNode } from "./lib/types";
import { NoteInfoDialog } from "./components/NoteInfoDialog";
import { saveSettings } from "./lib/settings";
import { type OpenTab, EDGE_HANDLE_DWELL_MS, OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./desktop/desktopTypes";
import { DesktopOverlays } from "./desktop/DesktopOverlays";
import { DesktopLibrary } from "./desktop/DesktopLibrary";
import { DesktopQuickNotes } from "./desktop/DesktopQuickNotes";
import { useDesktopShell } from "./desktop/useDesktopShell";
import { DesktopTopBarLeading, DesktopTopBarSearch } from "./desktop/DesktopTopBar";
import { TrashPanel } from "./components/TrashPanel";

export function App() {
  const {
    workspace, setWorkspace, notes, setNotes, treeNodes, setTreeNodes, openTabs, setOpenTabs,
    activeNoteId, setActiveNoteId, search, setSearch, conflictSnapshotNotice, setConflictSnapshotNotice,
    activeHistoryCount, setActiveHistoryCount,
    workspaceMenuRef, moreMenuRef, wsMenuWrapRef, moreMenuWrapRef, syncBtnRef,
    sync, setSync, cloudEnabled, setCloudEnabled, cloudConfigured, setCloudConfigured,
    setS3Settings, pendingSummary, setPendingSummary, draftEntries, setDraftEntries,
    syncAnchorRect, setSyncAnchorRect, pendingRenameId, setPendingRenameId,
    settings, setSettings, pinnedNoteIds, setPinnedNoteIds, tocEnabled, outlineEnhance, wideMode,
    quickNotesDirty, setQuickNotesDirty, openTabsRef, quickNotesRef, tabReloadVersionRef, editorsRef,
  } = useWorkspaceState();
  const { topMenuOpen, setTopMenuOpen, workspaceMenuOpen, setWorkspaceMenuOpen, closeMenus } = useTopMenus({
    workspaceTriggerRef: wsMenuWrapRef,
    moreTriggerRef: moreMenuWrapRef,
    workspaceMenuRef,
    moreMenuRef,
  });
  const [infoNote, setInfoNote] = useState<TreeNode | null>(null);
  const [revealNodeId, setRevealNodeId] = useState<string | null>(null);
  const { syncToast, setSyncToast, showSyncToast } = useSyncShell();
  const shell = useDesktopShell({ quickNotesRef });
  const {
    // sidebar
    sidebarMode, sidebarRenderMode, narrowOverlay, setSidebarMode, sidebarWidth, sidebarResizing, sidebarResizingRef,
    updateSidebarWidth, commitSidebarWidth, handleSidebarResizeActiveChange,
    showSidebarPreview, hideSidebarPreview, toggleSidebarDock, clearSidebarPreviewTimer,
    // outline
    outlineMode, activeOutlineEmpty, setActiveOutlineEmpty,
    outlineEmptyOverride, setOutlineEmptyOverride,
    outlineTabsVersion, outlineSidebarWidth, outlineResizing, setOutlineResizing,
    collapseOutline, pinOutline,
    updateOutlineSidebarWidth, commitOutlineSidebarWidth,
    // workspace
    desktopWorkspace, setDesktopWorkspace, switchDesktopWorkspace,
    // panels & misc
    focusMode, setFocusMode, notice, setNotice, showNotice, showNoticeWithAction, error, setError,
    searchPanelOpen, setSearchPanelOpen, searchPanelQuery, setSearchPanelQuery,
    setTrashOpen, historyOpen, setHistoryOpen, historyNoteId, setHistoryNoteId,
    settingsOpen, setSettingsOpen, settingsCategory, setSettingsCategory,
    confirmDelete, setConfirmDelete,
  } = shell;
  // 快捷键注册放在 shell 之后：⌘] 需要 toggleSidebarDock —— 目录栏此前只有鼠标入口（260923）。
  useWindowShortcuts({
    onOpenSearch: () => { setSearchPanelQuery(""); setSearchPanelOpen(true); closeMenus(); },
    onToggleFocus: () => { setFocusMode((value) => !value); closeMenus(); },
    onToggleSidebarDock: () => { toggleSidebarDock(); closeMenus(); },
    onEscape: closeMenus,
  });
  const layoutWidthsRef = useRef({ sidebar: sidebarWidth, outline: outlineSidebarWidth });
  layoutWidthsRef.current = { sidebar: sidebarWidth, outline: outlineSidebarWidth };
  // V5 Phase 4：保存管线（串行队列 + 防抖定时器 + revision 竞态保护）收拢到 useSavePipeline。
  // 审计 #7：每篇笔记的编辑 revision——保存请求发出后若有新编辑（revision 增长），
  // 旧响应不得覆盖最新草稿/清除 dirty。
  // V5 Phase 4：保存管线回调 useCallback 化——persistTab 依赖稳定，避免每次渲染重建（打字路径抖动收敛）。
  // pending 计数刷新已收敛为主进程 IPC 层事件广播（思源模式）：pending-summary-changed 单点订阅，
  // 渲染层不再需要各操作点手动触发（历史上 10+ 处手动刷新屡有遗漏）。
  const { handleNoteSaved, handleOpenTabsApplied, handleDraftCleared, handleSaveError, handleGetOpenTab, handleGetEditorCaches } = useSavePipelineGlue({
    setNotes, setTreeNodes, setSync, setOpenTabs, setDraftEntries, setError, openTabsRef, editorsRef,
  });

  const {
    saveState, setSaveState,
    persistTab, scheduleSave, scheduleDraftJournal,
    bumpRevision, resetRevision, clearNote, flushTimers,
    saveTimers, draftTimers,
  } = useSavePipeline({
    onNoteSaved: handleNoteSaved,
    onOpenTabsApplied: handleOpenTabsApplied,
    onDraftCleared: handleDraftCleared,
    onError: handleSaveError,
    // 回收站/被 purge 文档被丢弃保存时出声（编辑器此时已只读，这里是最后一道闸）
    onBlockedSave: () => showNotice("文档已在回收站中，编辑不会保存；恢复后才能继续写。"),
    getOpenTab: handleGetOpenTab,
    getEditorCaches: handleGetEditorCaches,
  });

  const preserveBitableDraft = useCallback((noteId: string, content: string) => {
    const saveTimer = saveTimers.current.get(noteId);
    if (saveTimer !== undefined) { window.clearTimeout(saveTimer); saveTimers.current.delete(noteId); }
    const draftTimer = draftTimers.current.get(noteId);
    if (draftTimer !== undefined) { window.clearTimeout(draftTimer); draftTimers.current.delete(noteId); }
    // 已经在途的旧保存响应不能清掉这份恢复草稿。
    bumpRevision(noteId);
    const title = openTabsRef.current.find((tab) => tab.noteId === noteId)?.title ?? "无标题";
    const entry = { noteId, title, content, updatedAt: new Date().toISOString() };
    void native.saveDraftJournal(entry).then(() => {
      setDraftEntries((entries) => [...entries.filter((item) => item.noteId !== noteId), entry]);
      showNotice("文档已只读，切换前的未保存输入已保留为本机草稿；解锁或恢复后可恢复草稿。");
    }).catch((reason) => setError("保留多维表草稿失败：" + getNativeErrorMessage(reason)));
  }, [saveTimers, draftTimers, bumpRevision, openTabsRef, setDraftEntries, showNotice, setError]);

  const { evictTabsForLimit, openNote, restoreDraft, discardDraft } = useTabLifecycle({
    settingsMaxOpenTabs: settings.maxOpenTabs,
    pinnedNoteIds,
    openTabsRef,
    persistTab,
    scheduleSave,
    resetRevision,
    showNotice,
    setError,
    setOpenTabs,
    setActiveNoteId,
    setPinnedNoteIds,
    setDraftEntries,
    setSaveState,
  });
  const { handleContentChange, createNoteIn, createNote, createSheetIn, createBitableIn, createBoardIn, deleteTreeNode } = useNoteLifecycle({
    bumpRevision,
    resetRevision,
    clearNote,
    scheduleDraftJournal,
    scheduleSave,
    evictTabsForLimit,
    showNotice,
    setError,
    treeNodes,
    notes,
    openTabsRef,
    settingsMaxOpenTabs: settings.maxOpenTabs,
    pinnedNoteIds,
    activeNoteId,
    setNotes,
    setTreeNodes,
    setOpenTabs,
    setActiveNoteId,
    setPinnedNoteIds,
    setPendingRenameId,
    setDraftEntries,
  });
  const shellPlatformClass = /Mac|iPhone|iPad/.test(navigator.platform) ? "platform-mac" : "platform-native-titlebar";

  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  // P2-4：图标查找 Map 化——消除每次渲染 O(标签数 × 树节点数) 的线性 find（打字路径每帧都在跑）。
  // 注意：useMemo 必须位于 if (!workspace) early-return 之前（hooks 顺序规则）。
  const iconByNoteId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const node of treeNodes) {
      if (node.noteFileId && !map.has(node.noteFileId)) map.set(node.noteFileId, node.icon ?? null);
    }
    return map;
  }, [treeNodes]);

  const docStats = useDocumentStats(openTabs, activeNoteId, null, "");

  // 顶栏冲突提醒可以在 12 秒后消失，但当前文档的“历史 N”是持久事实，
  // 不能随着 toast 消失；切换文档/打开历史面板时重新读取本地快照数量。



  // 钉住状态由 App 持有：自动淘汰/关闭后可感知并清理残留，淘汰逻辑能保护钉住标签。




  // 主题与自定义 CSS：设置变化即应用（data-theme 驱动 b3 令牌切换；首帧前已由 main.tsx 预应用）

  useBootstrap({
    setWorkspace, setNotes, setSync, setCloudEnabled, setS3Settings, setCloudConfigured,
    setConflictSnapshotNotice, setPendingSummary, setDraftEntries, setTreeNodes, setError, openNote,
  });

  useSyncProgress({
    setSync, setCloudEnabled, setNotes, setTreeNodes, setOpenTabs,
    setConflictSnapshotNotice, setHistoryNoteId, setHistoryOpen, setNotice, setTrashOpen,
    showNoticeWithAction, quickNotesRef, tabReloadVersionRef, openTabsRef,
  });



  // bootstrap 首拉 + 主进程广播订阅（写操作后的刷新由 pending-summary-changed 事件驱动，单点更新）
  const { handleTogglePin } = useDesktopLifecycle({
    onSwitchDesktopWorkspace: (w) => void switchDesktopWorkspace(w),
    syncToast, syncBtnRef, setSyncAnchorRect, activeNoteId,
    conflictSnapshotCount: conflictSnapshotNotice.length, historyOpen, setActiveHistoryCount,
    openTabs, setPinnedNoteIds, theme: settings.theme, setSettings,
    setSearchPanelQuery, setSearchPanelOpen, flushTimers, openTabsRef, draftTimers, saveTimers,
    layoutWidthsRef, quickNotesDirty, persistTab,
  });

  useOutlineSync({
    activeNoteId, outlineTabsVersion, setOutlineEmptyOverride, setActiveOutlineEmpty,
  });

  const { refreshDraftEntries, handleTrashRestored, handleHistoryRestored, reloadNoteTab } = useSyncRefresh({
    setPendingSummary, setDraftEntries, setTreeNodes, setNotes, setOpenTabs, tabReloadVersionRef, openTabsRef, bumpRevision,
  });

  // 保存管线已收拢到 useSavePipeline（persistTab 由 hook 提供）


  /** 超限自动淘汰：返回被关闭的 noteId 列表（dirty 内容先持久化，绝不淘汰当前激活标签）。 */


  // scheduleDraftJournal / scheduleSave 已收拢到 useSavePipeline（hook 提供）
  // notice/showNotice 已收拢到 useDesktopShell（Phase C）

  const { handleTabChange, reorderTabs, closeTab } = useDocumentTabs<OpenTab>({
    tabsRef: openTabsRef,
    activeNoteId,
    setTabs: setOpenTabs,
    setActiveNoteId,
    setSaveState,
    saveTimers,
    persistTab,
    clearScrollMemory,
  });

  // 云同步 toast 壳已收拢到 useSyncShell（busy 常驻，ok/error/其他自动消失）
  const runSync = useSyncController({
    setSync,
    setCloudConfigured,
    setSyncToast,
    setConflictSnapshotNotice,
    setSettingsCategory,
    setSettingsOpen,
    showSyncToast,
    showNoticeWithAction,
    setHistoryNoteId,
    setHistoryOpen,
  });

  const { handleS3SettingsChanged, handleSyncSettingsChanged, handleEditorReady, toggleNoteLock, handleQuickNoteConverted } = useDesktopHandlers({
    setS3Settings, setCloudConfigured, setCloudEnabled, editorsRef,
    activeNoteId, notes, openTabsRef, persistTab, setNotes, setTreeNodes,
    setDesktopWorkspace, openNote, setError,
  });
  const { copyMarkdownById, exportNoteById, copyPathsById, setNodeIcon, copyMarkdownFromCache, exportAs, copyNotePaths } = useNoteActions({ showNotice, setError, setTreeNodes });

  const {
    refreshTree,
    sidebarSelect, sidebarCreate, sidebarRename, sidebarMove,
    sidebarRequestDelete, sidebarSetIcon, sidebarOpenHistory, sidebarOpenSearch, sidebarPendingRenameConsumed,
  } = useTreeActions({
    createNoteIn, createSheetIn, createBitableIn, createBoardIn, openNote, setNodeIcon, treeNodes,
    setTreeNodes, setNotes, setOpenTabs, setConfirmDelete,
    setHistoryNoteId, setHistoryOpen, setSearchPanelQuery, setSearchPanelOpen,
    setPendingRenameId, setError,
  });

  useEffect(() => {
    if (sidebarMode !== "floating") return;
    const isInside = (x: number, y: number, selector: string) => {
      const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (sidebarResizingRef.current) return;
      // 热区（0..8px）也算"留在目录里"：贴边面板虽然会盖住它，但鼠标在面板内边缘来回时不该被自动收起。
      const inCorridor = isInSidebarCorridor(SIDEBAR_CORRIDOR_SELECTORS.map((selector) => isInside(event.clientX, event.clientY, selector)));
      if (inCorridor) {
        clearSidebarPreviewTimer();
      } else {
        hideSidebarPreview();
      }
    };
    window.addEventListener("pointermove", onPointerMove, true);
    return () => window.removeEventListener("pointermove", onPointerMove, true);
  }, [sidebarMode, clearSidebarPreviewTimer, hideSidebarPreview]);

  // ── 左缘触发把手（260922 用户定稿：隐形 8px 热区 + 跟手把手）──
  // 指针进入热区 → 立刻淡入把手（Y 跟随指针，钳制在热区内）；**驻留 EDGE_HANDLE_DWELL_MS** 后
  // 才浮出目录面板预览（防止只是划过左缘就弹）。把手点击 = 固定/取消固定（与热区点击同语义）。
  // 只用 ref + class 操作 DOM：mousemove 高频，不能每次 setState 触发整棵 App 重渲染。
  const edgeHotzoneRef = useRef<HTMLDivElement | null>(null);
  const edgePreviewTimer = useRef<number | null>(null);
  const cancelEdgePreview = useCallback(() => {
    if (edgePreviewTimer.current !== null) {
      window.clearTimeout(edgePreviewTimer.current);
      edgePreviewTimer.current = null;
    }
  }, []);
  const showEdgeHandle = useCallback((clientY: number) => {
    const el = edgeHotzoneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = Math.max(rect.top + 40, Math.min(rect.bottom - 40, clientY));
    el.style.setProperty("--edge-handle-y", `${Math.round(y)}px`);
    el.classList.add("is-active");
  }, []);
  const hideEdgeHandle = useCallback(() => {
    cancelEdgePreview();
    edgeHotzoneRef.current?.classList.remove("is-active");
  }, [cancelEdgePreview]);
  const armEdgePreview = useCallback(() => {
    cancelEdgePreview();
    edgePreviewTimer.current = window.setTimeout(() => {
      edgePreviewTimer.current = null;
      showSidebarPreview();
    }, EDGE_HANDLE_DWELL_MS);
  }, [cancelEdgePreview, showSidebarPreview]);
  useEffect(() => () => cancelEdgePreview(), [cancelEdgePreview]);
  // W5：把手相位机（纯决策在 ./components/sidebarHoverMachine；相位从 DOM/定时器真实来源读取，不额外持有 state）
  const edgeHandleShown = useCallback(() => Boolean(edgeHotzoneRef.current?.classList.contains("is-active")), []);
  const edgeDwellArmed = useCallback(() => edgePreviewTimer.current !== null, []);
  const applyEdgeEffects = useCallback((effects: HoverEffect[], clientY: number) => {
    for (const effect of effects) {
      if (effect === "showHandle") showEdgeHandle(clientY);
      else if (effect === "hideHandle") hideEdgeHandle();
      else if (effect === "armDwell") armEdgePreview();
      else if (effect === "cancelDwell") cancelEdgePreview();
      else if (effect === "showPreview") showSidebarPreview();
      else if (effect === "hidePreview") hideSidebarPreview();
      else if (effect === "toggleDock") toggleSidebarDock();
    }
  }, [showEdgeHandle, hideEdgeHandle, armEdgePreview, cancelEdgePreview, showSidebarPreview, hideSidebarPreview, toggleSidebarDock]);
  const dispatchEdge = useCallback((event: HoverEvent, clientY: number) => {
    const { effects } = reduceHover({ handleShown: edgeHandleShown(), dwellArmed: edgeDwellArmed() }, event);
    applyEdgeEffects(effects, clientY);
  }, [applyEdgeEffects, edgeHandleShown, edgeDwellArmed]);

  // 非指针清理（260924）：窗口失焦 / 页面隐藏时**收不到 pointerleave**，否则 is-active 残留 ⇒
  // 回到「收起」态时把手"常驻"。这里只收把手 + 取消驻留，不动面板模式。
  useEffect(() => {
    const clearEdgeHandle = () => hideEdgeHandle();
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") clearEdgeHandle(); };
    window.addEventListener("blur", clearEdgeHandle);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearEdgeHandle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hideEdgeHandle]);

  // 把手是 10px 边缘热区的「召唤物」，不是持久 UI。窗口失焦/页面隐藏之外，快速划出左缘、
  // 首次进入资料库时指针已经停在热区里、或热区因布局重建吞掉 pointerleave，都可能留下
  // `.is-active`。这里用全局 pointermove 做真实位置兜底：指针一旦明确离开热区/目录栏就收把手。
  useEffect(() => {
    if (sidebarRenderMode !== "collapsed") hideEdgeHandle();
  }, [hideEdgeHandle, sidebarRenderMode]);

  useEffect(() => {
    const clearWhenOutside = (event: PointerEvent) => {
      const hotzone = edgeHotzoneRef.current;
      if (!hotzone?.classList.contains("is-active")) return;
      const path = event.composedPath();
      if (path.includes(hotzone)) return;
      if (path.some((node) => node instanceof Element && (node.classList.contains("sidebar") || node.classList.contains("edge-hotzone-handle")))) return;
      hideEdgeHandle();
    };
    window.addEventListener("pointermove", clearWhenOutside, true);
    return () => window.removeEventListener("pointermove", clearWhenOutside, true);
  }, [hideEdgeHandle]);

  // 切换标签时，大纲数据会在编辑器注册后异步更新；期间禁止壳层 grid 动画，
  // 避免“旧列宽 → 新列宽”与正文淡入同时发生，造成 tab 切换时主区横向抖动。

  // 跟踪当前文档是否为空大纲；切换标签时清除豁免、重新评估。

  /** 只读锁切换：先保存脏草稿，再写 SQLite（锁状态经 manifest v3 同步） */
  if (!workspace) return <main className="loading-screen"><LoaderCircle className="spin" /><span>正在打开本地知识库</span>{error && <small>{error}</small>}</main>;

  // 字数/图片统计（W-2-A）：从渲染体移出，避免每次按键对整篇正文跑两次 O(n) 正则。
  const {
    activeNodeSyncState, editorPrefs, activePath, scrollActiveEditorToTop, navigateToHeading,
    headingPath, tabInfos, outlineVisible, lockedNoteIds, effectiveOutlineMode, shellStyle, activeKind,
  } = deriveDesktopView({
    activeNoteId, treeNodes, notes, openTabs, iconByNoteId,
    fontSize: settings.fontSize, showToolbar: settings.showToolbar, floatingToolbar: settings.floatingToolbar,
    tocEnabled, outlineEnhance,
    desktopWorkspace, activeOutlineEmpty, outlineEmptyOverride, outlineMode,
    sidebarWidth, sidebarMode, narrowOverlay, outlineSidebarWidth,
  });
  const topBarLeadingProps = {
    desktopWorkspace,
    sync: sync,
    pendingSummary,
    cloudEnabled,
    cloudConfigured,
    conflictSnapshots: conflictSnapshotNotice,
    onToggleWorkspaceMenu: () => { setWorkspaceMenuOpen((o) => !o); setTopMenuOpen(false); },
    onSync: () => { void runSync(); },
    onOpenSettings: () => { setSettingsCategory("sync"); setSettingsOpen(true); },
    onOpenHistory: (noteId: string) => { setHistoryNoteId(noteId); setHistoryOpen(true); },
  };
  const libraryTopBarLeading = (
    <DesktopTopBarLeading
      {...topBarLeadingProps}
      visible={desktopWorkspace === "library"}
      wsMenuWrapRef={desktopWorkspace === "library" ? wsMenuWrapRef : undefined}
      syncBtnRef={desktopWorkspace === "library" ? syncBtnRef : undefined}
    />
  );
  const quickNotesTopBarLeading = (
    <DesktopTopBarLeading
      {...topBarLeadingProps}
      visible={desktopWorkspace === "quick-notes"}
      wsMenuWrapRef={desktopWorkspace === "quick-notes" ? wsMenuWrapRef : undefined}
      syncBtnRef={desktopWorkspace === "quick-notes" ? syncBtnRef : undefined}
    />
  );
  const trashTopBarLeading = (
    <DesktopTopBarLeading
      {...topBarLeadingProps}
      visible={desktopWorkspace === "trash"}
      wsMenuWrapRef={desktopWorkspace === "trash" ? wsMenuWrapRef : undefined}
      syncBtnRef={desktopWorkspace === "trash" ? syncBtnRef : undefined}
    />
  );
  /** 文档页顶栏最右侧：全文搜索（原在左侧工作空间下拉里；⇧⌘F 亦可）。 */
  const topBarSearch = (
    <DesktopTopBarSearch onOpenSearch={() => sidebarOpenSearch(search)} />
  );

  return (
    <div className={`app-shell ${shellPlatformClass} sidebar-${sidebarRenderMode} outline-${effectiveOutlineMode} ${workspaceMenuOpen ? "workspace-menu-open" : ""} ${focusMode ? "focus-mode" : ""} ${desktopWorkspace === "quick-notes" ? "quick-notes-active" : ""} ${desktopWorkspace === "trash" ? "trash-space-active" : ""} ${sidebarResizing ? "sidebar-resizing" : ""} ${outlineResizing ? "outline-resizing" : ""} activity-rail-hidden`} style={shellStyle}>
      {/* 单例控制器只配一个应用级宿主，keep-alive 编辑器/历史/小记共享。 */}
      <ImageLightbox />
      <AttachmentPreview />
      {/* 整边触发（左）：隐形 8px 热区 + 跟手把手 —— 资料库空间（260922） */}
      {desktopWorkspace === "library" && (
        <div
          ref={edgeHotzoneRef}
          className="edge-hotzone edge-hotzone-l"
          title="目录：悬停展开 · 点击固定/取消"
          onPointerEnter={(e) => dispatchEdge({ type: "enter" }, e.clientY)}
          onPointerMove={(e) => dispatchEdge({ type: "move" }, e.clientY)}
          onPointerLeave={(e) => {
            // 把手先收（不带条件）：只要指针离开热区/把手就退场——否则移到正文后把手会赖着不走。
            const to = e.relatedTarget as Node | null;
            const staysInShell = Boolean(to && e.currentTarget.closest(".app-shell")?.contains(to));
            dispatchEdge({ type: "leave", staysInShell }, e.clientY);
          }}
          onClick={() => dispatchEdge({ type: "click" }, 0)}
          // 指针被系统/手势取消时不会有 pointerleave ⇒ 主动收把手（见下方 blur/visibility 清理）。
          onPointerCancel={() => hideEdgeHandle()}
        >
          {/* 跟手把手：默认不可见；指针进热区才浮出。点击 = 固定/取消固定。 */}
          <span
            className="edge-hotzone-handle"
            aria-hidden="true"
            title="点击固定/取消固定目录"
            onClick={(e) => { e.stopPropagation(); dispatchEdge({ type: "click" }, 0); }}
          >
            <PanelLeft size={15} className="edge-hotzone-handle__icon" />
            <span className="edge-hotzone-handle__label">目录</span>
          </span>
        </div>
      )}
      {/* 空间切换已并入顶栏工作空间菜单（S1+A）；活动栏不再渲染（壳层导航，功能见菜单 ⌘1–3） */}
      {/* keep-alive：Sidebar 常驻，小记/回收站空间由 shell class 隐藏（避免切回时重建目录树） */}
      <Sidebar nodes={treeNodes} activeId={activeNoteId} search={search} mode={sidebarRenderMode} width={sidebarWidth} minWidth={SIDEBAR_MIN_WIDTH} maxWidth={SIDEBAR_MAX_WIDTH} onSearch={setSearch} onRefreshTree={refreshTree} onSelect={sidebarSelect} onCreate={sidebarCreate} onRename={sidebarRename} onMoveNode={sidebarMove} onRequestDelete={sidebarRequestDelete} onCopyMarkdown={copyMarkdownFromCache} onExportAs={exportAs} onCopyPaths={copyNotePaths} onSetIcon={sidebarSetIcon} onShowInfo={(node) => setInfoNote(node)} onOpenHistory={sidebarOpenHistory} onRevealNoteFile={(node) => { if (node.noteFileId) void native.revealNoteFile(node.noteFileId).catch((reason) => setError(getNativeErrorMessage(reason))); }} revealNodeId={revealNodeId} onRevealConsumed={() => setRevealNodeId(null)} pendingRenameId={pendingRenameId} onPendingRenameConsumed={sidebarPendingRenameConsumed} onPreviewEnter={showSidebarPreview} onPreviewLeave={hideSidebarPreview} onResizeActiveChange={handleSidebarResizeActiveChange} onWidthChange={updateSidebarWidth} onWidthCommit={commitSidebarWidth} onToggleDock={toggleSidebarDock} docked={sidebarMode === "docked"} />
      <main className="workspace" onPointerDownCapture={(event) => {
        const clickedDocument = (event.target as HTMLElement).closest(".document-pane, .empty-workspace");
        // 点正文收起目录栏：宽窗沿用原语义（只有"悬停预览"那种临时浮动态会收）；
        // 窄窗的停靠态本身就是悬浮抽屉（`sidebarRenderMode`），所以窄窗额外把停靠态也纳入——
        // 用户 260915 定稿，且**仅窄窗生效**：宽窗停靠态点正文不会收起（隔离靠 narrowOverlay）。
        const shouldCollapse = sidebarMode === "floating" || (narrowOverlay && sidebarMode === "docked");
        if (clickedDocument && shouldCollapse) setSidebarMode("collapsed");
      }}>
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>关闭</button></div>}
        <div className={"workspace-view" + (desktopWorkspace === "library" ? "" : " workspace-view--hidden")}>
          <DesktopLibrary
            visible={desktopWorkspace === "library"}
            tabs={tabInfos}
            activeNoteId={activeNoteId}
            tocEnabled={tocEnabled}
            outlineEnhance={outlineEnhance}
            topbarLeading={libraryTopBarLeading}
            topbarTrailing={topBarSearch}
            wideMode={wideMode}
            editorPrefs={editorPrefs}
            activePathTitle={activePath.length > 0 ? (activePath[0].title || "无标题") : null}
            headingPath={headingPath}
            moreMenuWrapRef={moreMenuWrapRef}
            onToggleMoreMenu={() => { setTopMenuOpen((o) => !o); setWorkspaceMenuOpen(false); }}
            onScrollToTop={scrollActiveEditorToTop}
            onNavigateToHeading={navigateToHeading}
            lockedNoteIds={lockedNoteIds}
            onOpenTrash={() => void switchDesktopWorkspace("trash")}
            pinnedNoteIds={pinnedNoteIds}
            onTabChange={handleTabChange}
            onTabClose={closeTab}
            onTabsReorder={reorderTabs}
            onTogglePin={handleTogglePin}
            onContentChange={handleContentChange}
            onPreserveBitableDraft={preserveBitableDraft}
            onEditorReady={handleEditorReady}
            onReloadNote={reloadNoteTab}
            onCreateNote={() => void createNote()}
            outlineSlot={outlineVisible ? (
              <OutlineSidebar
                mode={effectiveOutlineMode}
                activeNoteId={activeNoteId}
                width={outlineSidebarWidth}
                minWidth={OUTLINE_SIDEBAR_MIN_WIDTH}
                maxWidth={OUTLINE_SIDEBAR_MAX_WIDTH}
                onCollapse={collapseOutline}
                onPin={pinOutline}
                onResizeActiveChange={setOutlineResizing}
                onWidthChange={updateOutlineSidebarWidth}
                onWidthCommit={commitOutlineSidebarWidth}
              />
            ) : null}
          />
        </div>
        <div className={"workspace-view" + (desktopWorkspace === "quick-notes" ? "" : " workspace-view--hidden")}>
          <DesktopQuickNotes
            notebooks={treeNodes}
            visible={desktopWorkspace === "quick-notes"}
            quickNotesRef={quickNotesRef}
            topbarLeading={quickNotesTopBarLeading}
            onDirtyChange={setQuickNotesDirty}
            onConverted={(note) => void handleQuickNoteConverted(note)}
            />
        </div>
        {/* 回收站空间：与小记同构（顶栏 + 整页 pane），非弹窗 */}
        <div className={"workspace-view" + (desktopWorkspace === "trash" ? "" : " workspace-view--hidden")}>
          <header className="tab-bar desktop-only" aria-label="顶栏">
            <div className="tabbar-leading">{trashTopBarLeading}</div>
            <div className="tab-items" />
            <div className="tabbar-trailing">{topBarSearch}</div>
          </header>
          <TrashPanel
            open={desktopWorkspace === "trash"}
            embed
            onClose={() => void switchDesktopWorkspace("library")}
            onChanged={() => void refreshDraftEntries()}
            onRestored={handleTrashRestored}
          />
        </div>
        <DesktopStatusBar
          showDocumentStats={desktopWorkspace === "library"}
          docKind={activeKind}
          wordCount={docStats.wordCount}
          imageCount={docStats.imageCount}
          locked={activeNoteId !== null && lockedNoteIds.has(activeNoteId)}
          notice={notice}
          documentStatus={getDocumentStatus({
            hasCloudConfig: cloudConfigured,
            syncState: activeNodeSyncState as "local" | "synced" | "conflict",
            saveState,
            historyCount: activeHistoryCount,
          })}
        />
      </main>
      {infoNote && (
        <NoteInfoDialog
          note={{ noteFileId: infoNote.noteFileId, title: infoNote.title }}
          onClose={() => setInfoNote(null)}
          onRevealNoteFile={() => { if (infoNote.noteFileId) void native.revealNoteFile(infoNote.noteFileId).catch((reason) => setError(getNativeErrorMessage(reason))); }}
          onOpenAssetsDir={() => { if (infoNote.noteFileId) void native.openNoteAssets(infoNote.noteFileId).catch((reason) => setError(getNativeErrorMessage(reason))); }}
          onOpenHistory={() => { void sidebarOpenHistory(infoNote); setInfoNote(null); }}
          onJumpToNode={(id) => { setInfoNote(null); setRevealNodeId(id); }}
        />
      )}
      <DesktopOverlays
        confirmDelete={confirmDelete}
        onConfirmDelete={(id) => void deleteTreeNode(id)}
        onCancelDelete={() => setConfirmDelete(null)}
        workspaceMenuOpen={workspaceMenuOpen}
        wsMenuWrapRef={wsMenuWrapRef}
        workspaceMenuRef={workspaceMenuRef}
        moreMenuWrapRef={moreMenuWrapRef}
        moreMenuRef={moreMenuRef}
        topMenuOpen={topMenuOpen}
        onCloseWorkspaceMenu={() => setWorkspaceMenuOpen(false)}
        desktopWorkspace={desktopWorkspace}
        onSwitchWorkspace={(w) => void switchDesktopWorkspace(w)}
        onOpenSettingsFromMenu={(category) => { setSettingsCategory(category); setSettingsOpen(true); setWorkspaceMenuOpen(false); }}
        focusMode={focusMode}
        onToggleFocusMode={() => { setFocusMode((value) => !value); setTopMenuOpen(false); }}
        activeNoteId={activeNoteId}
        activeKind={activeKind}
        lockedNoteIds={lockedNoteIds}
        onToggleNoteLock={() => { void toggleNoteLock(); setTopMenuOpen(false); }}
        // 文档右上角「更多」里的导出：与目录树右键同一套动作，作用于当前文档
        onExportAs={(format) => { void exportNoteById(activeNoteId, format); }}
        onCopyMarkdown={() => void copyMarkdownById(activeNoteId)}
        onCopyPaths={() => void copyPathsById(activeNoteId)}
        onCloseTopMenu={() => setTopMenuOpen(false)}
        draftEntries={draftEntries}
        onRestoreDraft={(entry) => void restoreDraft(entry)}
        onDiscardDraft={discardDraft}
        onCloseDrafts={() => setDraftEntries([])}
        searchPanelOpen={searchPanelOpen}
        searchPanelQuery={searchPanelQuery}
        onOpenNoteFromSearch={(id, query) => void openNote(id, query)}
        onCloseSearch={() => setSearchPanelOpen(false)}
        trashOpen={desktopWorkspace === "trash"}
        trashEmbed
        onCloseTrash={() => void switchDesktopWorkspace("library")}
        onTrashChanged={() => void refreshDraftEntries()}
        onTrashRestored={handleTrashRestored}
        historyOpen={historyOpen}
        historyNoteId={historyNoteId}
        onCloseHistory={() => setHistoryOpen(false)}
        onHistoryRestored={handleHistoryRestored}
        syncToast={syncToast}
        syncAnchorRect={syncAnchorRect}
        onCloseSyncToast={() => setSyncToast(null)}
        settingsOpen={settingsOpen}
        settingsCategory={settingsCategory}
        settings={settings}
        onCloseSettings={() => setSettingsOpen(false)}
        onSettingsChange={(patch) => saveSettings(patch)}
        onS3SettingsChanged={handleS3SettingsChanged}
        onSyncSettingsChanged={handleSyncSettingsChanged}
      />

    </div>
  );
}
