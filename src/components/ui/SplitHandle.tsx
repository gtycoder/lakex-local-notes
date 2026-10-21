/**
 * 左右分栏的**分隔条唯一实现**：指针拖拽 + ←/→ 微调（Shift 大步、Home/End 到两端）
 * + 双击复位 + `role=separator` 键盘可达；视觉复用 kit 的 `.ln-split-handle`。
 *
 * 宽度怎么存由调用方决定 —— `SplitPane` 存 localStorage（设备本地），文档分屏只留在内存（临时、不持久化）。
 * 判定只看有没有第二份交互实现：这里就是那一份。
 *
 * 拖拽落在 window 上（pointerdown 起、pointerup/cancel 收）：pointer capture 在合成鼠标/无活动指针时
 * 会抛错并中止拖拽，window 监听没有这个前提，两者叠加更稳。
 *
 * 261017 B：**4px 死区**（对齐 open-claude-ui 的指针微抖死区）——按下后移动不足 4px 不进入拖拽，
 * 松手也不落盘；越过阈值时把起点重定到当前点，避免"一进入就跳 4px"。双击复位不受影响。
 *
 * 261022 D1：资料库侧栏 / 大纲栏也复用本实现。两边的差异只用可选 props 表达
 * （定位类、右栏左缘方向、橡皮筋、键盘步长、冒泡、松手坐标），**不许再写第二套 pointer resize**。
 */
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

const STEP = 16;
const STEP_LARGE = 64;
/** 指针微抖死区：小于它不进入拖拽（只按下不移动 = 不落盘）。 */
export const DRAG_DEAD_PX = 4;
/** 越界橡皮筋阻尼：拖出合法区间时只跟手 16%，松手由调用方夹回。 */
const RUBBER_BAND_RATIO = 0.16;

export interface SplitDragState {
  pointerId: number;
  startX: number;
  startWidth: number;
  current: number;
  engaged: boolean;
}

/**
 * 拖拽的一步（纯函数，便于单测）：
 * - 未 engaged 且位移 < 4px：原样返回（不预览、不落盘）；
 * - 刚越过死区：把起点重定到当前指针，宽度保持按下时的值（不跳 4px）；
 * - 已 engaged：宽度 = 按下宽度 + 越过死区后的位移；
 * - `invert`（右栏左缘）：向左拖变宽，位移取反。
 */
export function nextSplitDrag(state: SplitDragState, clientX: number, invert = false): SplitDragState {
  if (!state.engaged) {
    if (Math.abs(clientX - state.startX) < DRAG_DEAD_PX) return state;
    return { ...state, engaged: true, startX: clientX };
  }
  const delta = invert ? state.startX - clientX : clientX - state.startX;
  return { ...state, current: state.startWidth + delta };
}

/** 越界橡皮筋（0.16 阻尼）：拖出 [min, max] 仍跟手，但只走 16% 距离；全仓唯一实现。 */
export function rubberBandWidth(width: number, minWidth: number, maxWidth: number): number {
  if (width < minWidth) return minWidth - (minWidth - width) * RUBBER_BAND_RATIO;
  if (width > maxWidth) return maxWidth + (width - maxWidth) * RUBBER_BAND_RATIO;
  return width;
}

export interface SplitHandleProps {
  /** 分隔条的可访问名（如「调整资源列表宽度」）。 */
  ariaLabel: string;
  minWidth?: number;
  maxWidth?: number;
  /** 右栏最小宽度：拖拽时用它夹取，避免把右栏压到没边。 */
  minRight?: number;
  /** 分栏容器（量总宽 + 未拖过时量左栏）；宽度已恒定时（侧栏/大纲栏）可不传。 */
  containerRef?: RefObject<HTMLElement | null>;
  /** 左栏当前宽度（px）；null = 没拖过，按 CSS/实测默认。 */
  width: number | null;
  /** 未拖过时量左栏宽度（拖拽起点与键盘步进用）；width 恒有值时可省。 */
  measureLeft?: () => number;
  /** 拖拽/键盘过程中的即时宽度（预览，不落盘）。 */
  onPreview: (next: number) => void;
  /** 松手/键盘落定：null = 复位到默认。 */
  onCommit: (next: number | null) => void;
  onResizingChange?: (resizing: boolean) => void;
  /** 叠加在 `.ln-split-handle` 之后的**定位类**（视觉基线固定在 kit，CSS 不动）。 */
  className?: string;
  /** 右栏左缘：向左拖变宽，键盘 ←/→ 同步反向。 */
  invert?: boolean;
  /** 拖拽宽度映射（如 0.16 橡皮筋）；给了它就不再走默认的硬夹取。 */
  softClamp?: (width: number) => number;
  /** 键盘步长（默认 16 / Shift 64）。 */
  keyStep?: number;
  keyStepLarge?: number;
  /** pointerdown 时阻止冒泡（大纲栏保持原语义）。 */
  stopPropagation?: boolean;
  /** 拖拽结束（松手/取消）回调，带原始指针坐标（大纲栏据此关闭悬停预览）。 */
  onDragEnd?: (point: { clientX: number; clientY: number }) => void;
}

export function SplitHandle({
  ariaLabel, minWidth = 240, maxWidth = 960, minRight = 240,
  containerRef, width, measureLeft, onPreview, onCommit, onResizingChange,
  className, invert = false, softClamp, keyStep = STEP, keyStepLarge = STEP_LARGE,
  stopPropagation = false, onDragEnd,
}: SplitHandleProps) {
  const dragRef = useRef<SplitDragState | null>(null);

  const clamp = (w: number, containerWidth: number) => {
    const upper = Math.min(maxWidth, containerWidth > 0 ? containerWidth - minRight : maxWidth);
    return Math.max(minWidth, Math.min(Math.max(minWidth, upper), w));
  };
  const leftWidth = () => (width != null ? width : (measureLeft?.() ?? minWidth));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch { /* 合成鼠标/无活动指针：不依赖 capture，下面走 window 监听 */ }
    const start = leftWidth();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: start, current: start, engaged: false };
    onResizingChange?.(true);
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const step = nextSplitDrag(drag, ev.clientX, invert);
      drag.engaged = step.engaged;
      drag.startX = step.startX;
      if (!step.engaged) return; // 死区内：不预览、不落盘
      const next = softClamp
        ? softClamp(step.current)
        : clamp(step.current, containerRef?.current?.getBoundingClientRect().width ?? 0);
      drag.current = next;
      onPreview(next);
    };
    const onUp = (ev: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onResizingChange?.(false);
      if (drag?.engaged) onCommit(drag.current); // 仅点击不移动 ⇒ 不落盘
      onDragEnd?.({ clientX: ev.clientX, clientY: ev.clientY });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? keyStepLarge : keyStep;
    const container = containerRef?.current?.getBoundingClientRect().width ?? 0;
    const current = leftWidth();
    let next: number;
    if (event.key === "ArrowLeft") next = clamp(current + (invert ? step : -step), container);
    else if (event.key === "ArrowRight") next = clamp(current + (invert ? -step : step), container);
    else if (event.key === "Home") next = clamp(minWidth, container);
    else if (event.key === "End") next = clamp(maxWidth, container);
    else return;
    event.preventDefault();
    onCommit(next);
  };

  return (
    <div
      className={className ? `ln-split-handle ${className}` : "ln-split-handle"}
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
