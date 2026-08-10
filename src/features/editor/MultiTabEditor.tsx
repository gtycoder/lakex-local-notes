import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import { EditorTab } from "./EditorTab";
import type { LakeEditorPrefs } from "./lakeRuntime";

export interface TabInfo {
  noteId: string;
  title: string;
  content: string;
  dirty?: boolean;
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

  useEffect(() => {
    if (!tabMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !switcherRef.current?.contains(event.target)) setTabMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
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
              className={`tab-item ${tab.noteId === activeNoteId ? "active" : ""}${tab.dirty ? " dirty" : ""}${draggingId === tab.noteId ? " dragging" : ""}`}
              onPointerDown={(e) => beginTabDrag(e, tab.noteId)}
              onPointerMove={moveTabDrag}
              onPointerUp={endTabDrag}
              onPointerCancel={endTabDrag}
              onClick={() => { if (suppressClickRef.current) return; onTabChange(tab.noteId); }}
              title={tab.title || "无标题"}
              aria-label={`切换到${tab.title || "无标题"}${tab.dirty ? "（有未保存更改）" : ""}`}
              aria-selected={tab.noteId === activeNoteId}
              role="tab"
            >
              <span className="tab-title">{tab.title || "无标题"}</span>
              <span
                className="tab-close"
                role="button"
                aria-label={`关闭${tab.title || "无标题"}`}
                title={`关闭${tab.title || "无标题"}`}
                onClick={(event) => {
                  event.stopPropagation();
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
    </div>
  );
}
