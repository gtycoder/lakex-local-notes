import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, FileText, Pin, X, XCircle, XOctagon } from "lucide-react";
import { createPortal } from "react-dom";
import { EditorTab } from "./EditorTab";
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
  /** 钉住的标签（由上层持有，保证关闭/自动淘汰时能感知钉住状态）。 */
  pinnedNoteIds?: ReadonlySet<string>;
  /** 切换标签钉住状态（由上层更新状态）。 */
  onTogglePin?: (noteId: string) => void;
  onContentChange: (noteId: string, content: string) => void;
  /** 工作区级可见性（keep-alive：外部隐藏整个工作区时把所有 tab 视为不可见，切回时触发重新水合） */
  visible?: boolean;
  prefs?: LakeEditorPrefs;
  onEditorReady?: (noteId: string, editor: import("./lakeRuntime").LakeEditorInstance | null) => void;
  /** 编辑器右键资料操作（M1.3） */
  onEditorCopyMarkdown?: (noteId: string) => void;
  onEditorExport?: (noteId: string, format: "markdown" | "html" | "lake") => void;
  onEditorCopyPaths?: (noteId: string) => void;
  /** 顶栏左侧元素（工作空间/云同步），渲染在标签左侧，与多 tab 融合成一条顶栏 */
  topbarLeading?: ReactNode;
  /** 顶栏右侧元素（外观/更多），渲染在标签最右侧 */
  topbarTrailing?: ReactNode;
  emptyAction?: ReactNode;
  /** 正文顶部路径（思源 protyle-breadcrumb），插在标签栏与编辑器之间 */
  breadcrumb?: ReactNode;
}

export function MultiTabEditor({
  tabs,
  activeNoteId,
  tocEnabled,
  onTabChange,
  onTabClose,
  onTabsReorder,
  lockedNoteIds,
  pinnedNoteIds,
  onTogglePin,
  onContentChange,
  visible = true,
  prefs,
  onEditorReady,
  onEditorCopyMarkdown,
  onEditorExport,
  onEditorCopyPaths,
  topbarLeading,
  topbarTrailing,
  emptyAction,
  breadcrumb,
}: MultiTabEditorProps) {
  const contentCache = useRef<Map<string, string>>(new Map());
  // 外部刷新（reloadKey 变化）时，必须丢弃 contentCache 里旧的编辑器内容，否则新实例仍用旧正文。
  const reloadKeysRef = useRef<Map<string, number>>(new Map());
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
      localStorage.setItem("lake-notes-v3.tab-switcher-width", String(tabMenuWidthRef.current));
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

  /** 渲染期确定当前应喂给 EditorTab 的正文；reloadKey 变化时先清缓存再返回 tab.content。 */
  const contentFor = (tab: TabInfo): string => {
    const key = tab.reloadKey ?? 0;
    const prev = reloadKeysRef.current.get(tab.noteId) ?? 0;
    if (prev !== key) {
      contentCache.current.delete(tab.noteId);
      reloadKeysRef.current.set(tab.noteId, key);
    }
    return contentCache.current.get(tab.noteId) ?? tab.content;
  };

  useEffect(() => {
    const activeIds = new Set(tabs.map((t) => t.noteId));
    for (const key of contentCache.current.keys()) {
      if (!activeIds.has(key)) contentCache.current.delete(key);
    }
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

  useEffect(() => {
    const activeTab = tabItemsRef.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(activeNoteId ?? "")}"]`);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeNoteId, tabs.length]);

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
              {pinned.has(tab.noteId) && <Pin size={11} className="tab-pin" aria-hidden="true" />}
              {tab.icon && <span className="tab-custom-icon" aria-hidden="true">{tab.icon}</span>}
              <span className="tab-title">{tab.title || "无标题"}</span>
              {tab.dirty && <span className="tab-dirty-dot" aria-label="有未保存更改" />}
              {tab.deleted && <span className="tab-deleted-badge" title="该文档已在其他设备删除，正文为删除前的最后内容">已删除</span>}
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
          ))}
        </div>
        {topbarTrailing && <div className="tabbar-trailing">{topbarTrailing}</div>}
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
            {tabMenuOpen && createPortal(
              <div ref={tabMenuRef} className="tab-switcher-menu" role="menu" aria-label="打开的标签" style={tabMenuStyle}>
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
                        <span className="tab-switcher-icon" aria-hidden="true">{tab.icon ?? <FileText size={15} />}</span>
                        <span className="tab-switcher-status" aria-hidden="true">{tab.dirty ? "●" : ""}</span>
                        <span className="tab-switcher-title">{tab.title || "无标题"}</span>
                        {tab.deleted && <span className="tab-deleted-badge" title="该文档已在其他设备删除，正文为删除前的最后内容">已删除</span>}
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
              </div>,
              document.body
            )}
          </div>
        )}
      </div>
      {breadcrumb}
      <div className="tab-panels">
        {tabs.length === 0 ? <section className="empty-workspace"><h2>开始写第一篇笔记</h2>{emptyAction}</section> : tabs.map((tab) => (
          <EditorTab
            key={`${tab.noteId}-${tab.reloadKey ?? 0}`}
            noteId={tab.noteId}
            locked={lockedNoteIds?.has(tab.noteId) ?? false}
            content={contentFor(tab)}
            visible={visible && tab.noteId === activeNoteId}
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
