/**
 * 顶栏标签条（D-10，261125 审计终审批次）：普通标签 + 分屏合并标签 + 「▾ 切换标签」浮层 +
 * 标签右键菜单（关闭族/钉住；合并标签 = 分屏专属两项）。从 features/editor/MultiTabEditor.tsx
 * 纯搬家（零行为变化）；拖拽排序 + FLIP 在 hooks/useTabStripDrag。
 *
 * 视觉单一来源：标签本体走 TabItemVisual（tabItemVisual.test 钉死）；浮层走 components/ui/Overlay；
 * 切换器宽度为设备本地（localStorage `lakex-local-notes-v3.tab-switcher-width`，160..440）。
 * 分屏组语义（Edge 式合并标签）见 MultiTabEditor 头注释与 splitView.test。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Columns2, File, Pin, X } from "lucide-react";
import { Menu } from "../../components/ui/Overlay";
import { escapeId } from "../../lib/cssEscape";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { TabContextMenu } from "./TabContextMenu";
import { NodeIconGlyph } from "../../components/ui/NodeIconGlyph";
import { TabItemVisual } from "./TabItemVisual";
import { useTabStripDrag } from "../../hooks/useTabStripDrag";
import type { TabInfo } from "./MultiTabEditor";

export interface TabStripProps {
  tabs: TabInfo[];
  activeNoteId: string | null;
  /** 钉住的标签（思源式固定页签：排最前、X 藏起、不参与批量关闭）。 */
  pinned: ReadonlySet<string>;
  /** 分屏组（null = 未分屏）；合并标签挂组内更靠前那页的位置。 */
  splitPair: { left: string; right: string } | null;
  splitFirstNote: string | null;
  splitActive: boolean;
  splitLeftTab: TabInfo | null;
  splitRightTab: TabInfo | null;
  onTabChange: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
  /** 拖拽排序：给出新的 noteId 顺序。 */
  onTabsReorder?: (noteIds: string[]) => void;
  onTogglePin?: (noteId: string) => void;
  /** 点合并标签 = 回到分屏区域。 */
  onActivateSplit?: () => void;
  /** 合并标签上的 × = 取消分屏（两个标签都保留）。 */
  onCloseSplit?: () => void;
  /** 取消分屏（合并标签右键菜单）。 */
  onExitSplit?: () => void;
  /** 左右位置互换（合并标签右键菜单）。 */
  onSwapSplit?: () => void;
  /** 顶栏左侧元素（工作空间/云同步），渲染在标签左侧 */
  topbarLeading?: ReactNode;
  /** 顶栏右侧元素（外观/更多），渲染在标签最右侧 */
  topbarTrailing?: ReactNode;
}

