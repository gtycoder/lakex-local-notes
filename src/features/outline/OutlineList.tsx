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

const INDENT_STEP = 16;

/** 计算某条目的子弹线（层级引导竖线）x 偏移列表。
 *  规则：depth≥2 的条目，若其后一条目深度 ≥ d，则画 d 层级竖线（组内连续、组尾终止）。 */
function computeGuides(items: OutlineNode[], index: number): number[] {
  const node = items[index];
  if (!node || node.depth < 2) return [];
  const nextDepth = items[index + 1]?.depth ?? 0;
  const guides: number[] = [];
  for (let d = 2; d <= node.depth; d += 1) {
    if (nextDepth >= d) guides.push(8 + (d - 2) * INDENT_STEP);
  }
  return guides;
}

function guideStyle(guides: number[]): React.CSSProperties | undefined {
  if (guides.length === 0) return undefined;
  const color = "var(--shell-separator, rgba(66, 75, 112, 0.16))";
  return {
    backgroundImage: guides.map(() => `linear-gradient(${color}, ${color})`).join(", "),
    backgroundSize: guides.map(() => "1px 100%").join(", "),
    backgroundPosition: guides.map((x) => `${x}px 0`).join(", "),
    backgroundRepeat: "no-repeat",
  };
}

/** 大纲条目列表：层级引导线（子弹线）+ 级别徽标 + 折叠 + 选中高亮 + 滚动进度条 */
export function OutlineList({ controller, onNavigate }: OutlineListProps) {
  const version = useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const items = controller.getVisibleItems();
  const selectedId = controller.getSelectedId();
  const progress = controller.getScrollProgress();
  const bodyRef = useRef<HTMLDivElement>(null);
  const smoothNextRef = useRef(false);
  void version;

  useLayoutEffect(() => {
    if (!selectedId) return;
    const body = bodyRef.current;
    const el = body?.querySelector(`.outline-item[data-id="${escapeId(selectedId)}"]`) as HTMLElement | null;
    if (!body || !el) return;
    const vp = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top <= vp.top + 10 || r.bottom >= vp.bottom - 10) {
      const delta = r.top - (vp.top + vp.height / 2);
      if (smoothNextRef.current) {
        body.scrollTo({ top: body.scrollTop + delta, behavior: "smooth" });
        smoothNextRef.current = false;
      } else {
        body.scrollTop += delta;
      }
    }
  }, [selectedId, items]);

  return (
    <div ref={bodyRef} className="outline-list">
      {items.length === 0 ? (
        <div className="outline-panel__empty">{controller.getFilterText() ? "无匹配条目" : "暂无大纲"}</div>
      ) : (
        items.map((node, i) => {
          const indent = 8 + (node.depth - 1) * INDENT_STEP;
          const selected = node.id === selectedId;
          const guides = computeGuides(items, i);
          return (
            <div
              key={node.id}
              className={`outline-item${selected ? " outline-item--selected" : ""}${node.hasChildren ? " has-children" : ""}`}
              data-id={node.id}
              style={{ paddingLeft: indent, ...guideStyle(guides) }}
              onClick={() => {
                smoothNextRef.current = true;
                controller.setSelected(node.id);
                controller.expandAncestorsOf(node.id);
                onNavigate(node.id);
              }}
              title={node.text}
            >
              {node.hasChildren ? (
                <button
                  className={`outline-item__fold${controller.isCollapsed(node.id) ? " is-collapsed" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    smoothNextRef.current = false;
                    controller.toggleCollapsed(node.id);
                  }}
                  tabIndex={-1}
                  aria-label={controller.isCollapsed(node.id) ? "展开" : "折叠"}
                >
                  <ChevronRight size={13} />
                </button>
              ) : (
                <span className="outline-item__dot" aria-hidden="true" />
              )}
              <span className="outline-item__text">{node.text || "\u00a0"}</span>
              <span className="outline-item__level">H{node.level}</span>
            </div>
          );
        })
      )}
      <div className="outline-list__progress" style={{ height: `${Math.max(2, progress * 100)}%` }} aria-hidden="true" />
    </div>
  );
}
