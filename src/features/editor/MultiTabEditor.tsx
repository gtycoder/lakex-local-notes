import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  onContentChange: (noteId: string, content: string) => void;
  prefs?: LakeEditorPrefs;
  onEditorReady?: (noteId: string, editor: import("./lakeRuntime").LakeEditorInstance | null) => void;
  topbarActions?: ReactNode;
  emptyAction?: ReactNode;
}

export function MultiTabEditor({
  tabs,
  activeNoteId,
  tocEnabled,
  onTabChange,
  onTabClose,
  onContentChange,
  prefs,
  onEditorReady,
  topbarActions,
  emptyAction,
}: MultiTabEditorProps) {
  const contentCache = useRef<Map<string, string>>(new Map());
  const tabItemsRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);

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
              className={`tab-item ${tab.noteId === activeNoteId ? "active" : ""}${tab.dirty ? " dirty" : ""}`}
              onClick={() => onTabChange(tab.noteId)}
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
            content={contentCache.current.get(tab.noteId) ?? tab.content}
            visible={tab.noteId === activeNoteId}
            tocEnabled={tocEnabled}
            onChange={(content) => handleChange(tab.noteId, content)}
            prefs={prefs}
            onEditorReady={onEditorReady}
          />
        ))}
      </div>
    </div>
  );
}
