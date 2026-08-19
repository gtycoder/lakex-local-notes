/**
 * 受控并发的批量异步执行（主进程同步链路用）。
 * - 按顺序保持结果数组（worker 按原索引写入，返回顺序与输入一致）；
 * - 并发数封顶；任一任务失败后停止领取新任务并立即向外抛错（在途任务继续完成）；
 * - 空数组直接返回，不启动 worker。
 */
export const ASSET_TRANSFER_CONCURRENCY = 4;

export async function runPool<T, R>(
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
