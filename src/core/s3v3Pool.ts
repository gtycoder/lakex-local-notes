/**
 * 有界并发池（纯逻辑，无 node 依赖）。对齐 AGENTS「S3 并发上限 = 8」。
 * 与现有 runAssetPool 语义一致：按输入顺序返回结果，首个错误上抛（但会等待已启动任务结束）。
 */
export interface SettledPoolResult<R> { results: Array<R | undefined>; errors: Array<{ index: number; error: unknown }> }

/** 与 runPool 相同并发语义，但不因单个失败终止其它任务（用于按 note 隔离的批量传输）。 */
export async function runPoolSettled<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<SettledPoolResult<R>> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("并发上限非法: " + limit);
  const results = new Array<R | undefined>(items.length);
  const errors: Array<{ index: number; error: unknown }> = [];
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { results[i] = await worker(items[i], i); } catch (error) { errors.push({ index: i, error }); }
    }
  });
  await Promise.all(runners);
  errors.sort((a, b) => a.index - b.index);
  return { results, errors };
}

export async function runPool<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("并发上限非法: " + limit);
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: unknown = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      if (failed) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        if (!failed) failed = e;
      }
    }
  });
  await Promise.all(runners);
  if (failed) throw failed;
  return results;
}
