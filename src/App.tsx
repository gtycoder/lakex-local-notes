import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Files, ListTree, LoaderCircle, Feather, Lock, LockOpen, Moon, MoreHorizontal, Pencil, Focus, Settings as Settings2Icon, Sun, Trash2 } from "lucide-react";
import { MobileLibrary } from "./components/MobileLibrary";
import { SearchPanel } from "./components/SearchPanel";
import { TrashPanel } from "./components/TrashPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { ConfirmDelete, Sidebar, type SidebarMode } from "./components/Sidebar";
import { QuickNotesWorkspace, type QuickNotesWorkspaceHandle } from "./components/QuickNotesWorkspace";
import { SyncToast } from "./components/SyncToast";
import { SyncStatusPopover } from "./components/SyncStatusPopover";
import { DraftRecoveryDialog } from "./components/DraftRecoveryDialog";
import { useWindowShortcuts } from "./hooks/useWindowShortcuts";
import { useTopMenus } from "./hooks/useTopMenus";
import { DesktopStatusBar } from "./components/DesktopStatusBar";
import { getDocumentStatus } from "./components/documentStatusModel";
import { LakeEditor } from "./features/editor/LakeEditor";
import { clearScrollMemory, locateEditorSearchHit } from "./features/editor/EditorTab";
import { resolveScrollNode } from "./features/editor/lakeRuntime";
import type { LakeEditorInstance } from "./features/editor/lakeRuntime";
import { MultiTabEditor, type TabInfo } from "./features/editor/MultiTabEditor";
import { selectEvictionIds, trimTabsToLimit } from "./core/tabLimit";
import { OutlineSidebar } from "./features/outline/OutlineSidebar";
import type { OutlineMode } from "./features/outline/OutlineController";
import { getOutlineTab, getOutlineTabsVersion, subscribeOutlineTabs } from "./features/outline/registry";
import { cleanLakeMarkdown } from "./core/markdownClean";

