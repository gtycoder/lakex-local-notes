/**
 * 纸张底纹几何的**唯一来源**（画布 SVG 与「导出 PDF/SVG/PNG」共用）。
 *
 * 261104 十七批：导出现在也要印底纹（用户定稿：和当前页状态一致，有底纹就保留）。
 * 画布侧用 React 画（InkPaper.tsx，颜色取 CSS 变量随主题切换）；导出侧拼字符串（打印文档没有
 * 主题变量 ⇒ 固定用浅色主题的边线色，页底永远是白纸）。两边**只共享几何数字与颜色常量**，
 * 各自输出自己那份 markup —— 之前这些魔数（32 / 16 / 1.4 / 31.5）只躺在 InkPaper.tsx 里。
 */
import type { InkBackground } from "./inkDoc.js";

/** 横线/网格的行距（逻辑 px）。 */
export const INK_PAPER_PITCH = 32;
/** 点阵的格距（逻辑 px）。 */
export const INK_PAPER_DOT_PITCH = 16;
/** 点阵圆点半径。 */
export const INK_PAPER_DOT_RADIUS = 1.4;
/** 线条画在格距边缘内缩半个描边（32 → 31.5），保证首行/首列不被裁掉。 */
export const INK_PAPER_STROKE_OFFSET = INK_PAPER_PITCH - 0.5;
export const INK_PAPER_STROKE_WIDTH = 1;

/** 导出侧颜色 = 浅色主题的 --lake-border-1 / --lake-border-strong（打印文档没有主题变量）。 */
export const INK_PAPER_EXPORT_COLORS = { line: "#e6e8ec", dot: "#d3d7de" } as const;

export function isPaperBackground(background: InkBackground): boolean {
  return background !== "blank";
}
