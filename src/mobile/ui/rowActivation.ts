/**
 * 可点「行/卡片」的键盘激活原语（261107 a11y 收口）。
 *
 * 移动端大量 `<div role="button" tabIndex={0} onClick>` 卡片只处理了触摸/鼠标点击，
 * 外接键盘（平板/桌面模式）按 Enter/Space 没反应。这里统一 role/tabIndex 与键盘语义；
 * 事件处理仍由调用方给（本函数只生成属性，不吞业务逻辑）。
 */
import type { KeyboardEventHandler } from "react";

export interface RowActivationProps {
  role: "button";
  tabIndex: number;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
}

/** 生成 role/tabIndex/onKeyDown；Enter/Space 触发 onActivate（只认事件目标本身，避免子按钮冒泡误触）。 */
export function rowActivationProps(onActivate: () => void): RowActivationProps {
  return {
    role: "button",
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate();
      }
    },
  };
}
