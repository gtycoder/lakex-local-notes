import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Check, Cloud, FileDown, Files, ListTree, LoaderCircle, Pencil, Save, Settings as Settings2Icon, WifiOff } from "lucide-react";
import { MobileLibrary } from "./components/MobileLibrary";
import { ConfirmDelete, Sidebar, type SidebarMode } from "./components/Sidebar";
import { SyncPanel } from "./components/SyncPanel";
import { LakeEditor } from "./features/editor/LakeEditor";
import type { LakeEditorInstance } from "./features/editor/lakeRuntime";
import { MultiTabEditor, type TabInfo } from "./features/editor/MultiTabEditor";
import { isDesktop, native } from "./lib/native";
import { loadSettings, saveSettings, subscribeSettings, type AppSettings } from "./lib/settings";
import { SettingsPanel } from "./components/SettingsPanel";
import { subtreeIds } from "./lib/tree";
import type { NoteDocument, NoteSummary, SyncStatus, TreeNode, WorkspaceSnapshot } from "./lib/types";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type MobilePage = "library" | "document";

const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 300;

function initialSidebarMode(): SidebarMode {
  const stored = localStorage.getItem("lake-notes-v2.sidebar-mode");
  if (stored === "docked" || stored === "collapsed") return stored;
  return localStorage.getItem("lake-notes-v1.sidebar") === "collapsed" ? "collapsed" : "docked";
}

