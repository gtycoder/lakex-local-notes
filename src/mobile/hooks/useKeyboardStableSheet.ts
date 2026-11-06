/**
 * 键盘「覆盖而不推动」弹窗的稳定化 hook（261106 task-94）。
 *
 * 背景：Android WebView（adjustResize）在键盘弹起时把布局视口压矮，底部 Sheet 的 max-height/底边随视口变化，
 * 视觉上就是「整个弹窗被顶上去」。产品要求：**弹窗 top/height 稳定**，键盘去覆盖下方列表，输入框保持可见。
 *
 * 方案：
 *  · 在键盘弹起**之前**（输入框 focusin 时）记下 Sheet 的 {top, height}；
 *  · 视口变矮（= 键盘高度 > 阈值）时，把 Sheet 的 top/height 钉回记录值（bottom:auto, max-height:none）——
 *    底边自然落到键盘下方 ⇒ 被键盘覆盖而不再整体上移；
 *  · 再把获得焦点的输入框滚进「键盘上方仍可见」的区域（只动 Sheet body 的 scrollTop，不重置其它滚动）；
 *  · 键盘收起 ⇒ 还原原有内联样式；无键盘/无输入焦点 ⇒ **零副作用**（桌面与测试不受影响）。
 */
import { useEffect, type RefObject } from "react";

/** 小于这个高度的视口收缩视为非键盘（地址栏/横竖屏抖动）。 */
export const KEYBOARD_MIN_INSET_PX = 80;
/** 输入框露出时与可视区底边保留的余量。 */
const REVEAL_MARGIN_PX = 12;

/** 键盘高度 = 基线视口高 - 当前视口高（不足阈值为 0）。 */
export function keyboardInsetOf(baselineHeight: number, currentHeight: number): number {
  if (!(baselineHeight > 0) || !(currentHeight > 0)) return 0;
  const inset = baselineHeight - currentHeight;
  return inset > KEYBOARD_MIN_INSET_PX ? Math.round(inset) : 0;
}

/** 键盘弹起时把 Sheet 钉回键盘前几何（top/height 固定、底边落到视口外被键盘覆盖）。 */
export function compensatedSheetStyle(geometry: { top: number; height: number }): { top: string; height: string; bottom: string; maxHeight: string } {
  return { top: geometry.top + "px", height: geometry.height + "px", bottom: "auto", maxHeight: "none" };
}

/** 要让输入框底边露到 visibleBottom 之上，body 需要额外滚多少（<=0 = 不用滚）。 */
export function scrollDeltaToReveal(inputBottom: number, visibleBottom: number, margin = REVEAL_MARGIN_PX): number {
  const delta = inputBottom + margin - visibleBottom;
  return delta > 0 ? Math.ceil(delta) : 0;
}

interface SavedStyle { top: string; height: string; bottom: string; maxHeight: string }

/**
 * 挂在 Sheet 根元素上：enabled = Sheet 打开且有输入可能的场景（本 hook 只在真有输入焦点时才动样式）。
 */
export function useKeyboardStableSheet(sheet: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const el = sheet.current;
    if (!el) return;
    /** 键盘未弹时的视口高（每次键盘收起后取较大值，避免地址栏变化污染基线）。 */
    let baseline = window.innerHeight || 0;
    let geometry: { top: number; height: number } | null = null;
    let saved: SavedStyle | null = null;

    const restore = (): void => {
      if (saved) {
        el.style.top = saved.top;
        el.style.height = saved.height;
        el.style.bottom = saved.bottom;
        el.style.maxHeight = saved.maxHeight;
        saved = null;
      }
      geometry = null;
    };

    const apply = (): void => {
      if (!geometry) return;
      if (!saved) saved = { top: el.style.top, height: el.style.height, bottom: el.style.bottom, maxHeight: el.style.maxHeight };
      const next = compensatedSheetStyle(geometry);
      el.style.top = next.top;
      el.style.height = next.height;
      el.style.bottom = next.bottom;
      el.style.maxHeight = next.maxHeight;
    };

    /** 只把当前焦点输入框滚进「键盘上方仍可见」的区域（不碰外层滚动）。 */
    const revealFocus = (): void => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !el.contains(active)) return;
      const body = el.querySelector<HTMLElement>(".mb-sheet__body");
      if (!body) return;
      const visibleBottom = (window.innerHeight || 0) - 8;
      const rect = active.getBoundingClientRect();
      const delta = scrollDeltaToReveal(rect.bottom, visibleBottom);
      if (delta > 0) body.scrollTop += delta;
    };

    const onFocusIn = (): void => {
      const inset = keyboardInsetOf(baseline, window.innerHeight || 0);
      const rect = el.getBoundingClientRect();
      if (inset > 0) {
        // 键盘已经弹起（例如切换输入框）：用「当前几何 + 视口收缩量」近似键盘前几何。
        if (!geometry && rect.height > 0) geometry = { top: rect.top, height: rect.height + inset };
        apply();
        window.requestAnimationFrame(revealFocus);
        return;
      }
      // 键盘还没弹：记下键盘前几何（focus 早于窗口 resize）。
      if (rect.height > 0) geometry = { top: rect.top, height: rect.height };
    };

    const onViewportChange = (): void => {
      const current = window.innerHeight || 0;
      const inset = keyboardInsetOf(baseline, current);
      if (inset > 0) {
        if (!geometry) {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0) geometry = { top: rect.top, height: rect.height + inset };
        }
        apply();
        window.requestAnimationFrame(revealFocus);
        return;
      }
      restore();
      baseline = Math.max(baseline, current);
    };

    el.addEventListener("focusin", onFocusIn);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      restore();
    };
  }, [sheet, enabled]);
}
