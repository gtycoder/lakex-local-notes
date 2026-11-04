/**
 * 笔迹渲染样式**唯一来源**（261104 十六批）。
 *
 * 背景：同一条「高亮 = 不透明 0.3 + multiply」被抄在 4 处（静态层 / 正在写的笔 / 缩略图 / 导出 PDF），
 * 而且已经漂了（缩略图 0.35）。用户定稿：**不做更多笔工具类型**，只要「锋利感 / 平滑感」两个维度可调，
 * 所以把 perfect-freehand 参数 + 不透明度/混合模式全部收进这张表：改笔感只改这里，
 * 组件与导出侧都不许再写字面量。
 */
import type { InkTool } from "../../core/inkDoc.js";

export interface InkStrokeStyle {
  /** perfect-freehand：越大越随压力/速度收锋（0 = 等宽，荧光笔/马克笔用）。 */
  thinning: number;
  /** 越大越平滑（拐点被拉圆）——「平滑感」旋钮。 */
  smoothing: number;
  streamline: number;
  /** 起止端收锋长度（逻辑 px，0 = 圆头）——「锋利感」旋钮。 */
  startTaper: number;
  endTaper: number;
  opacity: number;
  /** 只有高亮笔需要 multiply（盖住文字但仍看得见）；普通笔不设。 */
  blend?: "multiply";
}

/** 普通笔：跟随压感变粗细，端点保持圆头（当前观感，改笔感就从这三个数动手）。 */
const PEN_STYLE: InkStrokeStyle = {
  thinning: 0.55,
  smoothing: 0.55,
  streamline: 0.5,
  startTaper: 0,
  endTaper: 0,
  opacity: 1,
};

/** 高亮笔：宽面马克笔 ⇒ 等宽（thinning 0），半透明 + multiply 才有「盖住文字但仍看得见」的效果。 */
const HIGHLIGHTER_STYLE: InkStrokeStyle = {
  thinning: 0,
  smoothing: 0.55,
  streamline: 0.5,
  startTaper: 0,
  endTaper: 0,
  opacity: 0.3,
  blend: "multiply",
};

export function inkStrokeStyle(tool: InkTool): InkStrokeStyle {
  return tool === "highlighter" ? HIGHLIGHTER_STYLE : PEN_STYLE;
}
