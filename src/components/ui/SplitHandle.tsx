/**
 * 左右分栏的**分隔条唯一实现**：指针拖拽 + ←/→ 微调（Shift 大步、Home/End 到两端）
 * + 双击复位 + `role=separator` 键盘可达；视觉复用 kit 的 `.ln-split-handle`。
 *
 * 宽度怎么存由调用方决定 —— `SplitPane` 存 localStorage（设备本地），文档分屏只留在内存（临时、不持久化）。
 * 判定只看有没有第二份交互实现：这里就是那一份。
 *
 * 拖拽落在 window 上（pointerdown 起、pointerup/cancel 收）：pointer capture 在合成鼠标/无活动指针时
 * 会抛错并中止拖拽，window 监听没有这个前提，两者叠加更稳。
 */
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

const STEP = 16;
const STEP_LARGE = 64;

export interface SplitHandleProps {
  /** 分隔条的可访问名（如「调整资源列表宽度」）。 */
  ariaLabel: string;
  minWidth?: number;
  maxWidth?: number;
  /** 右栏最小宽度：拖拽时用它夹取，避免把右栏压到没边。 */
  minRight?: number;
  /** 分栏容器（量总宽 + 未拖过时量左栏）。 */
  containerRef: RefObject<HTMLElement | null>;
  /** 左栏当前宽度（px）；null = 没拖过，按 CSS/实测默认。 */
  width: number | null;
  /** 未拖过时量左栏宽度（拖拽起点与键盘步进用）。 */
  measureLeft: () => number;
  /** 拖拽/键盘过程中的即时宽度（预览，不落盘）。 */
  onPreview: (next: number) => void;
  /** 松手/键盘落定：null = 复位到默认。 */
  onCommit: (next: number | null) => void;
  onResizingChange?: (resizing: boolean) => void;
}

export function SplitHandle({
  ariaLabel, minWidth = 240, maxWidth = 960, minRight = 240,
  containerRef, width, measureLeft, onPreview, onCommit, onResizingChange,
}: SplitHandleProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; current: number } | null>(null);

  const clamp = (w: number, containerWidth: number) => {
    const upper = Math.min(maxWidth, containerWidth > 0 ? containerWidth - minRight : maxWidth);
    return Math.max(minWidth, Math.min(Math.max(minWidth, upper), w));
  };
  const leftWidth = () => (width != null ? width : measureLeft());

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch { /* 合成鼠标/无活动指针：不依赖 capture，下面走 window 监听 */ }
    const start = leftWidth();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: start, current: start };
    onResizingChange?.(true);
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = clamp(drag.startWidth + (ev.clientX - drag.startX), containerRef.current?.getBoundingClientRect().width ?? 0);
      drag.current = next;
      onPreview(next);
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onResizingChange?.(false);
      if (drag) onCommit(drag.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP_LARGE : STEP;
    const container = containerRef.current?.getBoundingClientRect().width ?? 0;
    const current = leftWidth();
    let next: number;
    if (event.key === "ArrowLeft") next = clamp(current - step, container);
    else if (event.key === "ArrowRight") next = clamp(current + step, container);
    else if (event.key === "Home") next = clamp(minWidth, container);
    else if (event.key === "End") next = clamp(maxWidth, container);
    else return;
    event.preventDefault();
    onCommit(next);
  };

  return (
    <div
      className="ln-split-handle"
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width != null ? Math.round(width) : undefined}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(null)}
    />
  );
}
