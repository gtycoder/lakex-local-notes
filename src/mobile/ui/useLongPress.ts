/**
 * 触屏长按（移动端**唯一实现**）：到点回调 + 一次震动反馈；手指移动超过阈值即取消（判给滚动/拖拽）。
 *
 * 为什么抽出来：目录行的"长按开始拖拽"与知识库卡片的"长按开菜单"用的是**同一个手势语义**
 * （阈值/反馈/取消条件），只是后续动作不同 ⇒ 阈值与计时只允许有一份（AGENTS §3#14 单一来源）。
 *
 * 用法：把返回的 handlers 挂到元素上；`onLongPress` 收到按下点的坐标（拖拽起手要用）。
 */
import { useCallback, useRef, type TouchEvent as ReactTouchEvent } from "react";
import { longPressFeedback } from "./haptics";

/** 默认长按时长（毫秒）。 */
export const LONG_PRESS_MS = 350;
/** 默认移动取消阈值（px）：超过即认为用户在滚动/拖拽，不是长按。 */
export const LONG_PRESS_MOVE_PX = 10;

export interface LongPressHandlers {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

export function useLongPress(
  onLongPress: (touch: { clientX: number; clientY: number }) => void,
  opts: { ms?: number; moveCancelPx?: number } = {},
): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const ms = opts.ms ?? LONG_PRESS_MS;
  const moveCancelPx = opts.moveCancelPx ?? LONG_PRESS_MOVE_PX;

  const clear = useCallback(() => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    start.current = null;
  }, []);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    clear();
    const t = e.touches[0];
    if (!t) return;
    start.current = { x: t.clientX, y: t.clientY };
    const { clientX, clientY } = t;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      longPressFeedback();
      onLongPress({ clientX, clientY });
    }, ms);
  }, [clear, ms, onLongPress]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const s = start.current;
    const t = e.touches[0];
    if (!s || !t) return;
    if (Math.abs(t.clientX - s.x) > moveCancelPx || Math.abs(t.clientY - s.y) > moveCancelPx) clear();
  }, [clear, moveCancelPx]);

  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear };
}
