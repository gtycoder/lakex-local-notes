import { describe, expect, it, vi } from "vitest";
import { OperationTimeoutError, withTimeout } from "./asyncTimeout";

describe("withTimeout", () => {
  it("操作先完成时透传结果并清理定时器", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "超时")).resolves.toBe(42);
  });

  it("操作挂起时按上限拒绝为可识别错误", async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise<never>(() => undefined), 500, "PDF 导出超时");
      const assertion = expect(pending).rejects.toBeInstanceOf(OperationTimeoutError);
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
