import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
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

const MAX_TABS = 8;

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

  return (
    <div className="multi-tab-editor">
      <div className="tab-bar">
        {topbarActions && <div className="tabbar-actions">{topbarActions}</div>}
        {tabs.map((tab) => (
          <button
            key={tab.noteId}
            className={`tab-item ${tab.noteId === activeNoteId ? "active" : ""}${tab.dirty ? " dirty" : ""}`}
            onClick={() => onTabChange(tab.noteId)}
            title={tab.title}
          >
            <span className="tab-title">{tab.title || "无标题"}</span>
            <span
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onTabClose(tab.noteId);
              }}
            >
              <X size={12} />
            </span>
          </button>
        ))}
        {tabs.length < MAX_TABS && (
          <span className="tab-bar-hint" title={`最多 ${MAX_TABS} 个标签`}>{tabs.length} / {MAX_TABS}</span>
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
