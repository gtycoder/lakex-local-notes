/** 主表与关联选择器共用的有界行窗口；完整数据不裁剪，编辑行最多保留一条。 */
import {
  cloneElement,
  Fragment,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import "./bitableViewport.css";

interface ViewportGeometry {
  key: string;
  size: number;
  source: number;
}
/** Cache topology only, never records or React cells. A value-only edit keeps virtualizer indexes stable. */
export function projectViewportGeometry<T>(
  previous: readonly ViewportGeometry[], items: readonly T[],
  getKey: (item: T) => string, estimateSize: (item: T) => number,
  leading: boolean, trailing: boolean,
): readonly ViewportGeometry[] {
  const offset = leading ? 1 : 0;
  const count = items.length + offset + (trailing ? 1 : 0);
  let same = previous.length === count;
  if (leading && (previous[0]?.key !== "leading" || previous[0]?.size !== 20)) same = false;
  if (trailing && (previous[count - 1]?.key !== "trailing" || previous[count - 1]?.size !== 34)) same = false;
  for (let i = 0; same && i < items.length; i++) {
    const entry = previous[i + offset];
    same = entry?.source === i && entry?.key === getKey(items[i]) && entry?.size === estimateSize(items[i]);
  }
  if (same) return previous;
  const next: ViewportGeometry[] = [];
  if (leading) next.push({ key: "leading", size: 20, source: -1 });
  for (let i = 0; i < items.length; i++) next.push({ key: getKey(items[i]), size: estimateSize(items[i]), source: i });
  if (trailing) next.push({ key: "trailing", size: 34, source: items.length });
  return next;
}

export interface BitableViewportHandle {
  ensureRow(index: number): Promise<void>;
  rowAt(clientY: number): number | null;
}
interface Props<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  estimateSize: (item: T) => number;
  renderRow: (item: T, index: number) => ReactElement;
  columns: number;
  totalRecords: number;
  leading?: ReactElement;
  trailing?: ReactElement;
  visible: boolean;
  handleRef: Ref<BitableViewportHandle>;
  measureRows?: boolean;
  scrollSelector?: ".bt-grid-wrap" | ".bt-rel-body";
  fillSpace?: boolean;
}
export function BitableVirtualBody<T>({
  items,
  getKey,
  estimateSize,
  renderRow,
  columns,
  totalRecords,
  leading,
  trailing,
  visible,
  handleRef,
  measureRows = false,
  scrollSelector = ".bt-grid-wrap",
  fillSpace = true,
}: Props<T>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [margin, setMargin] = useState(36);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const hasLeading = Boolean(leading);
  const hasTrailing = Boolean(trailing);
  const [geometry, setGeometry] = useState(() => projectViewportGeometry([], items, getKey, estimateSize, hasLeading, hasTrailing));
  const entries = useMemo(
    () => projectViewportGeometry(geometry, items, getKey, estimateSize, hasLeading, hasTrailing),
    [geometry, items, getKey, estimateSize, hasLeading, hasTrailing],
  );
  // Render-phase derived state belongs to this React tree, not a mutable cross-render ref/cache.
  if (entries !== geometry) setGeometry(entries);
  const keys = useMemo(() => {
    const next = new Map<string, number>();
    for (let index = 0; index < entries.length; index++) next.set(entries[index].key, index);
    return next;
  }, [entries]);
  const getScrollElement = useCallback(
    () => bodyRef.current?.closest<HTMLElement>(scrollSelector) ?? null,
    [scrollSelector],
  );
  const pinned = pinnedKey ? keys.get(pinnedKey) : undefined;
  // Row heights are controlled by the view model (36/44/64/96 or explicit numeric),
  // including group headers/gaps; only explicit numeric/custom sizes need actual row probes.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (
        pinned !== undefined &&
        pinned < entries.length &&
        !indexes.includes(pinned)
      )
        indexes.push(pinned);
      return indexes.sort((a, b) => a - b);
    },
    [pinned, entries.length],
  );
  const estimate = useCallback(
    (index: number) => entries[index].size,
    [entries],
  );
  const itemKey = useCallback((index: number) => entries[index].key, [entries]);
  const virtual = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: entries.length,
    getScrollElement,
    estimateSize: estimate,
    getItemKey: itemKey,
    overscan: 6,
    scrollMargin: margin,
    scrollPaddingStart: margin,
    initialRect: { width: 0, height: 600 },
    rangeExtractor,
    enabled: visible,
  });
  useLayoutEffect(() => {
    if (!visible) return;
    const element = getScrollElement();
    const body = bodyRef.current;
    if (!element || !body) return;
    // offsetTop is independent of sticky header rects and scroll position.
    const update = () => setMargin(body.offsetTop);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(element);
    return () => ro.disconnect();
  }, [visible, getScrollElement]);
  useLayoutEffect(() => {
    virtual.measure();
  }, [margin, entries, visible, measureRows]);
  useImperativeHandle(
    handleRef,
    () => ({
      async ensureRow(index) {
        const vi = index + (leading ? 1 : 0);
        if (vi < 0 || vi >= entries.length) return;
        virtual.scrollToIndex(vi, { align: "auto", behavior: "auto" });
        // New virtual range is committed asynchronously after native scrolling; wait for the real row.
        for (let i = 0; i < 8; i++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          if (bodyRef.current?.querySelector(`tr[data-index="${vi}"]`)) return;
        }
      },
      rowAt(clientY) {
        const scroll = getScrollElement();
        if (!scroll) return null;
        const offset =
          clientY - scroll.getBoundingClientRect().top + scroll.scrollTop;
        const vi = virtual.getVirtualItemForOffset(offset);
        return vi ? entries[vi.index].source : null;
      },
    }),
    [virtual, entries, leading, getScrollElement],
  );
  const pin = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return;
    const indexValue = target
      .closest("tr[data-index]")
      ?.getAttribute("data-index");
    if (indexValue == null) return;
    const index = Number(indexValue);
    if (Number.isInteger(index) && entries[index])
      setPinnedKey(entries[index].key);
  };
  // Reuse row elements while scrolling. This cache is only the mounted window + one pin,
  // not the dataset: offscreen editor components must not accumulate in memory.
  const rowCache = useMemo(
    () => new Map<string, ReactElement>(),
    [renderRow, items, leading, trailing, entries, measureRows],
  );
  const activeKeys = new Set<string>();
  let end = 0;
  const rendered = virtual.getVirtualItems().map((item) => {
    const entry = entries[item.index];
    const start = item.start - margin;
    const gap = Math.max(0, start - end);
    end = item.end - margin;
    activeKeys.add(entry.key);
    let row = rowCache.get(entry.key);
    if (!row) {
      const element =
        entry.source < 0 ? leading! : entry.source === items.length ? trailing! : renderRow(items[entry.source], entry.source);
      row = cloneElement(element as ReactElement<Record<string, unknown>>, {
        ref: measureRows ? virtual.measureElement : undefined,
        "data-index": item.index,
        "aria-rowindex": item.index + 2,
      });
      rowCache.set(entry.key, row);
    }
    return (
      <Fragment key={item.key}>
        {gap > 0 && (
          <tr className="bt-virtual-spacer" aria-hidden="true">
            <td colSpan={columns} style={{ height: gap }} />
          </tr>
        )}
        {row}
      </Fragment>
    );
  });
  for (const key of rowCache.keys())
    if (!activeKeys.has(key)) rowCache.delete(key);
  const remaining = Math.max(0, virtual.getTotalSize() - end);
  return (
    <tbody
      ref={bodyRef}
      data-record-count={totalRecords}
      data-virtual-row-count={entries.length}
      onFocusCapture={(event) => pin(event.target)}
      onPointerDownCapture={(event) => pin(event.target)}
      onCompositionStartCapture={(event) => pin(event.target)}
    >
      {rendered}
      {remaining > 0 && (
        <tr className="bt-virtual-spacer" aria-hidden="true">
          <td colSpan={columns} style={{ height: remaining }} />
        </tr>
      )}
      {fillSpace && <tr className="bt-grid-filler" aria-hidden="true">
        <td colSpan={columns} />
      </tr>}
    </tbody>
  );
}
