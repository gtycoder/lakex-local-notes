/**
 * 受控并发的批量异步执行（主进程同步链路用）。
 * - 按顺序保持结果数组（worker 按原索引写入，返回顺序与输入一致）；
 * - 并发数封顶；任一任务失败后停止领取新任务并立即向外抛错（在途任务继续完成）；
 * - 空数组直接返回，不启动 worker。
 */
export const ASSET_TRANSFER_CONCURRENCY = 4;

export async function runAsyncPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;

  const run = async (): Promise<void> => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

/**
 * 261107 review：业务模块（如创建副本的资源复制）需要「单条失败不终止」的有界并发池时，
 * 统一从这里取（实现仍是 s3v3Pool，避免两份并发实现漂移）；单条失败即中止的语义见上面的 runAsyncPool。
 */
export { runPool, runPoolSettled } from "./s3v3Pool.js";
export type { SettledPoolResult } from "./s3v3Pool.js";
