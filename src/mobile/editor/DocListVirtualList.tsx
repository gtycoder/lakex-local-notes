/**
 * 移动端文档列表虚拟化（261107）：**只在 >80 行时按需加载**，避免把 @tanstack/react-virtual
 * 拉进移动端入口 chunk（check:bundle 的 mobile-entry-js 预算）。
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode } from "react";

export const DOC_ROW_ESTIMATE_PX = 44;

export interface DocListVirtualListProps {
  items: ReadonlyArray<{ id: string }>;
  scrollElement: HTMLDivElement | null;
  renderRow: (item: { id: string }) => ReactNode;
}

export function DocListVirtualList({ items, scrollElement, renderRow }: DocListVirtualListProps) {
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => DOC_ROW_ESTIMATE_PX,
    overscan: 8,
  });
  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((item) => {
        const doc = items[item.index];
        if (!doc) return null;
        return (
          <div
            key={doc.id}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: "translateY(" + item.start + "px)" }}
          >
            {renderRow(doc)}
          </div>
        );
      })}
    </div>
  );
}

export default DocListVirtualList;
