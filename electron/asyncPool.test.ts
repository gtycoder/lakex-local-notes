import { describe, expect, it } from "vitest";
import { runPool } from "../src/core/asyncPool.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runPool", () => {
  it("空数组直接返回", async () => {
    await expect(runPool([], 4, async () => 1)).resolves.toEqual([]);
  });

  it("保持输入顺序返回结果", async () => {
    const out = await runPool([1, 2, 3, 4], 2, async (n) => {
      await sleep(10 - n);
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("并发数不超过上限", async () => {
    let active = 0;
    let peak = 0;
    await runPool(Array.from({ length: 8 }, (_, i) => i), 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(20);
      active -= 1;
    });
    expect(peak).toBe(3);
  });

  it("任务失败立即抛错，且不再领取新任务", async () => {
    const started: number[] = [];
    await expect(
      runPool([0, 1, 2, 3, 4], 2, async (n) => {
        started.push(n);
        if (n === 1) throw new Error("boom");
        await sleep(10);
        return n;
      }),
    ).rejects.toThrow("boom");
    // 失败后不应继续领取后面的任务（在途任务除外）
    expect(started.includes(4)).toBe(false);
  });
});
