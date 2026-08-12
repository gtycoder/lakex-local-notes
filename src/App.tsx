import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowLeft, Check, Cloud, Files, ListTree, LoaderCircle, Feather, Lock, LockOpen, MoreHorizontal, Pencil, Save, Settings as Settings2Icon, Trash2, WifiOff, X } from "lucide-react";
import { MobileLibrary } from "./components/MobileLibrary";
import { SearchPanel } from "./components/SearchPanel";
import { TrashPanel } from "./components/TrashPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { ConfirmDelete, Sidebar, type SidebarMode } from "./components/Sidebar";
import { QuickNotesWorkspace, type QuickNotesWorkspaceHandle } from "./components/QuickNotesWorkspace";
import { SyncPanel } from "./components/SyncPanel";
import { LakeEditor } from "./features/editor/LakeEditor";
import type { LakeEditorInstance } from "./features/editor/lakeRuntime";
import { MultiTabEditor, type TabInfo } from "./features/editor/MultiTabEditor";
import { OutlineSidebar } from "./features/outline/OutlineSidebar";
import type { OutlineMode } from "./features/outline/OutlineController";
import { getOutlineTab, getOutlineTabsVersion, subscribeOutlineTabs } from "./features/outline/registry";
import { cleanLakeMarkdown } from "./lib/markdownClean";
import { isDesktop, native } from "./lib/native";
import { loadSettings, saveSettings, subscribeSettings, type AppSettings } from "./lib/settings";
import { SettingsPanel } from "./components/SettingsPanel";
import { subtreeIds } from "./lib/tree";
import type { NoteDocument, NoteSummary, SyncStatus, TreeNode, WorkspaceSnapshot } from "./lib/types";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type MobilePage = "library" | "document";
type DesktopWorkspace = "library" | "quick-notes";

// 左侧资料库与右侧大纲面板各自维护宽度；两侧常驻 activity rail 才保持同宽。
const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 300;
const OUTLINE_SIDEBAR_DEFAULT_WIDTH = 280;
const OUTLINE_SIDEBAR_MIN_WIDTH = 200;
const OUTLINE_SIDEBAR_MAX_WIDTH = 420;
// 与左侧 --activity-rail-width 对齐，右侧只为常驻 rail 预留同样的 34px。
const OUTLINE_COLLAPSED_WIDTH = 34;

function initialOutlineMode(): OutlineMode {
  const stored = localStorage.getItem("lake-notes-v2.outline-sidebar-mode");
  if (stored === "docked" || stored === "collapsed") return stored;
  // 首次进入默认只显示常驻窄 rail；点击或悬停后再显示大纲面板。
  return "collapsed";
}

function initialSidebarMode(): SidebarMode {
  const stored = localStorage.getItem("lake-notes-v2.sidebar-mode");
  if (stored === "docked" || stored === "collapsed") return stored;
  return localStorage.getItem("lake-notes-v1.sidebar") === "collapsed" ? "collapsed" : "docked";
}

function initialSidebarWidth(): number {
  const stored = Number(localStorage.getItem("lake-notes-v3.sidebar-width"));
  return Number.isFinite(stored)
    ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, stored))
    : SIDEBAR_DEFAULT_WIDTH;
}

function initialOutlineSidebarWidth(): number {
  const stored = Number(localStorage.getItem("lake-notes-v3.outline-sidebar-width"));
  return Number.isFinite(stored)
    ? Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, stored))
    : OUTLINE_SIDEBAR_DEFAULT_WIDTH;
}

