import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type MutableRefObject } from "react";
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { escapeId } from "../../lib/cssEscape";

/** 只窗口化展示，完整投影仍由工作区负责筛选、排序与选择。编辑和菜单锚点不会被滚动卸载。 */
export function QuickNotesVirtualList<T extends { id: string }>({ items, mode, className, listRef, visible, keepIds, revealId, onRevealed, renderItem, empty }: {
  items: readonly T[]; mode: "index" | "timeline"; className: string; listRef?: MutableRefObject<HTMLDivElement | null>;
  visible: boolean; keepIds: readonly (string | null | undefined)[]; revealId: string | null; onRevealed(): void;
  renderItem(item: T): ReactNode; empty?: ReactNode;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [gap, setGap] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ id: string; last: boolean; primary: boolean } | null>(null);
  const lastVisible = useRef<{ rows: VirtualItem[]; size: number }>({ rows: [], size: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (listRef) listRef.current = node;
    setScroller(node);
    if (node) setGap(parseFloat(getComputedStyle(node).gap) || 0);
  }, [listRef]);
  const indexById = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items]);
  const windowed = items.length > 24;
  const held = [...keepIds, revealId, focusedId].map(id => id ? indexById.get(id) : undefined).filter((index): index is number => index !== undefined);
  const pendingIndex = pendingFocus ? indexById.get(pendingFocus.id) : undefined;
  if (pendingIndex !== undefined) held.push(pendingIndex);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: windowed ? items.length : 0,
    getScrollElement: () => scroller,
    getItemKey: index => items[index].id,
    estimateSize: () => mode === "index" ? 32 : 168,
    overscan: 6, gap,
    initialRect: { width: 640, height: 800 },
    enabled: windowed && visible,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...held])].sort((a, b) => a - b),
  });
  const liveRows = virtualizer.getVirtualItems();
  const liveSize = virtualizer.getTotalSize();
  useLayoutEffect(() => { if (visible && windowed) lastVisible.current = { rows: liveRows, size: liveSize }; }, [visible, windowed, liveRows, liveSize]);
  // 隐藏时窗口器暂停测量，但保留已挂载条目：编辑器正文只活在实例里，不能因切页卸载。
  const virtualItems = visible ? liveRows : lastVisible.current.rows;
  const rows = windowed ? virtualItems.flatMap(row => {
    const index = indexById.get(String(row.key));
    return index === undefined ? [] : [{ id: String(row.key), index, start: row.start }];
  }) : items.map((item, index) => ({ id: item.id, index, start: 0 }));
  useLayoutEffect(() => {
    if (!visible || !pendingFocus) return;
    if (!indexById.has(pendingFocus.id)) { setPendingFocus(null); return; }
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-quick-note-id="${escapeId(pendingFocus.id)}"]`);
    const buttons = Array.from(row?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]') ?? []);
    const target = pendingFocus.primary ? row?.querySelector<HTMLElement>('.quick-note-index-main,button[aria-label="编辑小记"]') ?? buttons[0] : pendingFocus.last ? buttons.at(-1) : buttons[0];
    if (target) { target.focus({ preventScroll: true }); setPendingFocus(null); }
  }, [visible, pendingFocus, indexById, virtualItems]);
  useEffect(() => {
    if (!visible || !revealId) return;
    const index = indexById.get(revealId);
    if (index === undefined) return;
    if (windowed) virtualizer.scrollToIndex(index, { align: "center" });
    else rootRef.current?.querySelector<HTMLElement>(`[data-quick-note-id="${escapeId(revealId)}"]`)?.scrollIntoView({ block: "nearest" });
    const timer = window.setTimeout(onRevealed, 1600);
    return () => window.clearTimeout(timer);
  }, [visible, revealId, indexById, windowed, virtualizer, onRevealed]);

  const navigate = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || !(event.target instanceof HTMLElement)
      || event.target.closest('input,textarea,select,audio,video,[contenteditable]:not([contenteditable="false"]),[role="slider"]')) return;
    const row = event.target.closest<HTMLElement>('[data-quick-note-id]');
    const index = row?.dataset.quickNoteId ? indexById.get(row.dataset.quickNoteId) : undefined;
    if (index === undefined) return;
    let next: number; let last = false;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Tab" && windowed) {
      const buttons = [...row!.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')];
      if (event.target !== (event.shiftKey ? buttons[0] : buttons.at(-1))) return;
      next = index + (event.shiftKey ? -1 : 1); last = event.shiftKey;
      const nextId = items[next]?.id;
      if (nextId && rootRef.current?.querySelector(`[data-quick-note-id="${escapeId(nextId)}"]`)) return;
    } else return;
    if (next < 0 || next >= items.length) return;
    event.preventDefault();
    if (windowed) virtualizer.scrollToIndex(next, { align: "auto" });
    setPendingFocus({ id: items[next].id, last, primary: event.key !== "Tab" });
  };
  const heldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement) setFocusedId(event.target.closest<HTMLElement>('[data-quick-note-id]')?.dataset.quickNoteId ?? null);
  };
  return <div ref={setRoot} className={className + (windowed ? " is-virtual" : "")} role="list" aria-label="小记列表"
    onKeyDownCapture={navigate} onFocusCapture={heldFocus} onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocusedId(null); }}>
    {items.length === 0 ? empty : <div className="quick-notes-virtual-space" style={windowed ? { height: visible ? liveSize : lastVisible.current.size } : undefined}>
      {rows.map(row => <div key={row.id} ref={windowed ? virtualizer.measureElement : undefined} data-index={windowed ? row.index : undefined}
        className={windowed ? "quick-notes-virtual-item" : undefined} role="listitem" aria-posinset={row.index + 1} aria-setsize={items.length}
        style={windowed ? { top: row.start } : undefined}>{renderItem(items[row.index])}</div>)}
    </div>}
  </div>;
}
