import type { ThemeMode } from "./settings";
import { themeById } from "./themes";

/** 应用主题（主题即数据）：只切 data-theme 属性，取值由 src/styles/themes/*.css 定义。
 *  colorScheme 由主题注册表给出（暖色纸质属 light 系，必须显式声明，否则原生控件会发黑）。 */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = themeById(theme).colorScheme;
}
