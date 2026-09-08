/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ListTree, Files, Pencil, X, ChevronRight, FolderOpen, FileText, Plus, Check, ArrowLeftRight, Trash2, SmilePlus, Move, History } from "lucide-react";
import { bridge } from "../bridge";
import { LAKE_EMOJIS } from "../../lib/lakeEmojis";
import { loadSettings } from "../../lib/settings";
import { selectEvictionIds } from "../../core/tabLimit";
import { DocumentEditor } from "../editor/DocumentEditor";
import { OutlineSheet } from "../editor/OutlineSheet";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { useEdgeSwipe } from "../useEdgeSwipe";
import { useAutoSave } from "../useAutoSave";
import type { POCNote } from "../bridge";
import type { NotebookTreeItem } from "./NotebookPage";
import type { TreeNode } from "../../lib/types";

/** 打开文档 tab 的内容状态（按 tab 缓存，切换不丢草稿） */
interface TabState { id: string; title: string; content: string; editing: boolean; lastAccessedAt: number; }

export interface NotebookWorkspaceProps {
  notebookId: string;
  initialNoteId?: string | null;
  onBack: () => void;
  /** 全部笔记本（切换笔记本用） */
  notebooks: TreeNode[];
  /** 切换到另一个笔记本 */
  onSwitchNotebook: (id: string) => void;
}

