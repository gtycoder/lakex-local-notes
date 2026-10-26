/**
 * 全局有界传输流水线（v3 首拉提速 P0-1）。
 *
 * 目标：不再「按篇开小池 + 逐篇 barrier」，而是把**对象级任务**（正文 GET、声明 GET、资产 GET）
 * 统一投进一个全局有界调度器：谁先完成谁写盘，带宽/连接始终打满；单任务失败只影响该对象。
 *
 * 纯逻辑、无 node 依赖（桌面/移动共用）。并发上限由调用方给（引擎默认 16–24，clamp 见引擎）。
 */

export type TransferPhase = "bodies" | "declarations" | "assets" | "uploads";

export interface TransferProgress {
  phase: TransferPhase;
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal?: number;
}

export interface TransferPipelineResult {
  /** 完成的任务数（含 0 字节的「已存在跳过」）。 */
  done: number;
  bytes: number;
  errors: Array<{ index: number; error: unknown }>;
}

/**
 * 运行有界流水线。
 * worker 返回本次搬运字节数（跳过/失败返回 0）；错误被收集、不中断其它任务。
 * onProgress 每完成一个任务回调一次（节流由上层/UI 负责）。
 */
export async function runTransferPipeline<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<number>,
  opts: { onProgress?: (p: TransferProgress) => void; phase?: TransferPhase; offsetDone?: number; offsetBytes?: number; totalOverride?: number; bytesTotal?: number } = {},
): Promise<TransferPipelineResult> {
  const concurrency = Number.isSafeInteger(limit) && limit >= 1 ? limit : 1;
  const errors: Array<{ index: number; error: unknown }> = [];
  const phase = opts.phase ?? "assets";
  const offsetDone = opts.offsetDone ?? 0;
  const offsetBytes = opts.offsetBytes ?? 0;
  let bytes = 0;
  let done = 0;
  let cursor = 0;
  const total = opts.totalOverride ?? items.length;
  const emit = () => {
    try {
      opts.onProgress?.({
        phase, done: offsetDone + done, total,
        bytesDone: offsetBytes + bytes,
        ...(opts.bytesTotal !== undefined ? { bytesTotal: opts.bytesTotal } : {}),
      });
    } catch { /* 进度回调自行负责，绝不阻断传输 */ }
  };
  const lane = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        const n = await worker(items[index], index);
        if (Number.isFinite(n) && n > 0) bytes += n;
      } catch (error) {
        errors.push({ index, error });
      }
      done += 1;
      emit();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  errors.sort((a, b) => a.index - b.index);
  return { done: offsetDone + done, bytes: bytes, errors };
}
