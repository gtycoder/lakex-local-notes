/**
 * 底部 Sheet 高度拖拽调整（261117 用户点单：记录面板太矮、长数据行展不开，要能自主上下调整）。
 *
 * 手势边界（与 useSwipeDownDismiss 划清）：**头部（grabber/标题行）拖拽 = 调高度** ——
 * 上拉变高、下拉变矮、松手停在当前位置（自由停驻）；拖到最小高度仍继续下拉过阈值松手 = 关闭；
 * 内容区的下滑关闭不受影响（resizable Sheet 由 MobileSheet 给 useSwipeDownDismiss 传 ignoreSelector 忽略头部）。
 * 高度写在 sheet 的内联 style.height 上（可被键盘稳定 hook 的临时钉住覆盖，收起后还原为调好的高度）。
 */
import { useEffect, type RefObject } from "react";

/** 高度范围（相对视口）：下限保证标题与一行内容可见，上限留出顶部安全距离。 */
export const SHEET_RESIZE_MIN_RATIO = 0.35;
export const SHEET_RESIZE_MAX_RATIO = 0.92;
/** 拖到最小高度后继续下拉超过该距离松手 = 关闭。 */
export const SHEET_RESIZE_DISMISS_PX = 64;
/** 位移小于该值不算拖拽（防误触）。 */
export const SHEET_RESIZE_ENGAGE_PX = 4;

export function clampSheetHeight(height: number, viewportHeight: number): number {
  const min = viewportHeight * SHEET_RESIZE_MIN_RATIO;
  const max = viewportHeight * SHEET_RESIZE_MAX_RATIO;
  return Math.min(Math.max(height, min), max);
}

export function shouldDismissFromResize(deltaY: number, height: number, viewportHeight: number): boolean {
  return deltaY > SHEET_RESIZE_DISMISS_PX && height <= viewportHeight * SHEET_RESIZE_MIN_RATIO + 1;
}

export interface SheetResizeOptions {
  enabled: boolean;
  onDismiss(): void;
}

/** 挂在 Sheet 头部（handle）上：拖拽调 sheet 高度；到最小高度继续下拉松手 = onDismiss。 */
export function useSheetResize(
  handle: RefObject<HTMLElement | null>,
  sheet: RefObject<HTMLElement | null>,
  { enabled, onDismiss }: SheetResizeOptions,
): void {
  useEffect(() => {
    const head = handle.current;
    const el = sheet.current;
    if (!enabled || !head || !el) return;
    let startY = 0;
    let startH = 0;
    let lastY = 0;
    let active = false;
    let dragging = false;

    const reset = (): void => {
      el.classList.remove("is-dragging");
      active = false;
      dragging = false;
    };
    const onStart = (event: TouchEvent): void => {
      if (event.touches.length !== 1) { reset(); return; }
      active = true;
      dragging = false;
      startY = event.touches[0]!.clientY;
      lastY = startY;
      startH = el.getBoundingClientRect().height;
    };
    const onMove = (event: TouchEvent): void => {
      if (!active || event.touches.length !== 1) return;
      const deltaY = event.touches[0]!.clientY - startY;
      lastY = event.touches[0]!.clientY;
      if (!dragging && Math.abs(deltaY) < SHEET_RESIZE_ENGAGE_PX) return;
      dragging = true;
      if (event.cancelable) event.preventDefault();
      el.classList.add("is-dragging");
      const next = clampSheetHeight(startH - deltaY, window.innerHeight);
      el.style.height = Math.round(next) + "px";
      el.style.maxHeight = "none";
    };
    const onEnd = (event: TouchEvent): void => {
      if (!active) return;
      const deltaY = (event.changedTouches[0]?.clientY ?? lastY) - startY;
      const height = el.getBoundingClientRect().height;
      const dismiss = dragging && shouldDismissFromResize(deltaY, height, window.innerHeight);
      reset();
      if (dismiss) onDismiss();
    };

    head.addEventListener("touchstart", onStart, { passive: true });
    head.addEventListener("touchmove", onMove, { passive: false });
    head.addEventListener("touchend", onEnd);
    head.addEventListener("touchcancel", reset);
    return () => {
      head.removeEventListener("touchstart", onStart);
      head.removeEventListener("touchmove", onMove);
      head.removeEventListener("touchend", onEnd);
      head.removeEventListener("touchcancel", reset);
      reset();
    };
  }, [handle, sheet, enabled, onDismiss]);
}
