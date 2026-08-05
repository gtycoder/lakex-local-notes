import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronsDownUp, ChevronsUpDown, Focus, ListOrdered, ListTree, MoveDiagonal, Search } from "lucide-react";
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
  mode: OutlineMode;
  activeNoteId: string | null;
  /** 固定 ↔ 悬浮 */
  onToggleFloat: () => void;
}

/** 右侧大纲栏（常驻/悬浮）；头部工具栏：筛选、展开/折叠全部、保持当前展开、固定 */
export function OutlineSidebar({ mode, activeNoteId, onToggleFloat }: OutlineSidebarProps) {
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
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const levelMenuRef = useRef<HTMLDivElement>(null);
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

  // 点击外部关闭「展开到级别」菜单
  useEffect(() => {
    if (!levelMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (levelMenuRef.current && !levelMenuRef.current.contains(e.target as Node)) setLevelMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [levelMenuOpen]);

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

  return (
    <aside className={`outline-sidebar outline-sidebar--${mode}`}>
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
        <div className="outline-sidebar__level" ref={levelMenuRef}>
          <button
            className={`outline-sidebar__btn${levelMenuOpen ? " is-active" : ""}`}
            title="展开到级别"
            onClick={() => setLevelMenuOpen((v) => !v)}
          >
            <ListOrdered size={14} />
          </button>
          {levelMenuOpen && (
            <div className="outline-sidebar__level-menu" role="menu">
              <button role="menuitem" onClick={() => { controller?.expandAll(); setLevelMenuOpen(false); }}>全部展开</button>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} role="menuitem" onClick={() => { controller?.expandToLevel(n); setLevelMenuOpen(false); }}>
                  展开到 {n} 级
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={`outline-sidebar__btn${mode === "floating" ? " is-active" : ""}`}
          title={mode === "docked" ? "设为悬浮" : "固定"}
          onClick={onToggleFloat}
        >
          <MoveDiagonal size={14} />
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