export function NotebookWorkspace(props: NotebookWorkspaceProps) {
  const { notebookId, initialNoteId, onBack, notebooks, onSwitchNotebook } = props;
  const [title, setTitle] = useState("知识库");
  const [tree, setTree] = useState<NotebookTreeItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([notebookId]));
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialNoteId ?? null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [notebookSwitchOpen, setNotebookSwitchOpen] = useState(false);
  const switchBtnRef = useRef<HTMLButtonElement>(null);
  const [switchPos, setSwitchPos] = useState<{ top: number; right: number } | null>(null);
  const editorsRef = useRef<Map<string, LakeEditorInstance | null>>(new Map());
  const autoOpenedRef = useRef(false);
  // 标签保持：本地记录上次打开的标签（按笔记本隔离）
  const TABS_KEY = "lake-notes-mobile.tabs." + notebookId;

  // 目录树长按管理：右键菜单 / 内联重命名 / 图标 / 移动 / 删除
  const [ctxMenu, setCtxMenu] = useState<{ node: NotebookTreeItem; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [iconFor, setIconFor] = useState<NotebookTreeItem | null>(null);
  const [moveFor, setMoveFor] = useState<NotebookTreeItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<NotebookTreeItem | null>(null);
  const [historyFor, setHistoryFor] = useState<NotebookTreeItem | null>(null);
  const [historyList, setHistoryList] = useState<Array<{ id: number; title: string; createdAt: string }>>([]);
  const [historyRestoreId, setHistoryRestoreId] = useState<number | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // 边缘滑动手势（对齐思源移动端）：左边缘右滑→目录抽屉；右边缘左滑→大纲抽屉（互斥）。
  useEdgeSwipe({
    onLeftEdgeSwipe: () => { setSidebarOpen(true); setOutlineOpen(false); },
    onRightEdgeSwipe: () => { setOutlineOpen(true); setSidebarOpen(false); },
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
        const added = [...prev, { id, title: n.title, content: n.content, editing: false, lastAccessedAt: Date.now() }];
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
      const rect = el.getBoundingClientRect();
      setCtxMenu({ node, x: Math.max(8, Math.min(rect.left, window.innerWidth - 220)), y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 200)) });
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
  const applyDelete = useCallback(async () => {
    const n = deleteFor; setDeleteFor(null);
    if (n) { try { await bridge.trashTreeItem(n.id, n.kind === "note" ? "note" : "folder"); await loadTree(); } catch { /* 忽略 */ } }
  }, [deleteFor, loadTree]);
  const applyMove = useCallback(async (targetParentId: string | null) => {
    const n = moveFor; setMoveFor(null);
    if (!n || n.parentId === targetParentId) return;
    try {
      const siblings = tree.filter((x) => x.parentId === targetParentId && x.id !== n.id).map((x) => x.id);
      await bridge.moveTreeNodeOrdered(n.id, targetParentId, [...siblings, n.id]);
      await loadTree();
    } catch { /* 忽略 */ }
  }, [moveFor, tree, loadTree]);

  const openHistory = useCallback(async (node: NotebookTreeItem) => {
    setHistoryFor(node);
    try { setHistoryList(await bridge.listNoteHistory(node.id)); } catch { setHistoryList([]); }
  }, []);
  const applyRestoreHistory = useCallback(async () => {
    const id = historyRestoreId; setHistoryRestoreId(null);
    if (id == null) return;
    try {
      await bridge.restoreHistory(id);
      setHistoryFor(null);
      await loadTree();
    } catch { /* 忽略 */ }
  }, [historyRestoreId, loadTree]);
  const deleteHistory = useCallback(async (historyId: number) => {
    try {
      await bridge.deleteHistory(historyId);
      setHistoryList((prev) => prev.filter((h) => h.id !== historyId));
    } catch { /* 忽略 */ }
  }, []);

  const renderBranch = (parentId: string, depth: number) => {
    const children = childrenOf(parentId);
    return children.map((it) => {
      const hasChildren = childrenOf(it.id).length > 0;
      const NodeIcon = it.kind === "group" ? FolderOpen : FileText;
      const isNote = it.kind === "note";
      return (
        <div key={it.kind + "-" + it.id}>
          <button
            className={"b3-list-item" + (activeId === it.id ? " b3-list-item--selected" : "")}
            style={{ paddingLeft: 12 + depth * 16 }}
            data-node-id={it.id}
            onClick={() => {
              if (renamingId) return;
              if (hasChildren) { toggleGroup(it.id); return; }
              if (isNote) { setSidebarOpen(false); void openTab(it.id); }
            }}
            onTouchStart={(e) => startLongPress(e, it)}
            onTouchMove={clearLongPress}
            onTouchEnd={clearLongPress}
            onTouchCancel={clearLongPress}
            onContextMenu={(e) => { e.preventDefault(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setCtxMenu({ node: it, x: Math.max(8, Math.min(rect.left, window.innerWidth - 220)), y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 200)) }); }}
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
      {/* 顶部栏 */}
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <div className="mobile-topbar-title">{title}</div>
        <button ref={switchBtnRef} className="mobile-icon-btn" onClick={() => {
          const btn = switchBtnRef.current;
          if (btn) {
            const rect = btn.getBoundingClientRect();
            setSwitchPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
          }
          setNotebookSwitchOpen((v) => !v);
        }} aria-label="切换笔记本"><ArrowLeftRight size={20} /></button>
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

      {/* 底部胶囊栏（思源 mobile-bottom-bar）：目录 / tab列表(计数) / 大纲 / 编辑；编辑态由底部工具栏接管（含完成），隐藏 */}
      {!active?.editing && (<nav className="mobile-bottom-bar">
        <button className={(sidebarOpen ? "active" : "") + " bottom-bar-btn"} onClick={() => setSidebarOpen((v) => !v)} aria-label="目录"><Files size={22} /><span className="bottom-bar-label">目录</span></button>
        <button className={"bottom-bar-btn" + (tabsOpen ? " active" : "")} onClick={() => setTabsOpen(true)} aria-label="标签页"><FileText size={22} /><span className="bottom-bar-label">标签</span>{tabs.length > 0 && <span className="bottom-bar-count">{tabs.length}</span>}</button>
        <button className={(outlineOpen ? "active" : "") + " bottom-bar-btn"} onClick={() => setOutlineOpen((v) => !v)} aria-label="大纲"><ListTree size={22} /><span className="bottom-bar-label">大纲</span></button>
        {active && <button className={"bottom-bar-btn" + (active.editing ? " active" : "")} onClick={toggleEdit} aria-label="编辑">{active.editing ? <Check size={22} /> : <Pencil size={22} />}<span className="bottom-bar-label">{active.editing ? "完成" : "编辑"}</span></button>}
      </nav>)}

      {/* 左目录抽屉 (.side-panel) */}
      <div className={"side-mask" + (sidebarOpen ? " on" : "")} onClick={() => setSidebarOpen(false)} />
      <aside className={"side-panel side-panel--left" + (sidebarOpen ? " on" : "")} aria-label="目录">
        <div className="side-panel-head">
          <span className="side-panel-title">{title}</span>
          <div className="side-panel-head-actions">
            <button className="mobile-icon-btn" onClick={() => void createDoc()} aria-label="新建"><Plus size={20} /></button>
            <button className="mobile-icon-btn" onClick={() => setSidebarOpen(false)} aria-label="关闭"><X size={20} /></button>
          </div>
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
            <div className="mobile-model-head">
              <span className="mobile-model-title">标签页</span>
              <button className="mobile-icon-btn" onClick={() => setTabsOpen(false)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-model-body">
              {tabs.length === 0 && <div className="mobile-empty">暂无打开的文档</div>}
              {tabs.map((t) => (
                <div key={t.id} className={"b3-list-item" + (t.id === activeId ? " b3-list-item--selected" : "")} onClick={() => { openTab(t.id); setTabsOpen(false); }}>
                  <span className="b3-list-item__text">{t.title || "无标题"}</span>
                  <button className="b3-list-item__action" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} aria-label="关闭"><X size={16} /></button>
                </div>
              ))}
              <button className="b3-button b3-button--outline model-add" onClick={() => { setTabsOpen(false); setSidebarOpen(true); }}><Plus size={14} />打开文档</button>
            </div>
          </div>
        </div>
      )}

      {/* 笔记本切换下拉（锚定右上角按钮，跟手弹出；目录抽屉已由底部胶囊栏/左边缘手势承担） */}
      {notebookSwitchOpen && switchPos && (
        <div className="mobile-dropdown-mask" onClick={() => setNotebookSwitchOpen(false)}>
          <div className="mobile-dropdown" style={{ top: switchPos.top, right: switchPos.right }} onClick={(e) => e.stopPropagation()}>
            <div className="mobile-dropdown-title">切换笔记本</div>
            <div className="mobile-dropdown-body">
              {notebooks.length === 0 && <p className="mobile-sheet-empty">暂无笔记本</p>}
              {notebooks.map((nb) => (
                <button
                  key={nb.id}
                  className={"b3-list-item" + (nb.id === notebookId ? " b3-list-item--selected" : "")}
                  onClick={() => { setNotebookSwitchOpen(false); if (nb.id !== notebookId) onSwitchNotebook(nb.id); }}
                >
                  <span className="b3-list-item__text">{nb.title}</span>
                  {nb.id === notebookId && <Check size={16} className="b3-list-item__action" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 目录树长按菜单 */}
      {ctxMenu && (
        <div className="mobile-dropdown-mask" onClick={() => setCtxMenu(null)}>
          <div className="mobile-dropdown" style={{ left: ctxMenu.x, top: ctxMenu.y, minWidth: 160 }} onClick={(e) => e.stopPropagation()}>
            <div className="mobile-dropdown-body">
              <button className="b3-list-item" onClick={() => { setRenamingId(ctxMenu.node.id); setRenameValue(ctxMenu.node.title); setCtxMenu(null); }}><Pencil size={16} className="ln-tree-icon" /><span className="b3-list-item__text">重命名</span></button>
              <button className="b3-list-item" onClick={() => { setIconFor(ctxMenu.node); setCtxMenu(null); }}><SmilePlus size={16} className="ln-tree-icon" /><span className="b3-list-item__text">设置图标</span></button>
              <button className="b3-list-item" onClick={() => { setMoveFor(ctxMenu.node); setCtxMenu(null); }}><Move size={16} className="ln-tree-icon" /><span className="b3-list-item__text">移动到…</span></button>
              {ctxMenu.node.kind === "note" && (
                <button className="b3-list-item" onClick={() => { void openHistory(ctxMenu.node); setCtxMenu(null); }}><History size={16} className="ln-tree-icon" /><span className="b3-list-item__text">历史版本</span></button>
              )}
              <button className="b3-list-item" onClick={() => { setDeleteFor(ctxMenu.node); setCtxMenu(null); }}><Trash2 size={16} className="ln-tree-icon" /><span className="b3-list-item__text">删除</span></button>
            </div>
          </div>
        </div>
      )}

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

      {/* 移动目标选择 */}
      {moveFor && (
        <div className="mobile-sheet-mask" onClick={() => setMoveFor(null)}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <span className="mobile-sheet-title">移动「{moveFor.title}」到…</span>
              <button className="mobile-icon-btn" onClick={() => setMoveFor(null)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-sheet-body">
              <button className="b3-list-item" onClick={() => void applyMove(notebookId)}><FolderOpen size={16} className="ln-tree-icon" /><span className="b3-list-item__text">（笔记本根目录）</span></button>
              {tree.filter((x) => x.kind === "group" && x.id !== moveFor.id).map((g) => (
                <button key={g.id} className="b3-list-item" onClick={() => void applyMove(g.id)}><FolderOpen size={16} className="ln-tree-icon" /><span className="b3-list-item__text">{g.title}</span></button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 历史版本 sheet */}
      {historyFor && (
        <div className="mobile-sheet-mask" onClick={() => { setHistoryFor(null); setHistoryRestoreId(null); }}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <span className="mobile-sheet-title">历史版本</span>
              <button className="mobile-icon-btn" onClick={() => { setHistoryFor(null); setHistoryRestoreId(null); }} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-sheet-body">
              {historyList.length === 0 && <p className="mobile-sheet-empty">暂无历史版本</p>}
              {historyList.map((h) => (
                <div key={h.id} className="b3-list-item" onClick={() => setHistoryRestoreId(h.id)}>
                  <span className="b3-list-item__text">{h.title || "无标题"}</span>
                  <span className="b3-list-item__meta">{new Date(h.createdAt).toLocaleString("zh-CN")}</span>
                  <button className="b3-list-item__action" onClick={(e) => { e.stopPropagation(); void deleteHistory(h.id); }} aria-label="删除"><X size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 恢复历史版本确认 */}
      {historyRestoreId != null && (
        <div className="mobile-sheet-mask" onClick={() => setHistoryRestoreId(null)}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head"><span className="mobile-sheet-title">恢复此版本？</span></div>
            <div className="mobile-sheet-body">
              <p className="mobile-sheet-empty">将用该历史版本覆盖当前正文。</p>
              <div className="mobile-model-body">
                <button className="b3-button" onClick={() => setHistoryRestoreId(null)}>取消</button>
                <button className="b3-button ft__error" onClick={() => void applyRestoreHistory()}>恢复</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {deleteFor && (
        <div className="mobile-sheet-mask" onClick={() => setDeleteFor(null)}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head"><span className="mobile-sheet-title">删除「{deleteFor.title}」？</span></div>
            <div className="mobile-sheet-body">
              <p className="mobile-sheet-empty">将移入回收站，可在回收站中恢复或彻底删除。</p>
              <div className="mobile-model-body">
                <button className="b3-button" onClick={() => setDeleteFor(null)}>取消</button>
                <button className="b3-button ft__error" onClick={() => void applyDelete()}>删除</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
