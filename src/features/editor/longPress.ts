/**
 * 桌面编辑器长按手势（触屏没有右键，用长按替代）。
 * 触摸保持 450ms 且位移 < 10px 触发；触发后吞掉随后的 click，避免误触卡片打开。
 * 返回解绑函数。
 *
 * 计时/阈值/取消/清理的唯一实现 = src/lib/longPressTimer.ts（本文件只做原生 touch 事件接线）。
 * 桌面入口只依赖框架无关的共享核心，**不 import 移动端模块**（跨端边界）。
 */
import { createLongPressTimer } from "../../lib/longPressTimer";

/** 桌面编辑器阈值：比移动端 hook（350ms）更"稳"，避免正文里选字/滚动时误触。 */
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

export function attachLongPress(
  el: HTMLElement,
  onLongPress: (clientX: number, clientY: number, target: EventTarget | null) => void,
): () => void {
  const timer = createLongPressTimer({
    ms: LONG_PRESS_MS,
    moveCancelPx: MOVE_TOLERANCE,
    onFire: ({ clientX, clientY }, target) => onLongPress(clientX, clientY, target),
  });

  const onStart = (event: TouchEvent): void => {
    const t = event.touches[0];
    if (!t) return;
    timer.start({ clientX: t.clientX, clientY: t.clientY }, event.target);
  };
  const onMove = (event: TouchEvent): void => {
    const t = event.touches[0];
    if (!t) return;
    timer.move({ clientX: t.clientX, clientY: t.clientY });
  };
  const onEnd = (): void => { timer.end(); };
  const onCancel = (): void => { timer.cancel(); };
  const onClickCapture = (event: Event): void => {
    // 长按触发过 → 这一次 click 是长按的副产物，吞掉（短按不受影响）。
    if (!timer.consumeClickSuppression()) return;
    event.stopPropagation();
    event.preventDefault();
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: true });
  el.addEventListener("touchend", onEnd, { passive: true });
  el.addEventListener("touchcancel", onCancel, { passive: true });
  el.addEventListener("click", onClickCapture, true);
  return () => {
    timer.dispose();
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onCancel);
    el.removeEventListener("click", onClickCapture, true);
  };
}
