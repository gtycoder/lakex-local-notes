/**
 * 关闭浮层后的焦点归还（261116）。
 *
 * 为什么需要：触发器经常在「打开浮层」的同一次更新里被卸载（顶栏菜单项 → 设置对话框、
 * 移动端卡片「更多」→ 标签 Sheet）。原来只判 isConnected ⇒ 直接放弃，焦点落到 body，
 * 键盘用户失去位置。这里加一级兜底：回到主区域（landmark），而不是 body。
 */
export function restoreFocus(target: HTMLElement | null | undefined): void {
  if (target && target.isConnected && typeof target.focus === "function") {
    target.focus({ preventScroll: true });
    return;
  }
  focusMainRegion();
}

/** 焦点退到主区域：main/[role=main] 默认不可聚焦 ⇒ 临时补 tabindex=-1，失焦即摘掉。 */
export function focusMainRegion(): void {
  if (typeof document === "undefined") return;
  const main = document.querySelector<HTMLElement>("main, [role=main]");
  if (!main) return;
  const injected = !main.hasAttribute("tabindex");
  if (injected) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
  if (injected) main.addEventListener("blur", () => { main.removeAttribute("tabindex"); }, { once: true });
}
