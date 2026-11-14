import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";

describe("withRetry（261114 二批：shouldRetry 谓词）", () => {
  it("predicate 返回 false → 立即抛出，不消耗剩余重试（永久失败不空转）", async () => {
    const fn = vi.fn(async () => { throw new Error("permanent"); });
    await expect(withRetry(fn, { maxRetries: 3, delayMs: 1, shouldRetry: () => false })).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("predicate 返回 true / 未传 → 保持原有重试语义", async () => {
    const fn = vi.fn(async () => { throw new Error("transient"); });
    await expect(withRetry(fn, { maxRetries: 2, delayMs: 1, shouldRetry: () => true })).rejects.toThrow("transient");
    expect(fn).toHaveBeenCalledTimes(3);
    const plain = vi.fn(async () => { throw new Error("transient"); });
    await expect(withRetry(plain, { maxRetries: 1, delayMs: 1 })).rejects.toThrow("transient");
    expect(plain).toHaveBeenCalledTimes(2);
  });
});
