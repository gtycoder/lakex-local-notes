import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCloudActive } from "./core/cloudState";
import { ChevronDown, PanelLeft, XSquare } from "lucide-react";
import { Menu } from "./components/ui/Overlay";
import { usePopoverPosition } from "./hooks/usePopoverPosition";
import { TabItemVisual } from "./features/editor/TabItemVisual";
import { Sidebar } from "./components/app/Sidebar";
import { SIDEBAR_CORRIDOR_SELECTORS, isInSidebarCorridor, reduceHover, type HoverEffect, type HoverEvent } from "./components/model/sidebarHoverMachine";
import { useWindowShortcuts } from "./hooks/useWindowShortcuts";
import { useTopMenus } from "./hooks/useTopMenus";
import { DesktopStatusBar } from "./components/app/DesktopStatusBar";
import { SafeModeBanner } from "./components/app/SafeModeBanner";
import { NamePromptDialog } from "./components/app/NamePromptDialog";
import { getDocumentStatus } from "./components/model/documentStatusModel";
import { clearScrollMemory } from "./features/editor/editorViewport";
import { prefetchEditorKernel } from "./features/editor/kernelPrefetch";
import { setNoteRefHost } from "./features/editor/noteRef";
import { TablePasteGuardDialog } from "./features/editor/TablePasteGuardDialog";
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
import { useTagSpaceData } from "./hooks/useTagSpaceData";
import { EMPTY_TAG_SELECTION, computeTagVisibleIds, type TagAggregateItem, type TagSelection } from "./features/tags/tagsModel";
import { createConflictCopy } from "./hooks/saveConflictCopy";
import { useSyncShell } from "./hooks/useSyncShell";
import { useSyncController } from "./hooks/useSyncController";
import { useDocumentTabs } from "./hooks/useDocumentTabs";
import { ImageLightbox } from "./features/editor/ImageLightbox";
import { AttachmentPreview } from "./features/attachment/AttachmentPreview";
import { NativeTitleTips } from "./components/ui/NativeTitleTips";
import { native } from "./lib/native";
import { getNativeErrorMessage } from "./lib/nativeErrors";
import { composeDiaryQuickNote } from "./features/diary/diaryQuickNote";
import type { TreeNode } from "./lib/types";
/** P12：回收站/单据属性弹窗都挂 Lake 内核（HistorySnapshotPreview → useHistorySnapshotViewer），
 *  只在真正打开时才需要 ⇒ 懒加载，避免内核重新进入首屏静态图。 */
const NoteInfoDialog = lazy(() => import("./components/app/NoteInfoDialog").then((m) => ({ default: m.NoteInfoDialog })));
import { saveSettings } from "./lib/settings";
import { useSafeModeStatus } from "./hooks/useSafeModeStatus";
import { useTabSessionPersistence } from "./hooks/useTabSessionPersistence";
import { type OpenTab, EDGE_HANDLE_DWELL_MS, OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, patchTabById, treeNodePath } from "./desktop/desktopTypes";
import { SaveConflictDialog } from "./components/app/SaveConflictDialog";
import { DesktopOverlays } from "./desktop/DesktopOverlays";
import { AiAssistantHost } from "./features/ai/AiAssistantHost";
import { openAiAssistant } from "./features/ai/aiAssistantSession";
import { DesktopLibrary } from "./desktop/DesktopLibrary";
import { DesktopQuickNotes } from "./desktop/DesktopQuickNotes";
// AI 写作空间按需加载（261109 发版前 review P2-4）：静态 import 会把入口 +28KB、首屏余量压到 13.9KB。
const AiWritingWorkspace = lazy(() => import("./features/aiWriting/AiWritingWorkspace").then((m) => ({ default: m.AiWritingWorkspace })));
import { useDesktopShell } from "./desktop/useDesktopShell";
import { DesktopSplitButton, DesktopTopBarLeading, DesktopTopBarSearch } from "./desktop/DesktopTopBar";
import { DesktopWorkspaceSlotProvider } from "./desktop/desktopWorkspaceSlot";
import { BrandLaunchMark } from "./components/app/BrandLaunchMark";
const TrashPanel = lazy(() => import("./components/app/TrashPanel").then((m) => ({ default: m.TrashPanel })));
/** 日记空间（docs/DIARY.md）：左栏年月 + 主区复用 EditorTab；组件内部再懒一层内核边界。 */
const DiaryWorkspace = lazy(() => import("./features/diary/DiaryWorkspace").then((m) => ({ default: m.DiaryWorkspace })));
import { documentTreeWithoutDiary, diaryEntryIds, diaryNotebookOf, documentIdOfTreeNode } from "./features/diary/diaryTree";
import { diaryOpenErrorMessage, requestDiaryOpenDate } from "./features/diary/diaryOpen";
import { formatDiaryDateKey, planDiaryConvert, planDiaryOpen } from "./core/diary";
/** P1 标签空间（一级入口「标签」）：只读聚合 + 就地元数据管理；预览正文由组件内部再懒加载（内核边界）。 */
const TagsWorkspace = lazy(() => import("./features/tags/TagsWorkspace").then((m) => ({ default: m.TagsWorkspace })));
import { AssetsBrowser } from "./components/app/AssetsBrowser";

