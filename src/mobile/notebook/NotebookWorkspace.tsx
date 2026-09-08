/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ListTree, Files, Pencil, X, ChevronRight, FolderOpen, FileText, Plus, Check, ArrowLeftRight, Trash2, SmilePlus, Move, History, CloudUpload, MoreHorizontal, FilePlus, Search, Settings } from "lucide-react";
import { bridge } from "../bridge";
import { LAKE_EMOJIS } from "../../lib/lakeEmojis";
import { loadSettings } from "../../lib/settings";
import { selectEvictionIds } from "../../core/tabLimit";
import { DocumentEditor } from "../editor/DocumentEditor";
import { OutlineSheet } from "../editor/OutlineSheet";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { usePanelDrag, type PanelSide } from "../usePanelDrag";
import { MobileSheetMenu, type MobileSheetItem } from "../ui/MobileSheetMenu";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";
import { longPressFeedback, tapFeedback } from "../ui/haptics";
import { useAutoSave } from "../useAutoSave";
import type { POCNote } from "../bridge";
/** 笔记本子树节点（原 NotebookPage 的类型，页面本体已随"两套壳"统一删除）。 */
export interface NotebookTreeItem {
  id: string;
  title: string;
  kind: "group" | "note";
  parentId: string | null;
  sortOrder: number;
  icon: string | null;
}
import type { TreeNode } from "../../lib/types";

/** 打开文档 tab 的内容状态（按 tab 缓存，切换不丢草稿） */
interface TabState { id: string; title: string; content: string; editing: boolean; lastAccessedAt: number; }

export interface NotebookWorkspaceProps {
  notebookId: string;
  initialNoteId?: string | null;
  /** 打开时直接进入编辑态（首页/搜索"新建文档"用） */
  initialMode?: "viewer" | "editor";
  onBack: () => void;
  /** 全部笔记本（切换笔记本用） */
  notebooks: TreeNode[];
  /** 切换到另一个笔记本 */
  onSwitchNotebook: (id: string) => void;
  /** 底部栏「更多」菜单要拉起的第一层浮层（思源：主菜单承担搜索/设置等入口） */
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onCreateNote: () => void;
  /** 当前活动文档变化（MobileApp 的定时快照要用） */
  onActiveNoteChange?: (id: string | null) => void;
}