function initialSidebarWidth(): number {
  const stored = Number(localStorage.getItem("lake-notes-v3.sidebar-width"));
  return Number.isFinite(stored) ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, stored)) : SIDEBAR_DEFAULT_WIDTH;
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
  const [saveState, setSaveState] = useState<SaveState>("idle");
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
  const [error, setError] = useState<string | null>(null);
  const openTabsRef = useRef<OpenTab[]>([]);
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
      const saved = await native.saveNote(noteId, title.trim() || "无标题", content);
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
    // 审计 #23：窗口/应用关闭时若有未保存草稿，阻止关闭并提示（Electron 显示原生对话框）；
    // 同时立即触发一次保存，尽量在用户留下期间落盘
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasDirty = openTabsRef.current.some((tab) => tab.dirty)
        || (mobileActive !== null && mobileDraftContent !== mobileActive.content);
      if (!hasDirty) return;
      for (const tab of openTabsRef.current) {
        if (tab.dirty) void persistTab(tab.noteId, tab.title, tab.content);
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [persistTab, mobileActive, mobileDraftContent]);

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

  /** 编辑器实例就绪回调：注册到 map，销毁时移除 */
  const handleEditorReady = useCallback((noteId: string, editor: LakeEditorInstance | null) => {
    if (editor) editorsRef.current.set(noteId, editor);
    else editorsRef.current.delete(noteId);
  }, []);

  /** 全文导出 Markdown：Lake 内核原生支持（getDocument("text/markdown")），复制到剪贴板 */
  const exportMarkdown = useCallback(async () => {
    const id = activeNoteId ?? mobileActive?.id ?? null;
    if (!id) { showNotice("没有打开的笔记"); return; }
    const editor = editorsRef.current.get(id);
    if (!editor || typeof (editor as any).getDocument !== "function") { showNotice("编辑器未就绪，请稍后再试"); return; }
    try {
      const md = String((editor as any).getDocument("text/markdown"));
      if (!md.trim()) { showNotice("当前笔记内容为空"); return; }
      await navigator.clipboard.writeText(md);
      showNotice("已复制 Markdown（" + md.length + " 字符）");
    } catch (reason) {
      setError("导出 Markdown 失败: " + (reason instanceof Error ? reason.message : String(reason)));
    }
  }, [activeNoteId, mobileActive, showNotice]);

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

  function updateSidebarWidth(width: number) {
    setSidebarWidth(width);
  }

  function commitSidebarWidth(width: number) {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
    setSidebarWidth(clamped);
    localStorage.setItem("lake-notes-v3.sidebar-width", String(Math.round(clamped)));
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
  const tabInfos: TabInfo[] = openTabs.map((tab) => ({ noteId: tab.noteId, title: tab.title, content: tab.content, dirty: tab.dirty }));

  const shellStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div className={`app-shell ${shellPlatformClass} sidebar-${sidebarMode} ${sidebarResizing ? "sidebar-resizing" : ""} ${isMobile ? `mobile-document-page ${mobileEditing ? "mobile-editing" : "mobile-reading"}` : ""}`} style={shellStyle}>
      <nav className="activity-rail desktop-only" aria-label="应用导航" onPointerEnter={showSidebarPreview} onPointerLeave={hideSidebarPreview}>
        <div className="activity-rail-spacer" />
        <button className={`activity-button ${sidebarMode === "docked" ? "active" : ""}`} onClick={toggleSidebarDock} title={sidebarMode === "docked" ? "取消固定资料库" : "固定资料库"} aria-pressed={sidebarMode === "docked"}><Files size={16} /></button>
        <div className="activity-rail-fill" />
      </nav>
      <Sidebar nodes={treeNodes} activeId={activeNoteId ?? mobileActive?.id ?? null} search={search} mobileOpen={mobileOpen} mode={sidebarMode} width={sidebarWidth} minWidth={SIDEBAR_MIN_WIDTH} maxWidth={SIDEBAR_MAX_WIDTH} onSearch={setSearch} onSelect={(id) => void (isMobile ? openNoteMobile(id) : openNote(id))} onCreate={(kind, parentId, title) => void createTreeItem(kind, parentId, title)} onRename={(id, title) => void renameTreeNode(id, title)} onMoveNode={(id, targetId, position) => void moveTreeNode(id, targetId, position)} onRequestDelete={(node) => setConfirmDelete(node)} pendingRenameId={pendingRenameId} onPendingRenameConsumed={() => setPendingRenameId(null)} onPreviewEnter={showSidebarPreview} onPreviewLeave={hideSidebarPreview} onResizeActiveChange={setSidebarResizing} onWidthChange={updateSidebarWidth} onWidthCommit={commitSidebarWidth} onCloseMobile={() => setMobileOpen(false)} />
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
              <button onClick={() => setMobileEditing(true)}><Pencil size={20} /><span>编辑</span></button>
              <button className={mobileTocOpen ? "selected" : ""} onClick={() => setMobileTocOpen((open) => !open)}><ListTree size={21} /><span>大纲</span></button>
              <button onClick={() => setMobileOpen(true)}><Files size={20} /><span>切换</span></button>
            </nav>}
          </section> : <section className="empty-workspace"><h2>开始写第一篇笔记</h2><button className="primary-button" onClick={() => void createNote()}>新建文档</button></section>
        ) : (
          <section className={`document-pane ${wideMode ? "wide-mode" : ""} ${settings.paragraphSpacing ? "paragraph-spacing" : ""}`}>
            <MultiTabEditor
              tabs={tabInfos}
              activeNoteId={activeNoteId}
              tocEnabled={tocEnabled}
              onTabChange={handleTabChange}
              onTabClose={closeTab}
              onContentChange={handleContentChange}
              prefs={editorPrefs}
              onEditorReady={handleEditorReady}
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
          <span>{isDesktop() ? "Electron 本地仓库" : "浏览器演示仓库"}</span>
          <span className="statusbar-wordcount" title="当前文档字数">{wordCountLabel}</span>
          {notice && <span className="statusbar-notice">{notice}</span>}
          <button className="statusbar-export-md" onClick={() => void exportMarkdown()} title="导出当前笔记为 Markdown（复制到剪贴板）"><FileDown size={13} /> MD</button>
          <span className={`save-label ${saveState}`}>{saveState === "saving" ? <LoaderCircle className="spin" size={12} /> : saveState === "dirty" ? <WifiOff size={12} /> : <Save size={12} />}{saveLabel(saveState)}</span>
          <span className={`statusbar-sync ${sync.phase}`} title="S3 同步状态"><Cloud size={12} />{sync.message}</span>
        </footer>
      </main>
      {confirmDelete && <ConfirmDelete node={confirmDelete} onConfirm={() => { const id = confirmDelete.id; setConfirmDelete(null); void deleteTreeNode(id); }} onCancel={() => setConfirmDelete(null)} />}
      <SyncPanel open={syncPanelOpen} onClose={() => setSyncPanelOpen(false)} onSyncStatusChange={(status) => setSync((current) => ({ ...current, ...status }))} />
      <SettingsPanel open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onChange={(patch) => saveSettings(patch)} />
    </div>
  );
}

const summaryOf = ({ content: _content, ...summary }: NoteDocument): NoteSummary => summary;
const saveLabel = (state: SaveState) => ({ idle: "本地", dirty: "待保存", saving: "保存中", saved: "已保存", error: "保存失败" })[state];