import { useDocumentStats } from "./hooks/useDocumentStats";
import { useSavePipeline } from "./hooks/useSavePipeline";
import { useSyncShell } from "./hooks/useSyncShell";
import { useMobileDocumentSession } from "./hooks/useMobileDocumentSession";
import { useSyncController } from "./hooks/useSyncController";
import { useDocumentTabs } from "./hooks/useDocumentTabs";
import { createRequestVersion } from "./core/requestVersion";
import { stripAssetAccessToken } from "./lib/assetPort";
import { getWorkspaceDisplayName } from "./lib/workspaceName";
import { isDesktop, native } from "./lib/native";
import { getNativeErrorMessage } from "./lib/nativeErrors";
import { loadSettings, saveSettings, subscribeSettings, type AppSettings } from "./lib/settings";
import { applyTheme } from "./lib/theme";
import { SettingsPanel, type SettingsCategory } from "./components/SettingsPanel";
import { subtreeIds } from "./core/tree";
import { planTabReload } from "./core/planTabReload";
import { DOCK_GUTTER, FIXED_RAIL_WIDTH } from "./lib/layoutMetrics";
import { OUTLINE_HOVER_TRIGGER_WIDTH, OUTLINE_SCROLLBAR_CLEARANCE } from "./features/outline/outlineInteraction";
import { shouldCollapseSidebarOnHoverLeave, shouldKeepSidebarPreviewOpen } from "./components/sidebarInteraction";
import type { DraftJournalEntry, NoteDigest, NoteDocument, NoteSummary, S3Settings, SyncPendingSummary, SyncProgress, SyncStatus, TreeNode, WorkspaceSnapshot } from "./lib/types";
import { initialOutlineMode, initialOutlineSidebarWidth, initialSidebarMode, initialSidebarWidth, patchNoteById, patchTabById, readEditorDocumentCaches, replaceTreeNode, saveLabel, summaryOf, treeNodePath, type DesktopWorkspace, type NoticeState, type OpenTab, type SaveState, OUTLINE_COLLAPSED_WIDTH, OUTLINE_SIDEBAR_DEFAULT_WIDTH, OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_HOVER_HIDE_DELAY_MS, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./desktop/desktopTypes";

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);
  const [searchPanelQuery, setSearchPanelQuery] = useState("");
  const [conflictSnapshotNotice, setConflictSnapshotNotice] = useState<Array<{ noteId: string; title: string }>>([]);
  const [activeHistoryCount, setActiveHistoryCount] = useState(0);
  const { topMenuOpen, setTopMenuOpen, workspaceMenuOpen, setWorkspaceMenuOpen, closeMenus } = useTopMenus();
  const [focusMode, setFocusMode] = useState(false);
  /** 顶栏两个下拉的触发容器 ref（定位 fixed 菜单用） */
  const wsMenuWrapRef = useRef<HTMLDivElement>(null);
  const moreMenuWrapRef = useRef<HTMLDivElement>(null);
  const syncBtnRef = useRef<HTMLButtonElement>(null);
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
  const [pendingSummary, setPendingSummary] = useState<SyncPendingSummary>({ documents: 0, resources: 0, quickNotes: 0, total: 0, generatedAt: "" });
  const [draftEntries, setDraftEntries] = useState<DraftJournalEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<TreeNode | null>(null);
  const [, setSyncProgress] = useState<SyncProgress | null>(null);
  const handleSyncToastAutoHide = useCallback(() => setSyncProgress(null), []);
  const { syncToast, setSyncToast, showSyncToast } = useSyncShell(handleSyncToastAutoHide);
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null);
  const {
    mobileOpen, setMobileOpen,
    mobilePage, setMobilePage,
    mobileEditing, setMobileEditing,
    mobileTocOpen, setMobileTocOpen,
    mobileActive, setMobileActive,
    mobileDraftTitle, setMobileDraftTitle,
    mobileDraftContent, setMobileDraftContent,
  } = useMobileDocumentSession();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [pinnedNoteIds, setPinnedNoteIds] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("editor");
  const tocEnabled = settings.showToc;
  const [wideMode] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(initialSidebarMode);
  const sidebarModeRef = useRef<SidebarMode>(sidebarMode);
  sidebarModeRef.current = sidebarMode;
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarResizingRef = useRef(false);
  // 全局唯一大纲状态（持久化）：所有“有大纲”的文档都遵循它；
  // 仅当当前文档没有大纲时自动强制悬浮（除非用户在空文档上显式固定）。
  const [outlineMode, setOutlineMode] = useState<OutlineMode>(initialOutlineMode);
  const [activeOutlineEmpty, setActiveOutlineEmpty] = useState(false);
  const [outlineEmptyOverride, setOutlineEmptyOverride] = useState(false);
  const [outlineSwitching, setOutlineSwitching] = useState(false);
  const outlineTabsVersion = useSyncExternalStore(subscribeOutlineTabs, getOutlineTabsVersion, getOutlineTabsVersion);
  const [outlineSidebarWidth, setOutlineSidebarWidth] = useState(initialOutlineSidebarWidth);
  const [outlineResizing, setOutlineResizing] = useState(false);
  const [desktopWorkspace, setDesktopWorkspace] = useState<DesktopWorkspace>("library");
  const [quickNotesDirty, setQuickNotesDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openTabsRef = useRef<OpenTab[]>([]);
  const quickNotesRef = useRef<QuickNotesWorkspaceHandle>(null);
  const tabReloadVersionRef = useRef(createRequestVersion());
  const layoutWidthsRef = useRef({ sidebar: sidebarWidth, outline: outlineSidebarWidth });
  layoutWidthsRef.current = { sidebar: sidebarWidth, outline: outlineSidebarWidth };
  // 已就绪的编辑器实例（noteId → editor），供导出 md 等场景使用
  const editorsRef = useRef<Map<string, LakeEditorInstance>>(new Map());
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const sidebarPreviewTimer = useRef<number | null>(null);
  // V5 Phase 4：保存管线（串行队列 + 防抖定时器 + revision 竞态保护）收拢到 useSavePipeline。
  // 审计 #7：每篇笔记的编辑 revision——保存请求发出后若有新编辑（revision 增长），
  // 旧响应不得覆盖最新草稿/清除 dirty。
  // V5 Phase 4：保存管线回调 useCallback 化——persistTab 依赖稳定，避免每次渲染重建（打字路径抖动收敛）。
  const refreshPendingSummaryRef = useRef<() => void>(() => undefined);
  const handleNoteSaved = useCallback((saved: NoteDocument) => {
    setNotes(patchNoteById(saved.id, summaryOf(saved)));
    setTreeNodes((items) => items.map((item) => item.noteFileId === saved.id || item.id === saved.id ? { ...item, title: saved.title, updatedAt: saved.updatedAt, syncState: saved.syncState } : item));
    setSync((current) => ({ ...current, pendingChanges: Math.max(1, current.pendingChanges) }));
    refreshPendingSummaryRef.current();
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
  const shellPlatformClass = /Mac|iPhone|iPad/.test(navigator.platform) ? "platform-mac" : "platform-native-titlebar";

  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  const docStats = useDocumentStats(openTabs, activeNoteId, mobileActive?.id ?? null, mobileActive?.content ?? "");

  // 顶栏冲突提醒可以在 12 秒后消失，但当前文档的“历史 N”是持久事实，
  // 不能随着 toast 消失；切换文档/打开历史面板时重新读取本地快照数量。
  useEffect(() => {
    if (!activeNoteId) { setActiveHistoryCount(0); return; }
    let alive = true;
    void native.listNoteHistory(activeNoteId)
      .then((items) => { if (alive) setActiveHistoryCount(items.length); })
      .catch(() => { if (alive) setActiveHistoryCount(0); });
    return () => { alive = false; };
  }, [activeNoteId, conflictSnapshotNotice.length, historyOpen]);

  useEffect(() => {
    if (sidebarMode !== "floating") localStorage.setItem("lake-notes-v2.sidebar-mode", sidebarMode);
  }, [sidebarMode]);

  useEffect(() => {
    return () => {
      flushTimers();
      for (const tab of openTabsRef.current) {
        if (!tab.dirty) continue;
        void native.saveDraftJournal({ noteId: tab.noteId, title: tab.title, content: tab.content, updatedAt: new Date().toISOString() }).catch(() => undefined);
      }
      draftTimers.current.forEach((timer) => window.clearTimeout(timer));
      draftTimers.current.clear();
      if (sidebarPreviewTimer.current !== null) window.clearTimeout(sidebarPreviewTimer.current);
      // 拖动过程只更新视觉状态；卸载时补一次合法的最终布局提交。
      const widths = layoutWidthsRef.current;
      localStorage.setItem("lake-notes-v3.sidebar-width", String(Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, widths.sidebar)))));
      localStorage.setItem("lake-notes-v3.outline-sidebar-width", String(Math.round(Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, widths.outline)))));
    };
  }, []);

  useEffect(() => {
    return subscribeSettings((next) => setSettings(next));
  }, []);

  // 钉住状态由 App 持有：自动淘汰/关闭后可感知并清理残留，淘汰逻辑能保护钉住标签。
  useEffect(() => {
    const activeIds = new Set(openTabs.map((t) => t.noteId));
    setPinnedNoteIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (activeIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [openTabs]);

  const handleTogglePin = useCallback((noteId: string) => {
    setPinnedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);


  // 面包屑大纲路径：订阅活动文档大纲变化（滚动切换标题时刷新）
  const [, forceOutlineRender] = useState(0);
  useEffect(() => {
    const handle = getOutlineTab(activeNoteId);
    if (!handle) return;
    return handle.controller.subscribe(() => forceOutlineRender((v) => v + 1));
  }, [activeNoteId, outlineTabsVersion]);

  // 主题与自定义 CSS：设置变化即应用（data-theme 驱动 b3 令牌切换；首帧前已由 main.tsx 预应用）
  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    void native.bootstrap().then(async (snapshot) => {
      setWorkspace(snapshot); setNotes(snapshot.notes); setSync(snapshot.sync);
      void native.getSyncSettings().then((cfg) => setCloudEnabled(cfg.enabled)).catch(() => undefined);
      void native.getS3Settings().then((cfg) => { setS3Settings(cfg); setCloudConfigured(Boolean(cfg)); }).catch(() => undefined);
      void native.getSyncStatus().then((info) => {
        const superseded = info.lastResult?.supersededNotes ?? [];
        if (superseded.length > 0) setConflictSnapshotNotice(superseded.map((item) => ({ noteId: item.id, title: item.title })));
      }).catch(() => undefined);
      void native.getSyncPendingSummary().then(setPendingSummary).catch(() => undefined);
      void native.listDraftJournals().then((entries) => {
        // 启动时不展示已经被删除的文档草稿：删除文档是明确的用户操作，草稿不应绕过回收站重新出现。
        const liveIds = new Set(snapshot.notes.map((note) => note.id));
        const orphaned = entries.filter((entry) => !liveIds.has(entry.noteId));
        setDraftEntries(entries.filter((entry) => liveIds.has(entry.noteId)));
        void Promise.all(orphaned.map((entry) => native.deleteDraftJournal(entry.noteId).catch(() => undefined)));
      }).catch(() => undefined);
      setTreeNodes(await native.listTreeNodes());
      const id = snapshot.lastOpenedNoteId ?? snapshot.notes[0]?.id;
      if (id && !media.matches) {
        const opened = await openNote(id);
        if (!opened) {
          // lastOpenedNoteId 可能指向已 purge 的旧文档；启动不能停在错误页，
          // 回退到第一个仍存在的文档，若资料库为空则保持空状态。
          setError(null);
          const fallback = snapshot.notes.find((note) => note.id !== id)?.id;
          if (fallback) await openNote(fallback);
        }
      }
    }).catch((reason) => setError(getNativeErrorMessage(reason)));
    return () => { media.removeEventListener("change", onChange); };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    return native.onSyncProgress((progress) => {
      const message = progress.message || (progress.phase === "done" ? "同步完成" : "同步中...");
      setSync((current) => ({ ...current, phase: progress.error ? "error" : progress.phase === "done" ? "success" : "syncing", message }));
      if (progress.phase === "done" && !progress.error) {
        void native.getSyncStatus().then((status) => {
          setSync((current) => ({ ...current, phase: "success", message: "同步完成", lastSyncedAt: status.lastSyncedAt, pendingChanges: 0 }));
        }).catch(() => undefined);
        void native.getSyncSettings().then((cfg) => setCloudEnabled(cfg.enabled)).catch(() => undefined);
        // 锁状态等元数据可能随同步变化，刷新摘要与树
        void native.listNoteSummaries().then((items) => setNotes(items)).catch(() => undefined);
        void native.listTreeNodes().then(setTreeNodes).catch(() => undefined);
        void quickNotesRef.current?.refresh();
        // 同步下载会更新磁盘上的 .lake；已打开且无本地未保存修改的 tab 需要重载正文，
        // 否则用户看不到另一端的最新内容（P0：自动同步后打开文档不刷新）。
        // 若本地改动被远端覆盖（已存历史），即使 tab 是 dirty 也要强制重载为远端内容。
        // 优化：先做轻量 digest 比对（只读 DB 行、不读正文文件），未变化的 tab 跳过全量
        // readNote，避免每次同步都把所有打开文档重新读盘（历史快照恢复后上传卡顿的诱因之一）。
        const supersededList = progress.supersededNotes ?? [];
        if (supersededList.length > 0) {
          setConflictSnapshotNotice(supersededList.map((item) => ({ noteId: item.id, title: item.title })));
          window.setTimeout(() => setConflictSnapshotNotice([]), 12000);
        }
        const supersededIds = new Set(supersededList.map((n) => n.id));
        // 渲染进程日志经主进程 console-message 转发落盘；[sync-tab] 前缀便于 grep。
        const tabRefreshStart = performance.now();
        const reloadVersion = tabReloadVersionRef.current.next();
        const tabsAtSync = openTabsRef.current.slice();
        console.log("[sync-tab] refresh start", JSON.stringify({ open: tabsAtSync.length, superseded: supersededList.length }));
        void (async () => {
          const deletedIds: string[] = [];
          let reloaded = 0;
          let skipped = 0;
          for (const tab of tabsAtSync) {
            if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
            const superseded = supersededIds.has(tab.noteId);
            if (!superseded && tab.dirty) { skipped += 1; continue; }
            const tabT0 = performance.now();
            let digest: NoteDigest | null = null;
            try { digest = await native.getNoteDigest(tab.noteId); } catch { continue; }
            if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
            const digestMs = Math.round(performance.now() - tabT0);
            // 远端已删除（软删/墓碑/purge）：标记 tab 提示用户，保留正文供复制/从回收站恢复。
            // 前置检查同时让 TS 收窄 digest 非空（reload 分支无需非空断言）。
            if (!digest || digest.deleted) {
              deletedIds.push(tab.noteId);
              console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: "deleted", digestMs, superseded }));
              continue;
            }
            // V5 Phase 4：digest 阶段决策收敛到纯函数 planTabReload（unchanged-skip / reload）。
            const plan = planTabReload({
              digest,
              lastDigest: tab.lastDigest ?? null,
              tabDirty: tab.dirty,
              superseded,
            });
            // deleted 分支由上方前置检查处理（digest 非空非 deleted 时 plan 不返回 deleted），此处兜底防御。
            if (plan.action === "deleted") continue;
            if (plan.action === "skip") {
              skipped += 1;
              console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: plan.reason === "dirty-pending" ? "skip-dirty" : "skip-unchanged", digestMs }));
              continue; // 正文/元数据未变化，无需重载
            }
            try {
              const readT0 = performance.now();
              const fresh = await native.readNote(tab.noteId);
              if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
              const readMs = Math.round(performance.now() - readT0);
              // 正文或标题任一变化才重载（标题变化不重建 Lake 实例，只更新标签文案）。
              if (fresh && (superseded || fresh.content !== tab.content || fresh.title !== tab.title)) {
                reloaded += 1;
                console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: superseded ? "reload-superseded" : "reload", digestMs, readMs, title: fresh.title }));
                setOpenTabs((tabs) => tabs.map((t) => t.noteId === tab.noteId
                  ? { ...t, title: fresh.title, content: fresh.content, dirty: false, reloadKey: (t.reloadKey ?? 0) + 1, lastDigest: { title: digest.title, updatedAt: digest.updatedAt } }
                  : t));
              } else {
                skipped += 1;
                console.log("[sync-tab] tab", JSON.stringify({ noteId: tab.noteId, action: "skip-content-equal", digestMs, readMs }));
              }
            } catch { /* 读取失败（已删除等）则跳过 */ }
          }
          if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
          console.log("[sync-tab] refresh done", JSON.stringify({ totalMs: Math.round(performance.now() - tabRefreshStart), open: openTabsRef.current.length, reloaded, deleted: deletedIds.length, skipped }));
          if (deletedIds.length > 0) {
            const deletedSet = new Set(deletedIds);
            setOpenTabs((tabs) => tabs.map((t) => deletedSet.has(t.noteId) ? { ...t, deleted: true } : t));
          }
          // 合并提示：冲突覆盖 → 点击查看历史；仅远端删除 → 点击查看回收站。
          if (supersededList.length > 0 || deletedIds.length > 0) {
            const parts: string[] = [];
            if (supersededList.length > 0) parts.push(`远端修改已覆盖本地 ${supersededList.length} 篇（已存历史）`);
            if (deletedIds.length > 0) parts.push(`${deletedIds.length} 个打开的文档已被删除（已移入回收站）`);
            const action: NoticeState["action"] = supersededList.length > 0
              ? { label: "查看历史", onClick: () => { setHistoryNoteId(supersededList[0].id); setHistoryOpen(true); setNotice(null); } }
              : { label: "查看回收站", onClick: () => { setTrashOpen(true); setNotice(null); } };
            setNotice({ text: parts.join("；"), action });
            if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
            noticeTimer.current = window.setTimeout(() => setNotice(null), 8000);
          }
        })();
      }
    });
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
      document.body.classList.toggle("keyboard-open", inset > 120);
    };
    update(); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); document.body.classList.remove("keyboard-open"); };
  }, []);

  const refreshPendingSummary = useCallback(() => {
    void native.getSyncPendingSummary().then(setPendingSummary).catch(() => undefined);
  }, []);
  refreshPendingSummaryRef.current = refreshPendingSummary;

  const refreshDraftEntries = useCallback(async () => {
    try {
      const [entries, summaries] = await Promise.all([native.listDraftJournals(), native.listNoteSummaries()]);
      const liveIds = new Set(summaries.map((note) => note.id));
      const valid = entries.filter((entry) => liveIds.has(entry.noteId));
      setDraftEntries(valid);
      const orphaned = entries.filter((entry) => !liveIds.has(entry.noteId));
      await Promise.all(orphaned.map((entry) => native.deleteDraftJournal(entry.noteId).catch(() => undefined)));
    } catch {
      // 草稿恢复是 best-effort，不能阻塞回收站/主界面的正常操作。
    }
  }, []);

  // 保存管线已收拢到 useSavePipeline（persistTab 由 hook 提供）


  /** 超限自动淘汰：返回被关闭的 noteId 列表（dirty 内容先持久化，绝不淘汰当前激活标签）。 */
  const evictTabsForLimit = useCallback(async (nextTabs: OpenTab[], openedId: string): Promise<string[]> => {
    const limit = settings.maxOpenTabs;
    if (limit <= 0) return [];
    const evictedIds = selectEvictionIds(nextTabs, { limit, activeNoteId: openedId, pinnedNoteIds });
    for (const id of evictedIds) {
      const tab = openTabsRef.current.find((t) => t.noteId === id);
      if (tab?.dirty) await persistTab(id, tab.title, tab.content);
      // V5 Phase 4：淘汰路径同步清理滚动记忆（避免残留导致下次打开位置错乱）
      clearScrollMemory(id);
    }
    return evictedIds;
  }, [settings.maxOpenTabs, pinnedNoteIds, persistTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchPanelQuery("");
        setSearchPanelOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // 审计 #23：窗口/应用关闭时若有未保存草稿，阻止关闭并提示（Electron 显示原生对话框）；
    // 同时立即触发一次保存，尽量在用户留下期间落盘
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasDirty = openTabsRef.current.some((tab) => tab.dirty)
        || (mobileActive !== null && mobileDraftContent !== mobileActive.content)
        || quickNotesDirty;
      if (!hasDirty) return;
      for (const tab of openTabsRef.current) {
        if (!tab.dirty) continue;
        const pendingTimer = saveTimers.current.get(tab.noteId);
        if (pendingTimer !== undefined) {
          window.clearTimeout(pendingTimer);
          saveTimers.current.delete(tab.noteId);
        }
        const draftTimer = draftTimers.current.get(tab.noteId);
        if (draftTimer !== undefined) {
          window.clearTimeout(draftTimer);
          draftTimers.current.delete(tab.noteId);
        }
        // beforeunload 无法等待 IPC；先 best-effort 落一份草稿，再尝试正式保存。
        void native.saveDraftJournal({ noteId: tab.noteId, title: tab.title, content: tab.content, updatedAt: new Date().toISOString() }).catch(() => undefined);
        void persistTab(tab.noteId, tab.title, tab.content);
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [persistTab, mobileActive, mobileDraftContent, quickNotesDirty]);

  // scheduleDraftJournal / scheduleSave 已收拢到 useSavePipeline（hook 提供）

  const showNotice = useCallback((text: string) => {
    setNotice({ text });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200);
  }, []);


  const openNote = useCallback(async (id: string, locateQuery = "", _newTab = false): Promise<boolean> => {
    const locate = () => {
      if (!locateQuery) return;
      let attempts = 0;
      const tryLocate = () => {
        if (locateEditorSearchHit(id, locateQuery) || attempts++ >= 8) return;
        window.setTimeout(tryLocate, 120);
      };
      window.setTimeout(tryLocate, 180);
    };
    const existing = openTabsRef.current.find((tab) => tab.noteId === id);
    if (existing) {
      // 标签曾被标记"已删除"（远端删除）：文档可能已从回收站恢复，重新拉取最新内容刷新标签。
      if (existing.deleted) {
        try {
          const t0 = performance.now();
          const note = await native.readNote(id);
          console.log("[sync-tab] openNote reload-deleted", JSON.stringify({ noteId: id, readMs: Math.round(performance.now() - t0) }));
          if (openTabsRef.current.some((t) => t.noteId === id)) {
            setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === id
              ? { ...tab, title: note.title, content: note.content, dirty: false, deleted: false, reloadKey: (tab.reloadKey ?? 0) + 1, lastDigest: { title: note.title, updatedAt: note.updatedAt } }
              : tab));
          }
        } catch { /* 尚未恢复，保持标记 */ }
      }
      setActiveNoteId(id);
      setOpenTabs((tabs) => tabs.map((tab) =>
        tab.noteId === id ? { ...tab, lastAccessedAt: Date.now() } : tab
      ));
      locate();
      return true;
    }
    try {
      const note = await native.readNote(id);
      if (openTabsRef.current.some((t) => t.noteId === id)) {
        setActiveNoteId(id);
        return true;
      }
      resetRevision(note.id, 0);
      const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now() };
      const nextForEvict = openTabsRef.current.some((t) => t.noteId === id)
        ? openTabsRef.current
        : [...openTabsRef.current, newTab];
      const evictedIds = await evictTabsForLimit(nextForEvict, id);
      setOpenTabs((tabs) => {
        const base = tabs.some((t) => t.noteId === id) ? tabs : [...tabs, newTab];
        // 更新器内再次封顶：并发打开时以最新已提交状态为准，杜绝旧 ref 竞态超限。
        return trimTabsToLimit(base, { limit: settings.maxOpenTabs, activeNoteId: id, pinnedNoteIds });
      });
      if (evictedIds.length > 0) {
        setPinnedNoteIds((prev) => {
          const next = new Set(prev);
          for (const ev of evictedIds) next.delete(ev);
          return next.size === prev.size ? prev : next;
        });
        showNotice(`已自动关闭最旧的标签（上限 ${settings.maxOpenTabs}）`);
      }
      setActiveNoteId(id);
      locate();
      return true;
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
      return false;
    }
  }, [evictTabsForLimit, settings.maxOpenTabs, pinnedNoteIds, showNotice]);

  const openNoteMobile = useCallback(async (id: string) => {
    try {
      const note = await native.readNote(id);
      setMobileActive(note); setMobileDraftTitle(note.title); setMobileDraftContent(note.content);
      setMobilePage("document");
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }, []);

  const restoreDraft = useCallback(async (entry: DraftJournalEntry) => {
    // 先确认正式文档仍存在。否则不能从恢复对话框中静默移除草稿，让用户误以为恢复成功。
    try { await native.readNote(entry.noteId); }
    catch {
      showNotice("草稿对应的文档已不存在；草稿仍保留，可手动丢弃。");
      return;
    }
    await openNote(entry.noteId);
    setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === entry.noteId ? { ...tab, title: entry.title || tab.title, content: entry.content, dirty: true, reloadKey: (tab.reloadKey ?? 0) + 1 } : tab));
    setActiveNoteId(entry.noteId);
    setDraftEntries((entries) => entries.filter((item) => item.noteId !== entry.noteId));
    setSaveState("dirty");
    scheduleSave(entry.noteId, entry.content);
  }, [openNote, scheduleSave, showNotice]);

  const discardDraft = useCallback((noteId: string) => {
    void native.deleteDraftJournal(noteId).catch(() => undefined);
    setDraftEntries((entries) => entries.filter((entry) => entry.noteId !== noteId));
  }, []);

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
    setSyncProgress,
    setSyncToast,
    setConflictSnapshotNotice,
    setSettingsCategory,
    setSettingsOpen,
    showSyncToast,
    refreshPendingSummary,
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
  const copyMarkdownById = useCallback(async (noteId: string | null) => {
    if (!noteId) { showNotice("该节点不是文档"); return; }
    try {
      const caches = await native.readNoteCaches(noteId);
      if (!caches.markdown) { showNotice("该文档还没有文本缓存，请先打开并保存一次"); return; }
      await navigator.clipboard.writeText(caches.markdown);
      showNotice("已复制 Markdown（" + caches.markdown.length + " 字符）");
    } catch (reason) {
      setError("复制 Markdown 失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  /** M1：收口导出（按 noteId）——右键「导出」子菜单所有格式统一入口（markdown/html/lake；word/pdf 待实现） */
  const exportNoteById = useCallback(async (noteId: string | null, format: "markdown" | "html" | "lake") => {
    if (!noteId) { showNotice("该节点不是文档"); return; }
    try {
      const dir = await native.pickExportDir();
      if (!dir) return; // 用户取消
      const result = await native.exportNote(noteId, format, dir);
      const skippedText = result.skipped > 0 ? `（${result.skipped} 张图片缺失已跳过）` : "";
      if (format === "markdown") {
        showNotice(`已导出 Markdown 资料包到 ${result.exportPath}（${result.imageCount} 张图片${skippedText}）`);
      } else if (format === "html") {
        showNotice(`已导出 HTML：${result.exportPath}（${result.imageCount} 张图片${skippedText}）`);
      } else {
        showNotice(`已导出原生 Lake：${result.exportPath}（${result.imageCount} 张图片内嵌${skippedText}）`);
      }
    } catch (reason) {
      setError("导出失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  /** M1：复制资料路径（按 noteId）——标题 + .lake 绝对路径 + 图片目录绝对路径 */
  const copyPathsById = useCallback(async (noteId: string | null) => {
    if (!noteId) { showNotice("该节点不是文档"); return; }
    try {
      const info = await native.getNotePaths(noteId);
      const text = `标题：${info.title}\n正文：${info.lakePath}\n图片目录：${info.assetsDir}`;
      await navigator.clipboard.writeText(text);
      showNotice("已复制资料路径（本机 AI 可读）");
    } catch (reason) {
      setError("复制资料路径失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  /** M1.6：设置/清除文档或分组的自定义图标 */
  const setNodeIcon = useCallback(async (node: TreeNode, icon: string | null) => {
    try {
      const updated = await native.setNodeIcon(node.id, icon);
      setTreeNodes(replaceTreeNode(updated));
      showNotice(icon ? "已设置图标" : "已清除图标");
    } catch (reason) {
      setError("设置图标失败: " + (getNativeErrorMessage(reason)));
    }
  }, [showNotice]);

  // 文档右键（TreeNode 版）包装
  const copyMarkdownFromCache = useCallback((node: TreeNode) => void copyMarkdownById(node.noteFileId), [copyMarkdownById]);
  const exportAs = useCallback((node: TreeNode, format: "markdown" | "html" | "lake") => void exportNoteById(node.noteFileId, format), [exportNoteById]);
  const copyNotePaths = useCallback((node: TreeNode) => void copyPathsById(node.noteFileId), [copyPathsById]);

  const handleContentChange = useCallback((noteId: string, content: string) => {
    bumpRevision(noteId);
    setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, content, dirty: true } : tab));
    const title = openTabsRef.current.find((tab) => tab.noteId === noteId)?.title ?? "无标题";
    scheduleDraftJournal(noteId, title, content);
    scheduleSave(noteId, content);
  }, [scheduleDraftJournal, scheduleSave]);

  async function createNoteIn(parentId: string | null) {
    const note = parentId === null ? await native.createNote("无标题文档") : await native.createNoteIn(parentId, "无标题文档");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    if (isMobile) {
      setMobileActive(note); setMobileDraftTitle(note.title); setMobileDraftContent(note.content);
      setMobileOpen(false); setMobilePage("document"); setMobileEditing(true);
    } else {
      resetRevision(note.id, 0);
      const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now() };
      const evictedIds = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
      setOpenTabs((tabs) => {
        const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
        return trimTabsToLimit(base, { limit: settings.maxOpenTabs, activeNoteId: note.id, pinnedNoteIds });
      });
      if (evictedIds.length > 0) {
        setPinnedNoteIds((prev) => {
          const next = new Set(prev);
          for (const ev of evictedIds) next.delete(ev);
          return next.size === prev.size ? prev : next;
        });
        showNotice(`已自动关闭最旧的标签（上限 ${settings.maxOpenTabs}）`);
      }
      setActiveNoteId(note.id);
      setPendingRenameId(note.id);
    }
  }

  async function createNote() {
    const notebookId = treeNodes.find((node) => node.nodeType === "notebook")?.id ?? null;
    await createNoteIn(notebookId);
  }

  const createTreeItem = useCallback(async (kind: "notebook" | "group" | "note", parentId: string | null, title?: string) => {
    try {
      if (kind === "note") { await createNoteIn(parentId); return; }
      const resolvedTitle = title?.trim();
      if (!resolvedTitle) return;
      if (kind === "notebook") await native.createNotebook(resolvedTitle);
      else if (parentId) await native.createGroup(parentId, resolvedTitle);
      setTreeNodes(await native.listTreeNodes());
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }, []);

  const renameTreeNode = useCallback(async (id: string, title: string) => {
    try {
      const renamed = await native.renameTreeNode(id, title);
      setTreeNodes(replaceTreeNode(renamed));
      if (renamed.noteFileId) {
        setNotes(patchNoteById(renamed.noteFileId, { title: renamed.title, updatedAt: renamed.updatedAt, syncState: "local" }));
        setOpenTabs(patchTabById(renamed.noteFileId, { title: renamed.title }));
      }
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }, []);

  const moveTreeNode = useCallback(async (id: string, targetId: string, position: "before" | "inside" | "after") => {
    try {
      const moving = treeNodes.find((node) => node.id === id);
      const target = treeNodes.find((node) => node.id === targetId);
      if (!moving || !target) return;
      const parentId = position === "inside" ? target.id : target.parentId;
      // UI 会过滤非法根层落点；这里再做一次边界保护，避免 stale pointerup
      // 或异步树刷新把 note/group 送到根层后弹出“必须位于目录节点下”。
      if (moving.nodeType !== "notebook" && parentId === null) return;
      if (moving.nodeType === "notebook" && parentId !== null) return;
      const sameParent = treeNodes.filter((node) => node.parentId === parentId && node.id !== id).sort((a, b) => a.sortOrder - b.sortOrder);
      const orderedIds = position === "inside"
        ? [...sameParent.map((node) => node.id), id]
        : (() => {
            const at = sameParent.findIndex((node) => node.id === targetId);
            const insertAt = at < 0 ? sameParent.length : position === "after" ? at + 1 : at;
            const next = [...sameParent.map((node) => node.id)];
            next.splice(insertAt, 0, id);
            return next;
          })();
      await native.moveTreeNodeOrdered(id, parentId, orderedIds);
      setTreeNodes(await native.listTreeNodes());
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }, [treeNodes]);

  // W-2-B：传给 Sidebar 的回调全部稳定化——App 每次渲染（含打字触发的 openTabs 变化）
  // 不再产生新引用，配合 memo(Sidebar) 让树行渲染彻底跳过按键路径。
  const sidebarSelect = useCallback((id: string) => {
    void (isMobile ? openNoteMobile(id) : openNote(id));
  }, [isMobile, openNoteMobile, openNote]);
  const sidebarCreate = useCallback((kind: "notebook" | "group" | "note", parentId: string | null, title?: string) => {
    void createTreeItem(kind, parentId, title);
  }, [createTreeItem]);
  const sidebarRename = useCallback((id: string, title: string) => {
    void renameTreeNode(id, title);
  }, [renameTreeNode]);
  const sidebarMove = useCallback((id: string, targetId: string, position: "before" | "inside" | "after") => {
    void moveTreeNode(id, targetId, position);
  }, [moveTreeNode]);
  const sidebarRequestDelete = useCallback((node: TreeNode) => setConfirmDelete(node), []);
  const sidebarSetIcon = useCallback((node: TreeNode, icon: string | null) => {
    void setNodeIcon(node, icon);
  }, [setNodeIcon]);
  const sidebarOpenHistory = useCallback((node: TreeNode) => {
    setHistoryNoteId(node.noteFileId);
    setHistoryOpen(!!node.noteFileId);
  }, []);
  const sidebarOpenSearch = useCallback((q?: string) => {
    setSearchPanelQuery(q ?? "");
    setSearchPanelOpen(true);
  }, []);
  const sidebarPendingRenameConsumed = useCallback(() => setPendingRenameId(null), []);
  const sidebarCloseMobile = useCallback(() => setMobileOpen(false), []);

  async function deleteTreeNode(id: string) {
    try {
      const removedNodeIds = subtreeIds(treeNodes, id);
      const removedNoteIds = new Set(
        treeNodes.filter((node) => removedNodeIds.has(node.id) && node.noteFileId).map((node) => node.noteFileId!)
      );
      removedNoteIds.forEach((noteId) => {
        clearNote(noteId);
        clearScrollMemory(noteId);
      });
      await native.deleteTreeNode(id);
      await Promise.all([...removedNoteIds].map((noteId) => native.deleteDraftJournal(noteId).catch(() => undefined)));
      setDraftEntries((entries) => entries.filter((entry) => !removedNoteIds.has(entry.noteId)));
      const remaining = notes.filter((note) => !removedNoteIds.has(note.id));
      setNotes(remaining);
      setTreeNodes(await native.listTreeNodes());
      const next = openTabsRef.current.filter((tab) => !removedNoteIds.has(tab.noteId));
      setOpenTabs(next);
      if (activeNoteId && removedNoteIds.has(activeNoteId)) {
        setActiveNoteId(next[next.length - 1]?.noteId ?? null);
      }
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }

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
    // A resize drag temporarily owns the pointer. The sidebar's bounds move
    // under the pointer as its width changes, so pointerleave is expected and
    // must not collapse the floating preview mid-drag.
    if (shouldKeepSidebarPreviewOpen(sidebarModeRef.current, sidebarResizingRef.current)) return;
    // A docked sidebar is a user-selected persistent state. Pointer leaving it
    // must never route through the floating-preview collapse path.
    if (!shouldCollapseSidebarOnHoverLeave(sidebarModeRef.current)) return;
    // Do not restart the grace period on every pointerleave/pointermove event.
    if (sidebarPreviewTimer.current !== null) return;
    sidebarPreviewTimer.current = window.setTimeout(() => {
      if (shouldCollapseSidebarOnHoverLeave(sidebarModeRef.current)) setSidebarMode("collapsed");
      sidebarPreviewTimer.current = null;
    }, SIDEBAR_HOVER_HIDE_DELAY_MS);
  }, []);

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

  const toggleSidebarDock = useCallback(() => {
    clearSidebarPreviewTimer();
    setSidebarMode((current) => current === "docked" ? "collapsed" : "docked");
  }, [clearSidebarPreviewTimer]);

  /** 手动切换全局大纲状态；空文档上显式固定时给一次豁免。 */
  function setOutlineModeForActive(mode: OutlineMode) {
    setOutlineMode(mode);
    localStorage.setItem("lake-notes-v2.outline-sidebar-mode", mode);
    if (mode === "docked" && activeOutlineEmpty) setOutlineEmptyOverride(true);
    else if (mode === "collapsed") setOutlineEmptyOverride(false);
  }

  /** 右侧 rail 的无图标命中区：保留思源大纲固定/悬停切换，不恢复视觉图标。 */
  function collapseOutline() {
    setOutlineModeForActive("collapsed");
  }

  function pinOutline() {
    setOutlineModeForActive("docked");
  }

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

  const updateSidebarWidth = useCallback((width: number) => {
    setSidebarWidth(width);
  }, []);

  const handleSidebarResizeActiveChange = useCallback((active: boolean) => {
    sidebarResizingRef.current = active;
    setSidebarResizing(active);
  }, []);

  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
    setSidebarWidth(clamped);
    localStorage.setItem("lake-notes-v3.sidebar-width", String(Math.round(clamped)));
  }, []);

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

  function updateOutlineSidebarWidth(width: number) {
    setOutlineSidebarWidth(width);
  }

  function commitOutlineSidebarWidth(width: number) {
    const clamped = Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, width));
    setOutlineSidebarWidth(clamped);
    localStorage.setItem("lake-notes-v3.outline-sidebar-width", String(Math.round(clamped)));
  }

  /** 审计 #8：移动端保存成功后同步 mobileActive/草稿，viewer 不再显示旧快照，
   * 离开时也不会因"仍有差异"而重复保存 */
  async function persistMobile(active: NoteDocument) {
    const saved = await persistTab(active.id, mobileDraftTitle, mobileDraftContent);
    if (saved) {
      setMobileActive(saved);
      setMobileDraftTitle(saved.title);
      setMobileDraftContent(saved.content);
    }
  }

  async function leaveMobileDocument() {
    if (mobileActive && mobileDraftContent !== mobileActive.content) {
      await persistMobile(mobileActive);
    }
    setMobileEditing(false); setMobileTocOpen(false); setMobileOpen(false); setMobilePage("library");
  }

  async function finishMobileEditing() {
    if (mobileActive && mobileDraftContent !== mobileActive.content) {
      await persistMobile(mobileActive);
    }
    setMobileEditing(false);
  }

  async function switchDesktopWorkspace(next: DesktopWorkspace) {
    if (next === desktopWorkspace) return;
    if (desktopWorkspace === "quick-notes") {
      const canLeave = await quickNotesRef.current?.confirmLeave() ?? true;
      if (!canLeave) return;
    }
    setDesktopWorkspace(next);
  }

  async function handleQuickNoteConverted(note: NoteDocument) {
    setNotes((items) => [summaryOf(note), ...items.filter((item) => item.id !== note.id)]);
    try { setTreeNodes(await native.listTreeNodes()); }
    catch (reason) { setError(getNativeErrorMessage(reason)); }
    setDesktopWorkspace("library");
    await openNote(note.id);
  }

  if (!workspace) return <main className="loading-screen"><LoaderCircle className="spin" /><span>正在打开本地知识库</span>{error && <small>{error}</small>}</main>;
  if (isMobile && mobilePage === "library") return <>
    <MobileLibrary notes={notes} search={search} sync={sync} onSearch={setSearch} onSelect={(id) => void openNoteMobile(id)} onCreate={() => void createNote()} />
  </>;

  // 字数/图片统计（W-2-A）：从渲染体移出，避免每次按键对整篇正文跑两次 O(n) 正则。
  const activeNodeSyncState = activeNoteId ? (treeNodes.find((n) => n.noteFileId === activeNoteId)?.syncState ?? "synced") : "synced";

  const editorPrefs = {
    fontSize: settings.fontSize,
    showToolbar: settings.showToolbar,
  };
  // 编辑器面包屑：活动文档路径（思源 protyle-breadcrumb）
  const activePath = activeNoteId ? treeNodePath(treeNodes, activeNoteId) : [];
  const scrollActiveEditorToTop = () => {
    if (!activeNoteId) return;
    clearScrollMemory(activeNoteId);
    const activeHost = document.querySelector<HTMLElement>(`.lake-editor-tab[data-note-id="${CSS.escape(activeNoteId)}"]`);
    // 正常路径按 activeNoteId 定位；多标签切换/懒加载的瞬间如果属性还未回流，
    // 再兜底处理当前可见的编辑器，避免点击后仍停留在旧滚动位置。
    const hosts = activeHost
      ? [activeHost]
      : [...document.querySelectorAll<HTMLElement>(".lake-editor-tab")].filter((host) => getComputedStyle(host).display !== "none");
    for (const host of hosts) {
      const scroller = resolveScrollNode(host);
      try {
        // 回到笔记本不是渐进定位：直接归零，避免大文档的平滑滚动
        // 被编辑器滚动记忆/懒渲染中途打断，停在半路。
        scroller.scrollTop = 0;
        scroller.scrollTo({ top: 0, behavior: "auto" });
      } catch {
        scroller.scrollTop = 0;
      }
    }
  };
  const navigateToHeading = (id: string) => {
    getOutlineTab(activeNoteId)?.navigate(id);
  };
  // 大纲路径：从当前滚动标题沿 parentId 上溯（H1→H2→…），与目录路径可区分
  const headingPath: Array<{ id: string; level: number; text: string }> = (() => {
    const handle = getOutlineTab(activeNoteId);
    const selectedId = handle?.controller.getSelectedId() ?? null;
    if (!handle || !selectedId) return [];
    const path: Array<{ id: string; level: number; text: string }> = [];
    let node = handle.controller.getNode(selectedId);
    while (node) {
      path.unshift({ id: node.id, level: node.level, text: node.text });
      node = node.parentId ? handle.controller.getNode(node.parentId) : null;
    }
    return path;
  })();
  const tabInfos: TabInfo[] = openTabs.map((tab) => ({
    noteId: tab.noteId, title: tab.title, content: tab.content, dirty: tab.dirty, deleted: tab.deleted,
    icon: treeNodes.find((n) => n.noteFileId === tab.noteId)?.icon ?? null,
    reloadKey: tab.reloadKey ?? 0,
  }));

  const outlineVisible = tocEnabled && !isMobile && desktopWorkspace === "library";
  // 只读锁：store 驱动（可同步），派生集合供多标签 viewer 重建
  const lockedNoteIds = new Set(notes.filter((n) => n.isLocked).map((n) => n.id));

  // 融合顶栏左侧按钮（工作空间/云同步/外观/更多）：库视图并入多 tab 顶栏，小记视图单独渲染
  // 顶栏左侧：工作空间（下拉：设置/回收站）+ 云同步
  const topBarLeading = (
    <>
      <div className="toolbar__menu-wrap" ref={wsMenuWrapRef}>
        <button className="toolbar__item" onClick={() => { setWorkspaceMenuOpen((o) => !o); setTopMenuOpen(false); }} title="工作空间" aria-label="工作空间">
          <span className="toolbar__text">{workspaceName}</span><ChevronDown size={13} />
        </button>

      </div>
      <SyncStatusPopover
        buttonRef={syncBtnRef}
        sync={sync}
        saveState={saveState}
        saveLabel={saveLabel(saveState)}
        pendingDocuments={pendingSummary.documents}
        pendingResources={pendingSummary.resources}
        pendingQuickNotes={pendingSummary.quickNotes}
        dirtyTabCount={openTabs.filter((tab) => tab.dirty).length}
        lastSavedAt={lastSavedAt}
        cloudEnabled={cloudEnabled}
        conflictSnapshots={conflictSnapshotNotice}
        conflictSnapshotText={conflictSnapshotNotice.length > 0 ? "检测到远端版本差异，已保留历史快照" : null}
        onSync={() => { void runSync(); }}
        onOpenSettings={() => { setSettingsCategory("sync"); setSettingsOpen(true); }}
        onOpenHistory={(noteId) => { setHistoryNoteId(noteId); setHistoryOpen(true); }}
      />
    </>
  );
  // 顶栏最右侧：外观模式 + 更多（文档操作，目前仅加锁，后续扩展）
  const topBarTrailing = (
    <button className="toolbar__item" onClick={() => saveSettings({ theme: settings.theme === "dark" ? "light" : "dark" })} title="外观模式（浅色/深色）" aria-label="外观模式">
      {settings.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
  const effectiveOutlineMode: OutlineMode = activeOutlineEmpty && !outlineEmptyOverride ? "collapsed" : outlineMode;
  const shellStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--sidebar-grid-w": sidebarMode === "docked" ? `${sidebarWidth}px` : "0px",
    // 目录与大纲的展开面板互不绑定；只有左右常驻 rail 都是 34px。
    "--outline-sidebar-width": `${outlineSidebarWidth}px`,
    "--outline-hover-trigger-width": `${OUTLINE_HOVER_TRIGGER_WIDTH}px`,
    "--outline-scrollbar-clearance": `${OUTLINE_SCROLLBAR_CLEARANCE}px`,
    "--outline-grid-w": outlineVisible
      ? effectiveOutlineMode === "docked"
        ? `${outlineSidebarWidth + OUTLINE_COLLAPSED_WIDTH + DOCK_GUTTER}px`
        : `${OUTLINE_COLLAPSED_WIDTH}px`
      : "0px",
  } as CSSProperties;

  return (
    <div className={`app-shell ${shellPlatformClass} sidebar-${sidebarMode} outline-${effectiveOutlineMode} ${workspaceMenuOpen ? "workspace-menu-open" : ""} ${focusMode ? "focus-mode" : ""} ${desktopWorkspace === "quick-notes" ? "quick-notes-active" : ""} ${sidebarResizing ? "sidebar-resizing" : ""} ${outlineResizing ? "outline-resizing" : ""} ${outlineSwitching ? "outline-switching" : ""} ${isMobile ? `mobile-document-page ${mobileEditing ? "mobile-editing" : "mobile-reading"}` : ""}`} style={shellStyle}>
      <nav className="activity-rail desktop-only" aria-label="应用导航" onPointerEnter={desktopWorkspace === "library" ? showSidebarPreview : undefined} onPointerLeave={desktopWorkspace === "library" ? hideSidebarPreview : undefined}>
        <div className="activity-rail-spacer" />
        <button className={`activity-button ${desktopWorkspace === "library" && sidebarMode === "docked" ? "active" : ""}`} onClick={() => { if (desktopWorkspace === "library") toggleSidebarDock(); else void switchDesktopWorkspace("library"); }} title="资料库" aria-label="资料库"><Files size={16} /></button>
        <button className={`activity-button ${desktopWorkspace === "quick-notes" ? "active" : ""}`} onClick={() => void switchDesktopWorkspace("quick-notes")} title="小记" aria-label="小记"><Feather size={16} /></button>
        <div className="activity-rail-fill" />
      </nav>
      {desktopWorkspace === "library" && <Sidebar nodes={treeNodes} activeId={activeNoteId ?? mobileActive?.id ?? null} search={search} mobileOpen={mobileOpen} mode={sidebarMode} width={sidebarWidth} minWidth={SIDEBAR_MIN_WIDTH} maxWidth={SIDEBAR_MAX_WIDTH} onSearch={setSearch} onSelect={sidebarSelect} onCreate={sidebarCreate} onRename={sidebarRename} onMoveNode={sidebarMove} onRequestDelete={sidebarRequestDelete} onCopyMarkdown={copyMarkdownFromCache} onExportAs={exportAs} onCopyPaths={copyNotePaths} onSetIcon={sidebarSetIcon} onOpenHistory={sidebarOpenHistory} onOpenSearch={sidebarOpenSearch} pendingRenameId={pendingRenameId} onPendingRenameConsumed={sidebarPendingRenameConsumed} onPreviewEnter={showSidebarPreview} onPreviewLeave={hideSidebarPreview} onResizeActiveChange={handleSidebarResizeActiveChange} onWidthChange={updateSidebarWidth} onWidthCommit={commitSidebarWidth} onCloseMobile={sidebarCloseMobile} />}
      {mobileOpen && <div className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
      <main className="workspace" onPointerDownCapture={(event) => {
        if (!isMobile && sidebarMode === "floating" && (event.target as HTMLElement).closest(".document-pane, .empty-workspace")) setSidebarMode("collapsed");
      }}>
        {isMobile && <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-only" onClick={() => void leaveMobileDocument()} title="返回文档列表"><ArrowLeft size={21} /></button>
            {mobileActive
              ? <input className="current-note-input" aria-label="文档名称" value={mobileDraftTitle} onChange={(event) => setMobileDraftTitle(event.target.value)} onBlur={() => { const title = mobileDraftTitle.trim(); if (title && mobileActive && title !== mobileActive.title) void renameTreeNode(mobileActive.id, title); else if (mobileActive) setMobileDraftTitle(mobileActive.title); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape" && mobileActive) { setMobileDraftTitle(mobileActive.title); event.currentTarget.blur(); } }} />
              : <span className="current-note">没有文档</span>}
          </div>
          <div className="topbar-actions">
            {mobileEditing && <button className="icon-button mobile-done" onClick={() => void finishMobileEditing()} title="完成编辑"><Check size={21} /></button>}
          </div>
        </header>}
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>关闭</button></div>}
        {isMobile ? (
          mobileActive ? <section className={`document-pane ${wideMode ? "wide-mode" : ""} ${settings.paragraphSpacing ? "paragraph-spacing" : ""}`}>
            <LakeEditor noteId={mobileActive.id} content={mobileEditing ? mobileDraftContent : mobileActive.content} mode={mobileEditing ? "editor" : "viewer"} tocEnabled={mobileTocOpen} onChange={(content) => setMobileDraftContent(content)} prefs={editorPrefs} onEditorReady={handleEditorReady} />
            {!mobileEditing && <nav className="mobile-reader-actions">
              {!mobileActive.isLocked && <button onClick={() => setMobileEditing(true)}><Pencil size={20} /><span>编辑</span></button>}
              <button className={mobileTocOpen ? "selected" : ""} onClick={() => setMobileTocOpen((open) => !open)}><ListTree size={21} /><span>大纲</span></button>
              <button onClick={() => setMobileOpen(true)}><Files size={20} /><span>切换</span></button>
            </nav>}
          </section> : <section className="empty-workspace"><h2>开始写第一篇笔记</h2><button className="b3-button" onClick={() => void createNote()}>新建文档</button></section>
        ) : desktopWorkspace === "quick-notes" ? (
          <>
            <header className="tab-bar desktop-only" aria-label="顶栏">
              <div className="tabbar-leading">{topBarLeading}</div>
              <div className="tabbar-spacer" />
              <div className="tabbar-trailing">{topBarTrailing}</div>
            </header>
            <QuickNotesWorkspace ref={quickNotesRef} notebooks={treeNodes} onDirtyChange={setQuickNotesDirty} onConverted={(note) => void handleQuickNoteConverted(note)} />
          </>
        ) : (
          <section className={`document-pane ${wideMode ? "wide-mode" : ""} ${settings.paragraphSpacing ? "paragraph-spacing" : ""}`}>
            <div className="read-progress" aria-hidden="true" />
            <MultiTabEditor
              tabs={tabInfos}
              activeNoteId={activeNoteId}
              tocEnabled={tocEnabled}
              topbarLeading={topBarLeading}
              topbarTrailing={topBarTrailing}
              breadcrumb={activePath.length > 0 ? (
                <nav className="protyle-breadcrumb" aria-label="文档路径">
                  {/* 只保留笔记本名（目录路径不重要，顶部有文档名） */}
                  <button type="button" className="protyle-breadcrumb__item protyle-breadcrumb__item--notebook" onClick={scrollActiveEditorToTop} title="回到文档顶部">{activePath[0].title || "无标题"}</button>
                  {headingPath.length > 0 && (
                    <>
                      <span className="protyle-breadcrumb__divider" aria-hidden="true"><ChevronRight size={12} /></span>
                      <span className="protyle-breadcrumb__outline" aria-label="大纲位置">
                        {headingPath.map((hn, i) => (
                          <button
                            key={hn.id}
                            type="button"
                            className={`protyle-breadcrumb__item${i === headingPath.length - 1 ? " protyle-breadcrumb__item--current" : ""}`}
                            onClick={() => navigateToHeading(hn.id)}
                            title={`跳转到 H${hn.level}：${hn.text}`}
                          >
                            {i > 0 && <ChevronRight size={12} />}
                            <span className="protyle-breadcrumb__h">H{hn.level}</span>
                            {hn.text}
                          </button>
                        ))}
                      </span>
                    </>
                  )}
                  <div className="toolbar__menu-wrap protyle-breadcrumb__more" ref={moreMenuWrapRef}>
                    <button className="toolbar__item protyle-breadcrumb__more-btn" onClick={() => { setTopMenuOpen((o) => !o); setWorkspaceMenuOpen(false); }} title="更多" aria-label="更多"><MoreHorizontal size={15} /></button>
                  </div>
                </nav>
              ) : undefined}
              onTabChange={handleTabChange}
              onTabClose={closeTab}
              onTabsReorder={reorderTabs}
              lockedNoteIds={lockedNoteIds}
              pinnedNoteIds={pinnedNoteIds}
              onTogglePin={handleTogglePin}
              onContentChange={handleContentChange}
              prefs={editorPrefs}
              onEditorReady={handleEditorReady}
              onEditorCopyMarkdown={(noteId) => void copyMarkdownById(noteId)}
              onEditorExport={(noteId, format) => void exportNoteById(noteId, format)}
              onEditorCopyPaths={(noteId) => void copyPathsById(noteId)}

              emptyAction={<button className="b3-button" onClick={() => void createNote()}>新建文档</button>}
            />
          </section>
        )}
        <DesktopStatusBar
          showDocumentStats={desktopWorkspace === "library"}
          wordCount={docStats.wordCount}
          imageCount={docStats.imageCount}
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
      {confirmDelete && <ConfirmDelete node={confirmDelete} onConfirm={() => { const id = confirmDelete.id; setConfirmDelete(null); void deleteTreeNode(id); }} onCancel={() => setConfirmDelete(null)} />}
      {/* 顶栏下拉用 portal 渲染到 body 根部，避免被 app-shell 内部堆叠上下文/overflow 覆盖 */}
      {workspaceMenuOpen && createPortal(
        <div className="top-menu top-menu--workspace" role="menu" aria-label="工作空间"
          style={{ top: (wsMenuWrapRef.current?.getBoundingClientRect().bottom ?? 38) + 6, left: wsMenuWrapRef.current?.getBoundingClientRect().left ?? 82 }}>
          <button role="menuitem" onClick={() => { setSettingsCategory("editor"); setSettingsOpen(true); setWorkspaceMenuOpen(false); }}><Settings2Icon size={15} />偏好设置</button>
          <button role="menuitem" onClick={() => { setTrashOpen(true); setWorkspaceMenuOpen(false); }}><Trash2 size={15} />回收站</button>
        </div>,
        document.body,
      )}
      {topMenuOpen && createPortal(
        <div className="top-menu top-menu--more" role="menu" aria-label="文档操作"
          style={{ top: (moreMenuWrapRef.current?.getBoundingClientRect().bottom ?? 38) + 6, left: (moreMenuWrapRef.current?.getBoundingClientRect().right ?? 1280) - 180 }}>
          <button role="menuitem" aria-checked={focusMode} onClick={() => { setFocusMode((value) => !value); setTopMenuOpen(false); }}>
            <Focus size={15} /><span>{focusMode ? "退出专注模式" : "进入专注模式"}<small>⌘⇧Enter</small></span>
          </button>
          {activeNoteId && (
            <button role="menuitem" onClick={() => { void toggleNoteLock(); setTopMenuOpen(false); }}>
              {lockedNoteIds.has(activeNoteId) ? <Lock size={15} /> : <LockOpen size={15} />}
              <span>{lockedNoteIds.has(activeNoteId) ? "解锁当前文档" : "锁定当前文档（只读）"}</span>
            </button>
          )}
        </div>,
        document.body,
      )}
      <DraftRecoveryDialog entries={draftEntries} onRestore={(entry) => void restoreDraft(entry)} onDiscard={discardDraft} onClose={() => setDraftEntries([])} />
      <SearchPanel open={searchPanelOpen} initialQuery={searchPanelQuery} onOpenNote={(id, query) => void openNote(id, query)} onClose={() => setSearchPanelOpen(false)} />
      <TrashPanel open={trashOpen} onClose={() => setTrashOpen(false)} onChanged={() => void refreshDraftEntries()} onRestored={() => {
        void refreshDraftEntries();
        void native.listTreeNodes().then(setTreeNodes).catch(() => undefined);
        void native.listNoteSummaries().then(setNotes).catch(() => undefined);
        // 从回收站恢复后，若该文档正开在 tab 里且曾被标记"已删除"，重载正文并清除标记。
        void (async () => {
          const reloadVersion = tabReloadVersionRef.current.next();
          const t0 = performance.now();
          for (const tab of openTabsRef.current.filter((t) => t.deleted)) {
            if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
            try {
              const readT0 = performance.now();
              const note = await native.readNote(tab.noteId);
              if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
              console.log("[sync-tab] trash-restore reload", JSON.stringify({ noteId: tab.noteId, readMs: Math.round(performance.now() - readT0) }));
              setOpenTabs((tabs) => tabs.map((t) => t.noteId === tab.noteId
                ? { ...t, title: note.title, content: note.content, dirty: false, deleted: false, reloadKey: (t.reloadKey ?? 0) + 1, lastDigest: { title: note.title, updatedAt: note.updatedAt } }
                : t));
            } catch { /* 该文档未恢复或仍不存在，保持标记 */ }
          }
          console.log("[sync-tab] trash-restore done", JSON.stringify({ totalMs: Math.round(performance.now() - t0) }));
        })();
      }} />
      <HistoryPanel open={historyOpen} noteId={historyNoteId} onClose={() => setHistoryOpen(false)} onRestored={(restoredId) => {
        void native.listTreeNodes().then(setTreeNodes).catch(() => undefined);
        void native.listNoteSummaries().then(setNotes).catch(() => undefined);
        // P1：恢复历史后若该文档正开在 tab 里，重载正文 + bump reloadKey 强制重建 Lake 实例。
        // reloadKey 是 MultiTabEditor 里 EditorTab key 的一部分（{noteId}-{reloadKey}），
        // bump 后 React 卸载旧实例、用恢复后的 content 重建新实例，保证编辑器显示恢复版。
        void (async () => {
          const reloadVersion = tabReloadVersionRef.current.next();
          try {
            const t0 = performance.now();
            const updated = await native.readNote(restoredId);
            if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
            console.log("[sync-tab] history-restore reload", JSON.stringify({ noteId: restoredId, readMs: Math.round(performance.now() - t0) }));
            setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === restoredId
              ? { ...tab, title: updated.title, content: updated.content, dirty: false, reloadKey: (tab.reloadKey ?? 0) + 1 }
              : tab));
            bumpRevision(restoredId);
          } catch { /* 文档未打开或读取失败则跳过 */ }
        })();
      }} />
      {syncToast && <SyncToast data={syncToast} onClose={() => { setSyncToast(null); setSyncProgress(null); }} anchorRect={syncBtnRef.current?.getBoundingClientRect()} />}
      <SettingsPanel open={settingsOpen} openCategory={settingsCategory} settings={settings} onClose={() => setSettingsOpen(false)} onChange={(patch) => saveSettings(patch)} onS3SettingsChanged={handleS3SettingsChanged} onSyncSettingsChanged={handleSyncSettingsChanged} />
    </div>
  );
}

