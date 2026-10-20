import { getStroke } from "perfect-freehand";
import type { InkPoint, InkStroke } from "../../core/inkDoc.js";

/** perfect-freehand 输出的是轮廓多边形；这里用直线段闭合为 SVG path。 */
export function outlineToSvgPath(points: number[][]): string {
  if (points.length === 0) return "";
  const first = points[0];
  let d = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    d += ` L ${point[0].toFixed(2)} ${point[1].toFixed(2)}`;
  }
  return d + " Z";
}

function usesRealPressure(stroke: InkStroke): boolean {
  return stroke.points.some((point) => point.pressure !== 0.5);
}

export function strokeToSvgPath(stroke: InkStroke, last: boolean): string {
  if (stroke.points.length === 0) return "";
  const input = stroke.points.map((point) => [point.x, point.y, point.pressure] as [number, number, number]);
  const outline = getStroke(input, {
    size: stroke.width,
    thinning: 0.55,
    smoothing: 0.55,
    streamline: 0.5,
    simulatePressure: !usesRealPressure(stroke),
    last,
  });
  return outlineToSvgPath(outline);
}

function pointToSegmentDistance(point: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

/** 笔迹级橡皮：命中任意线段/单点即整条删除（第一版语义，不做像素级擦除）。 */
export function hitTestStroke(stroke: InkStroke, point: InkPoint, extra = 8): boolean {
  const threshold = Math.max(6, stroke.width / 2 + extra);
  if (stroke.points.length === 1) return Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y) <= threshold;
  for (let i = 1; i < stroke.points.length; i += 1) {
    if (pointToSegmentDistance(point, stroke.points[i - 1], stroke.points[i]) <= threshold) return true;
  }
  return false;
}
