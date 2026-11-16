/**
 * 帧级合帧器（261116 P1-2）：把高频事件合并到一帧一次提交。
 *
 * 用途：AI 写作流式 delta 可能 50+/s，逐条 setState 会让整个工作区每 delta 重渲染一次；
 * 合并到 rAF 后每个绘制帧最多提交一次，且**生成结束时可同步 flush**（保证结束当帧就是完整内容）。
 * 调度器可注入（测试用同步/手动队列，不依赖 jsdom 的 rAF）。
 */

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
}

/** 默认调度器：有 rAF 用 rAF，没有（SSR/极简环境）退回 16ms 定时器。 */
export const rafFrameScheduler: FrameScheduler = {
  request(callback) {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    return setTimeout(callback, 16) as unknown as number;
  },
  cancel(id) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    else clearTimeout(id);
  },
};

export interface Coalescer<T> {
  /** 记录最新值；同一帧内多次 push 只保留最后一个。 */
  push(value: T): void;
  /** 若有待提交值：立即同步提交（结束/停止路径必须调，保证当帧完整）。 */
  flush(): void;
  /** 丢弃待提交值（切换会话/卸载）。 */
  cancel(): void;
  /** 是否有待提交值（测试/诊断用）。 */
  pending(): boolean;
}

export function createFrameCoalescer<T>(
  emit: (value: T) => void,
  scheduler: FrameScheduler = rafFrameScheduler,
): Coalescer<T> {
  let frame: number | null = null;
  let hasValue = false;
  let latest: T;
  const run = () => {
    frame = null;
    if (!hasValue) return;
    hasValue = false;
    emit(latest);
  };
  return {
    push(value) {
      latest = value;
      hasValue = true;
      if (frame === null) frame = scheduler.request(run);
    },
    flush() {
      if (frame !== null) {
        scheduler.cancel(frame);
        frame = null;
      }
      if (!hasValue) return;
      hasValue = false;
      emit(latest);
    },
    cancel() {
      if (frame !== null) {
        scheduler.cancel(frame);
        frame = null;
      }
      hasValue = false;
    },
    pending() {
      return hasValue;
    },
  };
}
