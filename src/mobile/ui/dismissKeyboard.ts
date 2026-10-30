/**
 * 收起软键盘的单一来源（261030 用户点单：输入完怎么收键盘）。
 *
 * Android WebView 没有 iOS 的「点空白收键盘」默认行为；textarea 又没有隐藏的完成键。
 * 统一口径：**点表单空白处**（落点不是输入控件）或**提交/选完日期**时，把当前可编辑元素 blur 掉。
 * 只用原生 blur —— 不注入 inputmode、不碰焦点环（输入框在移动端没有我们自己的焦点环）。
 */
export function dismissKeyboard(): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable) {
    try { active.blur(); } catch { /* 元素可能已卸载：无副作用 */ }
  }
}

/** 点按空白处收键盘：落点仍是输入控件（input/textarea/select/contenteditable）时不动。 */
export function dismissKeyboardOnPointerDown(event: { target: EventTarget | null }): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
  dismissKeyboard();
}
