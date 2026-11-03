/**
 * 平板形态判据（261102 起；261103 P3 收敛为**单一 store**）。
 *
 * **判据 = 当前窗口（宽 + 高），不是设备属性**：Android 分屏/自由窗口/折叠展开、iPad Slide Over/
 * Split View/Stage Manager 都会改变可用窗口，而设备级 smallestScreenWidthDp 不变 ⇒ 布局必须跟着窗口走。
 *
 * 三档（CSS px；与 docs/PAD-ADAPTATION.md §3.2 一致）：
 *   compact  <600                    手机 / Slide Over / 分屏窄窗 → 现行手机布局
 *   medium   600–799（或高 <560）     8" 平板、iPad mini 竖屏、手机横屏 → 单栏 + 内容限宽
 *   expanded ≥800 且高 ≥560           10–11" 平板竖/横屏 → 正文满宽 + 悬浮/可固定侧栏
 *
 * 写入：唯一判据 = `<html data-form-factor="...">`（CSS 读它；React 用 useFormFactor 读同一 store）。
 * **不再**写 body.lake-tablet、不再接收原生 smallestScreenWidthDp 提示（261103 清理死代码）。
 */
import { resetShellHeight, shellHeight, widthChanged } from "../hooks/viewportShell";

export type FormFactor = "compact" | "medium" | "expanded";

/** 断点（CSS px）。改这里必须同步 scripts/mobile-audit/window-sweep.mjs 的常量（有静态测试值守）。 */
export const FORM_FACTOR_BREAKPOINTS = { medium: 600, expanded: 800, expandedMinHeight: 560 } as const;

/**
 * 纯函数：给定窗口**宽 + 高**返回形态档（不读 DOM）。
 *
 * expanded 是「宽 + 有高度」的形态：手机横屏（842×390）宽度够但没有高度放双侧栏 ⇒ 回落 medium，
 * 手机仍用同一套 UI。heightPx 缺省 = 不限制（只按宽判，供纯宽度调用）。
 */
export function formFactorOf(widthPx: number, heightPx: number = Number.POSITIVE_INFINITY): FormFactor {
  if (!Number.isFinite(widthPx) || widthPx < FORM_FACTOR_BREAKPOINTS.medium) return "compact";
  if (widthPx < FORM_FACTOR_BREAKPOINTS.expanded) return "medium";
  if (Number.isFinite(heightPx) && heightPx < FORM_FACTOR_BREAKPOINTS.expandedMinHeight) return "medium";
  return "expanded";
}

/**
 * 形态判据用的「有效窗口高」：**取 window.innerHeight 与稳定外壳高的较大值**。
 *
 * Android adjustResize 下软键盘会把 innerHeight 压掉 >240px（1280×744 → ~460），而窗口其实还是平板
 * ⇒ 直接用会让整个外壳在打字时翻回 medium（页签/侧栏被卸载）。shellHeight() 是键盘收起时的稳定高度。
 * ⚠️ 已知盲区：**纯高度拖拽**与 IME 在 innerHeight 上不可区分，这里优先保证「打字不翻形态」。
 */
export function effectiveWindowHeight(innerHeightPx: number, shellHeightPx: number): number {
  const inner = Number.isFinite(innerHeightPx) && innerHeightPx > 0 ? innerHeightPx : 0;
  const shell = Number.isFinite(shellHeightPx) && shellHeightPx > 0 ? shellHeightPx : 0;
  return Math.max(inner, shell);
}

/** 当前窗口尺寸（高度取稳定外壳高；SSR 返回 0/0）。 */
export function currentWindowSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: effectiveWindowHeight(window.innerHeight, shellHeight()) };
}

// ── 单一 store：判据只算一次、只写一次 DOM，React 用 useSyncExternalStore 读同一份 ──
let current: FormFactor = "compact";
/** 是否已由 installFormFactor 接管（接管后靠 resize 事件更新；未接管时按需现算，供测试/懒加载）。 */
let installed = false;
const listeners = new Set<() => void>();

function compute(): FormFactor {
  const size = currentWindowSize();
  return formFactorOf(size.width, size.height);
}

/** 当前形态（React 快照 & 非 React 代码/调试同一个来源）。 */
export function currentFormFactor(): FormFactor {
  // 未 install 时（SSR/jsdom 测试/懒加载）按需现算，避免读到过期的模块初值。
  if (!installed) current = compute();
  return current;
}

/** 订阅判据变化（useSyncExternalStore / 测试用）。 */
export function subscribeFormFactor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 计算并发布：写 html 属性 + 通知订阅者；值没变则不通知。 */
function publish(): void {
  const next = compute();
  if (next !== current) current = next;
  if (typeof document !== "undefined") document.documentElement.dataset.formFactor = next;
  for (const listener of listeners) listener();
}

/**
 * 安装形态判据（幂等）：首帧前同步写一次，之后跟随窗口变化重新发布。
 * 返回卸载函数（测试/热重载用）。
 */
export function installFormFactor(): () => void {
  if (typeof window === "undefined") return () => {};
  if (installed) {
    // 热重载/二次调用：只保证 DOM 与当前值一致，不重复挂监听。
    publish();
    return () => {};
  }
  installed = true;
  current = compute();
  publish();
  // 窗口宽显著变化（分屏/自由窗口/折叠展开/旋转）⇒ 稳定外壳高必须重学，否则上一次平板窗口的 shell
  // （如 744）会留在窄窗里，把「宽但矮」的窗口误判成 expanded。IME 不改宽度 ⇒ 弹键盘不会触发重置。
  let lastWidth = window.innerWidth;
  const onChange = (): void => {
    if (widthChanged(lastWidth, window.innerWidth)) {
      lastWidth = window.innerWidth;
      resetShellHeight();
    }
    publish();
  };
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    installed = false;
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}
