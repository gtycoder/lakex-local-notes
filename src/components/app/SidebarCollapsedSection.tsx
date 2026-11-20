import { useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { SplitHandle } from "../ui/SplitHandle";

/**
 * 目录底部「已收起」分区（261120 用户点单）= **置顶的反向（置底）**。
 *
 * - 默认收起（只有一行标题 + 数量），展开态由调用方记忆（设备本地）；
 * - 展开后内容与目录**行为完全一样**（同一份 TreeRow 渲染，可继续展开子树、可右键、可拖拽）；
 * - 高度：默认自适应、**最多 1/3 目录栏**；展开时顶部有一条可拖拽分隔条（纵向 SplitHandle，261120 追加），
 *   上下拖可改高度（上限 = 目录栏的 70%），双击分隔条复位成自适应；高度按端记忆（设备本地）。
 * - 移动端有同语义的分组（两端 UI 各自实现，不共享组件）。
 */
export function SidebarCollapsedSection(props: {
  open: boolean;
  count: number;
  onToggle: () => void;
  /** 手动高度（px）；null = 自适应。 */
  height: number | null;
  /** 纵向分隔条的容器（目录栏本体，用来算 70% 上限）。 */
  containerRef: RefObject<HTMLElement | null>;
  onPreviewHeight: (height: number) => void;
  onCommitHeight: (height: number | null) => void;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const manual = props.open && props.height != null;
  return (
    <section
      ref={sectionRef}
      className={"sidebar-collapsed" + (manual ? " is-manual" : "")}
      style={manual ? { height: props.height as number } : undefined}
      aria-label="已收起"
    >
      {props.open && (
        <SplitHandle
          ariaLabel="调整已收起分区高度"
          axis="y"
          containerRef={props.containerRef}
          minWidth={56}
          maxWidth={9999}
          maxRatio={0.7}
          invert
          width={props.height}
          measureLeft={() => sectionRef.current?.getBoundingClientRect().height ?? 160}
          onPreview={props.onPreviewHeight}
          onCommit={props.onCommitHeight}
          className="sidebar-collapsed__splitter"
        />
      )}
      <button
        type="button"
        className="sidebar-collapsed__header"
        aria-expanded={props.open}
        aria-label={props.open ? "收起已收起笔记本" : "展开已收起笔记本"}
        onClick={props.onToggle}
      >
        {props.open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span>已收起</span>
        <span className="sidebar-collapsed__count" aria-hidden="true">{props.count}</span>
      </button>
      {props.open && <div className="sidebar-collapsed__body">{props.children}</div>}
    </section>
  );
}
