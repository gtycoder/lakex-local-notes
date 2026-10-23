/**
 * 「加密文本」卡的**插入面板图标**（内核约定见 `noteRefIcon.tsx` 文件头）：
 * 组件不渲染可见图形，只渲染一个 `<symbol>`；真正的 `<svg>` 由内核 sprite 提供，
 * 面板按 `slash.icon` 的值（必须是**全限定 symbol id**）用 `<use xlink:href="#<id>">` 引用，
 * 颜色因此随 `<use>` 的 color 继承（`currentColor` ⇒ 自动跟随主题，不需要第二份 symbol）。
 *
 * 为什么用 presentation attribute 而不是 `style={{...}}`：`currentColor` 在属性里就有效，
 * 不必破「组件里不写内联样式」的规矩（noteRefIcon 用 `style` 是因为它要取 CSS 变量）。
 */
import type { ReactElement } from "react";

/** 面板图标的 symbol id（**全限定**；改它旧正文不受影响，但面板会换成新图）。 */
export const LOCKED_TEXT_ICON_ID = "icon-lake-locked-text";

export function LockedTextIconSymbol(): ReactElement {
  return (
    <symbol id={LOCKED_TEXT_ICON_ID} viewBox="0 0 24 24" fill="none">
      {/* 锁体 */}
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.6" stroke="currentColor" strokeWidth="1.75" />
      {/* 锁梁 */}
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      {/* 锁孔 + 竖缝 */}
      <circle cx="12" cy="15.2" r="1.35" fill="currentColor" />
      <path d="M12 16.4V18.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </symbol>
  );
}
