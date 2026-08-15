import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

interface DialogSize {
  w: number;
  h: number;
}

interface DialogPoint {
  x: number;
  y: number;
}

interface FloatingDialogOptions {
  initialSize: DialogSize;
  minSize: DialogSize;
  maxWidth?: number;
}

/**
 * 思源式轻量浮动窗口：默认居中，标题栏可拖动，右下角可拉伸。
 * 拖动过程中只直接更新 DOM，松手后才提交 React 状态，避免每帧重渲染。
 */
export function useFloatingDialog({ initialSize, minSize, maxWidth = 1180 }: FloatingDialogOptions) {
  const [size, setSize] = useState(initialSize);
  const [position, setPosition] = useState<DialogPoint | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<"drag" | "resize" | null>(null);

  const getBounds = useCallback(() => ({
    maxW: Math.min(maxWidth, window.innerWidth - 32),
    maxH: Math.max(minSize.h, window.innerHeight - 32),
  }), [maxWidth, minSize.h]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, textarea, select, a, [data-no-drag]")) return;
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = "drag";
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = rect.left;
    const originY = rect.top;
    const target = event.currentTarget;
    // Computer Use / WebKit may not expose a stable pointer capture target
    // for a fixed overlay.  Listen on window as a fallback so a drag keeps
    // working even when the pointer leaves the header during the gesture.
    try { target.setPointerCapture(event.pointerId); } catch { /* best effort */ }

    panel.style.left = `${originX}px`;
    panel.style.top = `${originY}px`;
    panel.style.transform = "none";
    const move = (ev: PointerEvent) => {
      const nextX = Math.min(Math.max(8, originX + ev.clientX - startX), Math.max(8, window.innerWidth - panel.offsetWidth - 8));
      const nextY = Math.min(Math.max(8, originY + ev.clientY - startY), Math.max(8, window.innerHeight - panel.offsetHeight - 8));
      panel.style.left = `${nextX}px`;
      panel.style.top = `${nextY}px`;
    };
    const up = (ev: PointerEvent) => {
      interactionRef.current = null;
      setPosition({ x: panel.offsetLeft, y: panel.offsetTop });
      try { if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId); } catch { /* best effort */ }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }, []);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = "resize";
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* best effort */ }
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = panel.offsetWidth;
    const startH = panel.offsetHeight;
    const move = (ev: PointerEvent) => {
      const bounds = getBounds();
      const w = Math.min(bounds.maxW, Math.max(minSize.w, startW + ev.clientX - startX));
      const h = Math.min(bounds.maxH, Math.max(minSize.h, startH + ev.clientY - startY));
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
    };
    const up = (ev: PointerEvent) => {
      interactionRef.current = null;
      setSize({ w: panel.offsetWidth, h: panel.offsetHeight });
      try { if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId); } catch { /* best effort */ }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }, [getBounds, minSize.h, minSize.w]);

  const panelStyle: CSSProperties = {
    width: size.w,
    height: size.h,
    ...(position ? { left: position.x, top: position.y, transform: "none" } : {}),
  };

  return {
    panelRef,
    panelStyle,
    startDrag,
    startResize,
    interactionRef,
  };
}
