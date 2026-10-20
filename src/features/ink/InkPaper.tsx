import { useId } from "react";
import type { InkBackground } from "../../core/inkDoc.js";

export interface InkPaperProps {
  width: number;
  height: number;
  background: InkBackground;
}

/**
 * 纸张底纹放在 SVG 逻辑坐标里，而不是 CSS 像素背景：
 * 缩放页面时线条/点阵必须跟着墨迹一起缩放，不能因容器变大而改变纸张密度。
 */
export function InkPaper({ width, height, background }: InkPaperProps) {
  const rawId = useId();
  const patternId = "ink-paper-" + rawId.replace(/:/g, "");

  return (
    <>
      {background !== "blank" && (
        <defs>
          {background === "lined" ? (
            <pattern id={patternId} width={width} height={32} patternUnits="userSpaceOnUse">
              <line x1="0" y1="31.5" x2={width} y2="31.5" stroke="var(--lake-border-1)" strokeWidth="1" />
            </pattern>
          ) : background === "grid" ? (
            <pattern id={patternId} width={32} height={32} patternUnits="userSpaceOnUse">
              <path d="M 0 31.5 H 32 M 31.5 0 V 32" fill="none" stroke="var(--lake-border-1)" strokeWidth="1" />
            </pattern>
          ) : (
            <pattern id={patternId} width={16} height={16} patternUnits="userSpaceOnUse">
              <circle cx="8" cy="8" r="1.4" fill="var(--lake-border-strong)" />
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
