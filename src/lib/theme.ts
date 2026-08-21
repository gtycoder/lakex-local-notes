import type { ThemeMode } from "./settings";

/** 应用思源 daylight/midnight 主题，不提供自定义 CSS 注入层。 */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
