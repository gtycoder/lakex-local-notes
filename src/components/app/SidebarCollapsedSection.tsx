import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * 目录底部「已收起」分区（261120 用户点单）= **置顶的反向（置底）**。
 *
 * - 默认收起（只有一行标题 + 数量），展开态由调用方记忆（设备本地）；
 * - 展开后内容与目录**行为完全一样**（同一份 TreeRow 渲染，可继续展开子树、可右键、可拖拽）；
 * - 区域高度 = 内容自适应，**最多 1/3 目录栏高度**（CSS：.sidebar-collapsed 的 max-height + 内部滚动）。
 * - 移动端有同语义的分组（两端 UI 各自实现，不共享组件）。
 */
export function SidebarCollapsedSection(props: {
  open: boolean;
  count: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="sidebar-collapsed" aria-label="已收起">
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
