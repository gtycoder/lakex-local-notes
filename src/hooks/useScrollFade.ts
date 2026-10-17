import { useLayoutEffect, type RefObject } from "react";

/** 距边缘 1px 内视为「已到边」：亚像素滚动时避免上下两侧同时亮起。 */
const EDGE_EPSILON = 1;

/**
 * 261017 B：滚动边缘渐隐的状态同步（纯函数，便于单测）。
 *
 * 只读滚动几何 → 写 data-fade-top / data-fade-bottom（"1"/"0"）；样式在 kit 的 14b 选择器组
 * （.ln-select__list / .note-list.tree-list / .quick-notes-index）。
 * 为什么不用 rAF：隐藏窗口里 rAF 不触发（HANDOFF 环境坑），滚动后的边缘态会滞后；
 * 这里只读三个数字，直接在事件里算的代价可以忽略。
 */
export function syncScrollFade(el: HTMLElement): void {
  const top = el.scrollTop > EDGE_EPSILON ? "1" : "0";
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - EDGE_EPSILON ? "1" : "0";
  if (el.dataset.fadeTop !== top) el.dataset.fadeTop = top;
  if (el.dataset.fadeBottom !== bottom) el.dataset.fadeBottom = bottom;
}

/**
 * 给滚动容器挂边缘渐隐（配合 .ln-scroll-fade 使用）。
 * - 滚动、容器尺寸变化、子节点增删都会重算；
 * - `active` 用于条件挂载的容器（如 Select 弹层）：打开时重挂监听。
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, active: unknown = true): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    syncScrollFade(el);
    const onScroll = () => syncScrollFade(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    ro?.observe(el);
    const first = el.firstElementChild;
    const last = el.lastElementChild;
    if (first) ro?.observe(first);
    if (last && last !== first) ro?.observe(last);
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(onScroll) : null;
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [ref, active]);
}
