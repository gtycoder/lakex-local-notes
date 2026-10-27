/**
 * 资源上传/下载的**爆发统计**（261023）。
 *
 * 由来：粘贴一整页外部网页会触发 60–100 次远程图片上传（值得买实测 66 张 / 8.2MB，占 2.5s）。
 * 用户报"卡"时，日志里只有 CSP 噪音，分不清是 CPU 还是这段 I/O ⇒ 这里把一段爆发聚合成**一行**：
 * 次数 / 远程数 / 墙钟 / 单次最长 / 重试 / 失败。
 *
 * 只做聚合，不做阈值告警、不采样 URL、不落盘（走 console.info → 主进程 renderer 日志）。
 * 纯逻辑（无 Electron / DOM / performance 依赖），单测注入时钟与计时器。
 */

export type UploadKind = "url" | "data" | "file" | "attachment";

export interface UploadSample {
  kind: UploadKind;
  /** 调用开始（含排队等待）的时间戳，毫秒。 */
  startedAt: number;
  /** 完成（成功或失败）的时间戳，毫秒。 */
  endedAt: number;
  ok: boolean;
  /** withRetry 实际重试次数（0 = 一次成功）。 */
  retries: number;
}

export interface UploadBurstSummary {
  calls: number;
  remote: number;
  failed: number;
  retries: number;
  /** 整段爆发的墙钟：最后一个结束 - 最早一个开始（含 6 并发排队）。 */
  wallMs: number;
  /** 单次最长（含排队等待）。 */
  maxMs: number;
}

export interface UploadStatsOptions {
  emit: (line: string) => void;
  /** 最后一条完成后的静默窗口，默认 1500ms。 */
  flushDelayMs?: number;
  /** 少于这么多次的爆发不落日志（单张图 / 单附件不打扰），默认 3。 */
  minCalls?: number;
  /** 墙钟超过这个值即使次数少也落（慢单次），默认 1500ms。 */
  minWallMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function formatUploadBurst(summary: UploadBurstSummary): string {
  return "[perf] 资源上传 " + summary.calls + " 次（远程 " + summary.remote + " / 本地 " + (summary.calls - summary.remote) + "）：墙钟 " +
    Math.round(summary.wallMs) + "ms，单次最长 " + Math.round(summary.maxMs) + "ms，重试 " + summary.retries + " 次，失败 " + summary.failed + " 次";
}

export class UploadStats {
  private calls = 0;
  private remote = 0;
  private failed = 0;
  private retries = 0;
  private firstStart = 0;
  private lastEnd = 0;
  private maxMs = 0;
  private timer: unknown = null;
  private readonly emitLine: (line: string) => void;
  private readonly flushDelayMs: number;
  private readonly minCalls: number;
  private readonly minWallMs: number;
  private readonly setTimerFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimerFn: (handle: unknown) => void;

  constructor(options: UploadStatsOptions) {
    this.emitLine = options.emit;
    this.flushDelayMs = options.flushDelayMs ?? 1500;
    this.minCalls = options.minCalls ?? 3;
    this.minWallMs = options.minWallMs ?? 1500;
    this.setTimerFn = options.setTimer ?? ((fn, ms) => {
      const handle = setTimeout(fn, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
    this.clearTimerFn = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  record(sample: UploadSample): void {
    const endedAt = Number.isFinite(sample.endedAt) ? sample.endedAt : sample.startedAt;
    const startedAt = Math.min(sample.startedAt, endedAt);
    const elapsed = Math.max(0, endedAt - startedAt);
    this.calls += 1;
    if (sample.kind === "url") this.remote += 1;
    if (!sample.ok) this.failed += 1;
    this.retries += Math.max(0, sample.retries);
    this.firstStart = this.calls === 1 ? startedAt : Math.min(this.firstStart, startedAt);
    this.lastEnd = Math.max(this.lastEnd, endedAt);
    this.maxMs = Math.max(this.maxMs, elapsed);
    this.arm();
  }

  /** 立即结算并清空（窗口关闭 / 卸载时也调一次）。没有样本或未达阈值时静默。 */
  flush(): void {
    if (this.timer !== null) {
      this.clearTimerFn(this.timer);
      this.timer = null;
    }
    if (this.calls === 0) return;
    const summary: UploadBurstSummary = {
      calls: this.calls,
      remote: this.remote,
      failed: this.failed,
      retries: this.retries,
      wallMs: Math.max(0, this.lastEnd - this.firstStart),
      maxMs: this.maxMs,
    };
    this.calls = 0;
    this.remote = 0;
    this.failed = 0;
    this.retries = 0;
    this.firstStart = 0;
    this.lastEnd = 0;
    this.maxMs = 0;
    if (summary.calls < this.minCalls && summary.wallMs < this.minWallMs && summary.failed === 0) return;
    this.emitLine(formatUploadBurst(summary));
  }

  private arm(): void {
    if (this.timer !== null) this.clearTimerFn(this.timer);
    this.timer = this.setTimerFn(() => {
      this.timer = null;
      this.flush();
    }, this.flushDelayMs);
  }
}
