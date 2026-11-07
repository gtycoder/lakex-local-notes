/**
 * 空态原语（261107 架构整理）：统一 `.mb-empty` 容器（kit.css 的 v2 形态：图标 + 一句说明 + CTA）。
 *
 * 收口前 49 处手写：`<div className="mb-empty">…` / `<p className="mb-empty mb-empty--inset">…` /
 * `role=status|alert` 三种标签与两种内距各写各的；同一语义（居中说明）出现了 6 种变体。
 * 这里只收口**容器与语义**，不强行统一文案；带复杂布局（自定义卡片/操作行）的空态继续写原生结构。
 *
 * 不新增 CSS：继续用 kit.css 的 .mb-empty / .mb-empty--inset（kit 声明数预算已顶格）。
 */
import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** 说明文案（或图标 + 文案等任意子节点）。 */
  children: ReactNode;
  /** 浮层/设置卡内（kit 的 --inset 变体：内距 20/0）。 */
  inset?: boolean;
  /** 读屏语义：搜索结果用 status，错误用 alert。 */
  role?: "status" | "alert";
  className?: string;
}

export function EmptyState({ children, inset, role, className }: EmptyStateProps) {
  return (
    <div
      className={"mb-empty" + (inset ? " mb-empty--inset" : "") + (className ? " " + className : "")}
      {...(role ? { role } : {})}
    >
      {children}
    </div>
  );
}
