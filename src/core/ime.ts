/**
 * IME（输入法）组合态判据 —— **单一来源**（261115，MODERN-WEB-AUDIT A01）。
 *
 * 为什么需要：中文/日文输入法在「确认候选词」时也会发 Enter。若把这种 Enter 当成
 * 「提交 / 重命名 / 发送」，用户会提交半截文本（真实缺陷）。
 *
 * 口径（modern-web-guidance `ime-safe-enter-submit`）：
 * · Chromium / Android WebView 现代版本：`KeyboardEvent.isComposing === true` 即组合中；
 * · 旧 WebView 兼容：部分实现在组合确认时给 `keyCode === 229`；
 * · `keyCode === 13` **不是**判据（那本来就是普通回车，官方明确不要用它替代）。
 *
 * 为什么还要拆 `nativeEvent`：React 的 SyntheticKeyboardEvent **不保证**带 `isComposing`
 * （实测 @types/react 18 无该字段），真值只在原生事件上；本函数两种入参都收：
 * React 合成事件 → 读 `nativeEvent`；原生事件 → 直接读。
 *
 * 用法：`if (event.key === "Enter" && !isImeConfirming(event)) { …提交… }`
 */
export interface ImeCompositionLike {
  /** KeyboardEvent.isComposing */
  isComposing?: boolean;
  /** 旧 WebView 的组合确认键码 */
  keyCode?: number;
  /** React 合成事件的原生事件 */
  nativeEvent?: ImeCompositionLike | null;
}

/** 该按键事件是否是输入法组合过程中的「确认」回车（不应触发提交）。 */
export function isImeConfirming(event: ImeCompositionLike | null | undefined): boolean {
  if (!event) return false;
  const native = event.nativeEvent ?? event;
  return native.isComposing === true || native.keyCode === 229;
}
