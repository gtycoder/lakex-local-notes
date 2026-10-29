/**
 * CORE-14：SyncSettings 归一的单一来源 —— 同输入同输出，非法值回落 fallback。
 *
 * 背景（audit 10-core-services CORE-14）：桌面 / 移动 / IPC 三处各自解析同一份设置，回退策略互相矛盾。
 * 这里锁住统一口径；跨端默认值差异（enabled 默认 = 是否已配置 S3）由调用方 fallback 体现。
 */
import { describe, expect, it } from "vitest";
import { normalizeSyncSettings } from "./syncSettings.js";
import type { SyncSettings } from "./sharedTypes.js";

/** 桌面 getSyncSettings 的默认值：enabled 默认 = 是否已配置 S3（这里取 false，模拟未配置）。 */
const DESKTOP_FALLBACK: SyncSettings = { enabled: false, autoMode: "manual", autoIntervalMinutes: 15 };
/** 移动 readSyncSettings 的默认值：enabled 默认 = 是否存过 S3（这里取 false，模拟全新设备）。 */
const MOBILE_FALLBACK: SyncSettings = { enabled: false, autoMode: "manual", autoIntervalMinutes: 15 };

describe("normalizeSyncSettings", () => {
  it("完整合法值原样保留（deferAssets=true 才出现）", () => {
    expect(normalizeSyncSettings(
      { enabled: true, autoMode: "interval", autoIntervalMinutes: 30, deferAssets: true },
      DESKTOP_FALLBACK,
    )).toEqual({ enabled: true, autoMode: "interval", autoIntervalMinutes: 30, deferAssets: true });
  });

  it("非法 autoMode 回落 fallback（不再各端一套：桌面回落默认 / 移动强制 manual / IPC 抛错）", () => {
    for (const bad of ["never", "", null, 1, undefined]) {
      expect(normalizeSyncSettings({ autoMode: bad }, DESKTOP_FALLBACK).autoMode).toBe("manual");
      expect(normalizeSyncSettings({ autoMode: bad }, { ...DESKTOP_FALLBACK, autoMode: "onOpenClose" }).autoMode).toBe("onOpenClose");
    }
  });

  it("autoIntervalMinutes：< 1 / 非有限数 / 非 number 回落 fallback；合法值向下取整", () => {
    for (const bad of [0, -5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "30", null]) {
      expect(normalizeSyncSettings({ autoIntervalMinutes: bad }, DESKTOP_FALLBACK).autoIntervalMinutes, String(bad)).toBe(15);
    }
    expect(normalizeSyncSettings({ autoIntervalMinutes: 30.9 }, DESKTOP_FALLBACK).autoIntervalMinutes).toBe(30);
    expect(normalizeSyncSettings({ autoIntervalMinutes: 1 }, DESKTOP_FALLBACK).autoIntervalMinutes).toBe(1);
  });

  it("enabled：只认 boolean，其余回落 fallback（不再「缺省即 true」）", () => {
    for (const bad of ["false", 0, 1, null, undefined]) {
      expect(normalizeSyncSettings({ enabled: bad }, DESKTOP_FALLBACK).enabled).toBe(false);
      expect(normalizeSyncSettings({ enabled: bad }, { ...DESKTOP_FALLBACK, enabled: true }).enabled).toBe(true);
    }
    expect(normalizeSyncSettings({ enabled: false }, { ...DESKTOP_FALLBACK, enabled: true }).enabled).toBe(false);
  });

  it("deferAssets：缺省 / false / 非 boolean 都不写该键（缺省 = 全量语义）", () => {
    for (const raw of [{}, { deferAssets: false }, { deferAssets: "true" }, { deferAssets: 1 }]) {
      expect(normalizeSyncSettings(raw, DESKTOP_FALLBACK)).not.toHaveProperty("deferAssets");
    }
  });

  it("raw 不是对象（null / 字符串 / 数字）⇒ 完全回落 fallback，不抛错", () => {
    for (const raw of [null, undefined, "oops", 42, []]) {
      expect(normalizeSyncSettings(raw, DESKTOP_FALLBACK)).toEqual(DESKTOP_FALLBACK);
    }
  });

  it("跨端同输入：桌面与移动 fallback 只影响 enabled 默认值，其余逐字段一致", () => {
    const raw = { autoMode: "bogus", autoIntervalMinutes: 0, deferAssets: true };
    const desktop = normalizeSyncSettings(raw, DESKTOP_FALLBACK);
    const mobile = normalizeSyncSettings(raw, { ...MOBILE_FALLBACK, enabled: true });
    expect(desktop).toEqual({ enabled: false, autoMode: "manual", autoIntervalMinutes: 15, deferAssets: true });
    expect(mobile).toEqual({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15, deferAssets: true });
    expect({ ...desktop, enabled: mobile.enabled }).toEqual(mobile);
  });
});
