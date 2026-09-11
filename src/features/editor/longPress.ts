/**
 * 移动端长按手势（触屏没有右键，用长按替代）。
 * 触摸保持 450ms 且位移 < 10px 触发；触发后吞掉随后的 click，避免误触卡片打开。
 * 返回解绑函数。
 */
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

export function attachLongPress(
  el: HTMLElement,
  onLongPress: (clientX: number, clientY: number, target: EventTarget | null) => void,
): () => void {
  let timer: number | undefined;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const clear = (): void => {
    if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
  };
  const onStart = (event: TouchEvent): void => {
    const t = event.touches[0];
    if (!t) return;
    startX = t.clientX; startY = t.clientY; fired = false;
    clear();
    timer = window.setTimeout(() => { fired = true; onLongPress(startX, startY, event.target); }, LONG_PRESS_MS);
  };
  const onMove = (event: TouchEvent): void => {
    const t = event.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - startX) > MOVE_TOLERANCE || Math.abs(t.clientY - startY) > MOVE_TOLERANCE) clear();
  };
  const onEnd = (): void => { clear(); };
  const onClickCapture = (event: Event): void => {
    if (!fired) return;
    fired = false;
    event.stopPropagation();
    event.preventDefault();
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: true });
  el.addEventListener("touchend", onEnd, { passive: true });
  el.addEventListener("touchcancel", onEnd, { passive: true });
  el.addEventListener("click", onClickCapture, true);
  return () => {
    clear();
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
    el.removeEventListener("click", onClickCapture, true);
  };
}
