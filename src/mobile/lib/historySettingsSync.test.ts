/** MOB-17：历史设置变更总线（设置页保存成功 → 快照定时器重挂）。 */
import { describe, expect, it, vi } from "vitest";
import { notifyHistorySettingsChanged, subscribeHistorySettings } from "./historySettingsSync";

const settings = { maxSnapshots: 100, retentionDays: 30, cleanupIntervalHours: 24, snapshotIntervalMinutes: 15 };

describe("historySettingsSync", () => {
  it("保存成功后广播最新设置；退订后不再收到", () => {
    const listener = vi.fn();
    const off = subscribeHistorySettings(listener);
    notifyHistorySettingsChanged(settings);
    expect(listener).toHaveBeenCalledWith(settings);

    off();
    notifyHistorySettingsChanged({ ...settings, snapshotIntervalMinutes: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("单个订阅方抛错不影响其它订阅方", () => {
    const bad = vi.fn(() => { throw new Error("subscriber boom"); });
    const good = vi.fn();
    const offBad = subscribeHistorySettings(bad);
    const offGood = subscribeHistorySettings(good);
    expect(() => notifyHistorySettingsChanged(settings)).not.toThrow();
    expect(good).toHaveBeenCalledWith(settings);
    offBad();
    offGood();
  });
});
