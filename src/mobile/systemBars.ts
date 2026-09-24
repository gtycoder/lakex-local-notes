import type { ThemeMode } from "../lib/settings";

/** Android 原生注入的接口（见 android/.../MainActivity.kt 的 SystemBarsInterface）。 */
type SystemBarsBridge = { setDark?: (dark: boolean) => void };

/**
 * 让 Android 状态栏/导航栏跟随 App 主题。
 *
 * 为什么需要：WebView 不延伸到系统栏之下（栏后露出的是 window 背景），而 styles.xml 只写死了
 * `windowLightStatusBar=true`，于是深色主题下顶/底会各留一条近白 #FAFAFA 的硬边
 * （实测：深色内容 #1e2126 vs 系统栏 #fafafa）。纯 Web 侧改不了，必须走原生。
 * 非 Android（桌面 / 浏览器预览）没有该接口，静默跳过。
 */
export function applySystemBarTheme(theme: ThemeMode): void {
  const bridge = (window as { lakeSystemBars?: SystemBarsBridge }).lakeSystemBars;
  if (bridge && typeof bridge.setDark === "function") bridge.setDark(theme === "dark");
}
