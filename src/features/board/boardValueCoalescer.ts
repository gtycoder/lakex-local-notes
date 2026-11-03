/**
 * 画板 value 回灌的「每帧合并」（261103 八批）。
 *
 * 为什么：快速落笔时 plait 每次 pointermove 都会 onChange；宿主若立刻 setState，就会在同一帧里
 * 叠加 React 重渲染 + 内核按新 value 重算（场景越大越贵）。这里只把**回灌给 state 的这一步**
 * 合并到下一帧——保存/capture 用的 valueRef 仍同步更新（不在本模块管），所以语义不变。
 *
 * 用 setTimeout(16) 而不是 requestAnimationFrame：隐藏窗口里 rAF 不触发（AGENTS §7 已踩），
 * 会把 state 永远压住；定时器在后台照样跑。
 */
export interface BoardValueCoalescer<T> {
  /** 合并值；同一帧内多次调用只有最后一次生效。 */
  push(value: T): void;
  /** 立刻把待回灌的值刷出去（切换显示/卸载/外部覆盖前用）。 */
  flush(): void;
  /** 丢弃待回灌的值（外部要覆盖 state 时用，避免旧值稍后把新值盖回去）。 */
  cancel(): void;
}

export function createBoardValueCoalescer<T>(apply: (value: T) => void, delayMs = 16): BoardValueCoalescer<T> {
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    push(value: T): void {
      pending = { value };
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (next) apply(next.value);
      }, delayMs);
    },
    flush(): void {
      clearTimer();
      const next = pending;
      pending = null;
      if (next) apply(next.value);
    },
    cancel(): void {
      clearTimer();
      pending = null;
    },
  };
}
