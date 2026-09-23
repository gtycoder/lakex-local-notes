/**
 * 浮动工具栏内核原子件：直接用内核 FrameworkUiLib 原语渲染（ToolbarButton / Icon）。
 *
 * 已实测契约（spike 见 exp/kernel-ui-primitives）：
 *   - Icon: prop 是 type（如 "bold"/"editor-color"），不是 name。
 *   - ToolbarButton: (name, className, children…) → 自动补 ant-btn ne-ui-t-button，
 *     其余类名与固定工具栏逐类对齐（真身见 .ne-ui-toolbar 实测）。
 *   - 内核 FrameworkUiLib.Select 是 antd Select，外观与固定栏的「正文 ▾」文本下拉不一致 ⇒ 不用。
 *
 * 事件：内核 ToolbarButton 的 onClick 透传无文档承诺，故用一层 display:contents 的 span
 * 承接冒泡（display:contents 不生成盒子，不影响 toolbar 的 flex 布局与相邻选择器），
 * 只在外层挂一次 onClick，避免透传+冒泡双触发。
 */
import { createElement, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Doc } from "@dlient/lakex-doc-react";

/* eslint-disable @typescript-eslint/no-explicit-any */
function uiLib(): Record<string, any> {
  return ((Doc as unknown as { FrameworkUiLib?: Record<string, any> }).FrameworkUiLib) ?? {};
}

export function KIcon({ type, size }: { type: string; size?: number }) {
  const Icon: any = uiLib().Icon;
  if (!Icon) return null;
  return createElement(Icon, { type: type.startsWith('icon-') ? type : 'icon-' + type, size });
}

export function KToolbarButton({ name, icon, caret, caretClass, checked, disabled, className, title, onClick, children }: {
  name: string; icon?: string; caret?: boolean; caretClass?: string; checked?: boolean; disabled?: boolean;
  className?: string; title?: string; onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void; children?: ReactNode;
}) {
  const Tb: any = uiLib().ToolbarButton;
  if (!Tb) return null;
  const cls = [className ?? "", checked ? "checked" : ""].filter(Boolean).join(" ");
  return createElement(
    "span",
    { className: "selection-toolbar__kbtn", onClick },
    createElement(
      Tb,
      { name, className: cls, disabled, title, "aria-label": title, "aria-pressed": checked || undefined },
      icon ? createElement(KIcon, { type: icon }) : null,
      children ?? null,
      caret ? createElement("span", { className: caretClass ?? "ne-ui-toolbar-arrow-down" }) : null,
    ),
  );
}

