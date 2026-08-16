/**
 * 主题与自定义 CSS 应用（思源式自定义 UI）。
 * - applyTheme：设置 <html data-theme="dark|light">，b3 令牌（daylight/midnight）据此切换；
 * - applyCustomCss：注入用户自定义 CSS 到 <style id="lake-custom-css">。
 */
import type { ThemeMode } from "./settings";

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function applyCustomCss(css: string): void {
  const id = "lake-custom-css";
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  if (!css.trim()) {
    existing?.remove();
    return;
  }
  let el = existing;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
