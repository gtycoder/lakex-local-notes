import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Focus, ListOrdered, ListTree, Search } from "lucide-react";
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
  /** 头部「收起大纲」→ collapsed */
  onCollapse: () => void;
  /** 窄条点击 → docked（常驻） */
  onPin: () => void;
  /** collapsed 窄条 hover → floating */
  onPreviewEnter?: () => void;
  /** floating 移出 → collapsed */
  onPreviewLeave?: () => void;
}

/** 右侧大纲栏：docked 常驻面板 / collapsed 44px 窄条 / floating 悬停浮层 */
export function OutlineSidebar({ mode, activeNoteId, onCollapse, onPin, onPreviewEnter, onPreviewLeave }: OutlineSidebarProps) {
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
  const mountTimeRef = useRef(Date.now());
  void version;
  void controllerVersion;

  // 进入收起态时重置 hover 冷却（窄条刚出现时光标可能正好在上面）
  useEffect(() => {
    if (mode === "collapsed") mountTimeRef.current = Date.now();
  }, [mode]);

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

  // 收起窄条：图标 + 竖排文字，hover 展开、点击常驻
  if (mode === "collapsed") {
    return (
      <aside
        className="outline-sidebar outline-sidebar--collapsed"
        title="大纲"
        onMouseEnter={() => {
          // 收起瞬间光标可能正好在窄条上，短暂冷却避免立刻展开
          if (Date.now() - mountTimeRef.current < 500) return;
          onPreviewEnter?.();
        }}
        onMouseLeave={onPreviewLeave}
        onClick={onPin}
      >
        <ListTree size={16} />
        <span className="outline-sidebar__strip-label">大纲</span>
      </aside>
    );
  }

  return (
    <aside
      className={`outline-sidebar outline-sidebar--${mode}`}
      onMouseEnter={mode === "floating" ? onPreviewEnter : undefined}
      onMouseLeave={mode === "floating" ? onPreviewLeave : undefined}
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
        <button className="outline-sidebar__btn" title="收起大纲" onClick={onCollapse}>
          <ChevronRight size={14} />
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