interface OpenTab {
  noteId: string;
  title: string;
  content: string;
  dirty: boolean;
  lastAccessedAt: number;
}

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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  useEffect(() => {
    if (!statusMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const menu = document.querySelector(".statusbar-menu");
      const btn = document.querySelector(".statusbar-menu-btn");
      if (menu && !menu.contains(event.target as Node) && btn && !btn.contains(event.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStatusMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [statusMenuOpen]);
  const [sync, setSync] = useState<SyncStatus>({ phase: "idle", message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 });
  const [confirmDelete, setConfirmDelete] = useState<TreeNode | null>(null);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobilePage, setMobilePage] = useState<MobilePage>("library");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [mobileActive, setMobileActive] = useState<NoteDocument | null>(null);
  const [mobileDraftTitle, setMobileDraftTitle] = useState("");
  const [mobileDraftContent, setMobileDraftContent] = useState("");
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tocEnabled = settings.showToc;
  const [wideMode] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(initialSidebarMode);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  // 全局唯一大纲状态（持久化）：所有“有大纲”的文档都遵循它；
  // 仅当当前文档没有大纲时自动强制悬浮（除非用户在空文档上显式固定）。
  const [outlineMode, setOutlineMode] = useState<OutlineMode>(initialOutlineMode);
  const [activeOutlineEmpty, setActiveOutlineEmpty] = useState(false);
  const [outlineEmptyOverride, setOutlineEmptyOverride] = useState(false);
  const outlineTabsVersion = useSyncExternalStore(subscribeOutlineTabs, getOutlineTabsVersion, getOutlineTabsVersion);
  const [outlineSidebarWidth, setOutlineSidebarWidth] = useState(initialOutlineSidebarWidth);
  const [outlineResizing, setOutlineResizing] = useState(false);
  const [desktopWorkspace, setDesktopWorkspace] = useState<DesktopWorkspace>("library");
  const [quickNotesDirty, setQuickNotesDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openTabsRef = useRef<OpenTab[]>([]);
  const quickNotesRef = useRef<QuickNotesWorkspaceHandle>(null);
  const saveTimers = useRef<Map<string, number>>(new Map());
  // 已就绪的编辑器实例（noteId → editor），供导出 md 等场景使用
  const editorsRef = useRef<Map<string, LakeEditorInstance>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const sidebarPreviewTimer = useRef<number | null>(null);
  // 审计 #7：每篇笔记的编辑 revision——保存请求发出后若有新编辑（revision 增长），
  // 旧响应不得覆盖最新草稿/清除 dirty
  const revisionRef = useRef<Map<string, number>>(new Map());
  const shellPlatformClass = /Mac|iPhone|iPad/.test(navigator.platform) ? "platform-mac" : "platform-native-titlebar";

  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  useEffect(() => {
    if (sidebarMode !== "floating") localStorage.setItem("lake-notes-v2.sidebar-mode", sidebarMode);
  }, [sidebarMode]);

  useEffect(() => {
    localStorage.setItem("lake-notes-v3.sidebar-width", String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("lake-notes-v3.outline-sidebar-width", String(Math.round(outlineSidebarWidth)));
  }, [outlineSidebarWidth]);

  useEffect(() => {
    return () => {
      saveTimers.current.forEach((timer) => window.clearTimeout(timer));
      saveTimers.current.clear();
      if (sidebarPreviewTimer.current !== null) window.clearTimeout(sidebarPreviewTimer.current);
    };
  }, []);

  useEffect(() => {
    return subscribeSettings((next) => setSettings(next));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const onChange = () => setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    void native.bootstrap().then(async (snapshot) => {
      setWorkspace(snapshot); setNotes(snapshot.notes); setSync(snapshot.sync);
      setTreeNodes(await native.listTreeNodes());
      const id = snapshot.lastOpenedNoteId ?? snapshot.notes[0]?.id;
      if (id && !media.matches) await openNote(id);
    }).catch((reason) => setError(String(reason)));
    return () => { media.removeEventListener("change", onChange); };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    return native.onSyncProgress((progress) => {
      const message = progress.message || (progress.phase === "done" ? "同步完成" : "同步中...");
      setSync((current) => ({ ...current, phase: progress.phase === "done" ? "success" : "syncing", message }));
      if (progress.phase === "done") {
        void native.getSyncStatus().then((status) => {
          setSync((current) => ({ ...current, phase: "success", message: "同步完成", lastSyncedAt: status.lastSyncedAt, pendingChanges: 0 }));
        }).catch(() => undefined);
        // 锁状态等元数据可能随同步变化，刷新摘要与树
        void native.listNoteSummaries().then((items) => setNotes(items)).catch(() => undefined);
        void native.listTreeNodes().then(setTreeNodes).catch(() => undefined);
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

  const persistTab = useCallback(async (noteId: string, title: string, content: string) => {
    // 审计 #7：保存时快照当前 revision；响应返回后仅当期间无新编辑才覆盖草稿/清除 dirty
    const revision = revisionRef.current.get(noteId) ?? 0;
    setSaveState("saving");
    try {
      // M1：保存时由 Lake 内核生成 markdown/纯文本缓存，随正文同批落库
      const editor = editorsRef.current.get(noteId);
      const caches: { markdown: string | null; plain: string | null } = { markdown: null, plain: null };
      if (editor && typeof (editor as any).getDocument === "function") {
        try { caches.markdown = cleanLakeMarkdown(String((editor as any).getDocument("text/markdown"))); } catch { /* 忽略 */ }
        try { caches.plain = String((editor as any).getDocument("text/plain")); } catch { /* 忽略 */ }
      }
      const saved = await native.saveNote(noteId, title.trim() || "无标题", content, caches);
      // 笔记摘要/树节点始终以服务端返回为准（磁盘已写入）
      setNotes((items) => items.map((item) => item.id === saved.id ? summaryOf(saved) : item));
      setTreeNodes((items) => items.map((item) => item.noteFileId === saved.id || item.id === saved.id ? { ...item, title: saved.title, updatedAt: saved.updatedAt, syncState: saved.syncState } : item));
      setSync((current) => ({ ...current, pendingChanges: Math.max(1, current.pendingChanges) }));
      if (revisionRef.current.get(noteId) === revision) {
        // 无新编辑：安全覆盖 + 清除 dirty
        setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, title: saved.title, content: saved.content, dirty: false } : tab));
        setSaveState("saved");
      } else {
        // 期间有新编辑：不覆盖草稿、不清除 dirty（磁盘为旧内容，等待下一次保存）
        setSaveState("dirty");
      }
      return saved;
    } catch (reason) {
      const msg = String(reason);
      if (msg.includes("NotFound") || msg.includes("not found")) return;
      setSaveState("error"); setError(msg);
    }
  }, []);

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
        if (tab.dirty) void persistTab(tab.noteId, tab.title, tab.content);
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [persistTab, mobileActive, mobileDraftContent, quickNotesDirty]);

  const scheduleSave = useCallback((noteId: string, content: string) => {
    setSaveState("dirty");
    const existing = saveTimers.current.get(noteId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(noteId);
      const tab = openTabsRef.current.find((t) => t.noteId === noteId);
      if (tab) void persistTab(noteId, tab.title, content);
    }, 800);
    saveTimers.current.set(noteId, timer);
  }, [persistTab]);

  async function openNote(id: string) {
    const existing = openTabsRef.current.find((tab) => tab.noteId === id);
    if (existing) {
      setActiveNoteId(id);
      setOpenTabs((tabs) => tabs.map((tab) =>
        tab.noteId === id ? { ...tab, lastAccessedAt: Date.now() } : tab
      ));
      return;
    }
    try {
      const note = await native.readNote(id);
      if (openTabsRef.current.some((t) => t.noteId === id)) {
        setActiveNoteId(id);
        return;
      }
      revisionRef.current.set(note.id, 0);
      const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now() };
      setOpenTabs((tabs) => {
        if (tabs.some((t) => t.noteId === id)) return tabs;
        return [...tabs, newTab];
      });
      setActiveNoteId(id);
    } catch (reason) { setError(String(reason)); }
  }

  async function openNoteMobile(id: string) {
    try {
      const note = await native.readNote(id);
      setMobileActive(note); setMobileDraftTitle(note.title); setMobileDraftContent(note.content);
      setMobilePage("document");
    } catch (reason) { setError(String(reason)); }
  }

  async function closeTab(noteId: string) {
    const tab = openTabsRef.current.find((t) => t.noteId === noteId);
    if (!tab) return;
    if (tab.dirty) await persistTab(noteId, tab.title, tab.content);
    const refTabs = openTabsRef.current;
    const closedIndex = refTabs.findIndex((t) => t.noteId === noteId);
    if (closedIndex === -1) return;
    let nextActiveId: string | null = null;
    if (activeNoteId === noteId) {
      const without = refTabs.filter((t) => t.noteId !== noteId);
      const nextActive = without[Math.min(closedIndex, without.length - 1)];
      nextActiveId = nextActive?.noteId ?? null;
    }
    setOpenTabs((tabs) => tabs.filter((t) => t.noteId !== noteId));
    if (nextActiveId !== null) setActiveNoteId(nextActiveId);
  }

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200);
  }, []);

  /** 编辑器实例就绪回调：注册到 map，销毁时移除；就绪时补写文本缓存（存量文档首次打开即有缓存） */
  const handleEditorReady = useCallback((noteId: string, editor: LakeEditorInstance | null) => {
    if (editor) {
      editorsRef.current.set(noteId, editor);
      try {
        if (typeof (editor as any).getDocument === "function") {
          const markdown = cleanLakeMarkdown(String((editor as any).getDocument("text/markdown")));
          const plain = String((editor as any).getDocument("text/plain"));
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
      setError("复制 Markdown 失败: " + (reason instanceof Error ? reason.message : String(reason)));
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
      setError("导出失败: " + (reason instanceof Error ? reason.message : String(reason)));
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
      setError("复制资料路径失败: " + (reason instanceof Error ? reason.message : String(reason)));
    }
  }, [showNotice]);

  /** M1.6：设置/清除文档或分组的自定义图标 */
  const setNodeIcon = useCallback(async (node: TreeNode, icon: string | null) => {
    try {
      const updated = await native.setNodeIcon(node.id, icon);
      setTreeNodes((items) => items.map((item) => item.id === updated.id ? updated : item));
      showNotice(icon ? "已设置图标" : "已清除图标");
    } catch (reason) {
      setError("设置图标失败: " + (reason instanceof Error ? reason.message : String(reason)));
    }
  }, [showNotice]);

  // 文档右键（TreeNode 版）包装
  const copyMarkdownFromCache = useCallback((node: TreeNode) => void copyMarkdownById(node.noteFileId), [copyMarkdownById]);
  const exportAs = useCallback((node: TreeNode, format: "markdown" | "html" | "lake") => void exportNoteById(node.noteFileId, format), [exportNoteById]);
  const copyNotePaths = useCallback((node: TreeNode) => void copyPathsById(node.noteFileId), [copyPathsById]);

  const handleContentChange = useCallback((noteId: string, content: string) => {
    revisionRef.current.set(noteId, (revisionRef.current.get(noteId) ?? 0) + 1);
    setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, content, dirty: true } : tab));
    scheduleSave(noteId, content);
  }, [scheduleSave]);

  async function createNoteIn(parentId: string | null) {
    const note = parentId === null ? await native.createNote("无标题文档") : await native.createNoteIn(parentId, "无标题文档");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    if (isMobile) {
      setMobileActive(note); setMobileDraftTitle(note.title); setMobileDraftContent(note.content);
      setMobileOpen(false); setMobilePage("document"); setMobileEditing(true);
    } else {
      revisionRef.current.set(note.id, 0);
      const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now() };
      const currentTabs = openTabsRef.current;
      if (currentTabs.length >= 8) {
        let evictIndex = 0;
        for (let i = 1; i < currentTabs.length; i++) {
          if (currentTabs[i].lastAccessedAt < currentTabs[evictIndex].lastAccessedAt) evictIndex = i;
        }
        const evicted = currentTabs[evictIndex];
        if (evicted.dirty) await persistTab(evicted.noteId, evicted.title, evicted.content);
        setOpenTabs((tabs) => {
          const withoutEvicted = tabs.filter((t) => t.noteId !== evicted.noteId);
          return withoutEvicted.some((t) => t.noteId === note.id) ? tabs : [...withoutEvicted, newTab];
        });
      } else {
        setOpenTabs((tabs) => [...tabs, newTab]);
      }
      setActiveNoteId(note.id);
      setPendingRenameId(note.id);
    }
  }

  async function createNote() {
    const notebookId = treeNodes.find((node) => node.nodeType === "notebook")?.id ?? null;
    await createNoteIn(notebookId);
  }

  async function createTreeItem(kind: "notebook" | "group" | "note", parentId: string | null, title?: string) {
    try {
      if (kind === "note") { await createNoteIn(parentId); return; }
      const resolvedTitle = title?.trim();
      if (!resolvedTitle) return;
      if (kind === "notebook") await native.createNotebook(resolvedTitle);
      else if (parentId) await native.createGroup(parentId, resolvedTitle);
      setTreeNodes(await native.listTreeNodes());
    } catch (reason) { setError(String(reason)); }
  }

  async function renameTreeNode(id: string, title: string) {
    try {
      const renamed = await native.renameTreeNode(id, title);
      setTreeNodes((items) => items.map((item) => item.id === id ? renamed : item));
      if (renamed.noteFileId) {
        setNotes((items) => items.map((note) => note.id === renamed.noteFileId ? { ...note, title: renamed.title, updatedAt: renamed.updatedAt, syncState: "local" } : note));
        setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === renamed.noteFileId ? { ...tab, title: renamed.title } : tab));
      }
    } catch (reason) { setError(String(reason)); }
  }

  async function moveTreeNode(id: string, targetId: string, position: "before" | "inside" | "after") {
    try {
      const moving = treeNodes.find((node) => node.id === id);
      const target = treeNodes.find((node) => node.id === targetId);
      if (!moving || !target) return;
      const parentId = position === "inside" ? target.id : target.parentId;
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
    } catch (reason) { setError(String(reason)); }
  }

  async function deleteTreeNode(id: string) {
    try {
      const removedNodeIds = subtreeIds(treeNodes, id);
      const removedNoteIds = new Set(
        treeNodes.filter((node) => removedNodeIds.has(node.id) && node.noteFileId).map((node) => node.noteFileId!)
      );
      removedNoteIds.forEach((noteId) => {
        const timer = saveTimers.current.get(noteId);
        if (timer) { window.clearTimeout(timer); saveTimers.current.delete(noteId); }
        revisionRef.current.delete(noteId);
      });
      await native.deleteTreeNode(id);
      const remaining = notes.filter((note) => !removedNoteIds.has(note.id));
      setNotes(remaining);
      setTreeNodes(await native.listTreeNodes());
      const next = openTabsRef.current.filter((tab) => !removedNoteIds.has(tab.noteId));
      setOpenTabs(next);
      if (activeNoteId && removedNoteIds.has(activeNoteId)) {
        setActiveNoteId(next[next.length - 1]?.noteId ?? null);
      }
    } catch (reason) { setError(String(reason)); }
  }

  function clearSidebarPreviewTimer() {
    if (sidebarPreviewTimer.current !== null) {
      window.clearTimeout(sidebarPreviewTimer.current);
      sidebarPreviewTimer.current = null;
    }
  }

  function showSidebarPreview() {
    clearSidebarPreviewTimer();
    setSidebarMode((current) => current === "collapsed" ? "floating" : current);
  }

  function hideSidebarPreview() {
    clearSidebarPreviewTimer();
    sidebarPreviewTimer.current = window.setTimeout(() => {
      setSidebarMode((current) => current === "floating" ? "collapsed" : current);
      sidebarPreviewTimer.current = null;
    }, 120);
  }

  function toggleSidebarDock() {
    clearSidebarPreviewTimer();
    setSidebarMode((current) => current === "docked" ? "collapsed" : "docked");
  }

  /** 手动切换全局大纲状态；空文档上显式固定时给一次豁免。 */
  function setOutlineModeForActive(mode: OutlineMode) {
    setOutlineMode(mode);
    localStorage.setItem("lake-notes-v2.outline-sidebar-mode", mode);
    if (mode === "docked" && activeOutlineEmpty) setOutlineEmptyOverride(true);
    else if (mode === "collapsed") setOutlineEmptyOverride(false);
  }

  /** 右侧 activity button：悬停模式与固定模式之间切换。 */
  function collapseOutline() {
    setOutlineModeForActive("collapsed");
  }

  function pinOutline() {
    setOutlineModeForActive("docked");
  }

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

  function updateSidebarWidth(width: number) {
    setSidebarWidth(width);
  }

  function commitSidebarWidth(width: number) {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
    setSidebarWidth(clamped);
    localStorage.setItem("lake-notes-v3.sidebar-width", String(Math.round(clamped)));
  }

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
      setNotes((items) => items.map((item) => (item.id === tabId ? { ...item, isLocked: updated.isLocked, lockedAt: updated.lockedAt } : item)));
    } catch (reason) {
      setError(String(reason));
    }
  }

  /** 标签拖拽排序：按新顺序重排 openTabs（并同步 ref） */
  function reorderTabs(noteIds: string[]) {
    setOpenTabs((current) => {
      const byId = new Map(current.map((tab) => [tab.noteId, tab]));
      const next = noteIds.map((id) => byId.get(id)).filter((tab): tab is OpenTab => Boolean(tab));
      // 保留未出现在拖拽列表里的标签（理论上不会发生）
      for (const tab of current) if (!noteIds.includes(tab.noteId)) next.push(tab);
      return next;
    });
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
    catch (reason) { setError(String(reason)); }
    setDesktopWorkspace("library");
    await openNote(note.id);
  }

  function handleTabChange(noteId: string) {
    setActiveNoteId(noteId);
    setOpenTabs((tabs) => tabs.map((tab) =>
      tab.noteId === noteId ? { ...tab, lastAccessedAt: Date.now() } : tab
    ));
    const tab = openTabs.find((t) => t.noteId === noteId);
    setSaveState(tab?.dirty ? "dirty" : "idle");
  }

  if (!workspace) return <main className="loading-screen"><LoaderCircle className="spin" /><span>正在打开本地知识库</span>{error && <small>{error}</small>}</main>;
  if (isMobile && mobilePage === "library") return <>
    <MobileLibrary notes={notes} search={search} sync={sync} onSearch={setSearch} onSelect={(id) => void openNoteMobile(id)} onCreate={() => void createNote()} />
  </>;

  // 字数统计：当前活动标签正文去标签后字数
  const activeTab = openTabs.find((t) => t.noteId === activeNoteId);
  const activeContent = activeTab?.content ?? mobileActive?.content ?? "";
  const plainText = activeContent.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  const wordCount = plainText.trim().length;
  const wordCountLabel = wordCount > 0 ? `${wordCount} 字` : "";

  const editorPrefs = {
    fontSize: settings.fontSize,
    showToolbar: settings.showToolbar,
  };
  const tabInfos: TabInfo[] = openTabs.map((tab) => ({
    noteId: tab.noteId, title: tab.title, content: tab.content, dirty: tab.dirty,
    icon: treeNodes.find((n) => n.noteFileId === tab.noteId)?.icon ?? null,
  }));

  const outlineVisible = tocEnabled && !isMobile && desktopWorkspace === "library";
  // 只读锁：store 驱动（可同步），派生集合供多标签 viewer 重建
  const lockedNoteIds = new Set(notes.filter((n) => n.isLocked).map((n) => n.id));
  const effectiveOutlineMode: OutlineMode = activeOutlineEmpty && !outlineEmptyOverride ? "collapsed" : outlineMode;
  const shellStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--sidebar-grid-w": sidebarMode === "docked" ? `${sidebarWidth}px` : "0px",
    // 目录与大纲的展开面板互不绑定；只有左右常驻 rail 都是 34px。
    "--outline-sidebar-width": `${outlineSidebarWidth}px`,
    "--outline-grid-w": outlineVisible
      ? effectiveOutlineMode === "docked"
        ? `${outlineSidebarWidth + OUTLINE_COLLAPSED_WIDTH}px`
        : `${OUTLINE_COLLAPSED_WIDTH}px`
      : "0px",
  } as CSSProperties;

  return (
    <div className={`app-shell ${shellPlatformClass} sidebar-${sidebarMode} outline-${effectiveOutlineMode} ${desktopWorkspace === "quick-notes" ? "quick-notes-active" : ""} ${sidebarResizing ? "sidebar-resizing" : ""} ${outlineResizing ? "outline-resizing" : ""} ${isMobile ? `mobile-document-page ${mobileEditing ? "mobile-editing" : "mobile-reading"}` : ""}`} style={shellStyle}>
      <nav className="activity-rail desktop-only" aria-label="应用导航" onPointerEnter={desktopWorkspace === "library" ? showSidebarPreview : undefined} onPointerLeave={desktopWorkspace === "library" ? hideSidebarPreview : undefined}>
        <div className="activity-rail-spacer" />
        <button className={`activity-button ${desktopWorkspace === "library" && sidebarMode === "docked" ? "active" : ""}`} onClick={() => { if (desktopWorkspace === "library") toggleSidebarDock(); else void switchDesktopWorkspace("library"); }} title="资料库" aria-label="资料库"><Files size={16} /></button>
        <button className={`activity-button ${desktopWorkspace === "quick-notes" ? "active" : ""}`} onClick={() => void switchDesktopWorkspace("quick-notes")} title="小记" aria-label="小记"><Feather size={16} /></button>
        <button className="activity-button" onClick={() => { setTrashOpen(true); }} title="回收站" aria-label="回收站"><Trash2 size={16} /></button>
        <div className="activity-rail-fill" />
      </nav>
      {desktopWorkspace === "library" && <Sidebar nodes={treeNodes} activeId={activeNoteId ?? mobileActive?.id ?? null} search={search} mobileOpen={mobileOpen} mode={sidebarMode} width={sidebarWidth} minWidth={SIDEBAR_MIN_WIDTH} maxWidth={SIDEBAR_MAX_WIDTH} onSearch={setSearch} onSelect={(id) => void (isMobile ? openNoteMobile(id) : openNote(id))} onCreate={(kind, parentId, title) => void createTreeItem(kind, parentId, title)} onRename={(id, title) => void renameTreeNode(id, title)} onMoveNode={(id, targetId, position) => void moveTreeNode(id, targetId, position)} onRequestDelete={(node) => setConfirmDelete(node)} onCopyMarkdown={(node) => void copyMarkdownFromCache(node)} onExportAs={(node, format) => void exportAs(node, format)} onCopyPaths={(node) => void copyNotePaths(node)} onSetIcon={(node, icon) => void setNodeIcon(node, icon)} onOpenHistory={(node) => { setHistoryNoteId(node.noteFileId); setHistoryOpen(!!node.noteFileId); }} onOpenSearch={(q) => { setSearchPanelQuery(q ?? ""); setSearchPanelOpen(true); }} pendingRenameId={pendingRenameId} onPendingRenameConsumed={() => setPendingRenameId(null)} onPreviewEnter={showSidebarPreview} onPreviewLeave={hideSidebarPreview} onResizeActiveChange={setSidebarResizing} onWidthChange={updateSidebarWidth} onWidthCommit={commitSidebarWidth} onCloseMobile={() => setMobileOpen(false)} />}
      {mobileOpen && <div className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
      <main className="workspace" onPointerDownCapture={(event) => {
        if (!isMobile && sidebarMode === "floating" && (event.target as HTMLElement).closest(".document-pane, .empty-workspace")) setSidebarMode("collapsed");
      }}>
        {!isMobile && desktopWorkspace === "quick-notes" && <div className="quick-notes-titlebar" aria-hidden="true" />}
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
          </section> : <section className="empty-workspace"><h2>开始写第一篇笔记</h2><button className="primary-button" onClick={() => void createNote()}>新建文档</button></section>
        ) : desktopWorkspace === "quick-notes" ? (
          <QuickNotesWorkspace ref={quickNotesRef} notebooks={treeNodes} onDirtyChange={setQuickNotesDirty} onConverted={(note) => void handleQuickNoteConverted(note)} />
        ) : (
          <section className={`document-pane ${wideMode ? "wide-mode" : ""} ${settings.paragraphSpacing ? "paragraph-spacing" : ""}`}>
            <MultiTabEditor
              tabs={tabInfos}
              activeNoteId={activeNoteId}
              tocEnabled={tocEnabled}
              onTabChange={handleTabChange}
              onTabClose={closeTab}
              onTabsReorder={reorderTabs}
              lockedNoteIds={lockedNoteIds}
              onContentChange={handleContentChange}
              prefs={editorPrefs}
              onEditorReady={handleEditorReady}
              onEditorCopyMarkdown={(noteId) => void copyMarkdownById(noteId)}
              onEditorExport={(noteId, format) => void exportNoteById(noteId, format)}
              onEditorCopyPaths={(noteId) => void copyPathsById(noteId)}
              topbarActions={<>
                <button className="tabbar-action" onClick={() => setSettingsOpen(true)} data-tooltip="打开偏好设置" aria-label="打开偏好设置"><Settings2Icon size={15} /></button>
                <button className={`tabbar-action sync-tab-action ${sync.phase}`} onClick={() => setSyncPanelOpen(true)} data-tooltip={`云同步：${sync.message}`} aria-label={`云同步：${sync.message}`}>
                  <span className="sync-icon-wrap"><Cloud size={15} /><span className="sync-state-dot" aria-hidden="true" /></span>
                </button>
              </>}
              emptyAction={<button className="primary-button" onClick={() => void createNote()}>新建文档</button>}
            />
          </section>
        )}
        <footer className="statusbar">
          <span className="statusbar-repo">{desktopWorkspace === "quick-notes" ? "小记" : isDesktop() ? "Electron 本地仓库" : "浏览器演示仓库"}</span>
          {desktopWorkspace === "library" && <>
            <span className="statusbar-divider" />
            <span className="statusbar-wordcount" title="当前文档字数">{wordCountLabel}</span>
            {notice && <span className="statusbar-notice" title={notice}>{notice}</span>}
            <span className={`save-label ${saveState}`} title="保存状态">{saveState === "saving" ? <LoaderCircle className="spin" size={11} /> : saveState === "dirty" ? <WifiOff size={11} /> : <Save size={11} />}{saveLabel(saveState)}</span>
            <span className={`statusbar-sync ${sync.phase}`} title="S3 同步状态"><Cloud size={11} />{sync.message}</span>
            <button
              className={`statusbar-menu-btn${statusMenuOpen ? " open" : ""}`}
              onClick={() => setStatusMenuOpen((open) => !open)}
              aria-label="更多操作"
              title="更多操作"
            >
              <MoreHorizontal size={14} />
            </button>
            {statusMenuOpen && (
              <>
                <div className="statusbar-menu" role="menu">
                  {activeNoteId && (
                    <button role="menuitem" onClick={() => { void toggleNoteLock(); setStatusMenuOpen(false); }}>
                      {lockedNoteIds.has(activeNoteId) ? <Lock size={13} /> : <LockOpen size={13} />}
                      <span>{lockedNoteIds.has(activeNoteId) ? "解锁当前文档" : "锁定当前文档（只读）"}</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </>}
        </footer>
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
      <SearchPanel open={searchPanelOpen} initialQuery={searchPanelQuery} onOpenNote={(id) => void openNote(id)} onClose={() => setSearchPanelOpen(false)} />
      <TrashPanel open={trashOpen} onClose={() => setTrashOpen(false)} onRestored={() => { void native.listTreeNodes().then(setTreeNodes).catch(() => undefined); void native.listNoteSummaries().then(setNotes).catch(() => undefined); }} />
      <HistoryPanel open={historyOpen} noteId={historyNoteId} onClose={() => setHistoryOpen(false)} onRestored={() => { void native.listTreeNodes().then(setTreeNodes).catch(() => undefined); void native.listNoteSummaries().then(setNotes).catch(() => undefined); }} />
      <SyncPanel open={syncPanelOpen} onClose={() => setSyncPanelOpen(false)} onSyncStatusChange={(status) => setSync((current) => ({ ...current, ...status }))} />
      <SettingsPanel open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onChange={(patch) => saveSettings(patch)} />
    </div>
  );
}

const summaryOf = ({ content: _content, ...summary }: NoteDocument): NoteSummary => summary;
const saveLabel = (state: SaveState) => ({ idle: "本地", dirty: "待保存", saving: "保存中", saved: "已保存", error: "保存失败" })[state];
