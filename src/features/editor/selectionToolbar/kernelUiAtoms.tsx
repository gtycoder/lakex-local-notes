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

/**
 * 内核「嵌入图标」（FrameworkUiLib.EmbedIcon）：固定工具栏颜色按钮用的动态图标，
 * 传 type=`t-font-color`/`t-bg-color` + fill=当前色 ⇒ 图标下划线随当前色变化。
 * 浮动颜色按钮必须用它，才能和固定栏一样显示「上次使用色 / 默认色」。
 */
export function KEmbedIcon({ variant, color }: { variant: "text" | "bg"; color: string }) {
  const Embed: any = uiLib().EmbedIcon;
  if (!Embed) return null;
  return createElement(Embed, { type: variant === "text" ? "t-font-color" : "t-bg-color", fill: color });
}

/**
 * 内核「链接编辑弹层」：完全按内核 `plugins/link` 的 `.ne-link-editor` 结构渲染
 * （文本 / 链接 两个 Input + 确定 Button），文案与类名都用内核的 ⇒ 与固定栏弹窗逐项一致。
 * 输入框用 FrameworkUiLib.Input（= 内核 AU）、按钮用 FrameworkUiLib.Button（= 内核 er4）。
 */
export function KLinkEditor({ text, src, allowModifyText, invalid, onChangeText, onChangeSrc, onConfirm }: {
  text: string; src: string; allowModifyText: boolean; invalid: boolean;
  onChangeText: (value: string) => void; onChangeSrc: (value: string) => void; onConfirm: () => void;
}) {
  const lib = uiLib();
  const Input: any = lib.Input;
  const Button: any = lib.Button;
  if (!Input || !Button) return null;
  const onKeyDown = (event: { key?: string; preventDefault?: () => void }) => {
    if (event.key === "Enter") { event.preventDefault?.(); onConfirm(); }
  };
  return createElement(
    "div",
    { className: "ne-link-editor" },
    createElement(
      "div",
      { className: "ne-link-editor-field" },
      createElement("label", null,
        createElement("div", { className: "ne-link-editor-field-title" }, "文本"),
        createElement(Input, { value: text, disabled: !allowModifyText, placeholder: "添加描述", onChange: (e: any) => onChangeText(e.target.value ?? ""), onKeyDown }),
      ),
    ),
    createElement(
      "div",
      { className: "ne-link-editor-field" },
      createElement("label", null,
        createElement("div", { className: "ne-link-editor-field-title" }, "链接"),
        createElement(Input, { value: src, placeholder: "链接地址", onChange: (e: any) => onChangeSrc(e.target.value ?? ""), onKeyDown }),
      ),
      invalid ? createElement("div", { className: "ne-link-error-tip" }, "请输入正确的链接") : null,
    ),
    createElement(Button, { onClick: onConfirm, disabled: !src || invalid }, "确定"),
  );
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
    // disabled 时连外层冒泡点击也不接（内核按钮会拦，但我们的包裹 span 仍会冒到 onClick）。
    { className: "selection-toolbar__kbtn", onClick: disabled ? undefined : onClick },
    createElement(
      Tb,
      { name, className: cls, disabled, title, "aria-label": title, "aria-pressed": checked || undefined },
      icon ? createElement(KIcon, { type: icon }) : null,
      children ?? null,
      caret ? createElement("span", { className: caretClass ?? "ne-ui-toolbar-arrow-down" }) : null,
    ),
  );
}

