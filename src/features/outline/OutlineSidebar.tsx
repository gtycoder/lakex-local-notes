import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronsDownUp, ChevronsUpDown, Focus, ListOrdered, ListTree, Search } from "lucide-react";
import { DockFilterRow, useDockFilter } from "../../components/DockFilterBar";
import type { OutlineMode } from "./OutlineController";
import { OutlineList } from "./OutlineList";
import { getOutlineTab, getOutlineTabsVersion, subscribeOutlineTabs } from "./registry";
import { OUTLINE_HOVER_HIDE_DELAY_MS } from "./outlineInteraction";

function noopSubscribe(): () => void {
  return () => {};
}
function noopVersion(): number {
  return 0;
}

interface OutlineSidebarProps {
  mode: OutlineMode;
  /** 增强外观（折叠按钮/级别徽标/筛选行）；关闭则渲染接近原生的简洁列表。 */
  enhance?: boolean;
  activeNoteId: string | null;
  width: number;
  minWidth: number;
  maxWidth: number;
  /** rail 顶部的无图标命中区，保留固定/悬停切换能力 */
  onCollapse: () => void;
  onPin: () => void;
  onResizeActiveChange: (active: boolean) => void;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}

/**
 * 右侧大纲栏与左侧资料库遵循同一套布局：
 * - 34px rail 永远占据窗口右缘；
 * - 收起时悬停 rail，面板向左覆盖正文预览；
 * - 点击 rail 顶部的图标按钮固定面板，面板和 rail 共同参与 grid，让编辑器宽度自适应。
 */
