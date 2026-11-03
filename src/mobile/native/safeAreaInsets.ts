/**
 * 原生系统栏 / 刘海安全区 → CSS 变量（261027）。
 *
 * 背景：Android WebView 的 env(safe-area-inset-top) 在部分 ROM（MIUI 等）与
 * edge-to-edge（targetSdk 36 / Android 15+ 强制）下会是 0，内容就会压到状态栏/刘海下面；
 * 而只靠 CSS 拿不到真实 insets。原生侧（MainActivity 的 lakeInsets）用 WindowInsets
 * （systemBars ∪ displayCutout）换算成 CSS px，通过两个通道交过来：
 *   · 启动时：lakeInsets.getTop()/getBottom() 同步读；
 *   · 变化时：原生调用 window.__lakeSetNativeInsets(top, bottom)。
 * tokens.css 里 --mobile-*-safe-area = max(env(...), var(--mobile-native-*-safe))。
 * 非 Android（桌面 / 浏览器预览）没有桥，静默不动，env 仍然生效。
 */
type InsetsBridge = {
  getTop?: () => number;
  getBottom?: () => number;
  /** 261103 六批 A1：横屏/刘海左右安全区（老包没有这两个方法 ⇒ 缺省按 0）。 */
  getLeft?: () => number;
  getRight?: () => number;
};
const TOP_VAR = "--mobile-native-top-safe";
const BOTTOM_VAR = "--mobile-native-bottom-safe";
const LEFT_VAR = "--mobile-native-left-safe";
const RIGHT_VAR = "--mobile-native-right-safe";

export function installSafeAreaInsets(): void {
  const root = document.documentElement;
  /** left/right 是 261103 六批追加的第 3/4 参数：老原生包只传两个 ⇒ 缺省 0（保持旧行为）。 */
  const apply = (top: number, bottom: number, left = 0, right = 0): void => {
    const t = Number.isFinite(top) ? Math.max(0, top) : 0;
    const b = Number.isFinite(bottom) ? Math.max(0, bottom) : 0;
    const l = Number.isFinite(left) ? Math.max(0, left) : 0;
    const r = Number.isFinite(right) ? Math.max(0, right) : 0;
    root.style.setProperty(TOP_VAR, t + "px");
    root.style.setProperty(BOTTOM_VAR, b + "px");
    root.style.setProperty(LEFT_VAR, l + "px");
    root.style.setProperty(RIGHT_VAR, r + "px");
  };
  (window as { __lakeSetNativeInsets?: (top: number, bottom: number, left?: number, right?: number) => void }).__lakeSetNativeInsets = apply;
  const bridge = (window as { lakeInsets?: InsetsBridge }).lakeInsets;
  if (!bridge) return;
  try {
    apply(bridge.getTop?.() ?? 0, bridge.getBottom?.() ?? 0, bridge.getLeft?.() ?? 0, bridge.getRight?.() ?? 0);
  } catch { /* 桥不可用时保持 env 兜底 */ }
}
