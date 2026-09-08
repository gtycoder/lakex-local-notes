/**
 * 第二层工作区（精仿思源移动端）：点笔记本进入 → 文档层(main) + 底部胶囊栏 + 左目录抽屉 + 右大纲抽屉 + 全屏tab列表。
 * 参考 siyuan-master app/src/mobile/dock/MobileFiles.ts / MobileOutline.ts / MobileTabs.ts，
 * 骨架 .mobile-topbar/.mobile-bottom-bar/.side-panel(.side-panel--right)/.side-mask/.model。
 * 多 tab 的「顶部 tab 条」是桌面版；移动端是底部胶囊栏 #toolbarTabs 弹全屏列表（子代理已核对源码）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ListTree, Files, Pencil, X, ChevronRight, FolderOpen, FileText, Plus, Check, ArrowLeftRight } from "lucide-react";
import { bridge } from "../bridge";
import { DocumentEditor } from "../editor/DocumentEditor";
import { OutlineSheet } from "../editor/OutlineSheet";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { useEdgeSwipe } from "../useEdgeSwipe";
import type { POCNote } from "../bridge";
import type { NotebookTreeItem } from "./NotebookPage";
import type { TreeNode } from "../../lib/types";

/** 打开文档 tab 的内容状态（按 tab 缓存，切换不丢草稿） */
interface TabState { id: string; title: string; content: string; editing: boolean; }

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
  const editorsRef = useRef<Map<string, LakeEditorInstance | null>>(new Map());
  const autoOpenedRef = useRef(false);

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

  // 初次进入：自动打开指定文档，或树中第一个文档作为首 tab（仅一次）
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (initialNoteId) { autoOpenedRef.current = true; void openTab(initialNoteId); return; }
    const first = findFirstNote(tree);
    if (first) { autoOpenedRef.current = true; void openTab(first.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const openTab = useCallback((id: string) => {
    setActiveId(id);
    const existing = tabs.find((t) => t.id === id);
    if (existing) return; // 已有 tab：仅切换（keep-alive，不重读正文，避免卡顿）
    void bridge.readNote(id).then((n) => {
      if (!n) return;
      setTabs((prev) => prev.some((t) => t.id === id) ? prev : [...prev, { id, title: n.title, content: n.content, editing: false }]);
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

  const toggleEdit = useCallback(() => {
    if (!active) return;
    if (active.editing) {
      void bridge.saveNote(active.id, active.title, active.content);
    }
    setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, editing: !t.editing } : t)));
  }, [active]);

  const createDoc = useCallback(async () => {
    try {
      const n = await bridge.createNote("无标题文档", notebookId);
      await loadTree();
      setSidebarOpen(false);
      await openTab(n.id);
    } catch { /* 忽略 */ }
  }, [notebookId, loadTree, openTab]);

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
              if (hasChildren) { toggleGroup(it.id); return; }
              if (isNote) { setSidebarOpen(false); void openTab(it.id); }
            }}
          >
            {hasChildren ? <ChevronRight size={16} className={expanded.has(it.id) ? "ln-chevron open" : "ln-chevron"} /> : <span className="ln-chevron-spacer" />}
            <NodeIcon size={16} className="ln-tree-icon" />
            <span className="b3-list-item__text">{it.title}</span>
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
        <button className="mobile-icon-btn" onClick={() => setNotebookSwitchOpen(true)} aria-label="切换笔记本"><ArrowLeftRight size={20} /></button>
      </header>

      {/* 文档层（正文） */}
      <section className="mobile-workspace-body">
        {tabs.length === 0 ? (
          <div className="mobile-empty">暂无打开的文档，点左目录或底部打开</div>
        ) : tabs.map((t) => (
          <div key={t.id} className={"doc-pane" + (t.id === activeId ? " active" : "")}>
            <DocumentEditor
              note={{ id: t.id, title: t.title, content: t.content } as POCNote}
              content={t.content}
              title={t.title}
              editing={t.editing}
              onContentChange={(c) => setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, content: c } : x)))}
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

      {/* 笔记本切换 sheet（右上角入口；目录抽屉已由底部胶囊栏/左边缘手势承担） */}
      {notebookSwitchOpen && (
        <div className="mobile-sheet-mask" onClick={() => setNotebookSwitchOpen(false)}>
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sheet-head">
              <span className="mobile-sheet-title">切换笔记本</span>
              <button className="mobile-icon-btn" onClick={() => setNotebookSwitchOpen(false)} aria-label="关闭"><X size={20} /></button>
            </div>
            <div className="mobile-sheet-body">
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
    </div>
  );
}
