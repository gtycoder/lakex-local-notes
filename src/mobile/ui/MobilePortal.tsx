/**
 * 移动端浮层 portal（单一来源，261120）。
 *
 * 为什么需要：移动端浮层原语（`MobileSheet` 等）都是 `position: fixed`，而**内核 React 树里**渲染的浮层
 * （文档引用卡片、编辑面板等）可能处在带 `transform` 的祖先下 ⇒ fixed 的包含块变成祖先、浮层贴不到视口底
 * （AGENTS「transform 祖先破坏 fixed」）。把 portal 收成这一处，业务代码不各自写 createPortal
 * （`src/styles/uiPrimitives.test.ts` 的白名单只放行本文件）。
 */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function MobilePortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}