export function OutlineSidebar({
  mode,
  enhance = true,
  activeNoteId,
  width,
  minWidth,
  maxWidth,
  onCollapse,
  onPin,
  onResizeActiveChange,
  onWidthChange,
  onWidthCommit,
}: OutlineSidebarProps) {
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
  // 筛选输入框默认隐藏，点头部图标展开（与目录栏共用同一状态机与视觉）
  const filter = useDockFilter(filterDraft, setFilterDraft);
  const filterTimer = useRef<number | null>(null);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [railHovered, setRailHovered] = useState(false);
  const hideHoverTimerRef = useRef<number | null>(null);
  const levelMenuRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; currentWidth: number } | null>(null);
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

  useEffect(() => {
    // 从固定切回悬停时，当前 pointer 仍可能停在 rail 上；先清掉预览，
    // 用户下一次移入时再正常显示，避免刚点击就立刻重新打开。
    setRailHovered(false);
    if (hideHoverTimerRef.current !== null) window.clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = null;
  }, [mode]);

  const cancelHoverHide = () => {
    if (hideHoverTimerRef.current !== null) window.clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = null;
  };
  const scheduleHoverHide = () => {
    if (mode !== "collapsed" || resizeRef.current || hideHoverTimerRef.current !== null) return;
    // 面板是 rail 的视觉溢出区域，不属于 aside 的 layout box；延迟隐藏让
    // pointer 从触发 rail 移入大纲内容时不会先触发 aside pointerleave 把面板卸掉。
    hideHoverTimerRef.current = window.setTimeout(() => {
      hideHoverTimerRef.current = null;
      setRailHovered(false);
    }, OUTLINE_HOVER_HIDE_DELAY_MS);
  };

  // Hover is a union of three explicit rectangles: trigger, bridge and panel.
  // Do not rely on aside pointerleave: the floating panel intentionally extends
  // outside the aside layout box, and that caused the old scrollbar/panel race.
  useEffect(() => {
    if (mode !== "collapsed" || !railHovered) return;
    const onPointerMove = (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      const rects = [
        ".outline-sidebar__trigger",
        ".outline-sidebar__bridge",
        ".outline-sidebar__content",
      ].map((selector) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect()).filter(Boolean) as DOMRect[];
      const inside = rects.some((rect) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
      // While the panel is open, keep the transition corridor alive. It is not
      // a hit target, so the scrollbar remains directly operable, but moving
      // from the 25px trigger into the panel cannot race the hide timer.
      const panel = rects[2];
      const trigger = rects[0];
      const inCorridor = panel && trigger
        && point.x > panel.right && point.x < trigger.left
        && point.y >= Math.max(panel.top, trigger.top)
        && point.y <= Math.min(panel.bottom, trigger.bottom);
      if (inside || inCorridor) cancelHoverHide();
      else scheduleHoverHide();
    };
    window.addEventListener("pointermove", onPointerMove, true);
    return () => window.removeEventListener("pointermove", onPointerMove, true);
  }, [mode, railHovered]);

  const rubberBandWidth = (nextWidth: number) => {
    if (nextWidth < minWidth) return minWidth - (minWidth - nextWidth) * 0.16;
    if (nextWidth > maxWidth) return maxWidth + (nextWidth - maxWidth) * 0.16;
    return nextWidth;
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 与左侧资料库一致：固定态和悬停预览态都可直接拖动面板左边缘。
    // 收起且未悬停时内容/把手不可命中，因此不会误触。
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, currentWidth: width };
    onResizeActiveChange(true);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    // 右侧面板的拖拽边在左：向左拖动变宽，向右拖动变窄。
    const next = rubberBandWidth(resize.startWidth + resize.startX - event.clientX);
    resize.currentWidth = next;
    onWidthChange(next);
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const { clientX, clientY } = event;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onResizeActiveChange(false);
    onWidthCommit(resize.currentWidth);

    // 拖拽时 pointer capture 会让指针暂时离开 aside；在此之前不能关闭预览。
    // 松手后再根据真实落点同步，避免松在编辑器时悬浮面板一直停留。
    if (mode === "collapsed") {
      window.requestAnimationFrame(() => {
        const target = document.elementFromPoint(clientX, clientY);
        if (!asideRef.current?.contains(target)) setRailHovered(false);
      });
    }
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next = width;
    const step = event.shiftKey ? 24 : 8;
    if (event.key === "ArrowLeft") next += step;
    else if (event.key === "ArrowRight") next -= step;
    else if (event.key === "Home") next = minWidth;
    else if (event.key === "End") next = maxWidth;
    else return;
    event.preventDefault();
    const clamped = Math.min(maxWidth, Math.max(minWidth, next));
    onWidthChange(clamped);
    onWidthCommit(clamped);
  };


  const handleOutlineButtonClick = () => {
    if (mode === "collapsed") onPin();
    else onCollapse();
  };

  return (
    <aside
      ref={asideRef}
      className={`outline-sidebar outline-sidebar--${mode}${railHovered ? " outline-sidebar--hovered" : ""}`}
      onPointerEnter={cancelHoverHide}
    >
      {/* 右侧 rail 顶部图标按钮：收起/固定大纲切换。 */}
      <div className="outline-sidebar__bridge" onPointerEnter={cancelHoverHide} onPointerLeave={scheduleHoverHide} aria-hidden="true" />
      <nav className="outline-sidebar__rail" aria-label="右侧工具栏">
        <button
          type="button"
          className={`outline-sidebar__activity-button${mode === "docked" ? " active" : ""}`}
          title={mode === "collapsed" ? "固定大纲" : "取消固定大纲"}
          aria-label={mode === "collapsed" ? "固定大纲" : "取消固定大纲，改为悬停"}
          aria-pressed={mode === "docked"}
          onClick={handleOutlineButtonClick}
        >
          <ListTree size={16} />
        </button>
        <div className="outline-sidebar__rail-fill" />
        {/* 独立触发区：只有右侧窄条感应鼠标进入（rail 视觉宽度与其解耦）。 */}
        <div
          className="outline-sidebar__trigger"
          onPointerEnter={() => { cancelHoverHide(); if (mode === "collapsed") setRailHovered(true); }}
        />
      </nav>

      <div className="outline-sidebar__content" onPointerEnter={() => { cancelHoverHide(); if (mode === "collapsed") setRailHovered(true); }}>
        {enhance && (<div className="outline-sidebar__header">
          <span className="outline-sidebar__spacer" />
          <button
            className={`dock-icon-btn filter-btn${filter.active ? " is-active" : ""}`}
            title="筛选大纲"
            aria-label="筛选大纲"
            aria-pressed={filter.open}
            onClick={filter.toggle}
          >
            <Search size={14} />
          </button>
          <button
            className={`dock-icon-btn keep-current-btn${controller?.isKeepCurrentExpand() ? " is-active" : ""}`}
            title="保持当前展开（选中项自动展开祖先）"
            onClick={() => controller?.setKeepCurrentExpand(!controller.isKeepCurrentExpand())}
          >
            <Focus size={14} />
          </button>
          <button
            className="dock-icon-btn"
            title="展开全部"
            onClick={() => controller?.expandAll()}
          >
            <ChevronsDownUp size={14} />
          </button>
          <button
            className="dock-icon-btn"
            title="折叠全部"
            onClick={() => controller?.collapseAll()}
          >
            <ChevronsUpDown size={14} />
          </button>
          <div className="outline-sidebar__level" ref={levelMenuRef}>
            <button
              className={`dock-icon-btn level-btn${levelMenuOpen ? " is-active" : ""}`}
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
        </div>)}
        {enhance && <DockFilterRow filter={filter} placeholder="筛选大纲" />}
        {controller ? (
          <OutlineList controller={controller} enhance={enhance} onNavigate={(id) => handle?.navigate(id)} />
        ) : (
          <div className="outline-panel__empty">暂无大纲</div>
        )}
        <div
          className="outline-sidebar__resize-handle"
          role="separator"
          aria-label="调整大纲宽度"
          aria-orientation="vertical"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.round(width)}
          tabIndex={mode === "docked" || railHovered ? 0 : -1}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={handleResizeKeyDown}
        />
      </div>
    </aside>
  );
}
