import { useId } from "react";
import type { InkBackground } from "../../core/inkDoc.js";
import {
  INK_PAPER_DOT_PITCH,
  INK_PAPER_DOT_RADIUS,
  INK_PAPER_PITCH,
  INK_PAPER_STROKE_OFFSET,
  INK_PAPER_STROKE_WIDTH,
} from "../../core/inkPaperGeometry.js";

export interface InkPaperProps {
  width: number;
  height: number;
  background: InkBackground;
}

/**
 * 纸张底纹放在 SVG 逻辑坐标里，而不是 CSS 像素背景：
 * 缩放页面时线条/点阵必须跟着墨迹一起缩放，不能因容器变大而改变纸张密度。
 * 几何数字来自 core/inkPaperGeometry（导出侧同一份，别再在这里写魔数）。
 */
export function InkPaper({ width, height, background }: InkPaperProps) {
  const rawId = useId();
  const patternId = "ink-paper-" + rawId.replace(/:/g, "");

  return (
    <>
      {background !== "blank" && (
        <defs>
          {background === "lined" ? (
            <pattern id={patternId} width={width} height={INK_PAPER_PITCH} patternUnits="userSpaceOnUse">
              <line x1="0" y1={INK_PAPER_STROKE_OFFSET} x2={width} y2={INK_PAPER_STROKE_OFFSET} stroke="var(--lake-border-1)" strokeWidth={INK_PAPER_STROKE_WIDTH} />
            </pattern>
          ) : background === "grid" ? (
            <pattern id={patternId} width={INK_PAPER_PITCH} height={INK_PAPER_PITCH} patternUnits="userSpaceOnUse">
              <path d={`M 0 ${INK_PAPER_STROKE_OFFSET} H ${INK_PAPER_PITCH} M ${INK_PAPER_STROKE_OFFSET} 0 V ${INK_PAPER_PITCH}`} fill="none" stroke="var(--lake-border-1)" strokeWidth={INK_PAPER_STROKE_WIDTH} />
            </pattern>
          ) : (
            <pattern id={patternId} width={INK_PAPER_DOT_PITCH} height={INK_PAPER_DOT_PITCH} patternUnits="userSpaceOnUse">
              <circle cx={INK_PAPER_DOT_PITCH / 2} cy={INK_PAPER_DOT_PITCH / 2} r={INK_PAPER_DOT_RADIUS} fill="var(--lake-border-strong)" />
            </pattern>
          )}
        </defs>
      )}
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill={background === "blank" ? "transparent" : `url(#${patternId})`}
      />
    </>
  );
}

export default InkPaper;
