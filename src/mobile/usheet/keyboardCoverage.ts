/**
 * 「输入框不被键盘盖」判据 —— 可复用断言（261117 task-4：Univer 表格键盘排查收口顺带沉淀）。
 *
 * 口径（与 261117 多维表键盘收口、命名弹窗真机实测同一把尺）：**inputBottom ≤ innerHeight − 8**。
 * · innerHeight = 键盘弹起后的 window.innerHeight（adjustResize 下即「键盘上沿」所在视口高）；
 * · 8px = 贴边余量（KEYBOARD_COVER_MARGIN_PX）；
 * · covered = inputBottom > innerHeight − 8。
 *
 * 用法（render / jsdom 测试，判据单一来源，别在测试里再抄不等式）：
 *   const cov = elementKeyboardCoverage(input);
 *   expect(cov.covered, describeKeyboardCoverage(cov)).toBe(false);
 * 或 assertInputNotKeyboardCovered(input) —— 被盖时抛带两数的 Error。
 *
 * 设备探针同口径：读 input.getBoundingClientRect().bottom 与 innerHeight 两数一比即 covered。
 * 后续如需全仓复用（文档 dock / 多维表），可整体上移 src/mobile/ui/，本模块无需改动。
 */

/** 输入框底边与可视区底边保留的余量（口径里的 8）。 */
export const KEYBOARD_COVER_MARGIN_PX = 8;

export interface KeyboardCoverage {
  /** 输入框底边（getBoundingClientRect().bottom）。 */
  inputBottom: number;
  /** 键盘上方的安全底边 = innerHeight − margin。 */
  visibleBottom: number;
  /** 是否被键盘盖住（inputBottom > visibleBottom）。视口未测量（innerHeight ≤ 0）不判盖。 */
  covered: boolean;
}

/** 纯判据：输入框底边 + 键盘弹起后的视口高 → 是否被键盘盖。 */
export function keyboardCoverageOf(
  inputBottom: number,
  innerHeight: number,
  margin = KEYBOARD_COVER_MARGIN_PX,
): KeyboardCoverage {
  const visibleBottom = innerHeight - margin;
  if (!(innerHeight > 0)) return { inputBottom, visibleBottom, covered: false };
  return { inputBottom, visibleBottom, covered: inputBottom > visibleBottom };
}

/** DOM 入口：元素底边 vs 当前视口高（jsdom 里 rect / innerHeight 都可 stub）。 */
export function elementKeyboardCoverage(
  el: { getBoundingClientRect(): { bottom: number } },
  innerHeight: number = typeof window === "undefined" ? 0 : window.innerHeight,
  margin = KEYBOARD_COVER_MARGIN_PX,
): KeyboardCoverage {
  return keyboardCoverageOf(el.getBoundingClientRect().bottom, innerHeight, margin);
}

/** 断言失败信息：把两数一并打出（设备对不上时先看这两个数）。 */
export function describeKeyboardCoverage(cov: KeyboardCoverage): string {
  return "inputBottom=" + cov.inputBottom + " visibleBottom=" + cov.visibleBottom + "（innerHeight−" + KEYBOARD_COVER_MARGIN_PX + "）";
}

/** 可复用断言：元素没被键盘盖；被盖抛 Error（带两数），未盖返回判据明细。 */
export function assertInputNotKeyboardCovered(
  el: { getBoundingClientRect(): { bottom: number } },
  innerHeight?: number,
  margin = KEYBOARD_COVER_MARGIN_PX,
): KeyboardCoverage {
  const cov = elementKeyboardCoverage(el, innerHeight, margin);
  if (cov.covered) throw new Error("输入框被软键盘盖住：" + describeKeyboardCoverage(cov));
  return cov;
}
