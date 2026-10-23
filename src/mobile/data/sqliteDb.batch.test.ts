import { describe, expect, it, vi } from "vitest";
import { executeBatch, executeBatchInTransaction, type MobileDb } from "./sqliteDb";

function baseDb(overrides: Partial<MobileDb> = {}): MobileDb {
  return {
    prepare: () => ({ get: async () => undefined, all: async () => [], run: async () => ({ changes: 1, lastInsertRowid: 0 }) }),
    async transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>> { return await fn() as Awaited<ReturnType<T>>; },
    async pragma() { return undefined; },
    async exec() { return undefined; },
    async databaseSizeBytes() { return 0; },
    async close() { return undefined; },
    ...overrides,
  };
}

describe("executeBatch", () => {
  it("executeSet 失败直接抛出，不逐条重放造成部分成功", async () => {
    const run = vi.fn();
    const db = baseDb({ executeSet: async () => { throw new Error("bridge failed"); }, prepare: () => ({ get: async () => undefined, all: async () => [], run }) });
    await expect(executeBatch(db, [{ statement: "UPDATE t SET x=?", values: [1] }])).rejects.toThrow("bridge failed");
    expect(run).not.toHaveBeenCalled();
  });

  it("事务内批量下发必须 transaction:false（否则原生会重复 BEGIN）", async () => {
    const executeSet = vi.fn(async (_set: Array<{ statement: string; values: unknown[] }>, _options?: { transaction?: boolean }) => undefined);
    const db = baseDb({ executeSet });
    await executeBatchInTransaction(db, [{ statement: "UPDATE t SET x=?", values: [1] }]);
    expect(executeSet).toHaveBeenCalledWith([{ statement: "UPDATE t SET x=?", values: [1] }], { transaction: false });
  });

  it("无 executeSet 时在一个事务内逐条执行", async () => {
    const run = vi.fn(async () => ({ changes: 1, lastInsertRowid: 0 }));
    const transaction = vi.fn(async (fn: () => Promise<void>) => await fn());
    const db = baseDb({ transaction: transaction as MobileDb["transaction"], prepare: () => ({ get: async () => undefined, all: async () => [], run }) });
    await executeBatch(db, [
      { statement: "UPDATE t SET x=?", values: [1] },
      { statement: "UPDATE t SET x=?", values: [2] },
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
