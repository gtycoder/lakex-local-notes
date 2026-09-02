import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LoaderCircle } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import type { QuickNotesWorkspaceHandle } from "./components/QuickNotesWorkspace";
import { useWindowShortcuts } from "./hooks/useWindowShortcuts";
import { useTopMenus } from "./hooks/useTopMenus";
import { DesktopStatusBar } from "./components/DesktopStatusBar";
import { getDocumentStatus } from "./components/documentStatusModel";
import { clearScrollMemory, locateEditorSearchHit } from "./features/editor/EditorTab";
import { resolveScrollNode } from "./features/editor/lakeRuntime";
import type { LakeEditorInstance } from "./features/editor/lakeRuntime";
import type { TabInfo } from "./features/editor/MultiTabEditor";
import { selectEvictionIds, trimTabsToLimit } from "./core/tabLimit";
import { OutlineSidebar } from "./features/outline/OutlineSidebar";
import type { OutlineMode } from "./features/outline/OutlineController";
import { getOutlineTab } from "./features/outline/registry";
import { cleanLakeMarkdown } from "./core/markdownClean";

import { useDocumentStats } from "./hooks/useDocumentStats";
import { useNoteActions } from "./hooks/useNoteActions";
import { useSyncRefresh } from "./hooks/useSyncRefresh";
import { useSyncProgress } from "./hooks/useSyncProgress";
import { deriveDesktopView } from "./hooks/desktopDerivedState";
import { useDesktopLifecycle } from "./hooks/useDesktopLifecycle";
import { useBootstrap } from "./hooks/useBootstrap";
import { useTreeActions } from "./hooks/useTreeActions";
import { useTabLifecycle } from "./hooks/useTabLifecycle";
import { useNoteLifecycle } from "./hooks/useNoteLifecycle";
import { useSavePipeline } from "./hooks/useSavePipeline";
import { useSyncShell } from "./hooks/useSyncShell";
import { useSyncController } from "./hooks/useSyncController";
import { useDocumentTabs } from "./hooks/useDocumentTabs";
import { createRequestVersion } from "./core/requestVersion";
import { stripAssetAccessToken } from "./lib/assetPort";
import { getWorkspaceDisplayName } from "./lib/workspaceName";
import { native } from "./lib/native";
import { getNativeErrorMessage } from "./lib/nativeErrors";
import { loadSettings, saveSettings, type AppSettings } from "./lib/settings";
import { subtreeIds } from "./core/tree";
import { DOCK_GUTTER } from "./lib/layoutMetrics";
import { OUTLINE_HOVER_TRIGGER_WIDTH, OUTLINE_SCROLLBAR_CLEARANCE } from "./features/outline/outlineInteraction";
import type { DraftJournalEntry, NoteDocument, NoteSummary, S3Settings, SyncPendingSummary, SyncProgress, SyncStatus, TreeNode, WorkspaceSnapshot } from "./lib/types";
import { patchNoteById, patchTabById, readEditorDocumentCaches, replaceTreeNode, summaryOf, treeNodePath, type DesktopWorkspace, type NoticeState, type OpenTab, OUTLINE_COLLAPSED_WIDTH, OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./desktop/desktopTypes";
import { DesktopOverlays } from "./desktop/DesktopOverlays";
import { DesktopLibrary } from "./desktop/DesktopLibrary";
import { DesktopQuickNotes } from "./desktop/DesktopQuickNotes";
import { useDesktopShell } from "./desktop/useDesktopShell";
import { DesktopTopBarLeading, DesktopTopBarTrailing } from "./desktop/DesktopTopBar";
import { DesktopActivityRail } from "./desktop/DesktopActivityRail";

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [conflictSnapshotNotice, setConflictSnapshotNotice] = useState<Array<{ noteId: string; title: string }>>([]);
  const [activeHistoryCount, setActiveHistoryCount] = useState(0);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  /** 顶栏两个下拉的触发容器 ref（定位 fixed 菜单用） */
  const wsMenuWrapRef = useRef<HTMLDivElement>(null);
  const moreMenuWrapRef = useRef<HTMLDivElement>(null);
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  const { topMenuOpen, setTopMenuOpen, workspaceMenuOpen, setWorkspaceMenuOpen, closeMenus } = useTopMenus({
    workspaceTriggerRef: wsMenuWrapRef,
    moreTriggerRef: moreMenuWrapRef,
    workspaceMenuRef,
    moreMenuRef,
  });
  useWindowShortcuts({
    onOpenSearch: () => { setSearchPanelQuery(""); setSearchPanelOpen(true); closeMenus(); },
    onToggleFocus: () => { setFocusMode((value) => !value); closeMenus(); },
    onEscape: closeMenus,
  });
  const [sync, setSync] = useState<SyncStatus>({ phase: "idle", message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 });
  const [cloudEnabled, setCloudEnabled] = useState(true);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  /** 顶栏「工作空间」名：云同步启用且已配置 S3 时显示对象前缀。 */
  const [s3Settings, setS3Settings] = useState<S3Settings | null>(null);
  const workspaceName = getWorkspaceDisplayName(cloudEnabled, s3Settings);
  const [pendingSummary, setPendingSummary] = useState<SyncPendingSummary>({ documents: 0, folders: 0, resources: 0, quickNotes: 0, total: 0, generatedAt: "" });
  const [draftEntries, setDraftEntries] = useState<DraftJournalEntry[]>([]);
  const { syncToast, setSyncToast, showSyncToast } = useSyncShell();
  // P2-3：syncAnchorRect 仅在 toast 打开/内容变化时计算一次，避免每次渲染读 DOM 强制 reflow。
  const [syncAnchorRect, setSyncAnchorRect] = useState<DOMRect | null>(null);
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [pinnedNoteIds, setPinnedNoteIds] = useState<Set<string>>(() => new Set());
  const tocEnabled = settings.showToc;
  // P2-4：wideMode 恒 true 且从不 set，改为模块常量（消除死 useState）
  const wideMode = true;
  const [quickNotesDirty, setQuickNotesDirty] = useState(false);
  const openTabsRef = useRef<OpenTab[]>([]);
  const quickNotesRef = useRef<QuickNotesWorkspaceHandle>(null);
  const tabReloadVersionRef = useRef(createRequestVersion());
  // 已就绪的编辑器实例（noteId → editor），供导出 md 等场景使用
  const editorsRef = useRef<Map<string, LakeEditorInstance>>(new Map());
  const shell = useDesktopShell({ quickNotesRef });
  const {
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
    focusMode, setFocusMode, notice, setNotice, showNotice, showNoticeWithAction, error, setError,
    searchPanelOpen, setSearchPanelOpen, searchPanelQuery, setSearchPanelQuery,
    trashOpen, setTrashOpen, historyOpen, setHistoryOpen, historyNoteId, setHistoryNoteId,
    settingsOpen, setSettingsOpen, settingsCategory, setSettingsCategory,
    confirmDelete, setConfirmDelete,
  } = shell;
  const layoutWidthsRef = useRef({ sidebar: sidebarWidth, outline: outlineSidebarWidth });
  layoutWidthsRef.current = { sidebar: sidebarWidth, outline: outlineSidebarWidth };
  // V5 Phase 4：保存管线（串行队列 + 防抖定时器 + revision 竞态保护）收拢到 useSavePipeline。
  // 审计 #7：每篇笔记的编辑 revision——保存请求发出后若有新编辑（revision 增长），
  // 旧响应不得覆盖最新草稿/清除 dirty。
  // V5 Phase 4：保存管线回调 useCallback 化——persistTab 依赖稳定，避免每次渲染重建（打字路径抖动收敛）。
  // pending 计数刷新已收敛为主进程 IPC 层事件广播（思源模式）：pending-summary-changed 单点订阅，
  // 渲染层不再需要各操作点手动触发（历史上 10+ 处手动刷新屡有遗漏）。
  const handleNoteSaved = useCallback((saved: NoteDocument) => {
    setNotes(patchNoteById(saved.id, summaryOf(saved)));
    setTreeNodes((items) => items.map((item) => item.noteFileId === saved.id || item.id === saved.id ? { ...item, title: saved.title, updatedAt: saved.updatedAt, syncState: saved.syncState } : item));
    setSync((current) => ({
      ...current,
      pendingChanges: saved.syncState === "synced" ? current.pendingChanges : Math.max(1, current.pendingChanges),
    }));
  }, [setNotes, setTreeNodes, setSync]);
  const handleOpenTabsApplied = useCallback((saved: NoteDocument) => {
    setOpenTabs(patchTabById(saved.id, { title: saved.title, content: saved.content, dirty: false, lastDigest: { title: saved.title, updatedAt: saved.updatedAt } }));
  }, [setOpenTabs]);
  const handleDraftCleared = useCallback((noteId: string) => {
    void native.deleteDraftJournal(noteId).catch(() => undefined);
    setDraftEntries((entries) => entries.filter((entry) => entry.noteId !== noteId));
  }, [setDraftEntries]);
  const handleSaveError = useCallback((message: string) => setError(message), [setError]);
  const handleGetOpenTab = useCallback((noteId: string) => openTabsRef.current.find((t) => t.noteId === noteId), []);
  const handleGetEditorCaches = useCallback((noteId: string) => {
    return readEditorDocumentCaches(editorsRef.current.get(noteId)) ?? { markdown: null, plain: null };
  }, []);

  const {
    saveState, setSaveState, lastSavedAt,
    persistTab, scheduleSave, scheduleDraftJournal,
    bumpRevision, resetRevision, clearNote, flushTimers,
    saveTimers, draftTimers,
  } = useSavePipeline({
    onNoteSaved: handleNoteSaved,
    onOpenTabsApplied: handleOpenTabsApplied,
    onDraftCleared: handleDraftCleared,
    onError: handleSaveError,
    getOpenTab: handleGetOpenTab,
    getEditorCaches: handleGetEditorCaches,
  });

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
  const { handleContentChange, createNoteIn, createNote, deleteTreeNode } = useNoteLifecycle({
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



  // 面包屑大纲路径：订阅活动文档大纲变化（滚动切换标题时刷新）
  const [, forceOutlineRender] = useState(0);
  useEffect(() => {
    const handle = getOutlineTab(activeNoteId);
    if (!handle) return;
    return handle.controller.subscribe(() => forceOutlineRender((v) => v + 1));
  }, [activeNoteId, outlineTabsVersion]);

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
    syncToast, syncBtnRef, setSyncAnchorRect, activeNoteId,
    conflictSnapshotCount: conflictSnapshotNotice.length, historyOpen, setActiveHistoryCount,
    openTabs, setPinnedNoteIds, theme: settings.theme, setSettings,
    setSearchPanelQuery, setSearchPanelOpen, flushTimers, openTabsRef, draftTimers, saveTimers,
    layoutWidthsRef, quickNotesDirty, persistTab,
  });

  const { refreshPendingSummary, refreshDraftEntries, handleTrashRestored, handleHistoryRestored } = useSyncRefresh({
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
  });

  const handleS3SettingsChanged = useCallback((next: S3Settings) => {
    setS3Settings(next);
    setCloudConfigured(true);
  }, []);
  const handleSyncSettingsChanged = useCallback((next: { enabled: boolean }) => {
    setCloudEnabled(next.enabled);
  }, []);

  /** 编辑器实例就绪回调：注册到 map，销毁时移除；就绪时补写文本缓存（存量文档首次打开即有缓存） */
  const handleEditorReady = useCallback((noteId: string, editor: LakeEditorInstance | null) => {
    if (editor) {
      editorsRef.current.set(noteId, editor);
      try {
        if (typeof editor.getDocument === "function") {
          const markdown = cleanLakeMarkdown(stripAssetAccessToken(editor.getDocument("text/markdown")));
          const plain = stripAssetAccessToken(editor.getDocument("text/plain"));
          void native.updateNoteCaches(noteId, markdown, plain);
        }
      } catch {
        // 锁定态 Viewer 不暴露 getDocument("text/markdown")：由主进程从磁盘 .lake 兜底补齐缓存
        void native.ensureNoteCaches(noteId);
      }
    } else {
      editorsRef.current.delete(noteId);
    }
  }, []);

  /** 全文导出 Markdown：Lake 内核原生支持（getDocument("text/markdown")），复制到剪贴板 */
  /** M1：复制为 Markdown（按 noteId）——读保存时生成的文本缓存，无需打开编辑器 */
  const { copyMarkdownById, exportNoteById, copyPathsById, setNodeIcon, copyMarkdownFromCache, exportAs, copyNotePaths } = useNoteActions({ showNotice, setError, setTreeNodes });

  const {
    createTreeItem, renameTreeNode, moveTreeNode,
    sidebarSelect, sidebarCreate, sidebarRename, sidebarMove,
    sidebarRequestDelete, sidebarSetIcon, sidebarOpenHistory, sidebarOpenSearch, sidebarPendingRenameConsumed,
  } = useTreeActions({
    createNoteIn, openNote, setNodeIcon, treeNodes,
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
      if (isInside(event.clientX, event.clientY, ".activity-rail") || isInside(event.clientX, event.clientY, ".sidebar")) {
        clearSidebarPreviewTimer();
      } else {
        hideSidebarPreview();
      }
    };
    window.addEventListener("pointermove", onPointerMove, true);
    return () => window.removeEventListener("pointermove", onPointerMove, true);
  }, [sidebarMode, clearSidebarPreviewTimer, hideSidebarPreview]);

  // 切换标签时，大纲数据会在编辑器注册后异步更新；期间禁止壳层 grid 动画，
  // 避免“旧列宽 → 新列宽”与正文淡入同时发生，造成 tab 切换时主区横向抖动。
  useEffect(() => {
    setOutlineSwitching(true);
    const timer = window.setTimeout(() => setOutlineSwitching(false), 220);
    return () => window.clearTimeout(timer);
  }, [activeNoteId]);

  // 跟踪当前文档是否为空大纲；切换标签时清除豁免、重新评估。
  useEffect(() => {
    setOutlineEmptyOverride(false);
    const tabId = activeNoteId;
    if (!tabId) { setActiveOutlineEmpty(false); return; }
    const handle = getOutlineTab(tabId);
    if (!handle) { setActiveOutlineEmpty(false); return; }
    const evaluate = () => setActiveOutlineEmpty(handle.controller.getEntryCount() === 0);
    evaluate();
    return handle.controller.subscribe(evaluate);
    // tabsVersion：新标签注册晚于 activeNoteId 变化时也要重新评估。
  }, [activeNoteId, outlineTabsVersion]);

  /** 只读锁切换：先保存脏草稿，再写 SQLite（锁状态经 manifest v3 同步） */
  async function toggleNoteLock() {
    const tabId = activeNoteId;
    if (!tabId) return;
    const summary = notes.find((n) => n.id === tabId);
    if (!summary) return;
    const next = !summary.isLocked;
    const tab = openTabsRef.current.find((t) => t.noteId === tabId);
    if (next && tab?.dirty) await persistTab(tabId, tab.title, tab.content);
    // 锁定态 Viewer 无法用内核生成文本缓存；锁定前确保 md/text 缓存存在（已有则跳过）
    if (next) {
      try {
        const caches = await native.readNoteCaches(tabId);
        if (!caches.markdown || !caches.plain) {
          await native.ensureNoteCaches(tabId);
        }
      } catch { /* 缓存兜底失败不阻断锁定 */ }
    }
    try {
      const updated = await native.setNoteLocked(tabId, next);
      setNotes(patchNoteById(tabId, { isLocked: updated.isLocked, lockedAt: updated.lockedAt }));
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }

  async function handleQuickNoteConverted(note: NoteDocument) {
    setNotes((items) => [summaryOf(note), ...items.filter((item) => item.id !== note.id)]);
    try { setTreeNodes(await native.listTreeNodes()); }
    catch (reason) { setError(getNativeErrorMessage(reason)); }
    setDesktopWorkspace("library");
    await openNote(note.id);
  }

  if (!workspace) return <main className="loading-screen"><LoaderCircle className="spin" /><span>正在打开本地知识库</span>{error && <small>{error}</small>}</main>;

  // 字数/图片统计（W-2-A）：从渲染体移出，避免每次按键对整篇正文跑两次 O(n) 正则。
  const {
    activeNodeSyncState, editorPrefs, activePath, scrollActiveEditorToTop, navigateToHeading,
    headingPath, tabInfos, outlineVisible, lockedNoteIds, effectiveOutlineMode, shellStyle,
  } = deriveDesktopView({
    activeNoteId, treeNodes, notes, openTabs, iconByNoteId,
    fontSize: settings.fontSize, showToolbar: settings.showToolbar, tocEnabled,
    desktopWorkspace, activeOutlineEmpty, outlineEmptyOverride, outlineMode,
    sidebarWidth, sidebarMode, outlineSidebarWidth,
  });
  const topBarLeadingProps = {
    workspaceName,
    sync: sync,
    pendingSummary,
    cloudEnabled,
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
  const topBarTrailing = (
    <DesktopTopBarTrailing
      theme={settings.theme}
      onToggleTheme={() => saveSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}
    />
  );

  return (
    <div className={`app-shell ${shellPlatformClass} sidebar-${sidebarMode} outline-${effectiveOutlineMode} ${workspaceMenuOpen ? "workspace-menu-open" : ""} ${focusMode ? "focus-mode" : ""} ${desktopWorkspace === "quick-notes" ? "quick-notes-active" : ""} ${sidebarResizing ? "sidebar-resizing" : ""} ${outlineResizing ? "outline-resizing" : ""} ${outlineSwitching ? "outline-switching" : ""}`} style={shellStyle}>
      <DesktopActivityRail
        desktopWorkspace={desktopWorkspace}
        sidebarMode={sidebarMode}
        onToggleSidebarDock={toggleSidebarDock}
        onSwitchWorkspace={(w) => void switchDesktopWorkspace(w)}
        onPreviewEnter={showSidebarPreview}
        onPreviewLeave={hideSidebarPreview}
      />
      {/* keep-alive：Sidebar 常驻，小记模式由 .app-shell.quick-notes-active .sidebar 隐藏（避免切回时重建目录树、丢失展开状态） */}
      <Sidebar nodes={treeNodes} activeId={activeNoteId} search={search} mode={sidebarMode} width={sidebarWidth} minWidth={SIDEBAR_MIN_WIDTH} maxWidth={SIDEBAR_MAX_WIDTH} onSearch={setSearch} onSelect={sidebarSelect} onCreate={sidebarCreate} onRename={sidebarRename} onMoveNode={sidebarMove} onRequestDelete={sidebarRequestDelete} onCopyMarkdown={copyMarkdownFromCache} onExportAs={exportAs} onCopyPaths={copyNotePaths} onSetIcon={sidebarSetIcon} onOpenHistory={sidebarOpenHistory} onOpenSearch={sidebarOpenSearch} pendingRenameId={pendingRenameId} onPendingRenameConsumed={sidebarPendingRenameConsumed} onPreviewEnter={showSidebarPreview} onPreviewLeave={hideSidebarPreview} onResizeActiveChange={handleSidebarResizeActiveChange} onWidthChange={updateSidebarWidth} onWidthCommit={commitSidebarWidth} />
      <main className="workspace" onPointerDownCapture={(event) => {
        if (sidebarMode === "floating" && (event.target as HTMLElement).closest(".document-pane, .empty-workspace")) setSidebarMode("collapsed");
      }}>
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>关闭</button></div>}
        <div className={"workspace-view" + (desktopWorkspace === "quick-notes" ? " workspace-view--hidden" : "")}>
          <DesktopLibrary
            visible={desktopWorkspace === "library"}
            tabs={tabInfos}
            activeNoteId={activeNoteId}
            tocEnabled={tocEnabled}
            topbarLeading={libraryTopBarLeading}
            topbarTrailing={topBarTrailing}
            wideMode={wideMode}
            paragraphSpacing={settings.paragraphSpacing}
            editorPrefs={editorPrefs}
            activePathTitle={activePath.length > 0 ? (activePath[0].title || "无标题") : null}
            headingPath={headingPath}
            moreMenuWrapRef={moreMenuWrapRef}
            onToggleMoreMenu={() => { setTopMenuOpen((o) => !o); setWorkspaceMenuOpen(false); }}
            onScrollToTop={scrollActiveEditorToTop}
            onNavigateToHeading={navigateToHeading}
            lockedNoteIds={lockedNoteIds}
            pinnedNoteIds={pinnedNoteIds}
            onTabChange={handleTabChange}
            onTabClose={closeTab}
            onTabsReorder={reorderTabs}
            onTogglePin={handleTogglePin}
            onContentChange={handleContentChange}
            onEditorReady={handleEditorReady}
            onEditorCopyMarkdown={(noteId) => void copyMarkdownById(noteId)}
            onEditorExport={(noteId, format) => void exportNoteById(noteId, format)}
            onEditorCopyPaths={(noteId) => void copyPathsById(noteId)}
            onCreateNote={() => void createNote()}
          />
        </div>
        <div className={"workspace-view" + (desktopWorkspace === "quick-notes" ? "" : " workspace-view--hidden")}>
          <DesktopQuickNotes
            notebooks={treeNodes}
            quickNotesRef={quickNotesRef}
            topbarLeading={quickNotesTopBarLeading}
            topbarTrailing={topBarTrailing}
            onDirtyChange={setQuickNotesDirty}
            onConverted={(note) => void handleQuickNoteConverted(note)}
            />
        </div>
        <DesktopStatusBar
          showDocumentStats={desktopWorkspace === "library"}
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
      {outlineVisible && (
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
        onOpenSettingsFromMenu={(category) => { setSettingsCategory(category); setSettingsOpen(true); setWorkspaceMenuOpen(false); }}
        onOpenTrashFromMenu={() => { setTrashOpen(true); setWorkspaceMenuOpen(false); }}
        focusMode={focusMode}
        onToggleFocusMode={() => { setFocusMode((value) => !value); setTopMenuOpen(false); }}
        activeNoteId={activeNoteId}
        lockedNoteIds={lockedNoteIds}
        onToggleNoteLock={() => { void toggleNoteLock(); setTopMenuOpen(false); }}
        draftEntries={draftEntries}
        onRestoreDraft={(entry) => void restoreDraft(entry)}
        onDiscardDraft={discardDraft}
        onCloseDrafts={() => setDraftEntries([])}
        searchPanelOpen={searchPanelOpen}
        searchPanelQuery={searchPanelQuery}
        onOpenNoteFromSearch={(id, query) => void openNote(id, query)}
        onCloseSearch={() => setSearchPanelOpen(false)}
        trashOpen={trashOpen}
        onCloseTrash={() => setTrashOpen(false)}
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
