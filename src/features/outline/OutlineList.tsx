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
/** 层级竖线对齐其父级（depth = d-1）折叠箭头中心：8+(d-2)*16 + 箭头(18px)一半 */
const GUIDE_X = 17;

/** 不同层级的低调竖线配色（depth 2-6；depth 1 无竖线） */
const GUIDE_COLORS = [
  "rgba(92, 124, 214, 0.38)",  // 2 级组
  "rgba(56, 145, 134, 0.38)",  // 3 级组
  "rgba(176, 128, 62, 0.40)",  // 4 级组
  "rgba(146, 100, 178, 0.36)", // 5 级组
  "rgba(100, 108, 120, 0.35)", // 6 级组
];
function guideColor(depth: number): string {
  return GUIDE_COLORS[Math.min(Math.max(depth, 2), 6) - 2];
}

interface GuideSeg { x: number; y: "full" | "bottom"; color: string }

/** 计算某条目的层级竖线（纯竖线，不用折线）：
 *  - 每个包含该行的层级组画一条贯穿整行的竖线（组从首行延续到末行）；
 *  - 展开的父行额外画“箭头中心→行底”的半段，把竖线接到子列表。 */
function computeGuides(
  items: OutlineNode[],
  index: number,
  isCollapsed: (id: string) => boolean
): GuideSeg[] {
  const node = items[index];
  if (!node) return [];
  const segs: GuideSeg[] = [];
  for (let d = 2; d <= node.depth; d += 1) {
    segs.push({ x: GUIDE_X + (d - 2) * INDENT_STEP, y: "full", color: guideColor(d) });
  }
  if (node.hasChildren && !isCollapsed(node.id)) {
    segs.push({ x: GUIDE_X + (node.depth - 1) * INDENT_STEP, y: "bottom", color: guideColor(node.depth + 1) });
  }
  return segs;
}

function guideStyle(segs: GuideSeg[]): React.CSSProperties | undefined {
  if (segs.length === 0) return undefined;
  return {
    backgroundImage: segs.map((s) => `linear-gradient(${s.color}, ${s.color})`).join(", "),
    backgroundSize: segs.map((s) => (s.y === "full" ? "1px 100%" : "1px 50%")).join(", "),
    // background-position 百分比按 (容器-图片) 比例计算：下半段需 100%。
    backgroundPosition: segs.map((s) => `${s.x}px ${s.y === "bottom" ? "100%" : "0"}`).join(", "),
    backgroundRepeat: "no-repeat",
  };
}

/** 大纲条目列表：层级引导线（子弹线）+ 级别徽标 + 折叠 + 选中高亮。 */
export function OutlineList({ controller, onNavigate }: OutlineListProps) {
  const version = useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  const items = controller.getVisibleItems();
  const selectedId = controller.getSelectedId();
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
          const segs = computeGuides(items, i, (id) => controller.isCollapsed(id));
          return (
            <div
              key={node.id}
              className={`outline-item${selected ? " outline-item--selected" : ""}${node.hasChildren ? " has-children" : ""}`}
              data-id={node.id}
              style={{ paddingLeft: indent, ...guideStyle(segs) }}
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
                <span className="outline-item__fold-slot" aria-hidden="true" />
              )}
              <span className={`outline-item__level outline-item__level--${Math.min(Math.max(node.level, 1), 6)}`}>H{node.level}</span>
              <span className="outline-item__text">{node.text || "\u00a0"}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
