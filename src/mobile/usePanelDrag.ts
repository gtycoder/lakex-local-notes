/**
 * 移动端「跟手开合抽屉」手势（对齐思源 mobile/util/touch.ts + touchPanelGesture.ts）：
 *  - 触发：内容区任意横向滑动（不限屏幕边缘）；输入框/正文/[data-prevent-swipe]、多指、横向可滚动内容不触发；
 *  - 轴锁：位移先越过阈值且 |dx|>|dy| 才算横滑，纵向优先交给滚动；
 *  - 跟手：进度用**带符号**位移，反向滑动会跟着回退（对齐思源 offset 公式；旧版取绝对值，反向不回退）；
 *  - 释放：快速短滑（<1s 且位移 > 阈值）或越过视口宽 1/3 才提交（思源 touch.ts:309-313），否则回弹；
 *  - 提交后先把面板摆到最终态（transition 已恢复 → 平滑归位），再清内联样式交还 React 类名。
 */
import { useEffect, useRef } from "react";
import { getTouchAxis, isHorizontalScrollable, panelCommit, panelProgress } from "./gestureCore";

export type PanelSide = "left" | "right";

export interface PanelDragHandlers {
  getPanel: (side: PanelSide) => HTMLElement | null;
  getMask: (side: PanelSide) => HTMLElement | null;
  /** 该侧当前是否展开（React 状态） */
  isOpen: (side: PanelSide) => boolean;
  /** 手势结束后把结果写回 React 状态 */
  commit: (side: PanelSide, open: boolean) => void;
}

const SETTLE_MS = 200;         // 归位动画时长上限（CSS 是 150ms）
const SWIPING = "side-panel--swiping";
const MASK_SWIPING = "side-mask--swiping";
const EXCLUDE = 'input, textarea, select, [contenteditable="true"], [data-prevent-swipe]';

export function usePanelDrag(handlers: PanelDragHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let startTime = 0;
    let dir = 1;                  // 拉开当前侧的方向：左栏向右(+1)、右栏向左(-1)
    let axis: "x" | "y" | null = null;
    let side: PanelSide | null = null;
    let openAtStart = false;
    let dragging = false;
    let cancelled = false;       // 本手势已作废（纵向/非关闭方向/滚动内容/多指）→ 后续 move/end 一律 inert

    const apply = (s: PanelSide, p: number) => {
      const h = ref.current;
      const panel = h.getPanel(s);
      if (!panel) return false;
      const width = panel.getBoundingClientRect().width || window.innerWidth;
      if (!dragging) {
        dragging = true;
        panel.classList.add(SWIPING);
        h.getMask(s)?.classList.add(MASK_SWIPING);
      }
      panel.style.transform = s === "left" ? `translateX(${(p - 1) * width}px)` : `translateX(${(1 - p) * width}px)`;
      const mask = h.getMask(s);
      if (mask) { mask.style.visibility = "visible"; mask.style.opacity = String(p); }
      return true;
    };

    const stop = () => { side = null; axis = null; dragging = false; };
    const targetOf = (e: TouchEvent): HTMLElement | null => (e.target instanceof HTMLElement ? e.target : null);

    const onStart = (e: TouchEvent) => {
      cancelled = false;
      // 多指（缩放等）不参与抽屉手势
      if (e.touches.length > 1) { stop(); cancelled = true; return; }
      const t = e.touches[0];
      if (!t) return;
      const target = targetOf(e);
      if (target?.closest?.(EXCLUDE)) { stop(); cancelled = true; return; }
      // 存在文本选区时不滑出抽屉（对齐思源：选中内容优先）
      if (window.getSelection()?.toString()) { stop(); cancelled = true; return; }
      startX = t.clientX; startY = t.clientY; lastX = t.clientX; startTime = Date.now();
      axis = null; dragging = false;
      const h = ref.current;
      side = h.isOpen("left") ? "left" : h.isOpen("right") ? "right" : null;
      openAtStart = side !== null;
    };

    const onMove = (e: TouchEvent) => {
      if (axis === "y" || cancelled) return;
      const t = e.touches[0];
      if (!t) return;
      if (axis === null) {
        if (e.touches.length > 1) { axis = "y"; side = null; cancelled = true; return; }
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const judged = getTouchAxis(dx, dy);
        if (judged === undefined) return;
        if (judged === "y") { axis = "y"; side = null; cancelled = true; return; }
        axis = "x";
        if (!side) {
          side = dx > 0 ? "left" : "right";
          // 横向可滚动内容 → 交给原生滚动，不拉抽屉（对齐思源 isHorizontalScrollable）
          if (isHorizontalScrollable(targetOf(e), dx)) { cancelled = true; return; }
        } else {
          // 已展开：只有“关闭方向”可拖（左栏往左、右栏往右），往内滑作废；
          // 注意不能重置 axis（否则同一手势会被重新判成反方向、误开另一侧）。
          const closing = side === "left" ? dx < 0 : dx > 0;
          if (!closing) { cancelled = true; return; }
        }
        dir = side === "left" ? 1 : -1;
      }
      if (cancelled || !side || axis !== "x") return;
      lastX = t.clientX;
      const width = window.innerWidth || 1;
      const raw = dir * (lastX - startX);                 // >0 = 往“拉开该侧”的方向
      if (apply(side, panelProgress(openAtStart, raw, width))) e.preventDefault();
    };

    const onEnd = () => {
      const s = cancelled ? null : side;
      const h = ref.current;
      stop();
      if (!s) { h.getMask("left")?.classList.remove(MASK_SWIPING); h.getMask("right")?.classList.remove(MASK_SWIPING); return; }
      const width = window.innerWidth || 1;
      const raw = dir * (lastX - startX);
      const next = panelCommit(openAtStart, raw, Date.now() - startTime, width);
      const panel = h.getPanel(s);
      const mask = h.getMask(s);
      if (panel) {
        panel.classList.remove(SWIPING);
        panel.style.transform = next ? "translateX(0px)" : `translateX(${s === "left" ? "-100%" : "100%"})`;
      }
      if (mask) { mask.classList.remove(MASK_SWIPING); mask.style.opacity = next ? "1" : "0"; }
      h.commit(s, next);
      window.setTimeout(() => {
        if (panel) panel.style.transform = "";
        if (mask) { mask.style.opacity = ""; mask.style.visibility = ""; }
      }, SETTLE_MS);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
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
