import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronsDownUp, ChevronsUpDown, Focus, ListTree, Pin, Search } from "lucide-react";
import type { OutlineMode } from "./OutlineController";
import { OutlineList } from "./OutlineList";
import { getOutlineTab, getOutlineTabsVersion, subscribeOutlineTabs } from "./registry";

function noopSubscribe(): () => void {
  return () => {};
}
function noopVersion(): number {
  return 0;
}

interface OutlineSidebarProps {
  mode: Exclude<OutlineMode, "hidden">;
  activeNoteId: string | null;
  /** 固定 ↔ 悬浮（取消固定） */
  onTogglePin: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/** 右侧大纲栏（常驻/悬浮）；头部工具栏：筛选、展开/折叠全部、保持当前展开、固定 */
export function OutlineSidebar({ mode, activeNoteId, onTogglePin, onMouseEnter, onMouseLeave }: OutlineSidebarProps) {
  const version = useSyncExternalStore(subscribeOutlineTabs, getOutlineTabsVersion, getOutlineTabsVersion);
  const handle = getOutlineTab(activeNoteId);
  const controller = handle?.controller ?? null;
  // 头部按钮（保持当前/展开状态等）也需随 controller 变更刷新
  const controllerVersion = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getVersion : noopVersion,
    controller ? controller.getVersion : noopVersion
  );
  const [filterDraft, setFilterDraft] = useState("");
  const filterTimer = useRef<number | null>(null);
  void version;
  void controllerVersion;

  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeNoteId && prevActiveRef.current !== activeNoteId) {
      prevActiveRef.current = activeNoteId;
      handle?.refresh();
    }
  }, [activeNoteId, handle]);
  useEffect(() => {
    handle?.refresh();
  }, [mode, handle]);

  // 筛选输入防抖写入 controller
  useEffect(() => {
    if (filterTimer.current !== null) window.clearTimeout(filterTimer.current);
    filterTimer.current = window.setTimeout(() => {
      controller?.setFilterText(filterDraft);
      filterTimer.current = null;
    }, 150);
    return () => {
      if (filterTimer.current !== null) window.clearTimeout(filterTimer.current);
    };
  }, [filterDraft, controller]);

  const pinned = mode === "docked";

  return (
    <aside
      className={`outline-sidebar outline-sidebar--${mode}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="outline-sidebar__header">
        <ListTree size={14} />
        <span className="outline-sidebar__title">大纲</span>
        <span className="outline-sidebar__spacer" />
        <button
          className={`outline-sidebar__btn${controller?.isKeepCurrentExpand() ? " is-active" : ""}`}
          title="保持当前展开（选中项自动展开祖先）"
          onClick={() => controller?.setKeepCurrentExpand(!controller.isKeepCurrentExpand())}
        >
          <Focus size={14} />
        </button>
        <button
          className="outline-sidebar__btn"
          title="展开全部"
          onClick={() => controller?.expandAll()}
        >
          <ChevronsDownUp size={14} />
        </button>
        <button
          className="outline-sidebar__btn"
          title="折叠全部"
          onClick={() => controller?.collapseAll()}
        >
          <ChevronsUpDown size={14} />
        </button>
        <button
          className={`outline-sidebar__btn${pinned ? " is-active" : ""}`}
          title={pinned ? "取消固定（收起后 hover 右缘悬浮）" : "固定"}
          onClick={onTogglePin}
        >
          <Pin size={14} />
        </button>
      </div>
      <div className="outline-sidebar__filter">
        <Search size={12} />
        <input
          className="outline-sidebar__filter-input"
          placeholder="筛选大纲"
          value={filterDraft}
          onChange={(e) => setFilterDraft(e.target.value)}
          spellCheck={false}
        />
      </div>
      {controller ? (
        <OutlineList controller={controller} onNavigate={(id) => handle?.navigate(id)} />
      ) : (
        <div className="outline-panel__empty">暂无大纲</div>
      )}
    </aside>
  );
}