export function TabStrip({
  tabs, activeNoteId, pinned,
  splitPair, splitFirstNote, splitActive, splitLeftTab, splitRightTab,
  onTabChange, onTabClose, onTabsReorder, onTogglePin,
  onActivateSplit, onCloseSplit, onExitSplit, onSwapSplit,
  topbarLeading, topbarTrailing,
}: TabStripProps) {
  const switcherRef = useRef<HTMLDivElement>(null);
  /** tab 切换按钮（portal 弹窗的 fixed 定位锚点） */
  const switcherButtonRef = useRef<HTMLButtonElement>(null);
  /** portal 弹窗自身（外点关闭判定需要包含它） */
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [tabMenuWidth, setTabMenuWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem("lakex-local-notes-v3.tab-switcher-width"));
    return Number.isFinite(v) && v >= 160 && v <= 440 ? v : 220;
  });
  const tabMenuWidthRef = useRef(tabMenuWidth);
  const startTabMenuResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
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
      writeLocalStorage("lakex-local-notes-v3.tab-switcher-width", String(tabMenuWidthRef.current));
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
    // 261125 审计 M-04：隐藏占位改 .a11y-visually-hidden 工具类（a11y 层单一来源），不内联 fixed/1px 脚手架。
    () => <span aria-hidden="true" className="a11y-visually-hidden" />,
    []
  );
  const [tabCtx, setTabCtx] = useState<{ noteId: string; x: number; y: number; split?: boolean } | null>(null);

  // ---- 拖拽排序（pointer 事件，无外部依赖；状态机 + FLIP 在 hooks/useTabStripDrag）----
  const { tabItemsRef: stripRef, draggingId, suppressClickRef, beginTabDrag, moveTabDrag, endTabDrag, handleTabClose } = useTabStripDrag({
    tabs, onTabClose, onTabsReorder, splitPair, splitFirstNote,
  });

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
    const strip = stripRef.current;
    if (!strip) return;
    const activeTab = strip.querySelector<HTMLElement>(`[data-note-id="${escapeId(activeNoteId ?? "")}"]`)
      ?? (splitActive ? strip.querySelector<HTMLElement>("[data-split-group]") : null);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeNoteId, tabs.length, splitActive]);

  /** 鼠标没有横向滚轮时，用垂直滚轮驱动顶部 tab 的横向滚动。
   * 触控板产生的 deltaX 保持原生行为；原生非 passive listener 才能安全 preventDefault。 */
  const handleTabWheel = useCallback((event: WheelEvent) => {
    const strip = stripRef.current;
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
    const strip = stripRef.current;
    if (!strip) return;
    strip.addEventListener("wheel", handleTabWheel, { passive: false });
    return () => strip.removeEventListener("wheel", handleTabWheel);
  }, [handleTabWheel]);

  const selectTab = (noteId: string) => {
    onTabChange(noteId);
    setTabMenuOpen(false);
  };

  return (
    <>
    <div className="tab-bar">
      {topbarLeading && <div className="tabbar-leading">{topbarLeading}</div>}
      {/* 261116 用户点单：左侧按钮区与多标签区之间加一条小竖线，避免两组控件视觉粘连。 */}
      {topbarLeading && tabs.length > 0 && <span className="tabbar-divider" aria-hidden="true" />}
      <div className="tab-items" ref={stripRef} role="tablist" aria-label="打开的文档">
        {tabs.map((tab) => (
          splitPair && splitFirstNote != null && (tab.noteId === splitPair.left || tab.noteId === splitPair.right) ? (
            tab.noteId === splitFirstNote ? (
              <button
                key="__split_group__"
                type="button"
                className={`tab-item tab-split-tab${splitActive ? " active" : ""}${draggingId != null && draggingId === splitFirstNote ? " dragging" : ""}`}
                data-split-group="true"
                /* 合并标签在拖拽排序里代表整个组：id 用组内靠前那页（splitFirstNote），
                   落到新槽位后由 tabOrder.expandTabSlots 把两页整块放回同一位置。 */
                data-note-id={splitFirstNote ?? undefined}
                role="tab"
                aria-selected={splitActive}
                onPointerDown={(event) => { if (splitFirstNote) beginTabDrag(event, splitFirstNote); }}
                onPointerMove={moveTabDrag}
                onPointerUp={endTabDrag}
                onPointerCancel={endTabDrag}
                title={`分屏：${splitLeftTab?.title || "无标题"} ｜ ${splitRightTab?.title || "无标题"}`}
                aria-label={`分屏组：${splitLeftTab?.title || "无标题"}${splitLeftTab?.deleted ? "（已删除）" : ""} ｜ ${splitRightTab?.title || "无标题"}${splitRightTab?.deleted ? "（已删除）" : ""}`}
                onClick={() => { if (suppressClickRef.current) return; onActivateSplit?.(); }}
                /* 261014 用户点单：复合的二合一标签**右键**给出分屏专属动作（取消分屏 / 左右互换）。
                   与普通标签的右键菜单（关闭/钉住）分开：这个标签代表**两页**，单页语义在这里不成立。 */
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (splitFirstNote) setTabCtx({ noteId: splitFirstNote, x: event.clientX, y: event.clientY, split: true });
                }}
              >
                <span className="tab-split-tab__half">
                  {splitLeftTab && pinned.has(splitLeftTab.noteId) && <Pin size={12} className="tab-pin" aria-hidden="true" />}
                  {splitLeftTab?.icon && <span className="tab-custom-icon" aria-hidden="true"><NodeIconGlyph value={splitLeftTab.icon} /></span>}
                  <span className="tab-title">{splitLeftTab?.title || "无标题"}</span>
                  {splitLeftTab?.dirty && <span className="tab-dirty-dot" aria-label="有未保存更改" />}
                  {splitLeftTab?.deleted && <span className="tab-deleted-badge" title="该侧文档在回收站中（本机或他端删除）：只读、编辑不会保存，恢复后才能继续写">已删除</span>}
                </span>
                <span className="tab-split-tab__divider" aria-hidden="true" />
                <span className="tab-split-tab__half">
                  <Columns2 size={12} className="tab-split-tab__glyph" aria-hidden="true" />
                  {splitRightTab && pinned.has(splitRightTab.noteId) && <Pin size={12} className="tab-pin" aria-hidden="true" />}
                  {/* 261012 用户点单：**两半各自带上自己文档的图标**（此前只有左半有，右半丢图标）。 */}
                  {splitRightTab?.icon && <span className="tab-custom-icon" aria-hidden="true"><NodeIconGlyph value={splitRightTab.icon} /></span>}
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
            <TabItemVisual
              title={tab.title}
              icon={tab.icon ? <NodeIconGlyph value={tab.icon} /> : null}
              dirty={tab.dirty}
              deleted={tab.deleted}
              pinned={pinned.has(tab.noteId)}
              /* 钉住标签的 X 由 CSS 隐藏（思源式）：这里直接不给 onClose，语义与样式一致。 */
              onClose={pinned.has(tab.noteId) ? undefined : () => handleTabClose(tab.noteId)}
            />
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
            title={`切换标签（${tabs.length}）`}
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
                      <span className="tab-switcher-icon" aria-hidden="true">{tab.icon ? <NodeIconGlyph value={tab.icon} /> : <File size={15} />}</span>
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
    {tabCtx && (
      <TabContextMenu
        x={tabCtx.x}
        y={tabCtx.y}
        split={tabCtx.split ? { onExit: () => onExitSplit?.(), onSwap: () => onSwapSplit?.() } : undefined}
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
    </>
  );
}
