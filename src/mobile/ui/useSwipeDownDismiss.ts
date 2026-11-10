import { useEffect, type RefObject } from "react";
import { shouldDismissOnRelease, shouldEngageSwipeDown } from "./swipeDownDismiss";

/**
 * 下滑关闭（底部 Sheet / 侧边抽屉共用）：跟手位移 → 松手过阈值关闭，否则回弹。
 *
 * - 只认**纵向**：横向手势（侧边抽屉的左/右滑）不受影响；
 * - 内部滚动容器（默认 `.mb-sheet__body`）不在顶部时**不启动** ⇒ 不抢列表滚动；
 * - 拖动中给表面加 `is-dragging`（用来临时关掉 transform 过渡，保证跟手），松手移除让过渡负责回弹；
 * - 减少动效由 CSS（prefers-reduced-motion）兜底，本 hook 不写媒体查询。
 */
export interface SwipeDownDismissOptions {
  enabled: boolean;
  /** 内部滚动容器选择器；不传 = 不做滚动位置判定（整面可拖的抽屉/创建面板）。 */
  scrollSelector?: string;
  /** 拖动期间挂到表面上的类名（用来禁用过渡），默认 is-dragging。 */
  draggingClass?: string;
}

export function useSwipeDownDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  { enabled, scrollSelector, draggingClass = "is-dragging" }: SwipeDownDismissOptions,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let startY = 0;
    /** 记录最后一次 move 的 Y：部分环境（自动化/CDP）的 touchend 不带 changedTouches，靠它兜底。 */
    let lastY = 0;
    let active = false;
    let dragging = false;

    const scrollTopOf = (): number => {
      if (!scrollSelector) return 0;
      const scroller = el.querySelector<HTMLElement>(scrollSelector);
      return scroller?.scrollTop ?? 0;
    };
    const reset = (): void => {
      el.style.transform = "";
      el.classList.remove(draggingClass);
      active = false;
      dragging = false;
    };
    const onStart = (event: TouchEvent): void => {
      if (event.touches.length !== 1) { reset(); return; }
      active = true;
      dragging = false;
      startY = event.touches[0]!.clientY;
      lastY = startY;
    };
    const onMove = (event: TouchEvent): void => {
      if (!active || event.touches.length !== 1) return;
      const deltaY = event.touches[0]!.clientY - startY;
      lastY = event.touches[0]!.clientY;
      if (!shouldEngageSwipeDown(deltaY, scrollTopOf())) return;
      dragging = true;
      if (event.cancelable) event.preventDefault();
      el.classList.add(draggingClass);
      el.style.transform = "translate3d(0, " + deltaY + "px, 0)";
    };
    const onEnd = (event: TouchEvent): void => {
      if (!active) return;
      const deltaY = (event.changedTouches[0]?.clientY ?? lastY) - startY;
      const dismiss = dragging && shouldDismissOnRelease(deltaY, el.getBoundingClientRect().height);
      reset();
      if (dismiss) onDismiss();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", reset);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", reset);
      reset();
    };
  }, [ref, onDismiss, enabled, scrollSelector, draggingClass]);
}
