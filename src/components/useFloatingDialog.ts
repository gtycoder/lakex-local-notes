import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

interface DialogSize {
  w: number;
  h: number;
}

interface DialogPoint {
  x: number;
  y: number;
}

export type ResizeDirection = "r" | "l" | "t" | "d" | "rd" | "rt" | "ld" | "lt";

interface FloatingDialogOptions {
  /** 本地持久化键：位置/尺寸只存本机 localStorage，**不进 S3**（对齐思源 LOCAL_DIALOGPOSITION 的本地语义）。 */
  id: string;
  initialSize: DialogSize;
  minSize: DialogSize;
  maxWidth?: number;
}

interface StoredDialogState {
  w: number;
  h: number;
  x: number;
  y: number;
}

const STORE_KEY = "lake-notes-v3.dialog-states";
const EDGE = 8;

function readStore(): Record<string, StoredDialogState> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredDialogState>) : {};
  } catch {
    return {};
  }
}

function writeStore(id: string, state: StoredDialogState): void {
  try {
    const store = readStore();
    store[id] = state;
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // 隐私模式 / 存储被禁用：忽略，不影响弹窗使用
  }
}

/**
 * 思源式轻量浮动窗口：默认居中，标题栏可拖动，**8 个方向**可拉伸；位置/尺寸本地持久化（不进 S3）。
 * 拖动/缩放过程中只直接更新 DOM，松手后才提交 React 状态，避免每帧重渲染。
 */
export function useFloatingDialog({ id, initialSize, minSize, maxWidth = 1180 }: FloatingDialogOptions) {
  const [loaded] = useState(() => {
    const maxW = Math.min(maxWidth, window.innerWidth - 32);
    const maxH = Math.max(minSize.h, window.innerHeight - 32);
    const fit = (size: DialogSize): DialogSize => ({
      w: Math.min(maxW, Math.max(minSize.w, size.w)),
      h: Math.min(maxH, Math.max(minSize.h, size.h)),
    });
    const stored = readStore()[id];
    const size = fit(stored ? { w: stored.w, h: stored.h } : initialSize);
    const position = stored
      ? {
          x: Math.min(Math.max(EDGE, stored.x), Math.max(EDGE, window.innerWidth - size.w - EDGE)),
          y: Math.min(Math.max(EDGE, stored.y), Math.max(EDGE, window.innerHeight - size.h - EDGE)),
        }
      : null;
    return { size, position };
  });
  const [size, setSize] = useState<DialogSize>(loaded.size);
  const [position, setPosition] = useState<DialogPoint | null>(loaded.position);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<"drag" | "resize" | null>(null);

  const getBounds = useCallback(() => ({
    maxW: Math.min(maxWidth, window.innerWidth - 32),
    maxH: Math.max(minSize.h, window.innerHeight - 32),
  }), [maxWidth, minSize.h]);

  /**
   * 窗口尺寸变化后把浮窗拉回可见区（位置与尺寸一起收敛）。
   *
   * 位置/尺寸是本机持久化的：**在大窗口里把浮窗拖到右上/右下，之后用更小的窗口打开**，
   * 或窗口在被打开期间被缩小，浮窗就会留在屏幕外（用户 260926 报历史弹窗"完全不可见"）。
   * 这里的坐标同样是**视口绝对坐标**（依赖 .floating-dialog 的 position: fixed，见 panels.css 的说明）。
   */
  useEffect(() => {
    const reclamp = () => {
      const panel = panelRef.current;
      if (!panel || interactionRef.current) return; // 拖动/缩放中不插手
      const bounds = getBounds();
      const rect = panel.getBoundingClientRect();
      const w = Math.min(bounds.maxW, Math.round(rect.width));
      const h = Math.min(bounds.maxH, Math.round(rect.height));
      const x = Math.min(Math.max(EDGE, Math.round(rect.left)), Math.max(EDGE, window.innerWidth - w - EDGE));
      const y = Math.min(Math.max(EDGE, Math.round(rect.top)), Math.max(EDGE, window.innerHeight - h - EDGE));
      if (w === Math.round(rect.width) && h === Math.round(rect.height) && x === Math.round(rect.left) && y === Math.round(rect.top)) return;
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.transform = "none";
      panel.style.animation = "none";
      setSize({ w, h });
      setPosition({ x, y });
    };
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [getBounds]);

  const persist = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    writeStore(id, { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.left), y: Math.round(rect.top) });
  }, [id]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, textarea, select, a, [data-no-drag]")) return;
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = "drag";
    // 关掉入场动画：它的 keyframes 强制 translate(-50%,-50%)，会覆盖拖拽用的 transform:none。
    panel.style.animation = "none";
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
      const nextX = Math.min(Math.max(EDGE, originX + ev.clientX - startX), Math.max(EDGE, window.innerWidth - panel.offsetWidth - EDGE));
      const nextY = Math.min(Math.max(EDGE, originY + ev.clientY - startY), Math.max(EDGE, window.innerHeight - panel.offsetHeight - EDGE));
      panel.style.left = `${nextX}px`;
      panel.style.top = `${nextY}px`;
    };
    const up = (ev: PointerEvent) => {
      interactionRef.current = null;
      const finalRect = panel.getBoundingClientRect();
      setPosition({ x: Math.round(finalRect.left), y: Math.round(finalRect.top) });
      persist();
      try { if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId); } catch { /* best effort */ }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }, [persist]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection) => {
    if (event.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = "resize";
    // 同上：缩放的 left/top 锚定同样会被入场动画的 translate(-50%,-50%) 打乱。
    panel.style.animation = "none";
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* best effort */ }
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = panel.getBoundingClientRect();
    const startW = rect.width;
    const startH = rect.height;
    const startLeft = rect.left;
    const startTop = rect.top;
    const move = (ev: PointerEvent) => {
      const bounds = getBounds();
      let w = startW;
      let h = startH;
      let left = startLeft;
      let top = startTop;
      if (direction.includes("r")) w = Math.min(bounds.maxW, Math.max(minSize.w, startW + ev.clientX - startX));
      if (direction.includes("l")) {
        w = Math.min(bounds.maxW, Math.max(minSize.w, startW - (ev.clientX - startX)));
        left = startLeft + (startW - w);
      }
      if (direction.includes("d")) h = Math.min(bounds.maxH, Math.max(minSize.h, startH + ev.clientY - startY));
      if (direction.includes("t")) {
        h = Math.min(bounds.maxH, Math.max(minSize.h, startH - (ev.clientY - startY)));
        top = startTop + (startH - h);
      }
      left = Math.min(Math.max(EDGE, left), Math.max(EDGE, window.innerWidth - w - EDGE));
      top = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - h - EDGE));
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
      if (direction.includes("l") || direction.includes("t")) {
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.transform = "none";
      }
    };
    const up = (ev: PointerEvent) => {
      interactionRef.current = null;
      const finalRect = panel.getBoundingClientRect();
      setSize({ w: Math.round(finalRect.width), h: Math.round(finalRect.height) });
      if (direction.includes("l") || direction.includes("t")) setPosition({ x: Math.round(finalRect.left), y: Math.round(finalRect.top) });
      persist();
      try { if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId); } catch { /* best effort */ }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }, [getBounds, minSize.h, minSize.w, persist]);

  const panelStyle: CSSProperties = {
    width: size.w,
    height: size.h,
    ...(position ? { left: position.x, top: position.y, transform: "none", animation: "none" } : {}),
  };

  return {
    panelRef,
    panelStyle,
    startDrag,
    startResize,
    interactionRef,
  };
}
