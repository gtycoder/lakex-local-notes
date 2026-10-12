import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { EditorErrorBoundary } from "./EditorErrorBoundary";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { ArrowLeftRight, ChevronDown, ChevronsLeft, ChevronsRight, Columns2, File, GripVertical, MoreHorizontal, Pin, TriangleAlert, X, XCircle, XSquare } from "lucide-react";
import { Menu } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { SplitHandle } from "../../components/ui/SplitHandle";
import { SPLIT_WIDTH_LIMITS, clampSplitLeft } from "./splitGeometry";
import { EditorTab } from "./EditorTab";
import "./splitView.css";

/** 表格编辑器（Univer，按需加载）：只在真的打开表格文档时才进首屏之外的分包。 */
const UniverSheetEditor = lazy(() => import("../usheet/UniverSheetEditor").then((m) => ({ default: m.UniverSheetEditor })));
/** 多维表编辑器（自研，懒加载）：同样只在真的打开多维表文档时才进分包。 */
const BitableEditor = lazy(() => import("../bitable/BitableEditor").then((m) => ({ default: m.BitableEditor })));
/** 画板编辑器（Drawnix/Plait 引擎，懒加载）：只在真的打开画板文档时才进分包（≈511KB gzip）。 */
const BoardEditor = lazy(() => import("../board/BoardEditor").then((m) => ({ default: m.BoardEditor })));
import type { LakeEditorPrefs } from "./lakeRuntime";

const EMPTY_PINNED: ReadonlySet<string> = new Set();

export interface TabInfo {
  noteId: string;
  title: string;
  content: string;
  dirty?: boolean;
  /** 文档自定义图标（emoji） */
  icon?: string | null;
  /** P1：恢复历史后 bump，强制 EditorTab 重建（key 的一部分） */
  reloadKey?: number;
  /** 远端已删除（软删/墓碑/purge）：tab 显示"已删除"标记，正文保留供复制/恢复。 */
  deleted?: boolean;
  /** v6/v7 文档类型（doc | usheet | bitable | board；缺省 doc）。 */
  kind?: "doc" | "usheet" | "bitable" | "board";
}

interface MultiTabEditorProps {
  tabs: TabInfo[];
  activeNoteId: string | null;
  tocEnabled: boolean;
  outlineEnhance: boolean;
  onTabChange: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
  /** 拖拽排序：给出新的 noteId 顺序 */
  onTabsReorder?: (noteIds: string[]) => void;
  /** 只读锁的 noteId 集合（驱动 EditorTab viewer 重建） */
  lockedNoteIds?: ReadonlySet<string>;
  /** 锁定/解锁当前活动文档（多维表右上角菜单用；由上层处理持久化与状态）。 */
  onToggleNoteLock?: () => void;
  /** 多维表「导出 CSV」（来自多维表右上角菜单，走上层导出管线）。 */
  onExportBitableCsv?: (noteId: string) => void;
  /** 当前活动标签在回收站/已被他端 purge：顶部横幅 + 只读（见 tab.deleted）。 */
  onOpenTrash?: () => void;
  /** 钉住的标签（由上层持有，保证关闭/自动淘汰时能感知钉住状态）。 */
  pinnedNoteIds?: ReadonlySet<string>;
  /** 切换标签钉住状态（由上层更新状态）。 */
  onTogglePin?: (noteId: string) => void;
  onContentChange: (noteId: string, content?: string) => void;
  onPreserveBitableDraft?: (noteId: string, content: string) => void;
  /** 工作区级可见性（keep-alive：外部隐藏整个工作区时把所有 tab 视为不可见，切回时触发重新水合） */
  visible?: boolean;
  prefs?: LakeEditorPrefs;
  onEditorReady?: (noteId: string, editor: import("./lakeRuntime").LakeEditorInstance | null) => void;
  /** 审计 F15：usheet/Board 注册按需同步序列化（关闭/保存/退出时现取），null 表示卸载。 */
  onEditorCapture?: (noteId: string, capture: (() => string | null) | null) => void;
  /** 外部改动正文后重载该文档 tab（附件重命名用） */
  onReloadNote?: (noteId: string) => void;
  /** 顶栏左侧元素（工作空间/云同步），渲染在标签左侧，与多 tab 融合成一条顶栏 */
  topbarLeading?: ReactNode;
  /** 顶栏右侧元素（外观/更多），渲染在标签最右侧 */
  topbarTrailing?: ReactNode;
  emptyAction?: ReactNode;
  /** 面包屑（261008）：按 noteId 取该文档的笔记本名；由 EditorTab **自渲染**（每栏一条、随栏宽收缩）。 */
  notePathTitle?: (noteId: string) => string | null;
  /** 面包屑右端「更多」的锚点 + 回调（只在单栏时由焦点栏渲染）。 */
  moreMenuWrapRef?: RefObject<HTMLDivElement>;
  onToggleMoreMenu?: () => void;
  /** 分屏（261008）：左右两栏的文档；null = 未分屏。最多两栏、不同文档、临时不持久化。
   *  标签栏里这两页渲染成**一个合并标签**；点它才显示分屏区域。 */
  splitPair?: { left: string; right: string } | null;
  /** 点合并标签 = 回到分屏区域。 */
  onActivateSplit?: () => void;
  /** 合并标签上的 × = 取消分屏（两个标签都保留）。 */
  onCloseSplit?: () => void;
  /** 取消分屏（右栏标签仍保留在标签栏，只是回到单栏）。 */
  onExitSplit?: () => void;
  /** 左右位置互换（焦点跟随文档 ⇒ 视觉上焦点移到另一侧）。 */
  onSwapSplit?: () => void;
}

