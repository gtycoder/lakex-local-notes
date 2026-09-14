/**
 * 移动端「左右横滑」手势（用于平级页签切换：小记 ↔ 知识库）。
 * 轴锁复用 gestureCore.getTouchAxis（与抽屉手势同一套判定），纵向滚动优先。
 */
import { useEffect, useRef } from "react";
import { getTouchAxis } from "./gestureCore";

const SWIPE_THRESHOLD = 60;  // 触发切换所需横向位移（px）

export function useHorizontalSwipe(onSwipe: (dir: "left" | "right") => void): void {
  const ref = useRef(onSwipe);
  ref.current = onSwipe;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length > 1) { tracking = false; return; }
      const t = e.touches[0];
      if (!t) return;
      const el = e.target as HTMLElement | null;
      // 输入/可编辑/显式禁止滑动区域不触发
      if (el && typeof el.closest === "function" &&
        el.closest('textarea, input, [contenteditable="true"], [data-prevent-swipe]')) {
        tracking = false;
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (getTouchAxis(dx, dy) === "y") { tracking = false; return; } // 纵向占优 → 交给滚动
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      tracking = false;
      ref.current(dx < 0 ? "left" : "right");
    };

    const onEnd = () => { tracking = false; };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);
}
