/**
 * 媒体缩放几何（纯函数，图片/视频共用）。
 *
 * 手感对齐思源（siyuan-master app/src/protyle/wysiwyg/index.ts:1908）：
 *   newWidth = clamp(startWidth + 总位移 × 符号 × 对齐系数, min, max)
 * 每帧都相对**拖动起点的固定快照**计算，不累加上一帧结果 ⇒ 线性、无漂移、松手不跳。
 *
 * 对齐系数（思源 multiple 语义）：宽度变化时「被拖的那条边」移动量 = 光标位移量。
 *   - 左对齐：宽度增量全部落在右边 ⇒ 右边走 delta ⇒ 系数 1；
 *   - 居中：两边各走 delta/2、总宽走 2×delta ⇒ 右边走 delta ⇒ 系数 2；
 *   - 右对齐：左边走 delta ⇒ 系数 1（把手在左边）。
 * ⇒ 把手只出现在「宽度变化时会移动的边」上，被拖边缘永远与光标 1:1 贴合。
 */

export type MediaAlignment = "left" | "center" | "right";
export type MediaSide = "left" | "right";
export type MediaHandleId = "edge-left" | "edge-right" | "corner-tl" | "corner-tr" | "corner-br" | "corner-bl";

export interface MediaHandleSpec {
  id: MediaHandleId;
  kind: "edge" | "corner";
  side: MediaSide;
  cursor: string;
}

/** 宽度变化时会移动的边；把手只出现在这些边上（锚定边的把手无法跟手，一律不给）。 */
export function movingSidesFor(alignment: MediaAlignment): MediaSide[] {
  if (alignment === "center") return ["left", "right"];
  return alignment === "right" ? ["left"] : ["right"];
}

/** 对齐系数：保证被拖边缘与光标 1:1（思源 multiple = 1|2）。 */
export function alignmentFactor(alignment: MediaAlignment): 1 | 2 {
  return alignment === "center" ? 2 : 1;
}

/** 一个对齐下应挂载的把手（边缘长条 + 两侧角点）。 */
export function handlesFor(alignment: MediaAlignment): MediaHandleSpec[] {
  const specs: MediaHandleSpec[] = [];
  for (const side of movingSidesFor(alignment)) {
    specs.push({ id: side === "right" ? "edge-right" : "edge-left", kind: "edge", side, cursor: "ew-resize" });
    if (side === "right") {
      specs.push({ id: "corner-tr", kind: "corner", side, cursor: "nesw-resize" });
      specs.push({ id: "corner-br", kind: "corner", side, cursor: "nwse-resize" });
    } else {
      specs.push({ id: "corner-tl", kind: "corner", side, cursor: "nwse-resize" });
      specs.push({ id: "corner-bl", kind: "corner", side, cursor: "nesw-resize" });
    }
  }
  return specs;
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export interface ResizeValueRequest {
  /** 拖动起点的宽度值（px 或百分比，快照，拖动中不变）。 */
  startValue: number;
  /** 光标相对起点的总位移（px，右为正）。 */
  deltaPx: number;
  side: MediaSide;
  /** 对齐系数（alignmentFactor）。 */
  factor: 1 | 2;
  /** 1px 光标位移对应的「值」变化量（图片 = 1；视频 = 100/正文宽）。拖动前算好，拖动中不变。 */
  unitPerPixel: number;
  min: number;
  max: number;
  /** 值的小数位（图片 px = 0；视频百分比 = 1）。 */
  decimals: number;
}

/** 线性映射 + 夹取 + 定点取整；与拖动历史无关（只看起点与总位移）。 */
export function computeResizeValue(req: ResizeValueRequest): number {
  const sign = req.side === "right" ? 1 : -1;
  const raw = req.startValue + req.deltaPx * sign * req.factor * req.unitPerPixel;
  return roundTo(Math.min(req.max, Math.max(req.min, raw)), req.decimals);
}