export function MultiTabEditor({
  tabs,
  activeNoteId,
  tocEnabled,
  outlineEnhance,
  onTabChange,
  onTabClose,
  onTabsReorder,
  lockedNoteIds,
  onToggleNoteLock,
  onExportBitableCsv,
  pinnedNoteIds,
  onTogglePin,
  onContentChange,
  onPreserveBitableDraft,
  visible = true,
  prefs,
  onEditorReady,
  onEditorCapture,
  onReloadNote,
  onOpenTrash,
  topbarLeading,
  topbarTrailing,
  emptyAction,
  notePathTitle,
  moreMenuWrapRef,
  onToggleMoreMenu,
  splitPair = null,
  onActivateSplit,
  onCloseSplit,
  onExitSplit,
  onSwapSplit,
}: MultiTabEditorProps) {
  // 审计 §7.3：不再持有第二份可写正文（旧 contentCache/reloadKeysRef 已删）——
  // tab.content 只表示「最后已提交版本」；实时正文由 EditorTab 捕获、保存/草稿/关闭时按需 capture；
  // 外部刷新仍靠 key=noteId-reloadKey 重挂载 + tab.content 提供新正文。
  const tabItemsRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  /** tab 切换按钮（portal 弹窗的 fixed 定位锚点） */
  const switcherButtonRef = useRef<HTMLButtonElement>(null);
  /** portal 弹窗自身（外点关闭判定需要包含它） */
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [tabMenuWidth, setTabMenuWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("lake-notes-v3.tab-switcher-width"));
    return Number.isFinite(v) && v >= 160 && v <= 440 ? v : 220;
  });
  const tabMenuWidthRef = useRef(tabMenuWidth);
  const startTabMenuResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = tabMenuWidthRef.current;
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(440, Math.max(160, startW + (startX - ev.clientX)));
      tabMenuWidthRef.current = next;
      setTabMenuWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      writeLocalStorage("lake-notes-v3.tab-switcher-width", String(tabMenuWidthRef.current));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  /** portal 弹窗锚定在切换按钮正下方（fixed，脱离 .tab-bar 层叠上下文）。 */
  const tabMenuStyle = useMemo((): React.CSSProperties | undefined => {
    if (!tabMenuOpen) return undefined;
    const anchor = switcherButtonRef.current?.getBoundingClientRect();
    if (!anchor) return undefined;
    return {
      position: "fixed",
      top: anchor.bottom + 8,
      right: Math.max(8, window.innerWidth - anchor.right),
      width: tabMenuWidth,
      maxHeight: `min(470px, calc(100vh - ${anchor.bottom + 8}px - 16px))`,
    };
  }, [tabMenuOpen, tabMenuWidth]);

  const tabMenuAnchor = useMemo(
    () => <span aria-hidden="true" style={{ position: "fixed", left: -9999, top: 0, width: 1, height: 1 }} />,
    []
  );
  const pinned = pinnedNoteIds ?? EMPTY_PINNED;
  const [tabCtx, setTabCtx] = useState<{ noteId: string; x: number; y: number } | null>(null);

  // ---- 分屏（261008）：左右两栏、最多两个、不同文档、临时不持久化 ----
  const panelsRef = useRef<HTMLDivElement>(null);
  /** 左栏宽度（px）；null = 没拖过，两栏平分（CSS 的 1fr）。拖过只活在本次会话。 */
  const [splitLeft, setSplitLeft] = useState<number | null>(null);
  useEffect(() => { if (!splitPair) setSplitLeft(null); }, [splitPair]);
  /** 容器实测宽度：缩窗 / 开关目录栏 / 开关大纲栏都会改变它（261012 修「变窄后右栏塌成 0」）。 */
  const [panelsWidth, setPanelsWidth] = useState(0);
  useEffect(() => {
    const el = panelsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => el.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const width = read();
      setPanelsWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
    });
    ro.observe(el);
    setPanelsWidth(read());
    return () => ro.disconnect();
  }, []);
  /** 实际生效的左栏宽度（px）；null = 没拖过，两栏平分（CSS 的 1fr）。几何口径见 splitGeometry.ts。 */
  const effectiveSplitLeft = useMemo(
    () => (splitLeft == null ? null : clampSplitLeft(panelsWidth, splitLeft)),
    [splitLeft, panelsWidth],
  );
  /** 分屏组是否**当前激活**（焦点在组内两页之一）：只有激活时才显示两栏；
   *  点别的标签 = 普通单栏（合并标签仍在，点它再回分屏）。 */
  const splitActive = useMemo(
    () => splitPair != null && activeNoteId != null && (activeNoteId === splitPair.left || activeNoteId === splitPair.right),
    [splitPair, activeNoteId],
  );
  /** 合并标签挂在组内更靠前那页的位置；任一侧不在已开标签里 → null（自愈）。 */
  const splitFirstNote = useMemo(() => {
    if (!splitPair) return null;
    const li = tabs.findIndex((t) => t.noteId === splitPair.left);
    const ri = tabs.findIndex((t) => t.noteId === splitPair.right);
    if (li < 0 || ri < 0) return null;
    return li <= ri ? splitPair.left : splitPair.right;
  }, [splitPair, tabs]);
  const splitLeftTab = useMemo(() => (splitPair ? tabs.find((t) => t.noteId === splitPair.left) ?? null : null), [splitPair, tabs]);
  const splitRightTab = useMemo(() => (splitPair ? tabs.find((t) => t.noteId === splitPair.right) ?? null : null), [splitPair, tabs]);
  /** 本标签显示在哪一栏：分屏组**激活**时 left/right，否则恒 null。 */
  const paneOf = useCallback((noteId: string): "left" | "right" | null => {
    if (!splitActive || !splitPair) return null;
    if (noteId === splitPair.left) return "left";
    if (noteId === splitPair.right) return "right";
    return null;
  }, [splitActive, splitPair]);
  /** 本标签是否显示：分屏组激活时两栏都显示（右栏非焦点由 data-pane-visible 放行）；否则只有焦点标签。 */
  const paneVisible = useCallback((noteId: string) => (splitActive && splitPair ? paneOf(noteId) != null : noteId === activeNoteId), [splitActive, splitPair, paneOf, activeNoteId]);
  const measureSplitLeft = useCallback(() => {
    const first = panelsRef.current?.querySelector<HTMLElement>('[data-pane="left"]');
    return first ? first.getBoundingClientRect().width : 320;
  }, []);
  /** 点进任一栏即把焦点切到该栏（焦点栏决定 data-active / 面包屑 / 大纲 / 快捷键）。 */
  const handlePanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitActive || !splitPair) return;
    const host = (event.target as HTMLElement).closest<HTMLElement>("[data-pane]");
    const pane = host?.getAttribute("data-pane");
    const noteId = pane === "left" ? splitPair.left : pane === "right" ? splitPair.right : null;
    if (noteId && noteId !== activeNoteId) onTabChange(noteId);
  }, [splitActive, splitPair, activeNoteId, onTabChange]);

  // ---- 拖拽排序（pointer 事件，无外部依赖）----
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; active: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const flipRects = useRef<Map<string, number>>(new Map());

  // P2-6：关闭标签时清掉 FLIP 位置记忆，防残留（长会话累积 + 重开同笔记时误播滑入动画）
  const handleTabClose = useCallback((noteId: string) => {
    flipRects.current.delete(noteId);
    onTabClose(noteId);
  }, [onTabClose]);

  // FLIP：顺序变化时让标签从旧位置滑到新位置（deps 用 memo 化的 orderKey，
  // tabs 引用不变时跳过拼接与比较）
  const tabOrderKey = useMemo(() => tabs.map((t) => t.noteId).join("|"), [tabs]);
  // 活动标签是否"已在回收站/被他端 purge"：只读 + 顶部横幅（tab.deleted 由 openNote/同步刷新判定）
  const activeTabGone = tabs.some((t) => t.noteId === activeNoteId && t.deleted === true);
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
  }, [tabOrderKey]);

  const beginTabDrag = (event: ReactPointerEvent<HTMLButtonElement>, noteId: string) => {
    if (event.button !== 0 || !onTabsReorder || splitPair) return;   // 分屏组期间禁用拖拽（合并标签≠单 noteId）
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
    (noteId: string, content?: string) => {
      onContentChange(noteId, content);
    },
    [onContentChange]
  );

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
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (switcherRef.current?.contains(target)) return;
      if (tabMenuRef.current?.contains(target)) return;
      setTabMenuOpen(false);
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

  /** 空闲预热「表格编辑器」模块（Univer 分包）：**纯预取、不渲染**，且**只在 dev 生效**。
   *  实测（261010，隔离实例 + CDP）：首次打开表格的「点击 → 宿主挂载」这段在 dev 要 **1.86s**
   *  （Vite 逐个下发 dev 模块 + 未压缩代码执行，与点击无关），打包（scheme）只要 0.14s。
   *  ⇒ dev 下把它挪到空闲时段；打包侧保持**真懒加载**（不为一个 0.14s 的收益常驻解析 6.3MB 分包）。 */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let idleId: number | undefined;
    let timerId: number | undefined;
    const warm = () => { void import("../usheet/UniverSheetEditor"); };
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => { if (idleId !== undefined) window.cancelIdleCallback(idleId); };
    }
    timerId = window.setTimeout(warm, 2500);
    return () => { if (timerId !== undefined) window.clearTimeout(timerId); };
  }, []);

  useEffect(() => {
    const strip = tabItemsRef.current;
    if (!strip) return;
    const activeTab = strip.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(activeNoteId ?? "")}"]`)
      ?? (splitActive ? strip.querySelector<HTMLElement>("[data-split-group]") : null);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeNoteId, tabs.length, splitActive]);

  /** 鼠标没有横向滚轮时，用垂直滚轮驱动顶部 tab 的横向滚动。
   * 触控板产生的 deltaX 保持原生行为；原生非 passive listener 才能安全 preventDefault。 */
  const handleTabWheel = useCallback((event: WheelEvent) => {
    const strip = tabItemsRef.current;
    if (!strip) return;
    const maxScrollLeft = strip.scrollWidth - strip.clientWidth;
    if (maxScrollLeft <= 0) return;

    const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;

    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, strip.scrollLeft + delta));
    if (nextScrollLeft === strip.scrollLeft) return;

    event.preventDefault();
    strip.scrollLeft = nextScrollLeft;
  }, []);

  useEffect(() => {
    const strip = tabItemsRef.current;
    if (!strip) return;
    strip.addEventListener("wheel", handleTabWheel, { passive: false });
    return () => strip.removeEventListener("wheel", handleTabWheel);
  }, [handleTabWheel]);

  const selectTab = (noteId: string) => {
    onTabChange(noteId);
    setTabMenuOpen(false);
  };

  return (
    <div className="multi-tab-editor">
      <div className="tab-bar">
        {topbarLeading && <div className="tabbar-leading">{topbarLeading}</div>}
        <div className="tab-items" ref={tabItemsRef} role="tablist" aria-label="打开的文档">
          {tabs.map((tab) => (
            splitPair && splitFirstNote != null && (tab.noteId === splitPair.left || tab.noteId === splitPair.right) ? (
              tab.noteId === splitFirstNote ? (
                <button
                  key="__split_group__"
                  type="button"
                  className={`tab-item tab-split-tab${splitActive ? " active" : ""}`}
                  data-split-group="true"
                  role="tab"
                  aria-selected={splitActive}
                  title={`分屏：${splitLeftTab?.title || "无标题"} ｜ ${splitRightTab?.title || "无标题"}`}
                  aria-label={`分屏组：${splitLeftTab?.title || "无标题"}${splitLeftTab?.deleted ? "（已删除）" : ""} ｜ ${splitRightTab?.title || "无标题"}${splitRightTab?.deleted ? "（已删除）" : ""}`}
                  onClick={() => { if (suppressClickRef.current) return; onActivateSplit?.(); }}
                >
                  <span className="tab-split-tab__half">
                    {splitLeftTab && pinned.has(splitLeftTab.noteId) && <Pin size={12} className="tab-pin" aria-hidden="true" />}
                    {splitLeftTab?.icon && <span className="tab-custom-icon" aria-hidden="true">{splitLeftTab.icon}</span>}
                    <span className="tab-title">{splitLeftTab?.title || "无标题"}</span>
                    {splitLeftTab?.dirty && <span className="tab-dirty-dot" aria-label="有未保存更改" />}
                    {splitLeftTab?.deleted && <span className="tab-deleted-badge" title="该侧文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写">已删除</span>}
                  </span>
                  <span className="tab-split-tab__divider" aria-hidden="true" />
                  <span className="tab-split-tab__half">
                    <Columns2 size={12} className="tab-split-tab__glyph" aria-hidden="true" />
                    {splitRightTab && pinned.has(splitRightTab.noteId) && <Pin size={12} className="tab-pin" aria-hidden="true" />}
                    <span className="tab-title">{splitRightTab?.title || "无标题"}</span>
                    {splitRightTab?.dirty && <span className="tab-dirty-dot" aria-label="有未保存更改" />}
                    {splitRightTab?.deleted && <span className="tab-deleted-badge" title="该侧文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写">已删除</span>}
                  </span>
                  <span
                    className="tab-close"
                    role="button"
                    aria-label="取消分屏"
                    title="取消分屏（两个标签都保留）"
                    onClick={(event) => { event.stopPropagation(); onCloseSplit?.(); }}
                  >
                    <X size={12} />
                  </span>
                </button>
              ) : null
            ) : (
            <button
              key={tab.noteId}
              data-note-id={tab.noteId}
              className={`tab-item ${tab.noteId === activeNoteId ? "active" : ""}${tab.dirty ? " dirty" : ""}${tab.deleted ? " deleted" : ""}${draggingId === tab.noteId ? " dragging" : ""}${pinned.has(tab.noteId) ? " pinned" : ""}`}
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
              aria-label={`切换到${tab.title || "无标题"}${tab.dirty ? "（有未保存更改）" : ""}${tab.deleted ? "（已删除）" : ""}`}
              aria-selected={tab.noteId === activeNoteId}
              role="tab"
            >
              {pinned.has(tab.noteId) && <Pin size={12} className="tab-pin" aria-hidden="true" />}
              {tab.icon && <span className="tab-custom-icon" aria-hidden="true">{tab.icon}</span>}
              <span className="tab-title">{tab.title || "无标题"}</span>
              {tab.dirty && <span className="tab-dirty-dot" aria-label="有未保存更改" />}
              {tab.deleted && <span className="tab-deleted-badge" title="文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写">已删除</span>}
              <span
                className="tab-close"
                role="button"
                aria-label={`关闭${tab.title || "无标题"}`}
                title={pinned.has(tab.noteId) ? "钉住的标签只能通过「关闭全部」关闭" : `关闭${tab.title || "无标题"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (pinned.has(tab.noteId)) return; // 钉住标签的 X 由 CSS 隐藏（思源式）
                  handleTabClose(tab.noteId);
                }}
              >
                <X size={12} />
              </span>
            </button>
            )
          ))}
        </div>
        {tabs.length > 0 && (
          <div className="tab-switcher-wrap" ref={switcherRef}>
            <button
              ref={switcherButtonRef}
              className={`tab-switcher ${tabMenuOpen ? "open" : ""}`}
              onClick={() => setTabMenuOpen((open) => !open)}
              aria-label={`切换标签，共 ${tabs.length} 个`}
              aria-haspopup="menu"
              aria-expanded={tabMenuOpen}
              data-tooltip={`切换标签（${tabs.length}）`}
            >
              <ChevronDown size={15} />
              {tabMenuAnchor}
            </button>
            {tabMenuOpen && (
              <Menu surfaceClassName="tab-switcher-menu" label="打开的标签" onDismiss={() => setTabMenuOpen(false)} surfaceRef={tabMenuRef} style={tabMenuStyle}>
                <div className="tab-switcher-resize" onPointerDown={startTabMenuResize} title="拖动调整宽度" />
                <div className="tab-switcher-heading">
                  <strong>打开的标签</strong>
                  <span>{tabs.length}</span>
                </div>
                <div className="tab-switcher-list">
                  {tabs.map((tab) => (
                    <div
                      key={tab.noteId}
                      className={`tab-switcher-item ${tab.noteId === activeNoteId ? "active" : ""}${tab.deleted ? " deleted" : ""}`}
                      role="menuitem"
                    >
                      <button
                        className="tab-switcher-select"
                        onClick={() => selectTab(tab.noteId)}
                        title={tab.title || "无标题"}
                      >
                        <span className="tab-switcher-icon" aria-hidden="true">{tab.icon ?? <File size={15} />}</span>
                        <span className="tab-switcher-status" aria-hidden="true">{tab.dirty ? "●" : ""}</span>
                        <span className="tab-switcher-title ln-ellipsis">{tab.title || "无标题"}</span>
                        {tab.deleted && <span className="tab-deleted-badge" title="文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写">已删除</span>}
                      </button>
                      <button
                        className="tab-switcher-close"
                        onClick={() => handleTabClose(tab.noteId)}
                        aria-label={`关闭${tab.title || "无标题"}`}
                        title={`关闭${tab.title || "无标题"}`}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </Menu>
            )}
          </div>
        )}
        {topbarTrailing && <div className="tabbar-trailing">{topbarTrailing}</div>}
      </div>
      {activeTabGone && (
        <div className="tab-gone-banner" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>该文档在回收站中：只读、编辑不会保存。需要继续写请先恢复。</span>
          {onOpenTrash && <button type="button" onClick={onOpenTrash}>打开回收站</button>}
        </div>
      )}
      <div
        ref={panelsRef}
        className={`tab-panels${splitActive ? " is-split" : ""}`}
        style={splitActive && effectiveSplitLeft != null ? ({ "--split-left": `${effectiveSplitLeft}px` } as React.CSSProperties) : undefined}
        onPointerDownCapture={handlePanePointerDown}
      >
        {tabs.length === 0 ? <section className="empty-workspace">
          <span className="empty-workspace-icon" aria-hidden="true"><File size={24} /></span>
          <h2>开始写第一篇笔记</h2>
          <p className="empty-workspace-hint">新建文档开始记录，或按 ⌘K 搜索已有笔记</p>
          {emptyAction}
        </section> : <Suspense fallback={<div className="empty-workspace-hint">正在加载表格编辑器…</div>}>{tabs.map((tab) => (
          tab.kind === "usheet" ? (
            <EditorErrorBoundary key={"us-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
              <UniverSheetEditor
                noteId={tab.noteId}
                content={tab.content}
                visible={visible && paneVisible(tab.noteId)}
                focused={tab.noteId === activeNoteId}
                pane={paneOf(tab.noteId)}
                readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
                onChange={(content) => handleChange(tab.noteId, content)}
                onDirty={() => handleChange(tab.noteId)}
                onEditorCapture={(capture) => onEditorCapture?.(tab.noteId, capture)}
              />
            </EditorErrorBoundary>
          ) : tab.kind === "bitable" ? (
            <EditorErrorBoundary key={"bt-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
              <BitableEditor
                noteId={tab.noteId}
                content={tab.content}
                visible={visible && paneVisible(tab.noteId)}
                focused={tab.noteId === activeNoteId}
                pane={paneOf(tab.noteId)}
                readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
                locked={lockedNoteIds?.has(tab.noteId) ?? false}
                onToggleLock={onToggleNoteLock && tab.deleted !== true ? onToggleNoteLock : undefined}
                onExportCsv={onExportBitableCsv ? () => onExportBitableCsv(tab.noteId) : undefined}
                onChange={(content) => handleChange(tab.noteId, content)}
                onDirty={() => handleChange(tab.noteId)}
                onEditorCapture={(capture) => onEditorCapture?.(tab.noteId, capture)}
                onPreserveDraft={onPreserveBitableDraft ? (content) => onPreserveBitableDraft(tab.noteId, content) : undefined}
              />
            </EditorErrorBoundary>
          ) : tab.kind === "board" ? (
            <EditorErrorBoundary key={"bd-" + tab.noteId + "-" + (tab.reloadKey ?? 0)} noteId={tab.noteId}>
              <BoardEditor
                noteId={tab.noteId}
                content={tab.content}
                visible={visible && paneVisible(tab.noteId)}
                focused={tab.noteId === activeNoteId}
                pane={paneOf(tab.noteId)}
                readOnly={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
                onChange={(content) => handleChange(tab.noteId, content)}
                onDirty={() => handleChange(tab.noteId)}
                onEditorCapture={(capture) => onEditorCapture?.(tab.noteId, capture)}
              />
            </EditorErrorBoundary>
          ) : (
          <EditorTab
            key={`${tab.noteId}-${tab.reloadKey ?? 0}`}
            noteId={tab.noteId}
            locked={(lockedNoteIds?.has(tab.noteId) ?? false) || tab.deleted === true}
            content={tab.content}
            visible={visible && paneVisible(tab.noteId)}
            focused={tab.noteId === activeNoteId}
            pane={paneOf(tab.noteId)}
            pathTitle={notePathTitle?.(tab.noteId) ?? null}
            moreMenuWrapRef={moreMenuWrapRef}
            onToggleMoreMenu={onToggleMoreMenu}
            tocEnabled={tocEnabled}
            outlineEnhance={outlineEnhance}
            onChange={() => handleChange(tab.noteId)}
            prefs={prefs}
            onEditorReady={onEditorReady}
            onReloadNote={onReloadNote}
          />
          )
        ))}</Suspense>}
        {splitActive && (
          <SplitHandle
            ariaLabel="调整分屏宽度"
            minWidth={SPLIT_WIDTH_LIMITS.minLeft}
            maxWidth={SPLIT_WIDTH_LIMITS.maxLeft}
            minRight={SPLIT_WIDTH_LIMITS.minRight}
            containerRef={panelsRef}
            /* 传**生效宽度**：没拖过时也给出实测的一半 ⇒ 分隔条有 aria-valuenow，且拖拽起点与视觉一致。
               用户期望值仍只存在 splitLeft（session-only），容器变化不会把它写坏。 */
            width={effectiveSplitLeft ?? (panelsWidth > 0 ? Math.round(panelsWidth / 2) : null)}
            measureLeft={measureSplitLeft}
            onPreview={setSplitLeft}
            onCommit={(next) => setSplitLeft(next)}
          />
        )}
        {splitActive && <SplitPaneControls onExit={() => onExitSplit?.()} onSwap={() => onSwapSplit?.()} />}
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
            const next = new Set(pinned);
            if (next.has(tabCtx.noteId)) next.delete(tabCtx.noteId);
            else next.add(tabCtx.noteId);
            // 钉住组始终排在最前（思源式固定页签），其余保持原相对顺序
            const ordered = [
              ...tabs.filter((t) => next.has(t.noteId)).map((t) => t.noteId),
              ...tabs.filter((t) => !next.has(t.noteId)).map((t) => t.noteId),
            ];
            onTabsReorder?.(ordered);
            onTogglePin?.(tabCtx.noteId);
          }}
          onCloseTab={() => handleTabClose(tabCtx.noteId)}
          onCloseOthers={() => {
            for (const t of tabs) {
              if (t.noteId !== tabCtx.noteId && !pinned.has(t.noteId)) handleTabClose(t.noteId);
            }
          }}
          onCloseLeft={() => {
            const idx = tabs.findIndex((t) => t.noteId === tabCtx.noteId);
            for (const t of tabs.slice(0, idx)) {
              if (!pinned.has(t.noteId)) handleTabClose(t.noteId);
            }
          }}
          onCloseRight={() => {
            const idx = tabs.findIndex((t) => t.noteId === tabCtx.noteId);
            for (const t of tabs.slice(idx + 1)) {
              if (!pinned.has(t.noteId)) handleTabClose(t.noteId);
            }
          }}
          onCloseAll={() => {
            // 思源行为：关闭全部也跳过钉住的标签
            for (const t of tabs) {
              if (!pinned.has(t.noteId)) handleTabClose(t.noteId);
            }
          }}
          onClose={() => setTabCtx(null)}
        />
      )}
    </div>
  );
}


/** 分屏浮动工具条（用户 261008 定稿）：浮在两栏之上、**按住可拖到任意位置**；
 *  内容 = 拖拽把手 + `⋯` 菜单（取消分屏 / 左右互换）+ `×`。位置只存内存（分屏本身临时、不持久化）。 */
function SplitPaneControls({ onExit, onSwap }: { onExit: () => void; onSwap: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const { surfaceRef, style } = usePopoverPosition({ open, anchor: btnRef.current, align: "end" });
  /** Menu 是 portal 到 body 的：outside-dismiss 必须把浮层表面也算「里面」，否则真实鼠标 pointerdown 会先把菜单关掉、选择被吞。 */
  const setMenuRef = useCallback((el: HTMLElement | null) => { menuRef.current = el; surfaceRef(el); }, [surfaceRef]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-split-controls]") && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** 按住工具条（按钮以外）拖动：坐标相对分栏容器、夹在容器内；只写内存。 */
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const pill = pillRef.current;
    const container = pill?.offsetParent as HTMLElement | null;
    if (!pill || !container) return;
    event.preventDefault();
    const pillRect = pill.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originLeft = pillRect.left - box.left;
    const originTop = pillRect.top - box.top;
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const maxLeft = Math.max(0, box.width - pillRect.width);
      const maxTop = Math.max(0, box.height - pillRect.height);
      const x = Math.max(0, Math.min(originLeft + (ev.clientX - startX), maxLeft));
      const y = Math.max(0, Math.min(originTop + (ev.clientY - startY), maxTop));
      setPos({ x, y });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  return (
    <div
      ref={pillRef}
      className={`tab-split-controls${dragging ? " is-dragging" : ""}`}
      data-split-controls
      style={pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined}
      onPointerDown={onPointerDown}
      title="按住拖动可移到任意位置"
    >
      <span className="tab-split-grip" aria-hidden="true"><GripVertical size={14} /></span>
      <button
        ref={btnRef}
        type="button"
        className="ln-iconbtn ln-iconbtn--compact tab-split-btn"
        aria-label="分屏选项"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={15} />
      </button>
      <button type="button" className="ln-iconbtn ln-iconbtn--compact tab-split-btn" aria-label="取消分屏" onClick={onExit}>
        <X size={14} />
      </button>
      {open && (
        <Menu surfaceClassName="context-menu" label="分屏" onDismiss={() => setOpen(false)} surfaceRef={setMenuRef} style={style ?? undefined}>
          <button role="menuitem" onClick={() => { onExit(); setOpen(false); }}><X size={15} /><span>取消分屏</span></button>
          <button role="menuitem" onClick={() => { onSwap(); setOpen(false); }}><ArrowLeftRight size={15} /><span>左右互换</span></button>
        </Menu>
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
  // 坐标菜单统一走「先量尺寸、贴底翻上方」的共用定位（不再按 210/280 估算高度夹取）
  const { surfaceRef, style } = usePopoverPosition({ open: true, at: { x, y } });
  return (
    <Menu surfaceClassName="context-menu" surfaceRef={surfaceRef} onDismiss={onClose} style={style ?? undefined}>
      <button role="menuitem" onClick={() => { onCloseTab(); onClose(); }}><X size={15} /><span>关闭</span></button>
      {canCloseOthers && <button role="menuitem" onClick={() => { onCloseOthers(); onClose(); }}><XCircle size={15} /><span>关闭其他</span></button>}
      {canCloseOthers && <button role="menuitem" onClick={() => { onCloseAll(); onClose(); }}><XSquare size={15} /><span>关闭全部</span></button>}
      {hasLeft && <button role="menuitem" onClick={() => { onCloseLeft(); onClose(); }}><ChevronsLeft size={15} /><span>关闭左侧</span></button>}
      {hasRight && <button role="menuitem" onClick={() => { onCloseRight(); onClose(); }}><ChevronsRight size={15} /><span>关闭右侧</span></button>}
      <div className="context-menu-sep" />
      <button role="menuitem" onClick={() => { onTogglePin(); onClose(); }}><Pin size={15} /><span>{pinned ? "取消钉住" : "钉住"}</span></button>
    </Menu>
  );
};