export function NotebookWorkspace(props: NotebookWorkspaceProps) {
  const { notebookId, initialNoteId, initialMode, onBack, notebooks, onSwitchNotebook, onOpenSearch, onOpenSettings, onCreateNote, onActiveNoteChange } = props;
  const [title, setTitle] = useState("知识库");
  const [tree, setTree] = useState<NotebookTreeItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([notebookId]));
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialNoteId ?? null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [notebookSwitchOpen, setNotebookSwitchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // 思源：左右两侧面板互斥（都是 100vw 全屏抽屉，同时开会互相盖住）
  const openSidebar = useCallback((v: boolean) => { setSidebarOpen(v); if (v) { setOutlineOpen(false); setTabsOpen(false); } }, []);
  const openOutline = useCallback((v: boolean) => { setOutlineOpen(v); if (v) { setSidebarOpen(false); setTabsOpen(false); } }, []);
  const editorsRef = useRef<Map<string, LakeEditorInstance | null>>(new Map());
  const autoOpenedRef = useRef(false);
  const pendingEditRef = useRef(initialMode === "editor");
  // 标签保持：本地记录上次打开的标签（按笔记本隔离）
  const TABS_KEY = "lake-notes-mobile.tabs." + notebookId;

  // 目录树长按管理：思源 sheet 菜单 / 内联重命名 / 图标 / 移动（菜单子层）/ 删除（确认框）
  const [menuFor, setMenuFor] = useState<NotebookTreeItem | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [iconFor, setIconFor] = useState<NotebookTreeItem | null>(null);
  const [historyFor, setHistoryFor] = useState<NotebookTreeItem | null>(null);
  const [historyList, setHistoryList] = useState<Array<{ id: number; title: string; createdAt: string }>>([]);
  const longPressTimer = useRef<number | null>(null);

  // 跟手开合抽屉（思源 touch.ts 口径：内容区任意横滑、面板跟手、释放按 1/3 屏宽提交）
  usePanelDrag({
    getPanel: (side: PanelSide) => document.querySelector<HTMLElement>(side === "left" ? ".side-panel--left" : ".side-panel--right"),
    getMask: (side: PanelSide) => document.querySelector<HTMLElement>('[data-panel-mask="' + side + '"]'),
    isOpen: (side: PanelSide) => (side === "left" ? sidebarOpen : outlineOpen),
    commit: (side: PanelSide, open: boolean) => { if (side === "left") openSidebar(open); else openOutline(open); },
  });

  const loadTree = useCallback(async () => {
    const [treeArr, nodes] = await Promise.all([bridge.listNotebookTree(notebookId), bridge.listTreeNodes()]);
    setTree(treeArr);
    const nb = nodes.find((n) => n.id === notebookId);
    if (nb) setTitle(nb.title);
    return treeArr;
  }, [notebookId]);

  useEffect(() => { void loadTree(); }, [loadTree]);

  // 初次进入：优先恢复上次打开的标签（本地持久化），否则开指定文档/树中第一个（仅一次）
  useEffect(() => {
    if (autoOpenedRef.current) return;
    let saved: string[] = [];
    try { saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? "[]") as string[]; } catch { saved = []; }
    if (saved.length > 0) { autoOpenedRef.current = true; saved.forEach((id) => void openTab(id)); return; }
    if (initialNoteId) { autoOpenedRef.current = true; void openTab(initialNoteId); return; }
    const first = findFirstNote(tree);
    if (first) { autoOpenedRef.current = true; void openTab(first.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // 标签保持：打开标签变化即落本地（仅本机，不参与同步）
  useEffect(() => {
    try { localStorage.setItem(TABS_KEY, JSON.stringify(tabs.map((t) => t.id))); } catch { /* 忽略 */ }
  }, [tabs, TABS_KEY]);

  const openTab = useCallback((id: string) => {
    setActiveId(id);
    // 已打开：仅刷新 LRU 时间戳，不重读正文（keep-alive）
    setTabs((prev) => prev.some((t) => t.id === id) ? prev.map((t) => (t.id === id ? { ...t, lastAccessedAt: Date.now() } : t)) : prev);
    if (tabs.some((t) => t.id === id)) return;
    void bridge.readNote(id).then((n) => {
      if (!n) return;
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        const added = [...prev, { id, title: n.title, content: n.content, editing: pendingEditRef.current, lastAccessedAt: Date.now() }];
        pendingEditRef.current = false;
        const evicted = selectEvictionIds(added.map((t) => ({ noteId: t.id, lastAccessedAt: t.lastAccessedAt })), { limit: loadSettings().maxOpenTabs, activeNoteId: id, pinnedNoteIds: new Set() });
        if (evicted.length === 0) return added;
        const evictedSet = new Set(evicted);
        return added.filter((t) => !evictedSet.has(t.id));
      });
    });
  }, [tabs]);

  const closeTab = useCallback((id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) setActiveId(next.length ? next[Math.min(idx, next.length - 1)].id : null);
  }, [tabs, activeId]);

  const toggleGroup = (id: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const childrenOf = (parentId: string) => tree.filter((it) => it.parentId === parentId);
  const findFirstNote = (arr: NotebookTreeItem[]): NotebookTreeItem | null => {
    for (const it of arr) {
      if (it.kind === "note") return it;
      const sub = findFirstNote(childrenOf(it.id));
      if (sub) return sub;
    }
    return null;
  };

  // 编辑：保存当前 tab
  const active = tabs.find((t) => t.id === activeId) ?? null;

  // 立即同步（思源顶栏右侧的云图标就是同步状态/触发器）
  const runSync = useCallback(async () => {
    tapFeedback();
    try { const r = await bridge.syncNow(); showToast(r.message || "已同步"); }
    catch (e) { showToast("同步失败：" + (e as Error).message, { type: "error" }); }
  }, []);

  // 活动文档上报（MobileApp 的定时自动快照按当前文档留档）
  useEffect(() => { onActiveNoteChange?.(activeId); }, [activeId, onActiveNoteChange]);

  // 自动保存：编辑态内容变化防抖 1s 落盘
  const { schedule: scheduleAutoSave, flush: flushAutoSave } = useAutoSave(async (id, title, content) => {
    await bridge.saveNote(id, title, content);
  });

  const toggleEdit = useCallback(() => {
    if (!active) return;
    if (active.editing) {
      flushAutoSave();
      void bridge.saveNote(active.id, active.title, active.content);
    }
    setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, editing: !t.editing } : t)));
  }, [active, flushAutoSave]);

  const createDoc = useCallback(async () => {
    try {
      const n = await bridge.createNote("无标题文档", notebookId);
      await loadTree();
      setSidebarOpen(false);
      await openTab(n.id);
    } catch { /* 忽略 */ }
  }, [notebookId, loadTree, openTab]);

  // ---- 目录树长按管理 ----
  const clearLongPress = () => {
    if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  const startLongPress = (e: React.TouchEvent, node: NotebookTreeItem) => {
    clearLongPress();
    const el = e.currentTarget as HTMLElement;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      void el;
      longPressFeedback();
      setMenuFor(node);
    }, 500);
  };
  const applyRename = useCallback(async () => {
    const id = renamingId; const v = renameValue.trim();
    setRenamingId(null);
    if (id && v) { try { await bridge.renameTreeNode(id, v); await loadTree(); } catch { /* 忽略 */ } }
  }, [renamingId, renameValue, loadTree]);
  const applyIcon = useCallback(async (icon: string | null) => {
    const n = iconFor; setIconFor(null);
    if (n) { try { await bridge.setNodeIcon(n.id, icon); await loadTree(); } catch { /* 忽略 */ } }
  }, [iconFor, loadTree]);
  const applyDelete = useCallback(async (node: NotebookTreeItem) => {
    const ok = await confirmMobile({
      title: node.kind === "note" ? "移入回收站？" : "删除分组？",
      body: node.title || "无标题",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await bridge.trashTreeItem(node.id, node.kind === "note" ? "note" : "folder");
      await loadTree();
      // 已打开的标签必须一起关掉：否则回收站文档仍留在 tab 里可继续编辑（AGENTS §3 #16）
      closeTab(node.id);
      showToast("已移入回收站");
    } catch { showToast("删除失败", { type: "error" }); }
  }, [loadTree, closeTab]);
  const applyMove = useCallback(async (n: NotebookTreeItem, targetParentId: string) => {
    if (!n || n.parentId === targetParentId || n.id === targetParentId) return;
    try {
      const siblings = tree.filter((x) => x.parentId === targetParentId && x.id !== n.id).map((x) => x.id);
      await bridge.moveTreeNodeOrdered(n.id, targetParentId, [...siblings, n.id]);
      await loadTree();
      showToast("已移动");
    } catch { showToast("移动失败", { type: "error" }); }
  }, [tree, loadTree]);

  const openHistory = useCallback(async (node: NotebookTreeItem) => {
    setHistoryFor(node);
    try { setHistoryList(await bridge.listNoteHistory(node.id)); } catch { setHistoryList([]); }
  }, []);
  const applyRestoreHistory = useCallback(async (id: number) => {
    const ok = await confirmMobile({ title: "恢复此版本？", body: "将用该历史版本覆盖当前正文（当前正文会先自动留档）。", confirmText: "恢复", danger: true });
    if (!ok) return;
    try {
      await bridge.restoreHistory(id);
      setHistoryFor(null);
      await loadTree();
      showToast("已恢复历史版本");
    } catch { showToast("恢复失败", { type: "error" }); }
  }, [loadTree]);
  const deleteHistory = useCallback(async (historyId: number) => {
    try {
      await bridge.deleteHistory(historyId);
      setHistoryList((prev) => prev.filter((h) => h.id !== historyId));
    } catch { /* 忽略 */ }
  }, []);

  /** 目录树长按菜单（思源 .b3-menu--sheet 口径）：移动到… 用子层下钻，删除走危险项 + 确认框 */
  const treeMenuItems = (node: NotebookTreeItem): MobileSheetItem[] => {
    const groups = tree.filter((x) => x.kind === "group" && x.id !== node.id);
    return [
      { id: "rename", label: "重命名", icon: Pencil },
      { id: "icon", label: "设置图标", icon: SmilePlus },
      {
        id: "move", label: "移动到…", icon: Move,
        children: [
          { id: "__root", label: title, icon: FolderOpen, note: "笔记本根目录" },
          ...groups.map((g) => ({ id: g.id, label: g.title, icon: FolderOpen })),
        ],
      },
      ...(node.kind === "note" ? [{ id: "history", label: "历史版本", icon: History }] : []),
      { id: "delete", label: node.kind === "note" ? "移入回收站" : "删除分组", icon: Trash2, danger: true },
    ];
  };
  const onTreeMenuSelect = (item: MobileSheetItem, path: MobileSheetItem[]) => {
    const node = menuFor;
    setMenuFor(null);
    if (!node) return;
    const root = path[0]?.id;
    if (root === "move") { void applyMove(node, path[1]?.id === "__root" ? notebookId : String(path[1]?.id)); return; }
    if (root === "rename") { tapFeedback(); setRenamingId(node.id); setRenameValue(node.title); return; }
    if (root === "icon") { setIconFor(node); return; }
    if (root === "history") { void openHistory(node); return; }
    if (root === "delete") { void applyDelete(node); }
  };

  const renderBranch = (parentId: string, depth: number) => {
    const children = childrenOf(parentId);
    return children.map((it) => {
      const hasChildren = childrenOf(it.id).length > 0;
      const NodeIcon = it.kind === "group" ? FolderOpen : FileText;
      const isNote = it.kind === "note";
      return (
        <div key={it.kind + "-" + it.id}>
          <button
            className={"b3-list-item ln-indent" + (activeId === it.id ? " b3-list-item--selected" : "")}
            data-depth={depth}
            data-node-id={it.id}
            onClick={() => {
              if (renamingId) return;
              if (hasChildren) { toggleGroup(it.id); return; }
              if (isNote) { openSidebar(false); void openTab(it.id); }
            }}
            onTouchStart={(e) => startLongPress(e, it)}
            onTouchMove={clearLongPress}
            onTouchEnd={clearLongPress}
            onTouchCancel={clearLongPress}
            onContextMenu={(e) => { e.preventDefault(); setMenuFor(it); }}
          >
            {hasChildren ? <ChevronRight size={16} className={expanded.has(it.id) ? "ln-chevron open" : "ln-chevron"} /> : <span className="ln-chevron-spacer" />}
            {renamingId === it.id ? (
              <input
                className="b3-text-field"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => void applyRename()}
                onKeyDown={(e) => { if (e.key === "Enter") void applyRename(); if (e.key === "Escape") setRenamingId(null); }}
              />
            ) : (
              <>
                {it.icon ? <span className="ln-tree-icon">{it.icon}</span> : <NodeIcon size={16} className="ln-tree-icon" />}
                <span className="b3-list-item__text">{it.title}</span>
              </>
            )}
          </button>
          {hasChildren && expanded.has(it.id) && renderBranch(it.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="mobile-workspace">
      {/* 顶部栏（思源 #mobileTopBar：.toolbar--border + .toolbar__title 左对齐 + 右侧同步状态） */}
      <header className="toolbar toolbar--border mobile-topbar">
        <button className="toolbar__button" onClick={onBack} aria-label="返回"><ArrowLeft /></button>
        <input
          className={"toolbar__title" + (active?.editing ? "" : " toolbar__title--readonly")}
          value={active?.title ?? title}
          readOnly={!active?.editing}
          placeholder={active ? "" : title}
          aria-label="文档标题"
          onChange={(e) => {
            const t = e.target.value;
            const id = activeId;
            if (!id) return;
            setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, title: t } : x)));
            scheduleAutoSave(id, t, tabs.find((x) => x.id === id)?.content ?? "");
          }}
        />
        <button className="toolbar__button" onClick={() => void runSync()} aria-label="立即同步"><CloudUpload /></button>
      </header>

      {/* 文档层（正文） */}
      <section className="mobile-workspace-body">
        {tabs.length === 0 ? (
          <div className="mobile-empty">暂无打开的文档，点左目录或底部打开</div>
        ) : tabs.map((t) => (
          <div key={t.id} className={"doc-pane" + (t.id === activeId ? " active" : "")}>
            {t.editing && (
              <input
                className="mobile-title-input"
                value={t.title}
                placeholder="无标题"
                onChange={(e) => {
                  const title = e.target.value;
                  setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, title } : x)));
                  scheduleAutoSave(t.id, title, t.content);
                }}
              />
            )}
            <DocumentEditor
              note={{ id: t.id, title: t.title, content: t.content } as POCNote}
              content={t.content}
              title={t.title}
              editing={t.editing}
              onContentChange={(c) => { setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, content: c } : x))); if (t.editing) scheduleAutoSave(t.id, t.title, c); }}
              onToggleEdit={toggleEdit}
              documents={[]}
              hidePanels
              onEditorInstance={(ed) => { editorsRef.current.set(t.id, ed); }}
            />
          </div>
        ))}
      </section>

      {/* 底部胶囊栏（思源 #mobileBottomBar：纯图标 5 槽，键盘/编辑态整条下滑淡出而不是卸载） */}
      <nav className={"mobile-bottom-bar" + (active?.editing ? " mobile-bottom-bar--hidden" : "")} data-prevent-swipe aria-hidden={active?.editing ? "true" : "false"}>
        <button className={"mobile-bottom-bar__item" + (sidebarOpen ? " active" : "")} onClick={() => { tapFeedback(); openSidebar(!sidebarOpen); }} aria-label="文档树" title="文档树"><Files /></button>
        <button className={"mobile-bottom-bar__item" + (tabsOpen ? " active" : "")} onClick={() => { tapFeedback(); setTabsOpen(true); }} aria-label="标签页" title="标签页"><FileText />{tabs.length > 0 && <span className="bottom-bar-count">{tabs.length}</span>}</button>
        <button className={"mobile-bottom-bar__item" + (outlineOpen ? " active" : "")} onClick={() => { tapFeedback(); openOutline(!outlineOpen); }} aria-label="大纲" title="大纲"><ListTree /></button>
        <button className={"mobile-bottom-bar__item" + (active?.editing ? " active" : "")} disabled={!active} onClick={toggleEdit} aria-label={active?.editing ? "完成" : "编辑"} title={active?.editing ? "完成" : "编辑"}>{active?.editing ? <Check /> : <Pencil />}</button>
        <button className={"mobile-bottom-bar__item" + (moreOpen ? " active" : "")} onClick={() => { tapFeedback(); setMoreOpen(true); }} aria-label="更多" title="更多"><MoreHorizontal /></button>
      </nav>

      {/* 更多（思源 #menu：主菜单承担搜索/设置等次级入口） */}
      <MobileSheetMenu
        open={moreOpen}
        items={[
          { id: "new-doc", label: "新建文档", icon: FilePlus },
          { id: "switch-nb", label: "切换笔记本", icon: ArrowLeftRight, note: title },
          { id: "search", label: "搜索", icon: Search },
          { id: "settings", label: "设置", icon: Settings },
        ]}
        onClose={() => setMoreOpen(false)}
        onSelect={(it) => {
          setMoreOpen(false);
          if (it.id === "new-doc") onCreateNote();
          else if (it.id === "switch-nb") setNotebookSwitchOpen(true);
          else if (it.id === "search") onOpenSearch();
          else if (it.id === "settings") onOpenSettings();
        }}
      />

      {/* 左目录抽屉 (.side-panel) */}
      <div className={"side-mask" + (sidebarOpen ? " on" : "")} data-panel-mask="left" onClick={() => openSidebar(false)} />
      <aside className={"side-panel side-panel--left" + (sidebarOpen ? " on" : "")} aria-label="目录">
        <div className="toolbar toolbar--border toolbar--dark" data-prevent-swipe>
          <div className="toolbar__scroll"><span className="toolbar__text">{title}</span></div>
          <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => void createDoc()} aria-label="新建文档"><Plus /></span>
          <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => openSidebar(false)} aria-label="收起"><ChevronRight /></span>
        </div>
        <div className="side-panel-body">
          {childrenOf(notebookId).length === 0 && <div className="mobile-empty">暂无文档，点右上新建</div>}
          {renderBranch(notebookId, 0)}
        </div>
      </aside>

      {/* 右大纲抽屉 (.side-panel--right) */}
      <OutlineSheet side open={outlineOpen} editor={activeId ? (editorsRef.current.get(activeId) ?? null) : null} onClose={() => setOutlineOpen(false)} />

      {/* 全屏 tab 列表 (.model，思源 #toolbarTabs → #model) */}
      {tabsOpen && (
        <div className="mobile-model-mask" onClick={() => setTabsOpen(false)}>
          <div className="mobile-model" onClick={(e) => e.stopPropagation()}>
            <div className="toolbar toolbar--border mobile-model-head">
              <span className="toolbar__text">标签页</span>
              <span className="toolbar__icon" role="button" tabIndex={0} onClick={() => setTabsOpen(false)} aria-label="关闭"><X /></span>
            </div>
            <div className="mobile-model-body">
              {tabs.length === 0 && <div className="mobile-empty">暂无打开的文档</div>}
              {tabs.map((t) => (
                <div key={t.id} className={"b3-list-item" + (t.id === activeId ? " b3-list-item--selected" : "")} onClick={() => { openTab(t.id); setTabsOpen(false); }}>
                  <span className="b3-list-item__text">{t.title || "无标题"}</span>
                  <button className="b3-list-item__action" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} aria-label="关闭"><X size={16} /></button>
                </div>
              ))}
              <button className="b3-button b3-button--outline model-add" onClick={() => { setTabsOpen(false); openSidebar(true); }}><Plus size={16} />打开文档</button>
            </div>
          </div>
        </div>
      )}

      {/* 笔记本切换（思源 sheet 菜单：贴底、56dvh、下钻即整屏平移） */}
      <MobileSheetMenu
        open={notebookSwitchOpen}
        items={notebooks.map((nb) => ({ id: nb.id, label: nb.title, icon: FolderOpen, note: nb.id === notebookId ? "当前" : undefined }))}
        onClose={() => setNotebookSwitchOpen(false)}
        onSelect={(it) => { setNotebookSwitchOpen(false); if (it.id !== notebookId) onSwitchNotebook(it.id); }}
      />

      {/* 目录树长按菜单 */}
      <MobileSheetMenu
        open={!!menuFor}
        items={menuFor ? treeMenuItems(menuFor) : []}
        onClose={() => setMenuFor(null)}
        onSelect={onTreeMenuSelect}
      />

      {/* 图标选择器 */}
      {iconFor && (
        <div className="mobile-sheet-mask" onClick={() => setIconFor(null)}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <span className="mobile-sheet-title">设置图标</span>
              <button className="mobile-icon-btn" onClick={() => setIconFor(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-sheet-body">
              <div className="mobile-emoji-grid">
                {LAKE_EMOJIS.map((e) => (
                  <button key={e.name + e.char} className="mobile-emoji-cell" onClick={() => void applyIcon(e.char)} title={e.name}>{e.char}</button>
                ))}
              </div>
              <button className="b3-button b3-button--outline" onClick={() => void applyIcon(null)}>清除图标</button>
            </div>
          </div>
        </div>
      )}

      {/* 历史版本 sheet */}
      {historyFor && (
        <div className="mobile-sheet-mask" onClick={() => setHistoryFor(null)}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <span className="mobile-sheet-title">历史版本</span>
              <button className="mobile-icon-btn" onClick={() => setHistoryFor(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-sheet-body b3-list--mobile">
              {historyList.length === 0 && <p className="mobile-sheet-empty">暂无历史版本</p>}
              {historyList.map((h) => (
                <div key={h.id} className="b3-list-item" onClick={() => void applyRestoreHistory(h.id)}>
                  <span className="b3-list-item__text">{h.title || "无标题"}</span>
                  <span className="b3-list-item__meta">{new Date(h.createdAt).toLocaleString("zh-CN")}</span>
                  <button className="b3-list-item__action" onClick={(e) => { e.stopPropagation(); void deleteHistory(h.id); }} aria-label="删除"><X size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