export function App() {
  const {
    workspace, setWorkspace, notes, setNotes, treeNodes, setTreeNodes, openTabs, setOpenTabs,
    activeNoteId, setActiveNoteId, splitPair, setSplitPair, search, setSearch, conflictSnapshotNotice, setConflictSnapshotNotice,
    activeHistoryCount, setActiveHistoryCount,
    workspaceMenuRef, moreMenuRef, wsMenuWrapRef, moreMenuWrapRef, syncBtnRef,
    sync, setSync, cloudEnabled, setCloudEnabled, cloudConfigured, setCloudConfigured,
    setS3Settings, pendingSummary, setPendingSummary, draftEntries, setDraftEntries,
    syncAnchorRect, setSyncAnchorRect, pendingRenameId, setPendingRenameId,
    settings, setSettings, pinnedNoteIds, setPinnedNoteIds, tocEnabled, outlineEnhance, wideMode,
    quickNotesDirty, setQuickNotesDirty, openTabsRef, quickNotesRef, noteReloadGuardRef, editorsRef,
  } = useWorkspaceState();
  const { topMenuOpen, setTopMenuOpen, workspaceMenuOpen, setWorkspaceMenuOpen, closeMenus } = useTopMenus({
    workspaceTriggerRef: wsMenuWrapRef,
    moreTriggerRef: moreMenuWrapRef,
    workspaceMenuRef,
    moreMenuRef,
  });
  const [infoNote, setInfoNote] = useState<TreeNode | null>(null);
  const [revealNodeId, setRevealNodeId] = useState<string | null>(null);
  /**
   * 顶栏「更多 → AI 助手」入口（用户 261005 定稿）：**永远纯提问** —— 只问 + 复制。
   * **不读选区、不提供「替换选区 / 插入到选区后」**：选区滚出可视区后从右上角进入会有锚点/滚动难题，
   * 所以这里彻底不参与正文写回；要替换 / 插入请用**选区浮动工具栏**的 AI（它只在有选中时出现）。
   */

  const { syncToast, setSyncToast, showSyncToast } = useSyncShell();
  const shell = useDesktopShell({ quickNotesRef });
  // ===== P1 标签空间（一级入口「标签」）=====
  // 标签目录（quick-notes 库，已同步）+ 文档关系（主库）一份数据；侧栏「按标签筛选」与标签页共用。
  const tagSpace = useTagSpaceData();
  const [tagSelection, setTagSelection] = useState<TagSelection>(EMPTY_TAG_SELECTION);
  const tagVisibleIds = useMemo(
    () => computeTagVisibleIds(treeNodes, tagSpace.links, tagSelection),
    [treeNodes, tagSpace.links, tagSelection],
  );
  /** 标签目录元数据管理：目录仍走既有 quick-notes 标签通道（主进程负责跨库协调文档关系）。 */
  const tagSpaceActions = useMemo(() => ({
    rename: async (id: string, name: string) => { await native.updateQuickNoteTag(id, { name }); },
    merge: async (sourceId: string, targetId: string) => { await native.mergeQuickNoteTags(sourceId, targetId); },
    remove: async (id: string) => { await native.deleteQuickNoteTag(id); },
    reorder: async (ids: string[]) => { await native.reorderQuickNoteTags(ids); },
  }), []);
  /** 标签页只读预览取正文（文档 = readNote；小记 = readQuickNote 的 lake body）。 */
  const loadTagPreview = useCallback(async (item: TagAggregateItem): Promise<string | null> => {
    if (item.kind === "doc") {
      const note = await native.readNote(item.id);
      return note.content ?? "";
    }
    const quick = await native.readQuickNote(item.id);
    return quick.content?.body || quick.content?.text || "";
  }, []);
  /** 「移除该标签」= 取消这一条与标签的关系（可逆、无二次确认）：文档 setNoteTags / 小记 setQuickNoteTags。 */
  const removeTagFromItem = useCallback(async (item: TagAggregateItem, tagId: string): Promise<void> => {
    if (item.kind === "doc") {
      const current = tagSpace.links[item.id] ?? [];
      await native.setNoteTags(item.id, current.filter((id) => id !== tagId));
      return;
    }
    const quick = tagSpace.quickNotes.find((note) => note.id === item.id);
    await native.setQuickNoteTags(item.id, (quick?.tagIds ?? []).filter((id) => id !== tagId));
  }, [tagSpace.links, tagSpace.quickNotes]);
  const {
    // sidebar
    sidebarMode, sidebarRenderMode, narrowOverlay, setSidebarMode, sidebarWidth, sidebarResizing, sidebarResizingRef,
    updateSidebarWidth, commitSidebarWidth, handleSidebarResizeActiveChange,
    showSidebarPreview, hideSidebarPreview, toggleSidebarDock, clearSidebarPreviewTimer, holdSidebarExpanded,
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
  /** 进入标签空间时重读一次（目录/关系可能在别处改过：属性面板、小记页、同步）。 */
  useEffect(() => {
    if (desktopWorkspace === "tags") void tagSpace.reload();
  }, [desktopWorkspace, tagSpace.reload]);
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
  // 表格内核 = 一个 ≈6.8MB 的懒加载 chunk（Univer 全量 preset）：首开才拉 ⇒ 空白/灰底 → 表格（用户 261022
  // 报「打开表格先变白再变灰再出现表格，感觉卡」）。就绪后**空闲预取**，把下载 + 解析挪到点击之前；
  // 真正首开仍可能有实例初始化的几百 ms（那是内核 init，不是下载）。失败静默：非表格用户不为它付可见代价。
  useEffect(() => {
    if (!workspace) return;
    const prewarm = (): void => { void import("./features/usheet/UniverSheetEditor").catch(() => undefined); };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(prewarm, { timeout: 8000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(prewarm, 4000);
    return () => window.clearTimeout(handle);
  }, [workspace]);
  // 261023：macOS 原生全屏（独立 Space）里系统把标题栏/红绿灯一起隐藏 ⇒ 顶栏不再留 82px 让位，
  // 整体从最左侧开始（仿思源；只影响全屏，窗口/最大化仍是 82px）。判据 = 主进程广播的真实全屏态。
  useEffect(() => {
    const root = document.documentElement;
    const apply = (fullscreen: boolean) => root.classList.toggle("window-fullscreen", fullscreen);
    let off: (() => void) | undefined;
    try { off = native.onWindowFullscreen(apply); } catch { /* 非 Electron（浏览器预览/测试）忽略 */ }
    return () => { off?.(); root.classList.remove("window-fullscreen"); };
  }, []);

  // macOS 菜单「设置…（⌘,）」→ 打开设置面板（参考思源：菜单点击只发事件，渲染层决定开哪块）。
  useEffect(() => {
    let off: (() => void) | undefined;
    try { off = native.onOpenSettings(() => setSettingsOpen(true)); } catch { /* 非 Electron（浏览器预览/测试）忽略 */ }
    return () => { off?.(); };
  }, [setSettingsOpen]);

  // boot 窗口：等 workspace（或启动错误）已经渲染到主窗口后再显示，避免主窗口先露白/重复播 splash。
  useEffect(() => {
    if (!workspace && !error) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const bridge = (window as unknown as { lakeNative?: { rendererReady?: () => void } }).lakeNative;
        bridge?.rendererReady?.();
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, [workspace, error]);

  const { handleNoteSaved, handleOpenTabsApplied, handleDraftCleared, handleSaveError, handleGetOpenTab, handleGetEditorCaches, handleCaptureContent, handleCaptureReady } = useSavePipelineGlue({
    setNotes, setTreeNodes, setSync, setOpenTabs, setDraftEntries, setError, openTabsRef, editorsRef,
  });

  // 稳定保存失败回调：否则 persistTab → openNote → sidebarSelect 每次渲染都换引用，整树行缓存失效。
  const handleBlockedSave = useCallback(() => showNotice("文档已在回收站中，编辑不会保存；恢复后才能继续写。"), [showNotice]);

  const {
    saveStates, setSaveState,
    persistTab, scheduleSave, scheduleDraftJournal,
    bumpRevision, resetRevision, clearNote, flushTimers,
    saveTimers, draftTimers,
    saveConflicts, clearSaveConflict,
  } = useSavePipeline({
    onNoteSaved: handleNoteSaved,
    onOpenTabsApplied: handleOpenTabsApplied,
    onDraftCleared: handleDraftCleared,
    onError: handleSaveError,
    // 回收站/被 purge 文档被丢弃保存时出声（编辑器此时已只读，这里是最后一道闸）
    onBlockedSave: handleBlockedSave,
    getOpenTab: handleGetOpenTab,
    getEditorCaches: handleGetEditorCaches,
    captureContent: handleCaptureContent,
  });

  /**
   * Batch4-D 保存版本守卫：磁盘正文被外部/他端改过时管线返回 external_changed 并**挂起该文档的自动保存**，
   * 这里弹三选项确认（另存副本 / 覆盖磁盘 / 放弃并载入磁盘版），处理完才恢复自动保存。
   */
  const [saveConflictBusy, setSaveConflictBusy] = useState(false);
  const saveConflict = useMemo(() => Object.values(saveConflicts)[0] ?? null, [saveConflicts]);

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

  const { evictTabsForLimit, openNote, restoreTabs, restoreDraft, discardDraft } = useTabLifecycle({
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

  /** 全局搜索命中「小记」：切到小记工作区并定位/高亮该条（不进编辑态；结果 id 不在 tree_nodes，不能走 openNote）。 */
  const openQuickNoteFromSearch = useCallback(async (id: string) => {
    await switchDesktopWorkspace("quick-notes");
    await quickNotesRef.current?.revealNote(id);
  }, [switchDesktopWorkspace, quickNotesRef]);

  // 「文档引用」卡片的宿主注入（R2，261008）：自定义卡由**内核自己的 React 树**渲染，拿不到我们的
  // context/props ⇒ 把「文档清单 + 打开文档」注册到模块级注册表（与 imagePreview 同一姿势）。
  // 依赖 notes/openNote：每次 notes 变化都重注册，卡片读到的永远是最新快照。
  useEffect(() => {
    setNoteRefHost({
      listNotes: () => notes,
      openNote,
      /** 资料库全路径（`笔记本/分组/文档`）：「复制引用」复制的就是它（见 noteRef.ts 的 host 注释）。 */
      pathOf: (noteId) => {
        const path = treeNodePath(treeNodes, noteId);
        return path.length > 0 ? path.map((node) => node.title || "无标题").join("/") : null;
      },
    });
    return () => setNoteRefHost(null);
  }, [notes, openNote, treeNodes]);

  const { handleContentChange, createNoteIn, createUsheetIn, createBitableIn, createBoardIn, createInkIn, deleteTreeNode } = useNoteLifecycle({
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
    setConflictSnapshotNotice, setPendingSummary, setDraftEntries, setTreeNodes, setError, openNote, restoreTabs, showNotice,
  });

  // 桌面标签会话（device-local）：标签/活动页变化即落盘；开启「退出时关闭全部标签」时清掉、不恢复。
  // Batch4-D：安全模式（或判据还没到达）下**完全不碰**会话文件——安全模式不恢复标签，若照旧写回 []
  // 会把用户的原会话覆盖掉（下次正常启动也恢复不回来）。
  // 判据单一来源 = useSafeModeStatus 的会话写入门（组件里不再各写一套 if）。
  const safeModeStatus = useSafeModeStatus();
  useTabSessionPersistence({
    ready: Boolean(workspace),
    openTabs,
    activeNoteId,
    clearTabsOnExit: settings.clearTabsOnExit,
    safeModeStatus,
  });

  /** Batch3-B：内核预取只按启动时的安全模式判定一次（避免每次标签变化都打 IPC）。 */
  const safeModeCheckedRef = useRef(false);

  // P12：启动就绪后（首个 workspace 到达）安排一次内核 chunk 的空闲预取；幂等，后续标签变化再调无副作用。
  // Batch3-B：安全模式**不预热内核 chunk**（崩溃排查时少一个后台重活）⇒ 就绪后问一次主进程，结果只问一次。
  // 注：这里保留自己的查询（与上面会话判据分开问）——预取是另一件事，Batch3-B 的既有契约（含其静态护栏）
  // 不因会话门槛而改变；两处都是「启动时一次」，代价可忽略。
  useEffect(() => {
    if (!workspace || safeModeCheckedRef.current) return;
    safeModeCheckedRef.current = true;
    void native.getSafeModeState()
      .then((state) => { if (!state.active) prefetchEditorKernel(); })
      .catch(() => prefetchEditorKernel());
  }, [workspace]);

  useSyncProgress({
    setSync, setCloudEnabled, setNotes, setTreeNodes, setOpenTabs,
    setConflictSnapshotNotice, setHistoryNoteId, setHistoryOpen, setNotice, setTrashOpen,
    showNoticeWithAction, showNotice, quickNotesRef, openTabsRef,
    // 261028 P1：epoch 不一致时状态栏提示里的「打开同步设置」入口（最小新增 prop）。
    openSyncSettings: () => { setSettingsCategory("sync"); setSettingsOpen(true); },
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
    setPendingSummary, setDraftEntries, setTreeNodes, setNotes, setOpenTabs, noteReloadGuardRef, openTabsRef, bumpRevision,
  });

  // 保存管线已收拢到 useSavePipeline（persistTab 由 hook 提供）
  /** 创建副本前把涉及的 dirty 标签先落盘（同一份 persistTab，含版本守卫/冲突处理）。 */
  const flushNotesBeforeDuplicate = useCallback(async (ids: readonly string[]) => {
    const dirty = new Set(openTabsRef.current.filter((tab) => tab.dirty).map((tab) => tab.noteId));
    for (const id of ids) {
      if (!dirty.has(id)) continue;
      // 保存失败/被拦截 ⇒ 不创建副本（宁可让用户重试，也不复制旧内容）——与移动端统一。
      const outcome = await persistTab(id);
      if (!outcome || outcome.ok !== true) throw new Error("保存失败，未创建副本");
    }
  }, [persistTab]);

  /**
   * 「正文缺失」面板的重新读取（261023）：同步把正文拉回来后刷该 tab；仍缺失就明确告知，不静默。
   */
  const retryMissingBody = useCallback(async (noteId: string) => {
    try {
      const note = await native.readNote(noteId);
      if (note.bodyMissing) {
        showNotice(`《${note.title || "无标题"}》的正文仍然缺失（可等同步拉回或从历史恢复）。`);
        return;
      }
      setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId
        ? { ...tab, title: note.title, content: note.content, bodyMissing: false, dirty: false, reloadKey: (tab.reloadKey ?? 0) + 1 }
        : tab));
      showNotice("已重新读取正文。");
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }, [setOpenTabs, setError, showNotice]);


  /** 超限自动淘汰：返回被关闭的 noteId 列表（dirty 内容先持久化，绝不淘汰当前激活标签）。 */


  // scheduleDraftJournal / scheduleSave 已收拢到 useSavePipeline（hook 提供）
  // notice/showNotice 已收拢到 useDesktopShell（Phase C）

  const { handleTabChange: handleTabChangeBase, reorderTabs, closeTab: closeTabBase } = useDocumentTabs<OpenTab>({
    tabsRef: openTabsRef,
    activeNoteId,
    setTabs: setOpenTabs,
    setActiveNoteId,
    setSaveState,
    saveTimers,
    persistTab,
    clearScrollMemory,
  });

  // ---- 分屏（261008）：左右两栏、最多两个、不同文档、临时不持久化 ----
  /** 分屏开关：把另一个已打开标签放到右栏（焦点留在原栏）。 */
  const enterSplit = useCallback((noteId: string) => {
    if (!activeNoteId || noteId === activeNoteId) return;
    // 261012 修：分屏会隐藏两栏面包屑右端的「更多」触发钮 ⇒ 若顶栏菜单正开着，它的锚点元素被卸载，
    // 浮层停在旧坐标且再无按钮可对齐（DesktopOverlays 取 moreMenuWrapRef 的 rect，取不到就没有锚点）。
    closeMenus();
    setSplitPair({ left: activeNoteId, right: noteId });
  }, [activeNoteId, setSplitPair, closeMenus]);
  const exitSplit = useCallback(() => setSplitPair(null), [setSplitPair]);
  const swapSplit = useCallback(() => setSplitPair((p) => (p ? { left: p.right, right: p.left } : p)), [setSplitPair]);
  // 标签关掉/被淘汰后自愈：任一侧不在已开标签里就退出分屏（不做嵌套、不留悬空）。
  useEffect(() => {
    if (!splitPair) return;
    const ids = new Set(openTabs.map((t) => t.noteId));
    if (splitPair.left === splitPair.right || !ids.has(splitPair.left) || !ids.has(splitPair.right)) setSplitPair(null);
  }, [openTabs, splitPair, setSplitPair]);
  /** 分屏组（261008 定稿，Edge 式）：标签栏里两页是**一个合并标签**，点它才回到分屏区域；
   *  点其它标签 = 普通切换（**不再有"点第三个标签替换分屏栏"**）。组内记住最后焦点，供再次点开时恢复。 */
  const splitFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (splitPair && activeNoteId && (activeNoteId === splitPair.left || activeNoteId === splitPair.right)) {
      splitFocusRef.current = activeNoteId;
    }
  }, [splitPair, activeNoteId]);
  /** 点合并标签：回到分屏（焦点恢复到最后看的那一栏）。 */
  const activateSplit = useCallback(() => {
    if (!splitPair) return;
    setActiveNoteId(splitFocusRef.current ?? splitPair.left);
  }, [splitPair, setActiveNoteId]);
  /** 合并标签上的 ×：**取消分屏、两个标签都保留**（不做任何分屏替换/连带关闭）。 */
  const closeSplit = useCallback(() => setSplitPair(null), [setSplitPair]);
  /** 关闭分屏中的标签：先退出分屏（标签本身照常关闭/淘汰）。 */
  const closeTab = useCallback((noteId: string) => {
    if (splitPair && (noteId === splitPair.left || noteId === splitPair.right)) setSplitPair(null);
    void closeTabBase(noteId);
  }, [splitPair, setSplitPair, closeTabBase]);

  // 云同步 toast 壳已收拢到 useSyncShell（busy 常驻，ok/error/其他自动消失）
  const runSync = useSyncController({
    setSync,
    setCloudConfigured,
    setCloudEnabled,
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
    createNoteIn, createUsheetIn, createBitableIn, createBoardIn, createInkIn, openNote, setNodeIcon, treeNodes,
    setTreeNodes, setNotes, setOpenTabs, setConfirmDelete,
    setHistoryNoteId, setHistoryOpen, setSearchPanelQuery, setSearchPanelOpen,
    setPendingRenameId, setError,
  });

  // ===== 日记空间（261109，片B：桌面空间 UI）=====
  /** 文档空间目录树 = 全树 − 日记笔记本（表现层过滤，存储不动：DIARY.md 硬规则 5）。 */
  const sidebarTreeNodes = useMemo(() => documentTreeWithoutDiary(treeNodes), [treeNodes]);
  /** 日记条目 id 集合：资料库同篇去重（见 libraryTabs）与「打开某天」判定共用。 */
  const diaryNoteIds = useMemo(() => diaryEntryIds(treeNodes), [treeNodes]);
  const diaryNotebook = useMemo(() => diaryNotebookOf(treeNodes), [treeNodes]);

  /** 写「今天」：已存在就直接打开；否则走主进程 `diary_open_date`（单事务 ensure，连点只产生一篇）。
   *  IPC 未接线时**明确出声**，绝不静默失败、也不在渲染层自己建文档。 */
  const handleDiaryWriteToday = useCallback(async (dateKey: string) => {
    const todayKey = dateKey || formatDiaryDateKey();
    const plan = planDiaryOpen(treeNodes, todayKey);
    // core 的 existingNoteId 是**树节点 id**；打开文档要 noteFileId（两者不同，见 features/diary/diaryTree.ts）。
    const existingDocumentId = documentIdOfTreeNode(treeNodes, plan.existingNoteId);
    if (existingDocumentId) { await openNote(existingDocumentId); return; }
    const outcome = await requestDiaryOpenDate(todayKey);
    if (!outcome.ok) { showNotice(diaryOpenErrorMessage(outcome)); return; }
    if (outcome.result.duplicates.length > 0) showNotice("同一天有重复日记（历史数据），已打开其中一篇");
    // 树来自主进程（新建的 笔记本/年组/月组/文档 只有重读才可见），随后照既有方式打开。
    await refreshTree();
    await openNote(outcome.result.noteId);
  }, [treeNodes, openNote, refreshTree, showNotice]);

  const handleDiaryRenameNotebook = useCallback((title: string) => {
    if (diaryNotebook) sidebarRename(diaryNotebook.id, title);
  }, [diaryNotebook, sidebarRename]);
  const handleDiarySetNotebookIcon = useCallback((icon: string | null) => {
    if (diaryNotebook) sidebarSetIcon(diaryNotebook, icon);
  }, [diaryNotebook, sidebarSetIcon]);
  /** 「转为文档」：把日记条目移到目标笔记本（**移动**，同一 note；正文/历史/回收站都跟着走）。
   *  判据（是否日记条目、目标是否合法）由 core.planDiaryConvert 给，这里只执行 + 反馈。 */
  const handleDiaryConvertEntry = useCallback((nodeId: string, targetNotebookId: string) => {
    const plan = planDiaryConvert(treeNodes, nodeId, targetNotebookId);
    if (!plan.ok) return;
    const targetTitle = treeNodes.find((node) => node.id === plan.targetId)?.title ?? "笔记本";
    sidebarMove(nodeId, plan.targetId, "inside");
    showNotice("已转为文档：" + targetTitle);
  }, [treeNodes, sidebarMove, showNotice]);
  /** 新建某天的日记（261109：一天允许多篇）：走 IPC `mode:"new"`，建完刷新树并按**日记空间**打开。 */
  const handleDiaryCreateEntry = useCallback(async (dateKey: string) => {
    try {
      const result = await native.diaryOpenDate(dateKey, "new");
      await refreshTree();
      await openNote(result.noteId, "", false, "diary");
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }, [openNote, refreshTree, setError]);

  /** 「转为小记」（261109）：日期标题写入小记第一行，正文接在后面；成功后把日记移入回收站（软删可恢复）。
   *  媒体卡片不搬运（小记资源是另一套作用域）——`droppedMedia` 为真时**明说**，不静默丢内容。 */
  const handleDiaryToQuickNote = useCallback(async (nodeId: string) => {
    try {
      const doc = await native.readNote(nodeId);
      const composed = composeDiaryQuickNote({ title: doc.title, content: doc.content });
      await native.createQuickNote({
        text: composed.text,
        body: composed.body,
        draftId: crypto.randomUUID(),
        stagedImageIds: [],
      });
      await native.deleteTreeNode(nodeId);
      showNotice((composed.droppedMedia ? "已转为小记（图片 / 附件未搬运）" : "已转为小记") + "；日记已移入回收站，可恢复");
      await refreshTree();
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
    }
  }, [refreshTree, setError, showNotice]);

  /** 日记内搜索入口 = 打开**现有**全局搜索面板（日记是文档，已在 FTS 里；不新增索引）。
   *  范围收窄 = 面板的 `scopeNoteIds`（下面搜索面板处传入 `diaryNoteIds`），纯显示层过滤。 */
  const handleDiaryOpenSearch = useCallback(() => { sidebarOpenSearch(); }, [sidebarOpenSearch]);

  /** 资料库空态「新建文档」= 统一新建弹窗（261105 用户验收：所有需要写名字的新建都弹窗）。 */
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteBusy, setNewNoteBusy] = useState(false);
  const [newNoteError, setNewNoteError] = useState<string | null>(null);
  const submitNewNote = useCallback(async (title: string) => {
    const notebookId = treeNodes.find((node) => node.nodeType === "notebook")?.id ?? null;
    setNewNoteBusy(true);
    setNewNoteError(null);
    try {
      const id = await createNoteIn(notebookId, title);
      setNewNoteOpen(false);
      if (id) setRevealNodeId(id);
    } catch (reason) {
      setNewNoteError(getNativeErrorMessage(reason));
    } finally {
      setNewNoteBusy(false);
    }
  }, [treeNodes, createNoteIn]);

  /** 保存冲突三选项（Batch4-D）。每个分支都先记审计日志（渲染层 console 由主进程统一落盘）。 */
  const resolveSaveConflict = useCallback(async (choice: "copy" | "overwrite" | "discard") => {
    if (!saveConflict || saveConflictBusy) return;
    const conflict = saveConflict;
    const tab = openTabsRef.current.find((item) => item.noteId === conflict.noteId);
    const title = tab?.title || "无标题";
    const parentId = notes.find((item) => item.id === conflict.noteId)?.parentId ?? null;
    console.info(
      "[save-conflict] 用户选择 " + choice + " noteId=" + conflict.noteId + " diskHash=" + conflict.diskHash.slice(0, 12),
    );
    setSaveConflictBusy(true);
    try {
      if (choice === "overwrite") {
        clearSaveConflict(conflict.noteId);
        // 用冲突时看到的 diskHash 作为显式 baseHash 重试：期间磁盘若再次变化会被再拦一次（不静默覆盖）。
        await persistTab(conflict.noteId, undefined, undefined, { baseHash: conflict.diskHash });
        return;
      }
      if (choice === "copy") {
        // 本地改动另存为一篇新文档（kind/父级跟着原文档走；原文档随后载入磁盘版本）。
        const content = handleCaptureContent(conflict.noteId) ?? tab?.content ?? "";
        const created = await createConflictCopy({
          ports: {
            createNote: (copyParent, copyTitle) => native.createNoteIn(copyParent, copyTitle),
            createUsheet: (copyParent, copyTitle) => native.createUsheetIn(copyParent, copyTitle),
            createBitable: (copyParent, copyTitle) => native.createBitableIn(copyParent, copyTitle),
            createBoard: (copyParent, copyTitle) => native.createBoardIn(copyParent, copyTitle),
            createInk: (copyParent, copyTitle) => native.createInkIn(copyParent, copyTitle),
            saveNote: (copyId, copyTitle, body) => native.saveNote(copyId, copyTitle, body),
          },
          kind: tab?.kind ?? "doc",
          parentId,
          title,
          content,
        });
        clearSaveConflict(conflict.noteId);
        await refreshTree();
        setNotes(await native.listNoteSummaries());
        // Review-B P1-6：提示说「原文档将载入磁盘上的版本」就必须真的载入；
        // 否则原标签页仍是旧内容+旧 baseHash，下次保存再次判冲突、反复生成副本。
        const fresh = await native.readNote(conflict.noteId);
        setOpenTabs(patchTabById(conflict.noteId, {
          title: fresh.title,
          content: fresh.content,
          dirty: false,
          reloadKey: (tab?.reloadKey ?? 0) + 1,
          ...(fresh.contentHash ? { baseHash: fresh.contentHash } : {}),
        }));
        bumpRevision(conflict.noteId);
        showNotice("本次修改已另存为《" + created.title + "》，原文档将载入磁盘上的版本。");
      }
      if (choice === "discard") {
        clearSaveConflict(conflict.noteId);
        const fresh = await native.readNote(conflict.noteId);
        setOpenTabs(patchTabById(conflict.noteId, {
          title: fresh.title,
          content: fresh.content,
          dirty: false,
          reloadKey: (tab?.reloadKey ?? 0) + 1,
          ...(fresh.contentHash ? { baseHash: fresh.contentHash } : {}),
        }));
        bumpRevision(conflict.noteId);
        showNotice("已放弃本地未保存的修改，载入磁盘上的版本。");
      }
    } catch (error) {
      setError(getNativeErrorMessage(error));
    } finally {
      setSaveConflictBusy(false);
    }
  }, [saveConflict, saveConflictBusy, openTabsRef, notes, clearSaveConflict, persistTab, handleCaptureContent, refreshTree, setNotes, showNotice, setOpenTabs, bumpRevision, setError]);

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
  // W5：把手相位机（纯决策在 ./components/model/sidebarHoverMachine；相位从 DOM/定时器真实来源读取，不额外持有 state）
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

  /** 只读锁切换：先保存脏草稿，再写 SQLite（锁状态随 v3 索引条目同步；v3 无 manifest） */
  /** 空间切换：活动标签必须属于当前空间（日记/文档各自独立的 tab 集合，261109）。
   *  ⚠️ 必须放在下面 `if (!workspace) return` **之前**：放到早期 return 之后会让首渲染少跑一个 hook
   *  ⇒ React「Hooks 顺序变化」并直接白屏（本文件下方注释已有同类教训）。这里用 openTabs 判据
   *  （`tabInfos` 在早期 return 之后才派生，不能在这里用）。 */
  useEffect(() => {
    if (desktopWorkspace !== "diary" && desktopWorkspace !== "library") return;
    const space = desktopWorkspace === "diary" ? "diary" : "library";
    const inSpace = openTabs.filter((tab) => (tab.space ?? "library") === space);
    if (activeNoteId && inSpace.some((tab) => tab.noteId === activeNoteId)) return;
    const next = inSpace[inSpace.length - 1]?.noteId ?? null;
    if (next) setActiveNoteId(next);
    // 只在空间切换时回落；标签增删由各自的打开/关闭逻辑管理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopWorkspace]);

  /** 日记标签切换器（▾）：打开时按可视位置弹菜单；与文档标签的切换器同语义、数据不同。 */
  const [diaryTabMenu, setDiaryTabMenu] = useState<{ x: number; y: number } | null>(null);
  const diaryTabMenuPos = usePopoverPosition({
    open: Boolean(diaryTabMenu),
    at: diaryTabMenu,
  });

  if (!workspace) return <main className="loading-screen"><BrandLaunchMark label="正在打开本地知识库" />{error && <small>{error}</small>}</main>;

  // 字数/图片统计（W-2-A）：从渲染体移出，避免每次按键对整篇正文跑两次 O(n) 正则。
  const {
    activeNodeDirty, activeNodeConflict, editorPrefs, notePathTitle,
    tabInfos, outlineVisible, lockedNoteIds, cloudDeletedNoteIds, effectiveOutlineMode, shellStyle, activeKind,
  } = deriveDesktopView({
    activeNoteId, treeNodes, notes, openTabs, iconByNoteId,
    fontSize: settings.fontSize, showToolbar: settings.showToolbar, floatingToolbar: settings.floatingToolbar,
    tocEnabled, outlineEnhance,
    desktopWorkspace, activeOutlineEmpty, outlineEmptyOverride, outlineMode,
    sidebarWidth, sidebarMode, narrowOverlay, outlineSidebarWidth,
  });
  /**
   * 日记空间打开某篇日记时，**资料库视图不再挂同一篇**：EditorTab 每篇只能有一个实例
   * （内核实例按 noteId 注册到 editorsRef，capture 会互相覆盖 ⇒ 保存丢字）。
   * 资料库视图此时是 display:none（keep-alive），少挂这一篇用户看不见；离开日记空间立即恢复。
   *
   * 注意：这里**不用 useMemo** —— 该行位于 `if (!workspace) return` 之后，加 hook 会让
   * 「首次渲染提前 return、随后渲染多跑一个 hook」触发 hooks 顺序错误；过滤本身是 O(标签数)。
   */
  /** 两个空间各自独立 tab 条（261109）：按 tab 的 `space` 分流。
   *  兜底：**加 space 之前**打开的旧 tab 没有该字段 ⇒ 用「当前树里它是不是日记条目」判一次，
   *  否则旧会话的日期 tab 会一直粘在文档空间（用户报过「tab 混在一起」）。 */
  const ownsDiary = (tab: { noteId: string; space?: "library" | "diary" }): boolean =>
    tab.space ? tab.space === "diary" : diaryNoteIds.has(tab.noteId);
  const libraryTabs = tabInfos.filter((tab) => !ownsDiary(tab));
  const diaryTabs = tabInfos.filter((tab) => ownsDiary(tab));


  /** 顶栏左侧 = **唯一渲染点**（DT-09）：四个空间共用这一个元素，各自在顶栏槽位用
   *  `DesktopWorkspaceSlotProvider` 声明归属；可见性与共享 ref 由组件按槽位推导（四态逐项等价）。 */
  const topBarLeading = (
    <DesktopTopBarLeading
      desktopWorkspace={desktopWorkspace}
      sync={sync}
      pendingSummary={pendingSummary}
      cloudEnabled={cloudEnabled}
      cloudConfigured={cloudConfigured}
      conflictSnapshots={conflictSnapshotNotice}
      wsMenuWrapRef={wsMenuWrapRef}
      syncBtnRef={syncBtnRef}
      onToggleWorkspaceMenu={() => { setWorkspaceMenuOpen((o) => !o); setTopMenuOpen(false); }}
      onSync={() => { void runSync(); }}
      onOpenSettings={() => { setSettingsCategory("sync"); setSettingsOpen(true); }}
      onOpenHistory={(noteId: string) => { setHistoryNoteId(noteId); setHistoryOpen(true); }}
      onOpenNote={(noteId: string) => { void openNote(noteId); }}
    />
  );
  /** 文档页顶栏最右侧：全文搜索（原在左侧工作空间下拉里；⇧⌘F 亦可）。 */
  const topBarSearch = (
    <DesktopTopBarSearch onOpenSearch={() => sidebarOpenSearch(search)} />
  );
  /** 文档页顶栏最右侧：分屏入口 + 全文搜索。 */
  const topBarTrailing = (
    <>
      <DesktopSplitButton
        openTabs={openTabs}
        activeNoteId={activeNoteId}
        splitActive={splitPair != null}
        onEnterSplit={enterSplit}
        onExitSplit={exitSplit}
      />
      {topBarSearch}
    </>
  );

  return (
    <div className={`app-shell ${shellPlatformClass} sidebar-${sidebarRenderMode} outline-${effectiveOutlineMode} ${workspaceMenuOpen ? "workspace-menu-open" : ""} ${focusMode ? "focus-mode" : ""} ${desktopWorkspace === "quick-notes" ? "quick-notes-active" : ""} ${desktopWorkspace === "ai-writing" ? "ai-writing-active" : ""} ${desktopWorkspace === "diary" ? "diary-space-active" : ""} ${desktopWorkspace === "trash" ? "trash-space-active" : ""} ${desktopWorkspace === "resources" ? "resources-space-active" : ""} ${desktopWorkspace === "tags" ? "tags-space-active" : ""} ${sidebarResizing ? "sidebar-resizing" : ""} ${outlineResizing ? "outline-resizing" : ""} activity-rail-hidden`} style={shellStyle}>
      {/* 单例控制器只配一个应用级宿主，keep-alive 编辑器/历史/小记共享。 */}
      <ImageLightbox />
      <AttachmentPreview />
      {/* 261006：全局把原生 title 提示换成自绘 .ln-tip（一处实现覆盖全仓 168 处）。 */}
      <NativeTitleTips />
      {/* 整边触发（左）：隐形 8px 热区 + 跟手把手 —— 资料库空间（260922） */}
      {desktopWorkspace === "library" && (
        <div
          ref={edgeHotzoneRef}
          className="edge-hotzone edge-hotzone-l"
          title="目录：悬停展开，点击固定或取消"
          onPointerEnter={(e) => dispatchEdge({ type: "enter" }, e.clientY)}
          onPointerMove={(e) => dispatchEdge({ type: "move" }, e.clientY)}
          onPointerLeave={(e) => {
            // 把手先收（不带条件）：只要指针离开热区/把手就退场——否则移到正文后把手会赖着不走。
            // React在指针离开窗口时可能给Window；contains只能接收DOM节点。
            const to = e.relatedTarget;
            const staysInShell = to instanceof Node && Boolean(e.currentTarget.closest(".app-shell")?.contains(to));
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
      <Sidebar nodes={sidebarTreeNodes} activeId={activeNoteId} search={search} mode={sidebarRenderMode} width={sidebarWidth} minWidth={SIDEBAR_MIN_WIDTH} maxWidth={SIDEBAR_MAX_WIDTH} onSearch={setSearch} onRefreshTree={refreshTree} onSelect={sidebarSelect} onCreate={sidebarCreate} onRename={sidebarRename} onMoveNode={sidebarMove} onRequestDelete={sidebarRequestDelete} onCopyMarkdown={copyMarkdownFromCache} onExportAs={exportAs} onCopyPaths={copyNotePaths} onBeforeDuplicate={flushNotesBeforeDuplicate} onSetIcon={sidebarSetIcon} onShowInfo={(node) => setInfoNote(node)} onOpenHistory={sidebarOpenHistory} lockedNoteIds={lockedNoteIds} onToggleLockNote={(node) => { if (node.noteFileId) void toggleNoteLock(node.noteFileId); }} revealNodeId={revealNodeId} onRevealConsumed={() => setRevealNodeId(null)} pendingRenameId={pendingRenameId} onPendingRenameConsumed={sidebarPendingRenameConsumed} onPreviewEnter={showSidebarPreview} onPreviewLeave={hideSidebarPreview} onResizeActiveChange={handleSidebarResizeActiveChange} onWidthChange={updateSidebarWidth} onWidthCommit={commitSidebarWidth} onToggleDock={toggleSidebarDock} docked={sidebarMode === "docked"} onSidebarHold={holdSidebarExpanded}
        tagFilter={{ tags: tagSpace.tagOptions, selection: tagSelection, visibleIds: tagVisibleIds, onChange: setTagSelection }}
        onTagsChanged={() => { void tagSpace.reload(); }} />
      <main className="workspace" onPointerDownCapture={(event) => {
        const clickedDocument = (event.target as HTMLElement).closest(".document-pane, .empty-workspace");
        // 点正文收起目录栏：宽窗沿用原语义（只有"悬停预览"那种临时浮动态会收）；
        // 窄窗的停靠态本身就是悬浮抽屉（`sidebarRenderMode`），所以窄窗额外把停靠态也纳入——
        // 用户 260915 定稿，且**仅窄窗生效**：宽窗停靠态点正文不会收起（隔离靠 narrowOverlay）。
        const shouldCollapse = sidebarMode === "floating" || (narrowOverlay && sidebarMode === "docked");
        if (clickedDocument && shouldCollapse) setSidebarMode("collapsed");
      }}>
        {/* Batch3-B：安全模式常驻提示条（非安全模式时渲染 null） */}
        <SafeModeBanner />
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>关闭</button></div>}
        <div className={"workspace-view" + (desktopWorkspace === "library" ? "" : " workspace-view--hidden")}>
          <DesktopLibrary
            visible={desktopWorkspace === "library"}
            tabs={libraryTabs}
            activeNoteId={activeNoteId}
            tocEnabled={tocEnabled}
            outlineEnhance={outlineEnhance}
            topbarLeading={topBarLeading}
            topbarTrailing={topBarTrailing}
            splitPair={splitPair}
            onExitSplit={exitSplit}
            onSwapSplit={swapSplit}
            wideMode={wideMode}
            editorPrefs={editorPrefs}
            notePathTitle={notePathTitle}
            moreMenuWrapRef={moreMenuWrapRef}
            onToggleMoreMenu={() => { setTopMenuOpen((o) => !o); setWorkspaceMenuOpen(false); }}
            lockedNoteIds={lockedNoteIds}
            onToggleNoteLock={() => { void toggleNoteLock(); }}
            onExportBitableCsv={(noteId) => { void exportNoteById(noteId, "csv"); }}
            onOpenTrash={() => void switchDesktopWorkspace("trash")}
            pinnedNoteIds={pinnedNoteIds}
            onTabChange={handleTabChangeBase}
            onActivateSplit={activateSplit}
            onCloseSplit={closeSplit}
            onTabClose={closeTab}
            onTabsReorder={reorderTabs}
            onTogglePin={handleTogglePin}
            onContentChange={handleContentChange}
            onPreserveBitableDraft={preserveBitableDraft}
            onEditorReady={handleEditorReady}
        onEditorCapture={handleCaptureReady}
            onReloadNote={reloadNoteTab}
            onOpenHistory={(noteId) => { setHistoryNoteId(noteId); setHistoryOpen(true); }}
            onRetryBody={(noteId) => { void retryMissingBody(noteId); }}
            onCreateNote={() => { setNewNoteError(null); setNewNoteOpen(true); }}
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
        <div className={"workspace-view" + (desktopWorkspace === "ai-writing" ? "" : " workspace-view--hidden")}>
          {/* 懒加载分包：首次切进空间时才拉（壳层几何在 shell.css 里，空态只是一屏空白）。 */}
          <Suspense fallback={null}>
          <AiWritingWorkspace
            active={desktopWorkspace === "ai-writing"}
            treeNodes={treeNodes}
            topbarLeading={<DesktopWorkspaceSlotProvider workspace="ai-writing">{topBarLeading}</DesktopWorkspaceSlotProvider>}
            onOpenSettings={() => { setSettingsCategory("ai"); setSettingsOpen(true); }}
            onNotice={(text, action) => { if (action) showNoticeWithAction(text, action); else showNotice(text); }}
            onOpenNote={(noteId) => {
              // 新建的文档要先进树，否则切回资料库时侧栏没有它（tab 能开、目录缺席）。
              void refreshTree().then(() => { void switchDesktopWorkspace("library"); void openNote(noteId); }).catch(() => { void switchDesktopWorkspace("library"); void openNote(noteId); });
            }}
          />
          </Suspense>
        </div>
        <div className={"workspace-view" + (desktopWorkspace === "quick-notes" ? "" : " workspace-view--hidden")}>
          <DesktopQuickNotes
            notebooks={sidebarTreeNodes}
            visible={desktopWorkspace === "quick-notes"}
            // 判据用 cloudState 的 **UI 判据** isCloudActive（= 已配置 且 开关打开）；关了开关/没配置都算本地、不出网
            cloudReady={isCloudActive(cloudConfigured, cloudEnabled)}
            quickNotesRef={quickNotesRef}
            topbarLeading={topBarLeading}
            onDirtyChange={setQuickNotesDirty}
            onConverted={(note) => void handleQuickNoteConverted(note)}
            />
        </div>
        {/* 回收站空间：与小记同构（顶栏 + 整页 pane），非弹窗 */}
        <div className={"workspace-view" + (desktopWorkspace === "trash" ? "" : " workspace-view--hidden")}>
          <header className="tab-bar desktop-only" aria-label="顶栏">
            <div className="tabbar-leading">
              <DesktopWorkspaceSlotProvider workspace="trash">{topBarLeading}</DesktopWorkspaceSlotProvider>
            </div>
            <div className="tab-items" />
            <div className="tabbar-trailing">{topBarSearch}</div>
          </header>
          {/* P12：TrashPanel 挂内核（HistorySnapshotPreview / useHistorySnapshotViewer）⇒ 仅在回收站空间激活时懒挂载；
              离开发空间即卸载（原先常驻隐藏；回收站列表/选中态本来每次 open 都会重读）。 */}
          {desktopWorkspace === "trash" && (
            <Suspense fallback={null}>
              <TrashPanel
                open
                embed
                onClose={() => void switchDesktopWorkspace("library")}
                onChanged={() => void refreshDraftEntries()}
                onRestored={handleTrashRestored}
              />
            </Suspense>
          )}
        </div>
        {/* 资源空间：与回收站同构（顶栏 + 整页 pane）；左 2/3 列表、右 1/3 纯预览。261006 */}
        <div className={"workspace-view" + (desktopWorkspace === "resources" ? "" : " workspace-view--hidden")}>
          <header className="tab-bar desktop-only" aria-label="顶栏">
            <div className="tabbar-leading">
              <DesktopWorkspaceSlotProvider workspace="resources">{topBarLeading}</DesktopWorkspaceSlotProvider>
            </div>
            <div className="tab-items" />
            <div className="tabbar-trailing">{topBarSearch}</div>
          </header>
          <AssetsBrowser active={desktopWorkspace === "resources"} onDataChanged={() => { void refreshTree(); }} />
        </div>
        {/* P1 标签空间：只读聚合视图 + 就地标签元数据管理（不是第三个同步空间） */}
        <div className={"workspace-view" + (desktopWorkspace === "tags" ? "" : " workspace-view--hidden")}>
          <header className="tab-bar desktop-only" aria-label="顶栏">
            <div className="tabbar-leading">
              <DesktopWorkspaceSlotProvider workspace="tags">{topBarLeading}</DesktopWorkspaceSlotProvider>
            </div>
            <div className="tab-items" />
            <div className="tabbar-trailing">{topBarSearch}</div>
          </header>
          {desktopWorkspace === "tags" && (
            <Suspense fallback={null}>
              <TagsWorkspace
                active
                tags={tagSpace.tags}
                documentLinks={tagSpace.links}
                notes={notes}
                quickNotes={tagSpace.quickNotes}
                available={tagSpace.available}
                dataError={tagSpace.error}
                onReload={tagSpace.reload}
                onCreateTag={async (name: string) => {
                  // 目录唯一来源 = quick-notes 标签库（文档只存关系）；创建后由组件 reload 目录并选中新标签。
                  const created = await native.createQuickNoteTag(name);
                  return created.id;
                }}
                onRenameTag={tagSpaceActions.rename}
                onMergeTag={tagSpaceActions.merge}
                onDeleteTag={tagSpaceActions.remove}
                onReorderTags={tagSpaceActions.reorder}
                onOpenDocument={(id) => { void switchDesktopWorkspace("library"); void openNote(id); }}
                onOpenQuickNote={(id) => void openQuickNoteFromSearch(id)}
                onLoadPreview={loadTagPreview}
                onRemoveTagFromItem={removeTagFromItem}
                onError={setError}
              />
            </Suspense>
          )}
        </div>
        {/* 日记空间（261109）：独立空间页 —— 左 280 年月栏 + 主区复用 EditorTab；外置目录栏由 shell class 隐藏。 */}
        <div className={"workspace-view" + (desktopWorkspace === "diary" ? "" : " workspace-view--hidden")}>
          <header className="tab-bar desktop-only" aria-label="顶栏">
            <div className="tabbar-leading">
              <DesktopWorkspaceSlotProvider workspace="diary">{topBarLeading}</DesktopWorkspaceSlotProvider>
            </div>
            {/* 日记空间**独立 tab 条**（261109）：只列 `space==="diary"` 的标签，与文档空间互不影响。 */}
            <div className="tab-items" role="tablist" aria-label="打开的日记">
              {diaryTabs.map((tab) => (
                <button
                  key={tab.noteId}
                  type="button"
                  className={"tab-item" + (tab.noteId === activeNoteId ? " active" : "")}
                  role="tab"
                  aria-selected={tab.noteId === activeNoteId}
                  title={tab.title}
                  onClick={() => { void openNote(tab.noteId, "", false, "diary"); }}
                >
                  {/* 视觉原子与文档标签同源（features/editor/TabItemVisual）；这里只差交互能力。 */}
                  <TabItemVisual title={tab.title} onClose={() => closeTab(tab.noteId)} />
                </button>
              ))}
              {/* 日记标签条自带「关闭全部 + ▾ 切换器」（与文档标签条同语义，数据各自独立）。 */}
              {diaryTabs.length > 1 && (
                <>
                  <button
                    type="button"
                    className="ln-iconbtn ln-iconbtn--compact"
                    aria-label="关闭全部日记标签"
                    title="关闭全部"
                    onClick={() => { for (const tab of diaryTabs) closeTab(tab.noteId); }}
                  >
                    <XSquare size={13} />
                  </button>
                  <button
                    type="button"
                    className="ln-iconbtn ln-iconbtn--compact"
                    aria-label={"切换日记标签，共 " + diaryTabs.length + " 个"}
                    title="切换标签"
                    aria-haspopup="menu"
                    aria-expanded={Boolean(diaryTabMenu)}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setDiaryTabMenu({ x: rect.left, y: rect.bottom + 4 });
                    }}
                  >
                    <ChevronDown size={13} />
                  </button>
                </>
              )}
            </div>
            {diaryTabMenu && (
              <Menu
                surfaceRef={diaryTabMenuPos.surfaceRef}
                style={diaryTabMenuPos.style ?? undefined}
                onDismiss={() => setDiaryTabMenu(null)}
                aria-label="日记标签列表"
              >
                {diaryTabs.map((tab) => (
                  <button
                    key={tab.noteId}
                    type="button"
                    role="menuitem"
                    className={"ln-menu__item" + (tab.noteId === activeNoteId ? " is-selected" : "")}
                    onClick={() => { setDiaryTabMenu(null); void openNote(tab.noteId, "", false, "diary"); }}
                  >
                    {tab.title}
                  </button>
                ))}
              </Menu>
            )}
            <div className="tabbar-trailing">{topBarSearch}</div>
          </header>
          {desktopWorkspace === "diary" && (
            <Suspense fallback={null}>
              <DiaryWorkspace
                active
                treeNodes={treeNodes}
                activeNoteId={activeNoteId}
                tabs={diaryTabs}
                lockedNoteIds={lockedNoteIds}
                tocEnabled={tocEnabled}
                outlineEnhance={outlineEnhance}
                editorPrefs={editorPrefs}
                onOpenEntry={(noteId) => { void openNote(noteId, "", false, "diary"); }}
                onWriteToday={(dateKey) => { void handleDiaryWriteToday(dateKey); }}
                onCreateEntry={(dateKey) => { void handleDiaryCreateEntry(dateKey); }}
                onOpenSearch={handleDiaryOpenSearch}
                onConvertEntry={handleDiaryConvertEntry}
                onConvertToQuickNote={(nodeId) => { void handleDiaryToQuickNote(nodeId); }}
                onRenameNotebook={handleDiaryRenameNotebook}
                onSetNotebookIcon={handleDiarySetNotebookIcon}
                onContentChange={handleContentChange}
                onEditorReady={handleEditorReady}
                onReloadNote={reloadNoteTab}
              />
            </Suspense>
          )}
        </div>
        <DesktopStatusBar
          showDocumentStats={desktopWorkspace === "library"}
          docKind={activeKind}
          wordCount={docStats.wordCount}
          imageCount={docStats.imageCount}
          locked={activeNoteId !== null && lockedNoteIds.has(activeNoteId)}
          onUnlock={activeNoteId !== null ? () => { void toggleNoteLock(activeNoteId); } : undefined}
          notice={notice}
          documentStatus={getDocumentStatus({
            // 状态栏的「仅本地/待同步」按云同步**是否启用**判定（关开关/没配置都算本地）；
            // 不能用「S3 是否配置过」——否则关掉同步后仍会显示「待同步」（regression 261029）。
            cloudEnabled: isCloudActive(cloudConfigured, cloudEnabled),
            isDirty: activeNodeDirty,
            isConflict: activeNodeConflict,
            isCloudDeleted: activeNoteId !== null && cloudDeletedNoteIds.has(activeNoteId),
            // 只取**活动文档**的保存状态；没有记录时回落到标签自身的 dirty（按文档，后台保存不污染当前状态栏）
            saveState: activeNoteId
              ? (saveStates[activeNoteId] ?? (tabInfos.find((tab) => tab.noteId === activeNoteId)?.dirty ? "dirty" : "idle"))
              : "idle",
            historyCount: activeHistoryCount,
          })}
        />
      </main>
      {infoNote && (
        <Suspense fallback={null}>
        <NoteInfoDialog
          note={{ noteFileId: infoNote.noteFileId, title: infoNote.title }}
          onClose={() => setInfoNote(null)}
          onRevealNoteFile={() => { if (infoNote.noteFileId) void native.revealNoteFile(infoNote.noteFileId).catch((reason) => setError(getNativeErrorMessage(reason))); }}
          onOpenAssetsDir={() => { if (infoNote.noteFileId) void native.openNoteAssets(infoNote.noteFileId).catch((reason) => setError(getNativeErrorMessage(reason))); }}
          onOpenHistory={() => { void sidebarOpenHistory(infoNote); setInfoNote(null); }}
          onJumpToNode={(id) => { setInfoNote(null); setRevealNodeId(id); }}
          onTagsChanged={() => { void tagSpace.reload(); }}
        />
        </Suspense>
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
        // 261006：菜单里选完空间要**关菜单**（原先不关，遮着刚切过去的内容；回收站/资源/小记都受影响）
        onSwitchWorkspace={(w) => { setWorkspaceMenuOpen(false); void switchDesktopWorkspace(w); }}
        onOpenSettingsFromMenu={(category) => { setSettingsCategory(category); setSettingsOpen(true); setWorkspaceMenuOpen(false); }}
        focusMode={focusMode}
        onToggleFocusMode={() => { setFocusMode((value) => !value); setTopMenuOpen(false); }}
        activeNoteId={activeNoteId}
        activeKind={activeKind}
        lockedNoteIds={lockedNoteIds}
        onToggleNoteLock={() => { void toggleNoteLock(); setTopMenuOpen(false); }}
        onOpenAiAssistant={() => {
          openAiAssistant({
            context: { kind: "none", allowDocument: { noteId: activeNoteId ?? undefined } },
            placement: { kind: "floating" },
            outputs: [],
            applyOutput: () => false,
          });
          setTopMenuOpen(false);
        }}
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
        onOpenQuickNoteFromSearch={(id) => void openQuickNoteFromSearch(id)}
        onCloseSearch={() => setSearchPanelOpen(false)}
        searchScopeNoteIds={desktopWorkspace === "diary" ? diaryNoteIds : null}
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
        cloudConfigured={cloudConfigured}
        cloudEnabled={cloudEnabled}
      />
      <AiAssistantHost />
      {/* 大表格粘贴护栏（A+B，261008）：超阈值不粘进文档，改为明确提示 + 一键「存为表格文档」 */}
      <TablePasteGuardDialog parentId={notes.find((n) => n.id === activeNoteId)?.parentId ?? null} />
      {/* 资料库空态「新建文档」：与目录栏新建同一套弹窗（预填默认名，可改或直接确认） */}
      <NamePromptDialog
        open={newNoteOpen}
        title="新建文档"
        inputLabel="文档名称"
        placeholder="输入文档名称"
        initialValue="无标题文档"
        busy={newNoteBusy}
        error={newNoteError}
        onSubmit={submitNewNote}
        onClose={() => { if (!newNoteBusy) setNewNoteOpen(false); }}
      />
      {/* Batch4-D 保存版本守卫：磁盘正文被外部/他端改过时三选项确认（自动保存已暂停） */}
      <SaveConflictDialog
        open={saveConflict !== null}
        fileName={saveConflict ? (openTabs.find((tab) => tab.noteId === saveConflict.noteId)?.title ?? "") : ""}
        busy={saveConflictBusy}
        onSaveAsCopy={() => void resolveSaveConflict("copy")}
        onOverwrite={() => void resolveSaveConflict("overwrite")}
        onDiscardAndReload={() => void resolveSaveConflict("discard")}
      />

    </div>
  );
}
