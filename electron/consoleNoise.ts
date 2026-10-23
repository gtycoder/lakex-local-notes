/**
 * 渲染层控制台噪音折叠（261023）。
 *
 * 背景（实测）：把一整页外部网页粘进文档时，内核会先把远程 img 的 src 指向 https 地址插进 DOM，
 * CSP 会为每张图打一条 "Loading the image '…' violates the following Content Security Policy
 * directive" 通知 —— 单次粘贴 60–103 行（值得买页面实测 103 行，见 docs/TROUBLESHOOTING.md §M），
 * 把同一时刻真正需要的日志冲掉。
 *
 * 这些通知**不代表内容丢失**（图片最终仍由主进程受控下载落地），逐条保留没有诊断价值；
 * 折叠成一行（条数 + 示例 URL）即可。其余消息原样放行，且**保持顺序**：遇到非 CSP 消息时先把
 * 待发的汇总吐出去，再让调用方写自己的行。
 *
 * 纯逻辑（不依赖 electron / DOM），主进程在 main.ts 的 console-message 转发处接线。
 */

export interface ConsoleNoiseFilterOptions {
  /** 汇总行的落点（主进程里是 log.renderer.info）。 */
  emit: (line: string) => void;
  /** 最后一条 CSP 通知后多久吐汇总（毫秒）。默认 2000。 */
  flushDelayMs?: number;
  /** 计时器注入（单测用）；默认 setTimeout + unref。 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const CSP_VIOLATION_RE = /violates the following Content Security Policy directive/i;
const CSP_IMAGE_RE = /Loading the image '([^']*)'/i;
const SAMPLE_MAX_CHARS = 120;

export function isCspViolationNotice(message: string): boolean {
  return CSP_VIOLATION_RE.test(message);
}

/** 汇总行文案（单测直接断言它）。 */
export function formatCspSummary(count: number, images: number, sample: string | null): string {
  const trimmed = sample && sample.length > SAMPLE_MAX_CHARS ? sample.slice(0, SAMPLE_MAX_CHARS) + "…" : sample;
  const sampleText = trimmed ? "，示例 " + trimmed : "";
  return "[console-noise] 折叠 " + count + " 条 CSP 拦截通知（图片 " + images + " 张" + sampleText + "）：渲染层加载外部图片被拦下，图片仍由主进程受控下载落地，不是内容丢失";
}

/**
 * 把连续出现的 CSP 拦截通知折叠成一行汇总。
 * 用法：if (filter.observe(msg)) return; —— 返回 true 表示已折叠、不要逐条落盘。
 */
export class ConsoleNoiseFilter {
  private count = 0;
  private images = 0;
  private sample: string | null = null;
  private timer: unknown = null;
  private readonly emitLine: (line: string) => void;
  private readonly flushDelayMs: number;
  private readonly setTimerFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimerFn: (handle: unknown) => void;

  constructor(options: ConsoleNoiseFilterOptions) {
    this.emitLine = options.emit;
    this.flushDelayMs = options.flushDelayMs ?? 2000;
    this.setTimerFn = options.setTimer ?? ((fn, ms) => {
      const handle = setTimeout(fn, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
    this.clearTimerFn = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** true = 已折叠；false = 放行（放行前会先 flush 待发汇总，保证日志顺序）。 */
  observe(message: string): boolean {
    if (!isCspViolationNotice(message)) {
      this.flush();
      return false;
    }
    this.count += 1;
    const match = CSP_IMAGE_RE.exec(message);
    if (match) {
      this.images += 1;
      if (this.sample === null && match[1]) this.sample = match[1];
    }
    this.arm();
    return true;
  }

  /** 立即吐出汇总（没有待发内容时是空操作）。窗口关闭 / 进程退出时也调一次。 */
  flush(): void {
    if (this.timer !== null) {
      this.clearTimerFn(this.timer);
      this.timer = null;
    }
    if (this.count === 0) return;
    const count = this.count;
    const images = this.images;
    const sample = this.sample;
    this.count = 0;
    this.images = 0;
    this.sample = null;
    this.emitLine(formatCspSummary(count, images, sample));
  }

  private arm(): void {
    if (this.timer !== null) this.clearTimerFn(this.timer);
    this.timer = this.setTimerFn(() => {
      this.timer = null;
      this.flush();
    }, this.flushDelayMs);
  }
}
