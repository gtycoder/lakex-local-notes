/**
 * 触感反馈：**只在有意义的时刻震**（用户 260914 拍板收敛）。
 * 保留三类：长按命中、破坏性/失败告警、完成确认（保存/落点提交/创建成功）。
 * 不再对「每一次点击」震动——切 tab、开文档、开抽屉、开菜单都不震，
 * 否则用户会很快对震动脱敏（Apple「多模态反馈」口径：只在成功/错误/提交/吸附时给）。
 * 无 Vibration API 时静默跳过。
 */
type VibrateFn = (pattern: number | readonly number[]) => boolean;

export function vibrate(ms: number | readonly number[]): void {
  try {
    const nav = navigator as Navigator & { vibrate?: VibrateFn };
    if (typeof nav.vibrate === "function") nav.vibrate(ms);
  } catch { /* 不支持即忽略 */ }
}
/** 长按命中 */
export const longPressFeedback = () => vibrate(14);
/** 危险/确认 */
export const warnFeedback = () => vibrate([10, 40, 10]);
/** 完成确认：保存成功/落点提交/创建成功（双击节奏，与危险三击区分） */
export const successFeedback = () => vibrate([12, 30, 12]);
