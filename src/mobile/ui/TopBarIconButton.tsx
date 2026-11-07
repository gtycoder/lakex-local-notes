/**
 * 顶栏图标按钮原语（261107 架构收敛）：把历史手写的 `<span role="button" tabIndex={0}>` 换成真 `<button>`。
 *
 * 旧写法缺 Enter/Space 激活、语义靠 role 补；这里统一 type/aria-label/title 与 .toolbar__icon 几何。
 * 不用于「行内的 ⋯/＋」——那些位于行按钮内部，嵌套 button 非法，由行自身语义承载（另行记录）。
 */
import type { ReactNode } from "react";

export interface TopBarIconButtonProps {
  /** 读屏名（同时作为 title 兜底）。 */
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  className?: string;
}

export function TopBarIconButton({ label, icon, onClick, title, disabled, className }: TopBarIconButtonProps) {
  return (
    <button
      type="button"
      className={"toolbar__icon" + (className ? " " + className : "")}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
    >{icon}</button>
  );
}
