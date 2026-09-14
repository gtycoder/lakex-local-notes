import { useEffect, type RefObject } from "react";
import { getTouchAxis } from "../gestureCore";

/**
 * 浮层右滑关闭/返回（对齐思源：全屏 menu/model 支持右滑关闭）。
 * 只认右滑；纵向滑动交给原生滚动；目标元素需带 data-prevent-swipe，避免底层抽屉手势同时触发。
 */
export function useSwipeToClose(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  enabled: boolean,
  threshold = 64,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let startX = 0;
    let startY = 0;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const axis = getTouchAxis(dx, dy);
      if (axis === undefined || axis === "y" || dx < 0) return;
      if (dx > threshold) onDismiss();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [ref, onDismiss, enabled, threshold]);
}
