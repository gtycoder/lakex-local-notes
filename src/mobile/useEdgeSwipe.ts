/**
 * 移动端「边缘滑动」手势（对齐思源移动端 touch.ts）：从屏幕左/右边缘横向滑动，呼出对应侧抽屉。
 * 思源源码把左右 8px 作为边缘触发区；这里放宽到 24px 以适配触控精度，纵向位移为主时视为滚动、不触发。
 * 与目录/大纲抽屉按钮等效，作为手势切换的补充入口。
 */
import { useEffect, useRef } from "react";

export interface EdgeSwipeHandlers {
  /** 从左边缘向右滑（呼出左侧抽屉：目录） */
  onLeftEdgeSwipe?: () => void;
  /** 从右边缘向左滑（呼出右侧抽屉：大纲） */
  onRightEdgeSwipe?: () => void;
}

const EDGE_WIDTH = 24;        // 边缘触发区宽（px）
const SWIPE_THRESHOLD = 48;   // 横向滑动触发阈值（px）

export function useEdgeSwipe(handlers: EdgeSwipeHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let edge: "left" | "right" | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      edge = startX <= EDGE_WIDTH ? "left" : startX >= window.innerWidth - EDGE_WIDTH ? "right" : null;
    };

    const onMove = (e: TouchEvent) => {
      if (!edge) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // 纵向位移占优 → 视为滚动，放弃本次手势
      if (Math.abs(dy) > Math.abs(dx)) { edge = null; return; }
      if (edge === "left" && dx > SWIPE_THRESHOLD) { edge = null; ref.current.onLeftEdgeSwipe?.(); }
      else if (edge === "right" && dx < -SWIPE_THRESHOLD) { edge = null; ref.current.onRightEdgeSwipe?.(); }
    };

    const onEnd = () => { edge = null; };

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
