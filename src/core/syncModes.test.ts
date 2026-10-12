import { describe, expect, it } from "vitest";
import { SYNC_AUTO_MODE_OPTIONS, SYNC_INTERVAL_PRESETS, autoSyncIntervalMs, shouldSyncOnForeground, syncIntervalOptions } from "./syncModes";

const base = { enabled: true, autoMode: "interval" as const, autoIntervalMinutes: 15 };

describe("同步策略选项与判定（单一来源）", () => {
  it("模式选项覆盖三档且顺序稳定", () => {
    expect(SYNC_AUTO_MODE_OPTIONS.map((o) => o.value)).toEqual(["manual", "interval", "onOpenClose"]);
  });

  it("间隔候选 = 预设 ∪ 当前值（桌面设过的非预设值不被吞掉）", () => {
    expect(syncIntervalOptions(15)).toEqual([...SYNC_INTERVAL_PRESETS].sort((a, b) => a - b));
    expect(syncIntervalOptions(7)).toContain(7);
    expect(syncIntervalOptions(0)).toEqual([...SYNC_INTERVAL_PRESETS].sort((a, b) => a - b));
  });

  it("定时周期：关开关 / 非 interval / 间隔<1 都不起定时器", () => {
    expect(autoSyncIntervalMs({ ...base })).toBe(15 * 60 * 1000);
    expect(autoSyncIntervalMs({ ...base, enabled: false })).toBeNull();
    expect(autoSyncIntervalMs({ ...base, autoMode: "manual" })).toBeNull();
    expect(autoSyncIntervalMs({ ...base, autoMode: "onOpenClose" })).toBeNull();
    expect(autoSyncIntervalMs({ ...base, autoIntervalMinutes: 0 })).toBeNull();
    expect(autoSyncIntervalMs(null)).toBeNull();
  });

  it("前台补同步只在 onOpenClose 档", () => {
    expect(shouldSyncOnForeground({ enabled: true, autoMode: "onOpenClose" })).toBe(true);
    expect(shouldSyncOnForeground({ enabled: true, autoMode: "interval" })).toBe(false);
    expect(shouldSyncOnForeground({ enabled: false, autoMode: "onOpenClose" })).toBe(false);
    expect(shouldSyncOnForeground(null)).toBe(false);
  });
});
