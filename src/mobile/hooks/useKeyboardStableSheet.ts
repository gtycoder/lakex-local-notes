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

/**
 * 滚动余量不足时（小表单/已滚到底，scrollTop 调不动）把 Sheet 整体抬起的量：
 * 受 Sheet 当前 top 限制（最多抬到贴视口顶）；gap <= 0 或已在顶 = 不抬。
 * 261117：只滚 .mb-sheet__body 在这类场景**天生失效**（内容不足一屏时 scrollTop 恒 0），
 * 输入框永远留在键盘后面 —— 抬 Sheet 是兜底，还原由 restore() 统一处理。
 */
export function liftToReveal(gap: number, sheetTop: number): number {
  if (!(gap > 0) || !(sheetTop > 0)) return 0;
  return Math.ceil(Math.min(gap, sheetTop));
}

interface SavedStyle { top: string; height: string; bottom: string; maxHeight: string }

/**
 * 把 root 内的当前焦点输入框滚进「键盘上方仍可见」的区域（沿滚动链由内向外逐级滚；
 * 只动 root 内的滚动容器）。滚动余量不足时**不负责**兜底 —— Sheet 场景由抬升兜底，
 * 随视口收缩的面（如 .mbt-form-scroll）本来就有原生滚动余量。
 * 261117：内层列表/选项行有自己的滚动容器时，只滚最外层够不着（「输选项名称被键盘盖」）。
 */
export function revealActiveInputWithin(root: HTMLElement, visibleBottom: number): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return;
  let node: HTMLElement | null = active;
  while (node && node !== root) {
    const parent = node.parentElement as HTMLElement | null;
    if (!parent) break;
    if (parent.scrollHeight > parent.clientHeight + 1) {
      const targetBottom = Math.min(parent.getBoundingClientRect().bottom, visibleBottom);
      const margin = targetBottom >= visibleBottom ? REVEAL_MARGIN_PX : 0;
      const delta = scrollDeltaToReveal(node.getBoundingClientRect().bottom, targetBottom, margin);
      if (delta > 0) parent.scrollTop += delta;
    }
    node = parent;
  }
}

/**
 * 轻量键盘露出 hook（无「钉几何」）：给**随视口收缩**的输入面用 ——
 * 多维表表单视图（.mbt-form-scroll）这类面在键盘弹起时容器自动变矮，
 * 但浏览器原生 focus 滚动发生在键盘弹起**之前**、之后会失效 ⇒ resize 时补滚一次。
 */
export function useKeyboardRevealFocus(root: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const el = root.current;
    if (!el) return;
    const reveal = (): void => {
      const visibleBottom = (window.innerHeight || 0) - 8;
      window.requestAnimationFrame(() => revealActiveInputWithin(el, visibleBottom));
    };
    el.addEventListener("focusin", reveal);
    window.addEventListener("resize", reveal);
    window.addEventListener("orientationchange", reveal);
    return () => {
      el.removeEventListener("focusin", reveal);
      window.removeEventListener("resize", reveal);
      window.removeEventListener("orientationchange", reveal);
    };
  }, [root, enabled]);
}

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

    /** 把当前焦点输入框弄进「键盘上方仍可见」的区域：
     *  ① 沿滚动链逐级滚（revealActiveInputWithin，覆盖内层滚动容器）；
     *  ② 滚完仍被盖（滚动余量不足：小表单/已到底）⇒ 抬 Sheet（不改高度，键盘收起 restore 还原）。 */
    const revealFocus = (): void => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !el.contains(active)) return;
      const visibleBottom = (window.innerHeight || 0) - 8;
      revealActiveInputWithin(el, visibleBottom);
      const gap = active.getBoundingClientRect().bottom + REVEAL_MARGIN_PX - visibleBottom;
      const lift = liftToReveal(gap, el.getBoundingClientRect().top);
      if (lift > 0) {
        if (!saved) saved = { top: el.style.top, height: el.style.height, bottom: el.style.bottom, maxHeight: el.style.maxHeight };
        el.style.top = (el.getBoundingClientRect().top - lift) + "px";
        el.style.bottom = "auto";
      }
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
