import { describe, expect, it } from "vitest";
import { runPool, runPoolSettled } from "./s3v3Pool.js";

describe("runPool", () => {
  it("按序返回且并发受限", async () => {
    let active = 0;
    let max = 0;
    const out = await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThan(1);
  });
  it("首个错误上抛", async () => {
    await expect(runPool([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); return n; })).rejects.toThrow("boom");
  });
  it("空输入", async () => {
    expect(await runPool([], 8, async () => 1)).toEqual([]);
  });
  it("settled：单点失败不影响其它任务，返回全部错误", async () => {
    const r = await runPoolSettled([1, 2, 3, 4], 2, async (n) => { if (n % 2 === 0) throw new Error("e" + n); return n; });
    expect(r.results[0]).toBe(1);
    expect(r.results[2]).toBe(3);
    expect(r.errors.map((x) => x.index)).toEqual([1, 3]);
  });
});
