import { describe, expect, it } from "vitest";
import {
  isSyncLockBusyCode, retryableRetryMessage, retryableStatusMessage,
  SYNC_EPOCH_MISMATCH_MESSAGE, SYNC_RETRYABLE_TITLE,
} from "./syncFailureText";

describe("同步失败文案（手动/自动两条路径同源，261028 P1）", () => {
  it("发布锁相关码 = 另一台设备在发布，不是本机故障", () => {
    expect(isSyncLockBusyCode("lock-busy")).toBe(true);
    expect(isSyncLockBusyCode("publish-conflict")).toBe(true);
    expect(isSyncLockBusyCode("cloud-changed")).toBe(true);
    expect(isSyncLockBusyCode("epoch-mismatch")).toBe(false);
    expect(isSyncLockBusyCode(undefined)).toBe(false);
    expect(retryableStatusMessage("lock-busy")).toContain("另一台设备正在同步");
    expect(retryableRetryMessage("lock-busy")).toContain("发布锁被占用");
    expect(retryableRetryMessage("lock-busy")).toContain("本地改动没丢");
  });

  it("非锁类可重试错误保留真实原因，不硬套「另一台设备」", () => {
    const message = retryableRetryMessage("unknown", "网络连接超时");
    expect(message).toContain("网络连接超时");
    expect(message).not.toContain("另一台设备");
    expect(retryableStatusMessage("unknown")).toContain("稍后自动重试");
  });

  it("epoch 不一致的引导文案指向「设置 → 同步 → 从云端恢复」且说明先隔离备份", () => {
    expect(SYNC_RETRYABLE_TITLE).toBe("同步暂时没成功");
    expect(SYNC_EPOCH_MISMATCH_MESSAGE).toContain("从云端恢复");
    expect(SYNC_EPOCH_MISMATCH_MESSAGE).toContain("隔离备份");
  });
});
