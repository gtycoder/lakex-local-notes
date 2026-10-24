/**
 * 「加密文本」卡的**插入面板图标**（设计 261024：圆角底板 + 居中挂锁；不保留示意文本线/锁面板）。
 *
 * 与 `noteRefIcon.tsx` 同一套内核约定：组件不渲染可见图形，只渲染一个 `<symbol>`；
 * 真正的 `<svg>` 由内核 sprite 提供，面板按 `slash.icon` 的值（**全限定 symbol id**）用
 * `<use xlink:href="#<id>">` 引用。颜色只能靠**继承**进入 `<use>` 的 shadow 树 ⇒
 * 调色板走 `--lake-locked-text-icon-*`（浅色见 `themes/base.css`、深色见 `themes/dark.css`），
 * 元素上用 `style={{ fill: var(…) }}` 取值（`var()` 在 presentation attribute 里不生效）。
 *
 * 几何按 **72×72** 网格绘制：面板图标盒 36px ⇒ 0.5 缩放（锁描边 3 → 1.5px），
 * 与 note-ref 的 72 网格同尺度。锁体放大并居中，36px 下不再有浅灰“文档示意”干扰。
 */
import type { ReactElement } from "react";

/** 面板图标的 symbol id（**全限定**；改它旧正文不受影响，但面板会换成新图）。 */
export const LOCKED_TEXT_ICON_ID = "icon-lake-locked-text";

const iconVar = (name: string) => `var(--lake-locked-text-icon-${name})`;

export function LockedTextIconSymbol(): ReactElement {
  return (
    <symbol id={LOCKED_TEXT_ICON_ID} viewBox="0 0 72 72" fill="none">
      {/* 底框：圆角底板（与菜单其他图标同语言） */}
      <rect
        x="1" y="1" width="70" height="70" rx="12"
        style={{ fill: iconVar("tile"), stroke: iconVar("tile-border") }}
        strokeWidth="1.8"
      />
      {/* 锁梁 */}
      <path
        d="M27.5 33V28.5A8.5 8.5 0 0 1 44.5 28.5V33"
        style={{ stroke: iconVar("ink") }}
        strokeWidth="3" strokeLinecap="round"
      />
      {/* 锁体 */}
      <rect
        x="21" y="32" width="30" height="19" rx="5"
        style={{ fill: iconVar("tile"), stroke: iconVar("ink") }}
        strokeWidth="3"
      />
      {/* 锁孔 */}
      <circle cx="36" cy="38.8" r="2.2" style={{ fill: iconVar("ink") }} />
      <path d="M36 40.8V45.8" style={{ stroke: iconVar("ink") }} strokeWidth="3" strokeLinecap="round" />
    </symbol>
  );
}
