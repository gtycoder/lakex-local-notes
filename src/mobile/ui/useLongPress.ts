/**
 * 触屏长按（移动端**唯一实现**）：到点回调 + 一次震动反馈；手指移动超过阈值即取消（判给滚动/拖拽）。
 *
 * 为什么抽出来：目录行的"长按开始拖拽"与知识库卡片的"长按开菜单"用的是**同一个手势语义**
 * （阈值/反馈/取消条件），只是后续动作不同 ⇒ 阈值与计时只允许有一份（AGENTS §3#14 单一来源）。
 * 计时/取消/清理本身在 src/lib/longPressTimer.ts（桌面编辑器 features/editor/longPress.ts 共用同一份）；
 * 本文件只做 React 接线，**不要再自己 setTimeout**。
 *
 * 用法：把返回的 handlers 挂到元素上；`onLongPress` 收到按下点的坐标（拖拽起手要用）。
 */
import { useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent } from "react";
import { createLongPressTimer, type LongPressTimer } from "../../lib/longPressTimer";
import { longPressFeedback } from "./haptics";

/** 默认长按时长（毫秒）。桌面编辑器是 450ms（见 features/editor/longPress.ts）。 */
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
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  /** 共享核心按「ms + 阈值」复用；opts 变化就重建（旧实例先 dispose）。 */
  const timerRef = useRef<{ ms: number; moveCancelPx: number; timer: LongPressTimer } | null>(null);

  const ensureTimer = useCallback((): LongPressTimer => {
    const ms = optsRef.current.ms ?? LONG_PRESS_MS;
    const moveCancelPx = optsRef.current.moveCancelPx ?? LONG_PRESS_MOVE_PX;
    const current = timerRef.current;
    if (current && current.ms === ms && current.moveCancelPx === moveCancelPx) return current.timer;
    current?.timer.dispose();
    // 反馈固定 = 移动端震动；桌面那份不传 feedback（不震动）。
    const timer = createLongPressTimer({
      ms,
      moveCancelPx,
      feedback: longPressFeedback,
      onFire: (point) => onLongPressRef.current(point),
    });
    timerRef.current = { ms, moveCancelPx, timer };
    return timer;
  }, []);

  // 卸载 = 解绑（旧实现漏了这一步：组件卸载后计时器仍会到点回调一次）。
  useEffect(() => () => {
    timerRef.current?.timer.dispose();
    timerRef.current = null;
  }, []);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    const timer = ensureTimer();
    const t = e.touches[0];
    if (!t) { timer.cancel(); return; }
    timer.start({ clientX: t.clientX, clientY: t.clientY });
  }, [ensureTimer]);

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    ensureTimer().move({ clientX: t.clientX, clientY: t.clientY });
  }, [ensureTimer]);

  const clear = useCallback(() => { ensureTimer().end(); }, [ensureTimer]);

  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear };
}
