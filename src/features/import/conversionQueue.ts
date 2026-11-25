/**
 * 导入转换的**共用设施**（D-09 收口，docs/audit-261125/02-desktop-ui.md）：串行队列 + 在途计数 + 转换总超时。
 *
 * html/Word（htmlImportPipeline）与 Markdown（markdownImportPipeline）两条管线共用**同一条**串行队列：
 * 同一时刻只跑一个转换，避免多内核并存的内存峰值（原 markdownImportPipeline 的队列注释口径，
 * 原来两管线各有一份队列 ⇒ Word 与 Markdown 并发时会有两个临时内核并存，违反该口径）。
 *
 * 错误类沿用历史名 `MarkdownImportError`：convertAiMarkdown 等消费者按类名 instanceof + code 判定，
 * 改名有连锁代价（保留类名、只修注释的口径见 D-09 报告）；超时文案由调用方按管线传 label（Word/Markdown）。
 */

export type MarkdownImportErrorCode =
  | "too-large"
  | "render-timeout"
  | "no-lake-id"
  | "convert-failed"
  | "aborted"
  | "busy";

export class MarkdownImportError extends Error {
  readonly code: MarkdownImportErrorCode;
  constructor(code: MarkdownImportErrorCode, message: string) {
    super(message);
    this.name = "MarkdownImportError";
    this.code = code;
  }
}

let queueTail: Promise<unknown> = Promise.resolve();
/** 当前在途转换数（测试断言串行用）。 */
let inFlight = 0;

export function conversionInFlight(): number {
  return inFlight;
}

/** 测试用：清空队列状态（不中断在途转换）。 */
export function resetConversionQueueForTest(): void {
  queueTail = Promise.resolve();
  inFlight = 0;
}

/** 串行入队：同一时刻只跑一个转换；前一个失败不堵后一个。 */
export function enqueueConversion<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    inFlight += 1;
    try { return await task(); } finally { inFlight -= 1; }
  }, async () => {
    inFlight += 1;
    try { return await task(); } finally { inFlight -= 1; }
  });
  queueTail = run.then(() => undefined, () => undefined);
  return run;
}

/** 转换总超时：`label` 给管线名（Word/Markdown），超时抛 render-timeout（文案各管各的）。 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new MarkdownImportError("render-timeout", label + " 转换超时（超过 " + timeoutMs + "ms）"));
    }, timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
