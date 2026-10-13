import { describe, expect, it } from "vitest";
import { SYNC_AUTO_MODE_OPTIONS, SYNC_INTERVAL_PRESETS, SYNC_OPEN_CLOSE_NOTE, autoSyncIntervalMs, shouldSyncOnOpenClose, syncIntervalOptions } from "./syncModes";

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

  // 261013 用户定稿：只要云同步开着，开/关应用都各同步一次（interval 也含在内）；「完全手动」不补。
  it("开/关应用补同步：interval 与 onOpenClose 两档都补", () => {
    expect(shouldSyncOnOpenClose({ enabled: true, autoMode: "interval" })).toBe(true);
    expect(shouldSyncOnOpenClose({ enabled: true, autoMode: "onOpenClose" })).toBe(true);
  });

  it("开/关应用补同步：「完全手动」与关闭开关都不补", () => {
    expect(shouldSyncOnOpenClose({ enabled: true, autoMode: "manual" })).toBe(false);
    expect(shouldSyncOnOpenClose({ enabled: false, autoMode: "interval" })).toBe(false);
    expect(shouldSyncOnOpenClose({ enabled: false, autoMode: "onOpenClose" })).toBe(false);
    expect(shouldSyncOnOpenClose(null)).toBe(false);
  });

  it("文案单一来源：开/关说明非空且提到三档语义", () => {
    expect(SYNC_OPEN_CLOSE_NOTE).toContain("按固定间隔");
    expect(SYNC_OPEN_CLOSE_NOTE).toContain("完全手动");
  });
});
