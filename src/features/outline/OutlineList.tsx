import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { OutlineController, type OutlineNode } from "./OutlineController";

interface OutlineListProps {
  controller: OutlineController;
  onNavigate: (id: string) => void;
}

function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}

/** 大纲条目列表（扁平前序渲染 + 折叠 + 选中高亮 + 选中项滚入可视区） */
export function OutlineList({ controller, onNavigate }: OutlineListProps) {
  const version = useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const items = controller.getVisibleItems();
  const selectedId = controller.getSelectedId();
  const bodyRef = useRef<HTMLDivElement>(null);
  void version;

  useLayoutEffect(() => {
    if (!selectedId) return;
    const body = bodyRef.current;
    const el = body?.querySelector(`.outline-item[data-id="${escapeId(selectedId)}"]`) as HTMLElement | null;
    if (!body || !el) return;
    const vp = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top <= vp.top + 10 || r.bottom >= vp.bottom - 10) {
      body.scrollTop += r.top - (vp.top + vp.height / 2);
    }
  }, [selectedId, items]);

  return (
    <div ref={bodyRef} className="outline-list">
      {items.length === 0 ? (
        <div className="outline-panel__empty">暂无大纲</div>
      ) : (
        items.map((node) => {
          const indent = 8 + (node.depth - 1) * 14;
          const selected = node.id === selectedId;
          return (
            <div
              key={node.id}
              className={`outline-item${selected ? " outline-item--selected" : ""}`}
              data-id={node.id}
              style={{ paddingLeft: indent }}
              onClick={() => {
                controller.setSelected(node.id);
                controller.expandAncestorsOf(node.id);
                onNavigate(node.id);
              }}
              title={node.text}
            >
              <button
                className={`outline-item__fold${controller.isCollapsed(node.id) ? " is-collapsed" : ""}`}
                style={{ visibility: node.hasChildren ? "visible" : "hidden" }}
                onClick={(e) => {
                  e.stopPropagation();
                  controller.toggleCollapsed(node.id);
                }}
                tabIndex={-1}
                aria-label={controller.isCollapsed(node.id) ? "展开" : "折叠"}
              >
                <ChevronRight size={14} />
              </button>
              <span className="outline-item__text">{node.text || "\u00a0"}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
