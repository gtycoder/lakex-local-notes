/**
 * 收起软键盘的单一来源（261030 用户点单：输入完怎么收键盘）。
 *
 * Android WebView 没有 iOS 的「点空白收键盘」默认行为；textarea 又没有隐藏的完成键。
 * 统一口径：**点表单空白处**（落点不是输入控件）或**提交/选完日期**时，把当前可编辑元素 blur 掉。
 * 只用原生 blur —— 不注入 inputmode、不碰焦点环（输入框在移动端没有我们自己的焦点环）。
 */
import { noteViewport, shellHeight } from "../hooks/viewportShell";

/** 当前焦点是否在文本输入上（软键盘**大概率**开着）——返回键优先收键盘等判据共用。
 *  ⚠️ 它只是「键盘开着」的**代理**：Android 收起输入法**不会** blur WebView 里的元素，
 *  「焦点还在、键盘已收」是常态（261119 快捷 capture 退出链现场）；要判键盘本身用 softKeyboardVisible。 */
export function activeIsTextInput(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable === true;
}

/**
 * 软键盘**此刻是否真的可见**。判据与 hooks/useKeyboard 的 keyboardOpen 同口径：
 * 可见高差（adjustResize 的视口收缩 ∪ edge-to-edge 的 visualViewport 差值）> 8。
 * 用途：「返回键优先收键盘」只在**真有键盘可收**时才吞返回（见 useBackHandler 的 capture 退出链）。
 */
export function softKeyboardVisible(): boolean {
  if (typeof window === "undefined") return false;
  const ih = window.innerHeight;
  const vv = window.visualViewport;
  const vvH = vv ? Math.round(vv.height) : ih;
  const vvTop = vv ? Math.max(0, vv.offsetTop) : 0;
  // 顺手维护稳定外壳高基线（无 useKeyboard 订阅者时判据也能工作；幂等、只增不减）。
  noteViewport(ih, vvH);
  const off = Math.max(0, Math.round(ih - vvH - vvTop));
  const shrunk = Math.max(0, Math.round(shellHeight() - ih));
  return Math.max(off, shrunk) > 8;
}

export function dismissKeyboard(): void {
  if (!activeIsTextInput()) return;
  try { (document.activeElement as HTMLElement).blur(); } catch { /* 元素可能已卸载：无副作用 */ }
}

/** 点按空白处收键盘：落点仍是输入控件（input/textarea/select/contenteditable）时不动。 */
export function dismissKeyboardOnPointerDown(event: { target: EventTarget | null }): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
  dismissKeyboard();
}
