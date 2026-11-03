/**
 * 平板形态判据（261102 · pad 适配批次）。
 *
 * **判据 = 窗口宽度，不是设备属性**：Android 分屏 / 自由窗口 / 折叠展开、iPad Slide Over /
 * Split View / Stage Manager 都会改变可用宽度，而设备的 `smallestScreenWidthDp` 不变
 * ⇒ 布局必须跟着**当前窗口**走（与 docs/PAD-ADAPTATION.md §3.2 一致）。
 *
 * 三档（CSS px，取 android WindowSizeClass 的 600 / 840 两档中的 600 / 800 —— 800 是为了让
 * iPad 10.9/11 竖屏（820–834）也能进双栏）：
 *   compact  <600   手机 / Slide Over / 分屏窄窗 → 现行手机布局，零改动
 *   medium   600–799 8" 平板、iPad mini 竖屏 → 单栏 + 内容限宽 + 浮层收敛
 *   expanded ≥800   10–11" 平板竖屏 / 任意横屏 → 正文满宽 + 悬浮目录/大纲 + 桌面式工具栏
 *
 * 写入：`<html data-form-factor="...">`（CSS 唯一判据）+ `body.lake-tablet`（历史类名兼容）。
 * 原生 `lakeDevice.isTablet()` 只作提示（折叠/形态遥测），不参与布局 —— iPad 没有该桥。
 */
export type FormFactor = "compact" | "medium" | "expanded";

/** 断点（CSS px）。改这里必须同步 src/mobile/pad/pad.css 里注释的同一组值。 */
export const FORM_FACTOR_BREAKPOINTS = { medium: 600, expanded: 800, expandedMinHeight: 560 } as const;

/**
 * 纯函数：给定窗口**宽 + 高**返回形态档（便于单测；不读 DOM）。
 *
 * expanded 是「宽 + 有高度」的形态：手机横屏（如 842×390）宽度虽然够，但没有高度放双侧栏，
 * 判成 expanded 会让内容被侧栏挤扁 ⇒ 这类窗口**回落到 medium 单栏**（手机仍用同一套 UI）。
 * heightPx 缺省视为不限高（只按宽判，供纯宽度调用/旧测试用）。
 */
export function formFactorOf(widthPx: number, heightPx: number = Number.POSITIVE_INFINITY): FormFactor {
  if (!Number.isFinite(widthPx) || widthPx < FORM_FACTOR_BREAKPOINTS.medium) return "compact";
  if (widthPx < FORM_FACTOR_BREAKPOINTS.expanded) return "medium";
  // heightPx 缺省 = Infinity（不限制）；只有**拿到了真实高度且太矮**才回落（手机横屏 / 扁窗）。
  if (Number.isFinite(heightPx) && heightPx < FORM_FACTOR_BREAKPOINTS.expandedMinHeight) return "medium";
  return "expanded";
}

/** 是否是平板级布局（medium | expanded）。 */
export function isPadLayout(formFactor: FormFactor): boolean {
  return formFactor !== "compact";
}

/** 当前形态的模块级缓存（供非 React 代码/调试读取；React 用 useFormFactor）。 */
let current: FormFactor = "compact";

export function currentFormFactor(): FormFactor {
  return current;
}

/** 把形态写到 DOM（唯一写入口）。 */
export function applyFormFactor(formFactor: FormFactor): void {
  current = formFactor;
  if (typeof document === "undefined") return;
  document.documentElement.dataset.formFactor = formFactor;
  document.body.classList.toggle("lake-tablet", formFactor !== "compact");
}

/**
 * 安装形态判据：首帧前同步写一次，之后跟随窗口宽变化。
 * 返回卸载函数（测试/热重载用）。
 */
export function installFormFactor(): () => void {
  const read = (): FormFactor => formFactorOf(window.innerWidth, window.innerHeight);
  applyFormFactor(read());
  const onChange = (): void => applyFormFactor(read());
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  // 原生形态推送只作提示（MainActivity：折叠展开/旋转时推一次）；布局判据仍是窗口宽。
  (window as { __lakeSetTablet?: (tablet: boolean) => void }).__lakeSetTablet = (tablet: boolean): void => {
    nativeTabletHint = tablet === true;
    applyFormFactor(read());
  };
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

/** 原生侧的「这是台平板」提示（仅遥测/调试；不参与布局）。 */
let nativeTabletHint = false;
export function nativeDeviceHint(): boolean {
  return nativeTabletHint;
}
