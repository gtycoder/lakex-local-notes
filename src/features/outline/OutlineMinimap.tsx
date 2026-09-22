/** 原生 ne-toc-small-view 同款 minimap：按真实条目画横线（深度定宽），不做重复渐变。 */
import type { OutlineNode } from "./OutlineController";

export interface OutlineMinimapProps {
  items: Array<Pick<OutlineNode, "id" | "level">>;
  selectedId: string | null;
  onPick?: (id: string) => void;
}

export function OutlineMinimap({ items, selectedId, onPick }: OutlineMinimapProps) {
  return (
    <div className="toc-minimap" aria-hidden="true">
      {items.map((node) => {
        const depth = Math.min(Math.max(node.level, 1), 6);
        return (
          <button
            key={node.id}
            type="button"
            className={`toc-minimap__item toc-minimap__item--d${depth}${selectedId === node.id ? " is-selected" : ""}`}
            tabIndex={-1}
            onClick={() => onPick?.(node.id)}
          />
        );
      })}
    </div>
  );
}
