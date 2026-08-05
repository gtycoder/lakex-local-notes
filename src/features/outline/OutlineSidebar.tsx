import { useEffect, useRef, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, ListTree } from "lucide-react";
import type { OutlineMode } from "./OutlineController";
import { OutlineList } from "./OutlineList";
import { getOutlineTab, getOutlineTabsVersion, subscribeOutlineTabs } from "./registry";

interface OutlineSidebarProps {
  mode: OutlineMode;
  activeNoteId: string | null;
  onToggleDock: () => void;
  onPreviewEnter?: () => void;
  onPreviewLeave?: () => void;
}

/** 右侧大纲栏：与左侧 Sidebar 同形态（docked / floating / collapsed） */
export function OutlineSidebar({ mode, activeNoteId, onToggleDock, onPreviewEnter, onPreviewLeave }: OutlineSidebarProps) {
  const version = useSyncExternalStore(subscribeOutlineTabs, getOutlineTabsVersion, getOutlineTabsVersion);
  const handle = getOutlineTab(activeNoteId);
  void version;

  const prevActiveRef = useRef<string | null>(null);
  // 打开/切换标签时刷新选中高亮
  useEffect(() => {
    if (activeNoteId && prevActiveRef.current !== activeNoteId) {
      prevActiveRef.current = activeNoteId;
      handle?.refresh();
    }
  }, [activeNoteId, handle]);
  // 侧栏变为可见（docked/floating）时刷新
  useEffect(() => {
    if (mode !== "collapsed") handle?.refresh();
  }, [mode, handle]);

  const docked = mode === "docked";

  return (
    <aside
      className={`outline-sidebar outline-sidebar--${mode}`}
      onPointerEnter={mode === "collapsed" ? onPreviewEnter : undefined}
      onPointerLeave={mode === "collapsed" ? onPreviewLeave : undefined}
    >
      <div className="outline-sidebar__header">
        <ListTree size={14} />
        <span className="outline-sidebar__title">大纲</span>
        <span className="outline-sidebar__spacer" />
        <button
          className="outline-sidebar__collapse"
          title={docked ? "收起大纲" : "展开大纲"}
          onClick={onToggleDock}
        >
          {docked ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>
      {handle ? (
        <OutlineList controller={handle.controller} onNavigate={handle.navigate} />
      ) : (
        <div className="outline-panel__empty">暂无大纲</div>
      )}
    </aside>
  );
}
