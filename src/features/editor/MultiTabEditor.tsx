import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, FileText, Pin, X, XCircle, XOctagon } from "lucide-react";
import { createPortal } from "react-dom";
import { EditorTab } from "./EditorTab";
import type { LakeEditorPrefs } from "./lakeRuntime";

export interface TabInfo {
  noteId: string;
  title: string;
  content: string;
  dirty?: boolean;
  /** 文档自定义图标（emoji） */
  icon?: string | null;
}

interface MultiTabEditorProps {
  tabs: TabInfo[];
  activeNoteId: string | null;
  tocEnabled: boolean;
  onTabChange: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
  /** 拖拽排序：给出新的 noteId 顺序 */
  onTabsReorder?: (noteIds: string[]) => void;
  /** 只读锁的 noteId 集合（驱动 EditorTab viewer 重建） */
  lockedNoteIds?: ReadonlySet<string>;
  onContentChange: (noteId: string, content: string) => void;
  prefs?: LakeEditorPrefs;
  onEditorReady?: (noteId: string, editor: import("./lakeRuntime").LakeEditorInstance | null) => void;
  /** 编辑器右键资料操作（M1.3） */
  onEditorCopyMarkdown?: (noteId: string) => void;
  onEditorExport?: (noteId: string, format: "markdown" | "html" | "lake") => void;
  onEditorCopyPaths?: (noteId: string) => void;
  topbarActions?: ReactNode;
  emptyAction?: ReactNode;
}

