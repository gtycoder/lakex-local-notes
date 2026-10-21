/**
 * 触屏长按计时核心（框架无关）：**全仓唯一**的「按住 → 到点 / 移动取消 / 清理」实现。
 *
 * 为什么抽出来：长按有两个消费者，语义相同、只有参数不同 ——
 *   ① 桌面编辑器 src/features/editor/longPress.ts：原生 touch 监听，450ms / 10px，不震动，触发后吞 click；
 *   ② 移动端唯一实现 src/mobile/ui/useLongPress.ts：React hook，默认 350ms / 10px，到点震动。
 * 计时器曾各写一份（AGENTS §3#14「同一个交互语义只有一套」，§7#20「长按过的那一次要吞掉随后的 click」），
 * 本文件把状态机收成一份；两个消费者只做「事件接线 + 参数」，**不得再自己 setTimeout**。
 *
 * 判据（护栏 src/lib/longPressTimer.test.ts）：到点只触发一次、位移超过阈值取消、
 * 重复 start 清掉上一轮、dispose/end/cancel 后不再触发、短按不产生 click 吞。
 */

export interface LongPressPoint {
  clientX: number;
  clientY: number;
}

export interface LongPressTimerOptions {
  /** 触发时长（毫秒）。 */
  ms: number;
  /** 移动取消阈值（px）：任一轴位移**严格大于**该值即取消；0 = 一动就取消（目录行拖拽）。 */
  moveCancelPx: number;
  /** 到点回调：坐标 = 按下点（不是最后一次 move 的点，拖拽起手要用）；target = 按下时的原始事件目标。 */
  onFire: (point: LongPressPoint, target: EventTarget | null) => void;
  /** 到点反馈（移动端震动）。不传 = 不反馈（桌面）。在 onFire 之前调用。 */
  feedback?: () => void;
}

export interface LongPressTimer {
  /** 按下：记下起点并开始计时。重复调用会清掉上一轮再重新计时。 */
  start: (point: LongPressPoint, target?: EventTarget | null) => void;
  /** 移动：超过阈值即取消（判给滚动/拖拽），未超过则继续计时。 */
  move: (point: LongPressPoint) => void;
  /** 抬手：清计时（保留「已触发」标记，随后到来的 click 仍要能吞）。 */
  end: () => void;
  /** touchcancel：同 end（没有 click 可吞，标记留到下一次 start 自然清掉）。 */
  cancel: () => void;
  /** 解绑/卸载：清计时并让后续 start/move 全部失效。 */
  dispose: () => void;
  /**
   * 长按真的触发过 → 返回 true 并消费掉这次标记（调用方据此吞掉随后的一次 click）；
   * 短按 / 移动取消 / 尚未到点 → 返回 false（不误伤条目自身的 click）。
   */
  consumeClickSuppression: () => boolean;
}

/**
 * 创建长按计时器。句柄由调用方持有：
 * - 原生监听（桌面）：在 touchstart/move/end/cancel 里分别调 start/move/end/cancel，卸载时 dispose；
 * - React hook（移动端）：把 handler 挂到元素上，卸载时 dispose。
 */
export function createLongPressTimer(options: LongPressTimerOptions): LongPressTimer {
  const { ms, moveCancelPx, onFire, feedback } = options;

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 按下点；非空 = 本轮计时仍在进行（到点/取消/抬手后置空）。 */
  let pressPoint: LongPressPoint | null = null;
  let pressTarget: EventTarget | null = null;
  /** 本轮长按是否真的触发过（供 click 吞用；只有下一次 start 会清掉）。 */
  let fired = false;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  };
  /** 清计时 + 清按下点；不动 fired（click 在 touchend 之后才到）。 */
  const stopPress = (): void => {
    clearTimer();
    pressPoint = null;
    pressTarget = null;
  };

  return {
    start(point, target = null) {
      if (disposed) return;
      stopPress();                 // 重复 start：上一轮（含未消费的 click 吞标记）统一作废
      fired = false;
      pressPoint = { clientX: point.clientX, clientY: point.clientY };
      pressTarget = target ?? null;
      timer = globalThis.setTimeout(() => {
        timer = undefined;
        if (disposed || !pressPoint) return;
        const firedPoint = pressPoint;
        const firedTarget = pressTarget;
        pressPoint = null;
        pressTarget = null;
        fired = true;
        feedback?.();
        onFire(firedPoint, firedTarget);
      }, ms);
    },

    move(point) {
      if (disposed || !pressPoint) return;
      const overX = Math.abs(point.clientX - pressPoint.clientX) > moveCancelPx;
      const overY = Math.abs(point.clientY - pressPoint.clientY) > moveCancelPx;
      if (overX || overY) stopPress();
    },

    end() {
      if (disposed) return;
      stopPress();
    },

    cancel() {
      if (disposed) return;
      stopPress();
    },

    dispose() {
      disposed = true;
      stopPress();
      fired = false;
    },

    consumeClickSuppression() {
      if (!fired) return false;
      fired = false;
      return true;
    },
  };
}
