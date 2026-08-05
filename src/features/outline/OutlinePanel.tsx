import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { ChevronRight, ListTree, Pin, X } from "lucide-react";
import { OutlineController, type OutlineNode } from "./OutlineController";

interface OutlinePanelProps {
  controller: OutlineController;
  /** true = 固定（docked）；false = 悬浮（hover 弹出） */
  pinned: boolean;
  /** 工具栏开启时面板下移到工具栏之下 */
  belowToolbar?: boolean;
  onNavigate: (id: string) => void;
  /** 固定/取消固定 */
  onPin: () => void;
  /** 收起（回到 rail） */
  onHide: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function escapeId(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id.replace(/["\\]/g, "\\$&");
  }
}

export function OutlinePanel({
  controller,
  pinned,
  belowToolbar,
  onNavigate,
  onPin,
  onHide,
  onMouseEnter,
  onMouseLeave,
}: OutlinePanelProps) {
  const version = useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const items = controller.getVisibleItems();
  const selectedId = controller.getSelectedId();
  const bodyRef = useRef<HTMLDivElement>(null);
  void version;

  // 选中项滚入列表可视区（Lake _makeVisible 语义：超出 10px 容忍带则居中）
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

  // 扁平渲染：getVisibleItems 已是遵循折叠的前序列表，避免递归与扁平双份渲染
  const renderItem = (node: OutlineNode): React.ReactNode => {
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
  };

  return (
    <div
      className={`outline-panel outline-panel--${pinned ? "docked" : "floating"}${belowToolbar ? " below-toolbar" : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="outline-panel__header">
        <ListTree size={14} />
        <span className="outline-panel__title">大纲</span>
        <span className="outline-panel__spacer" />
        <button
          className={`outline-panel__btn${pinned ? " is-active" : ""}`}
          title={pinned ? "取消固定" : "固定"}
          onClick={onPin}
        >
          <Pin size={14} />
        </button>
        <button className="outline-panel__btn" title="收起大纲" onClick={onHide}>
          <X size={14} />
        </button>
      </div>
      <div ref={bodyRef} className="outline-panel__body">
        {items.length === 0 ? (
          <div className="outline-panel__empty">暂无大纲</div>
        ) : (
          items.map((node) => renderItem(node))
        )}
      </div>
    </div>
  );
}
