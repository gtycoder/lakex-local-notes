import type { ThemeMode } from "./settings";
import { themeById } from "./themes";

/** 应用主题（主题即数据）：只切 data-theme 属性，取值由 src/styles/themes/*.css 定义。
 *  colorScheme 由主题注册表给出（暖色纸质属 light 系，必须显式声明，否则原生控件会发黑）。 */
export function applyTheme(theme: ThemeMode): void {
  const { colorScheme } = themeById(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = colorScheme;
  // win32 融合标题栏（261123）：原生窗口控制按钮配色跟随主题色阶（light/dark 档；暖色/清爽属 light）。
  // 只发色阶字符串——配色常量单一来源 = electron/mainWindowOptions.ts（glue 测试对 themes/*.css 逐值校验）。
  // 直接走 window.lakeNative（不 import native.ts：本文件在移动入口图里，引包装层会伤 mobile entry 预算）；
  // 非 win32 主进程忽略、移动端桥无此键 ⇒ 无副作用。
  window.lakeNative?.setTitleBarOverlayScheme?.(colorScheme);
}
