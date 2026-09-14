/** 触感反馈（安卓语义：长按命中/危险操作给一次短震动；无 Vibration API 时静默跳过）。 */
type VibrateFn = (pattern: number | readonly number[]) => boolean;

export function vibrate(ms: number | readonly number[]): void {
  try {
    const nav = navigator as Navigator & { vibrate?: VibrateFn };
    if (typeof nav.vibrate === "function") nav.vibrate(ms);
  } catch { /* 不支持即忽略 */ }
}
/** 轻反馈：菜单项命中/进入重命名 */
export const tapFeedback = () => vibrate(8);
/** 长按命中 */
export const longPressFeedback = () => vibrate(14);
/** 危险/确认 */
export const warnFeedback = () => vibrate([10, 40, 10]);
/** 完成确认：保存成功/落点提交/创建成功（双击节奏，与危险三击区分） */
export const successFeedback = () => vibrate([12, 30, 12]);
