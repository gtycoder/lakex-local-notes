/**
 * 「文档引用」卡的**插入面板图标**（用户 261008 设计稿：浅色 72×72 网格原样搬运，
 * 深色由同一份几何 + 另一套调色板重绘；调色板见 `src/styles/themes/base.css` 的 `--lake-note-ref-icon-*`）。
 *
 * ⚠️ 内核自定义卡的图标约定（见 `vendor/lakex-doc-react/src/components/lakex/icon.tsx` 与
 * `types.ts` 的 `CustomCard.icon`）：**组件不渲染可见图形**，而是渲染一整个 `<symbol id=...>`；
 * 真正的 `<svg>` 由内核 sprite 提供，面板按 `slash.icon` 的值用 `<use xlink:href="#<id>">` 引用，
 * 尺寸由 CSS 的 font-size 决定（卡片选择面板的图标盒 36px ⇒ 本 72 网格按 0.5 缩放：
 * 描边 2 → 1px、底框 1.8 → 0.9px）。symbol 由 `lakeRuntime.ensureCustomCardIcons()` 收进隐藏 sprite。
 *
 * ⚠️ **为什么每个图形都写 `style` 里的 CSS 变量**（本项目「禁止内联样式」的唯一例外）：
 * `<use>` 的内容活在 **shadow 树**里 —— **选择器打不到它，只有「继承」能进去**。
 * 所以随主题变化的颜色只能走自定义属性：变量在 `themes/base.css`（浅色=设计稿原值）与
 * `themes/dark.css`（深色重绘）里各定义一份，元素用 `style={{ fill: "var(--…)" }}` 取值
 * ⇒ 换主题时图标自动跟着换，**不需要第二份 symbol、也不依赖内核的别名表**。
 * （注意：`var()` 写在**presentation attribute**（`fill="var(…)"`）里浏览器不认，必须走 `style`。）
 */
import type { ReactElement } from "react";
import { NOTE_REF_ICON_ID } from "./noteRef";

/** 取调色板的简写：`paint("tile")` → `--lake-note-ref-icon-tile`。 */
const iconVar = (name: string) => `var(--lake-note-ref-icon-${name})`;

export function NoteRefIconSymbol(): ReactElement {
  return (
    <symbol id={NOTE_REF_ICON_ID} viewBox="0 0 72 72" fill="none">
      {/* 底框：圆角方块（浅色白底 / 深色暗底） */}
      <rect
        x="1" y="1" width="70" height="70" rx="12"
        style={{ fill: iconVar("tile"), stroke: iconVar("tile-border"), strokeWidth: 1.8 }}
      />
      {/* 文档主体 + 折角 */}
      <path
        d="M18 12.5H40.5L51 23V57C51 59.2 49.2 61 47 61H18C15.8 61 14 59.2 14 57V16.5C14 14.3 15.8 12.5 18 12.5Z"
        style={{ fill: iconVar("page"), stroke: iconVar("page-ink"), strokeWidth: 2, strokeLinejoin: "round" }}
      />
      <path
        d="M40.5 12.5V21C40.5 22.1 41.4 23 42.5 23H51"
        style={{ fill: iconVar("fold"), stroke: iconVar("page-ink"), strokeWidth: 2, strokeLinejoin: "round" }}
      />
      {/* 两条正文示意线（灰）+ 一条高亮短线（蓝）；高亮线不断线，深色下换亮蓝 */}
      <path d="M22 29H42" style={{ stroke: iconVar("rule"), strokeWidth: 1.8, strokeLinecap: "round" }} />
      <path d="M22 37H37" style={{ stroke: iconVar("rule"), strokeWidth: 1.8, strokeLinecap: "round" }} />
      <path d="M22 45H30" style={{ stroke: iconVar("accent"), strokeWidth: 2.4, strokeLinecap: "round" }} />
      {/* 右下角链接：先用「底框色」粗描边挖空，再叠设计稿的绿钩（顺序不能反，绿钩要压在挖空之上）。
          挖空色 = tile ⇒ 深色下自然变成"从暗底框里挖出来"。 */}
      <g transform="translate(36 40)">
        <path
          d="M10 13L7.2 15.8C5.3 17.7 5.3 20.7 7.2 22.6C9.1 24.5 12.1 24.5 14 22.6L18 18.6C19.9 16.7 19.9 13.7 18 11.8"
          style={{ stroke: iconVar("knockout"), strokeWidth: 5.8, strokeLinecap: "round", strokeLinejoin: "round" }}
        />
        <path
          d="M14 13L16.8 10.2C18.7 8.3 18.7 5.3 16.8 3.4C14.9 1.5 11.9 1.5 10 3.4L6 7.4C4.1 9.3 4.1 12.3 6 14.2"
          style={{ stroke: iconVar("knockout"), strokeWidth: 5.8, strokeLinecap: "round", strokeLinejoin: "round" }}
        />
        <path
          d="M10 13L7.2 15.8C5.3 17.7 5.3 20.7 7.2 22.6C9.1 24.5 12.1 24.5 14 22.6L18 18.6C19.9 16.7 19.9 13.7 18 11.8"
          style={{ stroke: iconVar("link"), strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
        />
        <path
          d="M14 13L16.8 10.2C18.7 8.3 18.7 5.3 16.8 3.4C14.9 1.5 11.9 1.5 10 3.4L6 7.4C4.1 9.3 4.1 12.3 6 14.2"
          style={{ stroke: iconVar("link"), strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
        />
        <path d="M9 16L15 10" style={{ stroke: iconVar("link"), strokeWidth: 2, strokeLinecap: "round" }} />
      </g>
    </symbol>
  );
}