export function MultiTabEditor({
  tabs,
  activeNoteId,
  tocEnabled,
  onTabChange,
  onTabClose,
  onTabsReorder,
  lockedNoteIds,
  onContentChange,
  prefs,
  onEditorReady,
  onEditorCopyMarkdown,
  onEditorExport,
  onEditorCopyPaths,
  topbarActions,
  emptyAction,
}: MultiTabEditorProps) {
  const contentCache = useRef<Map<string, string>>(new Map());
  const tabItemsRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [tabCtx, setTabCtx] = useState<{ noteId: string; x: number; y: number } | null>(null);

  // ---- 拖拽排序（pointer 事件，无外部依赖）----
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; active: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const flipRects = useRef<Map<string, number>>(new Map());

  // FLIP：顺序变化时让标签从旧位置滑到新位置
  useLayoutEffect(() => {
    const strip = tabItemsRef.current;
    if (!strip) return;
    const els = [...strip.querySelectorAll<HTMLElement>(".tab-item")];
    for (const el of els) {
      const id = el.dataset.noteId;
      if (!id) continue;
      const prev = flipRects.current.get(id);
      const next = el.getBoundingClientRect().left;
      flipRects.current.set(id, next);
      if (prev != null && Math.abs(prev - next) > 1) {
        el.animate(
          [{ transform: `translateX(${prev - next}px)` }, { transform: "translateX(0)" }],
          { duration: 180, easing: "cubic-bezier(.22, 1, .36, 1)" }
        );
      }
    }
  }, [tabs.map((t) => t.noteId).join("|")]);

  const beginTabDrag = (event: ReactPointerEvent<HTMLButtonElement>, noteId: string) => {
    if (event.button !== 0 || !onTabsReorder) return;
    if ((event.target as HTMLElement).closest(".tab-close")) return;
    dragRef.current = { id: noteId, startX: event.clientX, startY: event.clientY, active: false };
  };

  const moveTabDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.active = true;
      suppressClickRef.current = true;
      setDraggingId(drag.id);
    }
    const strip = tabItemsRef.current;
    if (!strip) return;
    const els = [...strip.querySelectorAll<HTMLElement>(".tab-item")];
    const order = els.map((el) => el.dataset.noteId ?? "");
    const from = order.indexOf(drag.id);
    // 以指针 x 与各标签中心比较，确定插入位置
    let to = from;
    for (let i = 0; i < order.length; i += 1) {
      if (i === from) continue;
      const r = els[i].getBoundingClientRect();
      const center = r.left + r.width / 2;
      if (i < from && event.clientX < center) { to = i; break; }
      if (i > from && event.clientX > center) to = i;
    }
    if (to !== from) {
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, drag.id);
      onTabsReorder?.(next);
    }
  };

  const endTabDrag = () => {
    if (dragRef.current?.active) {
      // 让 click 事件（切换标签）被抑制一次
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    } else {
      suppressClickRef.current = false;
    }
    dragRef.current = null;
    setDraggingId(null);
  };

  const handleChange = useCallback(
    (noteId: string, content: string) => {
      contentCache.current.set(noteId, content);
      onContentChange(noteId, content);
    },
    [onContentChange]
  );

  useEffect(() => {
    const activeIds = new Set(tabs.map((t) => t.noteId));
    for (const key of contentCache.current.keys()) {
      if (!activeIds.has(key)) contentCache.current.delete(key);
    }
  }, [tabs]);

  // tab 被关闭后清理 pinned 记录，避免重新打开同文档时残留钉住状态
  useEffect(() => {
    const activeIds = new Set(tabs.map((t) => t.noteId));
    setPinned((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (activeIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  useEffect(() => {
    if (!tabCtx) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest("[data-context-menu]")) setTabCtx(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabCtx(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tabCtx]);

  useEffect(() => {
    if (!tabMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !switcherRef.current?.contains(event.target)) setTabMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tabMenuOpen]);

  useEffect(() => {
    const activeTab = tabItemsRef.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(activeNoteId ?? "")}"]`);
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeNoteId, tabs.length]);

  const selectTab = (noteId: string) => {
    onTabChange(noteId);
    setTabMenuOpen(false);
  };

  return (
    <div className="multi-tab-editor">
      <div className="tab-bar">
        {topbarActions && <div className="tabbar-actions">{topbarActions}</div>}
        <div className="tab-items" ref={tabItemsRef} role="tablist" aria-label="打开的文档">
          {tabs.map((tab) => (
            <button
              key={tab.noteId}
              data-note-id={tab.noteId}
              className={`tab-item ${tab.noteId === activeNoteId ? "active" : ""}${tab.dirty ? " dirty" : ""}${draggingId === tab.noteId ? " dragging" : ""}${pinned.has(tab.noteId) ? " pinned" : ""}`}
              onPointerDown={(e) => beginTabDrag(e, tab.noteId)}
              onPointerMove={moveTabDrag}
              onPointerUp={endTabDrag}
              onPointerCancel={endTabDrag}
              onClick={() => { if (suppressClickRef.current) return; onTabChange(tab.noteId); }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setTabCtx({ noteId: tab.noteId, x: event.clientX, y: event.clientY });
              }}
              title={tab.title || "无标题"}
              aria-label={`切换到${tab.title || "无标题"}${tab.dirty ? "（有未保存更改）" : ""}`}
              aria-selected={tab.noteId === activeNoteId}
              role="tab"
            >
              {pinned.has(tab.noteId) && <Pin size={11} className="tab-pin" aria-hidden="true" />}
              {tab.icon && <span className="tab-custom-icon" aria-hidden="true">{tab.icon}</span>}
              <span className="tab-title">{tab.title || "无标题"}</span>
              <span
                className="tab-close"
                role="button"
                aria-label={`关闭${tab.title || "无标题"}`}
                title={pinned.has(tab.noteId) ? "钉住的标签只能通过「关闭全部」关闭" : `关闭${tab.title || "无标题"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (pinned.has(tab.noteId)) return; // 钉住标签的 X 由 CSS 隐藏（思源式）
                  onTabClose(tab.noteId);
                }}
              >
                <X size={12} />
              </span>
            </button>
          ))}
        </div>
        {tabs.length > 0 && (
          <div className="tab-switcher-wrap" ref={switcherRef}>
            <button
              className={`tab-switcher ${tabMenuOpen ? "open" : ""}`}
              onClick={() => setTabMenuOpen((open) => !open)}
              aria-label={`切换标签，共 ${tabs.length} 个`}
              aria-haspopup="menu"
              aria-expanded={tabMenuOpen}
              data-tooltip={`切换标签（${tabs.length}）`}
            >
              <ChevronDown size={15} />
            </button>
            {tabMenuOpen && (
              <div className="tab-switcher-menu" role="menu" aria-label="打开的标签">
                <div className="tab-switcher-heading">
                  <strong>打开的标签</strong>
                  <span>{tabs.length}</span>
                </div>
                <div className="tab-switcher-list">
                  {tabs.map((tab) => (
                    <div
                      key={tab.noteId}
                      className={`tab-switcher-item ${tab.noteId === activeNoteId ? "active" : ""}`}
                      role="menuitem"
                    >
                      <button
                        className="tab-switcher-select"
                        onClick={() => selectTab(tab.noteId)}
                        title={tab.title || "无标题"}
                      >
                        <span className="tab-switcher-icon" aria-hidden="true">{tab.icon ?? <FileText size={15} />}</span>
                        <span className="tab-switcher-status" aria-hidden="true">{tab.dirty ? "●" : ""}</span>
                        <span className="tab-switcher-title">{tab.title || "无标题"}</span>
                      </button>
                      <button
                        className="tab-switcher-close"
                        onClick={() => onTabClose(tab.noteId)}
                        aria-label={`关闭${tab.title || "无标题"}`}
                        title={`关闭${tab.title || "无标题"}`}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="tab-panels">
        {tabs.length === 0 ? <section className="empty-workspace"><h2>开始写第一篇笔记</h2>{emptyAction}</section> : tabs.map((tab) => (
          <EditorTab
            key={tab.noteId}
            noteId={tab.noteId}
            locked={lockedNoteIds?.has(tab.noteId) ?? false}
            content={contentCache.current.get(tab.noteId) ?? tab.content}
            visible={tab.noteId === activeNoteId}
            tocEnabled={tocEnabled}
            onChange={(content) => handleChange(tab.noteId, content)}
            prefs={prefs}
            onEditorReady={onEditorReady}
            onEditorCopyMarkdown={onEditorCopyMarkdown}
            onEditorExport={onEditorExport}
            onEditorCopyPaths={onEditorCopyPaths}
          />
        ))}
      </div>
      {tabCtx && (
        <TabContextMenu
          x={tabCtx.x}
          y={tabCtx.y}
          pinned={pinned.has(tabCtx.noteId)}
          canCloseOthers={tabs.length > 1}
          hasLeft={tabs.findIndex((t) => t.noteId === tabCtx.noteId) > 0}
          hasRight={tabs.findIndex((t) => t.noteId === tabCtx.noteId) < tabs.length - 1}
          onTogglePin={() => {
            setPinned((prev) => {
              const next = new Set(prev);
              if (next.has(tabCtx.noteId)) next.delete(tabCtx.noteId);
              else next.add(tabCtx.noteId);
              // 钉住组始终排在最前（思源式固定页签），其余保持原相对顺序
              const ordered = [
                ...tabs.filter((t) => next.has(t.noteId)).map((t) => t.noteId),
                ...tabs.filter((t) => !next.has(t.noteId)).map((t) => t.noteId),
              ];
              onTabsReorder?.(ordered);
              return next;
            });
          }}
          onCloseTab={() => onTabClose(tabCtx.noteId)}
          onCloseOthers={() => {
            for (const t of tabs) {
              if (t.noteId !== tabCtx.noteId && !pinned.has(t.noteId)) onTabClose(t.noteId);
            }
          }}
          onCloseLeft={() => {
            const idx = tabs.findIndex((t) => t.noteId === tabCtx.noteId);
            for (const t of tabs.slice(0, idx)) {
              if (!pinned.has(t.noteId)) onTabClose(t.noteId);
            }
          }}
          onCloseRight={() => {
            const idx = tabs.findIndex((t) => t.noteId === tabCtx.noteId);
            for (const t of tabs.slice(idx + 1)) {
              if (!pinned.has(t.noteId)) onTabClose(t.noteId);
            }
          }}
          onCloseAll={() => {
            // 思源行为：关闭全部也跳过钉住的标签
            for (const t of tabs) {
              if (!pinned.has(t.noteId)) onTabClose(t.noteId);
            }
          }}
          onClose={() => setTabCtx(null)}
        />
      )}
    </div>
  );
}

interface TabContextMenuProps {
  x: number;
  y: number;
  pinned: boolean;
  onTogglePin: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  onCloseAll: () => void;
  canCloseOthers: boolean;
  hasLeft: boolean;
  hasRight: boolean;
  onClose: () => void;
}

const TabContextMenu = ({ x, y, pinned, onTogglePin, onCloseTab, onCloseOthers, onCloseLeft, onCloseRight, onCloseAll, canCloseOthers, hasLeft, hasRight, onClose }: TabContextMenuProps) => {
  const left = Math.min(x, window.innerWidth - 210);
  const top = Math.min(y, window.innerHeight - 280);
  return createPortal(
    <div className="context-menu" style={{ left, top }} role="menu" data-context-menu>
      <button role="menuitem" onClick={() => { onCloseTab(); onClose(); }}><X size={15} /><span>关闭</span></button>
      {canCloseOthers && <button role="menuitem" onClick={() => { onCloseOthers(); onClose(); }}><XCircle size={15} /><span>关闭其他</span></button>}
      {canCloseOthers && <button role="menuitem" onClick={() => { onCloseAll(); onClose(); }}><XOctagon size={15} /><span>关闭全部</span></button>}
      {hasLeft && <button role="menuitem" onClick={() => { onCloseLeft(); onClose(); }}><ChevronsLeft size={15} /><span>关闭左侧</span></button>}
      {hasRight && <button role="menuitem" onClick={() => { onCloseRight(); onClose(); }}><ChevronsRight size={15} /><span>关闭右侧</span></button>}
      <div className="context-menu-sep" />
      <button role="menuitem" onClick={() => { onTogglePin(); onClose(); }}><Pin size={15} /><span>{pinned ? "取消钉住" : "钉住"}</span></button>
    </div>,
    document.body
  );
};
