/**
 * 移动端「跟手开合抽屉」手势（对齐思源 mobile/util/touch.ts + touchPanelGesture.ts 口径）：
 *  - 触发：内容区任意横向滑动（不限屏幕边缘）；输入框/正文/[data-prevent-swipe] 不触发；
 *  - 轴锁定：位移先越过阈值且 |dx|>|dy| 才算横滑，纵向优先交给滚动（本次手势作废）；
 *  - 拖拽中：面板 transform 跟手、遮罩透明度联动，并加 --swiping 关掉 transition（思源同名类）；
 *  - 释放：|dx| > 视口宽/3 提交（思源 touch.ts:310），否则回弹；
 *  - 提交后先按最终态摆好 transform（transition 已恢复 → 平滑归位），再清掉内联样式，把状态交还 React 类名。
 * 旧 useEdgeSwipe 只在 >48px 时"触发一次开合"，没有跟手/反悔——手感差距就在这里。
 */
import { useEffect, useRef } from "react";

export type PanelSide = "left" | "right";

export interface PanelDragHandlers {
  getPanel: (side: PanelSide) => HTMLElement | null;
  getMask: (side: PanelSide) => HTMLElement | null;
  /** 该侧当前是否展开（React 状态） */
  isOpen: (side: PanelSide) => boolean;
  /** 手势结束后把结果写回 React 状态 */
  commit: (side: PanelSide, open: boolean) => void;
}

const AXIS_THRESHOLD = 8;      // 判定横/纵轴的位移阈值
const COMMIT_RATIO = 1 / 3;    // 提交阈值（视口宽的 1/3）
const SETTLE_MS = 200;         // 归位动画时长上限（CSS 是 150ms）
const SWIPING = "side-panel--swiping";
const MASK_SWIPING = "side-mask--swiping";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function usePanelDrag(handlers: PanelDragHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let startTime = 0;
    let axis: "x" | "y" | null = null;
    let side: PanelSide | null = null;
    let openAtStart = false;
    let dragging = false;

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

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], [data-prevent-swipe]')) { stop(); return; }
      startX = t.clientX; startY = t.clientY; lastX = t.clientX; startTime = Date.now();
      axis = null; dragging = false;
      const h = ref.current;
      side = h.isOpen("left") ? "left" : h.isOpen("right") ? "right" : null;
      openAtStart = side !== null;
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_THRESHOLD) return;
        if (Math.abs(dy) >= Math.abs(dx)) { axis = "y"; side = null; return; }   // 纵向 → 交给滚动
        axis = "x";
        if (!side) side = dx > 0 ? "left" : "right";                             // 未展开：方向决定要拉开哪侧
        else if (openAtStart) {
          // 已展开：只有"关闭方向"可拖（左栏往左、右栏往右），往内滑作废
          const closing = side === "left" ? dx < 0 : dx > 0;
          if (!closing) { side = null; return; }
        }
      }
      if (!side || axis !== "x") return;
      lastX = t.clientX;
      const width = window.innerWidth || 1;
      const moved = Math.abs(lastX - startX);
      const p = openAtStart ? clamp01(1 - moved / width) : clamp01(moved / width);
      if (apply(side, p)) e.preventDefault();
    };

    const onEnd = () => {
      const s = side;
      const h = ref.current;
      stop();
      if (!s) { h.getMask("left")?.classList.remove(MASK_SWIPING); h.getMask("right")?.classList.remove(MASK_SWIPING); return; }
      const moved = Math.abs(lastX - startX);
      // 对齐思源 touch.ts:308-313：快速横向滑动（<1000ms）即便距离短也提交；慢拖才要求越过 1/3 屏宽。
      const quickFlick = Date.now() - startTime < 1000 && moved > AXIS_THRESHOLD;
      const passed = moved > (window.innerWidth || 1) * COMMIT_RATIO || quickFlick;
      const next = openAtStart ? !passed : passed;
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
