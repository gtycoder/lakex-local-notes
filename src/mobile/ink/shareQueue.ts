/**
 * 分享处理串行队列（261102 T2-E）。
 *
 * 背景：系统分享的冷启动 consume 与热启动 "shared" 事件可能同时/连续到达（用户连点多次分享），
 * 以前 MobileApp 用 busy 标志做互斥 —— 处理中到达的分享被**直接丢掉**（连提示都没有）。
 * 这里收敛成「串行队列」：一次只处理一个，其余排队；队列满（默认 5）时丢弃本次并回调一次
 * 可见提示（"分享处理队列已满，丢弃本次分享"），不再无声丢弃。
 *
 * 纯类：handler / onOverflow / onError 全部注入 ⇒ 不依赖 React / bridge / toast，单测直接跑。
 * 串行纪律：同一时刻最多一个 handler 在跑（连异常也一样，异常后继续下一个）。
 */
export const SHARE_QUEUE_LIMIT = 5;

/** 队列满时给用户的可见提示（MobileApp 直接 toast 这句）。 */
export const SHARE_QUEUE_FULL_HINT = "分享处理队列已满，丢弃本次分享";

export interface ShareQueueOptions<T> {
  /** 等待队列上限（不含正在处理的那一个）。 */
  limit?: number;
  /** 串行处理一个任务；抛错不影响后续任务。 */
  handle: (item: T) => Promise<void>;
  /** 队列已满、本次被丢弃时回调（给一次可见提示）。 */
  onOverflow?: (item: T) => void;
  /** handler 抛错时回调（调用方负责错误提示）；队列继续。 */
  onError?: (item: T, reason: unknown) => void;
}

export class ShareQueue<T> {
  private readonly limit: number;
  private readonly handle: (item: T) => Promise<void>;
  private readonly onOverflow?: (item: T) => void;
  private readonly onError?: (item: T, reason: unknown) => void;
  private readonly pending: T[] = [];
  private running = false;

  constructor(options: ShareQueueOptions<T>) {
    const limit = options.limit ?? SHARE_QUEUE_LIMIT;
    // 非法上限（0 / 负数 / NaN / Infinity）回落到默认值，不静默变成「永不排队」。
    this.limit = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : SHARE_QUEUE_LIMIT;
    this.handle = options.handle;
    this.onOverflow = options.onOverflow;
    this.onError = options.onError;
  }

  /** 当前等待中的任务数（不含正在处理的那一个）。 */
  get size(): number {
    return this.pending.length;
  }

  /** 是否有任务正在处理。 */
  get busy(): boolean {
    return this.running;
  }

  /**
   * 入队并自动开始处理。
   * @returns true = 已入队；false = 队列已满被丢弃（已调用 onOverflow）。
   */
  enqueue(item: T): boolean {
    if (this.pending.length >= this.limit) {
      this.onOverflow?.(item);
      return false;
    }
    this.pending.push(item);
    void this.drain();
    return true;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift() as T;
        try {
          await this.handle(item);
        } catch (reason) {
          this.onError?.(item, reason);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
