/**
 * 小记列表的**虚拟行窗口**（261120 首屏瘦身：从 HomePage 里抽出来的独立懒组件）。
 *
 * 为什么要拆：@tanstack/virtual-core + react-virtual 在入口 chunk 里实测占 **≈8.2KB gzip**（入口的 16%），
 * 而它只在「小记数量超过一屏阈值」时才需要。拆成懒组件后：入口不再包含它，首屏资源图同步减少
 * ≈8.2KB；短列表根本不会下载这个 chunk，长列表在挂载时才拉（配合 HomePage 的先渲染前 12 条兜底）。
 *
 * 行为与拆分前逐项一致：滚动容器由父级传入（父级管滚动记忆/FLIP 动画），本组件只管
 * ① 量 cards 相对滚动容器的偏移（scrollMargin）② 固定行高估值 168 + overscan 6 ③ measureElement 动态量高
 * ④ 外部要求滚到某条（全局搜索命中）时 scrollToIndex。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface QuickNotesVirtualListProps {
  /** 已排序好的小记（同一数组引用变化 = 需要重新 measure）。 */
  items: readonly { id: string }[];
  /** 第 index 条怎么渲染（父级闭包，含选中态/预览/长按等语义）。 */
  renderCard: (note: never) => ReactNode;
  /** 小记列表的滚动容器（父级 ref 注入；未就绪时先不虚拟化）。 */
  scrollElement: HTMLDivElement | null;
  /** 外部要求滚到某条的下标（全局搜索命中/待处理小记）；消费后通过 onScrollToIndexDone 清空。 */
  scrollToIndex?: number | null;
  onScrollToIndexDone?: () => void;
}

export function QuickNotesVirtualList({ items, renderCard, scrollElement, scrollToIndex, onScrollToIndexDone }: QuickNotesVirtualListProps) {
  const [cardsEl, setCardsEl] = useState<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);
  const getItemKey = useCallback((index: number) => items[index]?.id ?? index, [items]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement,
    estimateSize: () => 168,
    getItemKey,
    overscan: 6,
    initialRect: { width: 390, height: 800 },
    scrollMargin,
    scrollPaddingStart: scrollMargin,
    enabled: scrollElement !== null,
  });
  // cards 相对滚动容器的偏移（上方还有筛选条/标题等）——每次数据或筛选变化都重量一次。
  useEffect(() => {
    const scroller = scrollElement;
    if (!scroller || !cardsEl) return;
    const update = () => {
      setScrollMargin(cardsEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scrollElement, cardsEl, items.length]);
  // 数据变化后重算行高（卡片高度随摘要/图片变化）。
  useEffect(() => { virtualizer.measure(); }, [items, virtualizer]);
  // 外部要求滚到某条：等虚拟行挂载后再滚（与拆分前同一时序）。
  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0) return;
    virtualizer.scrollToIndex(scrollToIndex, { align: "center" });
    onScrollToIndexDone?.();
  }, [scrollToIndex, virtualizer, onScrollToIndexDone]);

  return (
    <div
      ref={setCardsEl}
      className="mobile-quick-cards"
      style={{ display: "block", position: "relative", height: Math.max(0, virtualizer.getTotalSize() - scrollMargin), padding: 0 }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const note = items[item.index];
        if (!note) return null;
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", padding: "6px 14px", transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            {renderCard(note as never)}
          </div>
        );
      })}
    </div>
  );
}
