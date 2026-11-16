import { describe, expect, it } from "vitest";
import {
  applyUpdateSettingsPatch,
  normalizeUpdateSettings,
  UPDATE_CHECK_INTERVAL_OPTIONS,
  UPDATE_SETTINGS_DEFAULTS,
} from "./updateTypes";

describe("updateTypes（更新中心设置）", () => {
  it("缺省/坏值回默认：自动检查开、24h、自动下载开、未忽略", () => {
    expect(normalizeUpdateSettings(null)).toEqual(UPDATE_SETTINGS_DEFAULTS);
    expect(normalizeUpdateSettings({ autoCheck: "yes", checkIntervalHours: 7, autoDownload: 1, ignoredVersion: 5 })).toEqual(UPDATE_SETTINGS_DEFAULTS);
  });

  it("下拉三档 = 24 小时 / 每周 / 每月（0 与旧 6/12 不再出现在选项里）", () => {
    expect([...UPDATE_CHECK_INTERVAL_OPTIONS]).toEqual([24, 168, 720]);
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).not.toContain(0);
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).not.toContain(6);
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).not.toContain(12);
    for (const hours of [24, 168, 720]) expect(normalizeUpdateSettings({ checkIntervalHours: hours }).checkIntervalHours).toBe(hours);
  });

  it("旧值收敛：6/12 小时 → 24；0 保留为历史「关闭」（只读兼容，不再是选项）", () => {
    expect(normalizeUpdateSettings({ checkIntervalHours: 6 }).checkIntervalHours).toBe(24);
    expect(normalizeUpdateSettings({ checkIntervalHours: 12 }).checkIntervalHours).toBe(24);
    expect(normalizeUpdateSettings({ checkIntervalHours: 7 }).checkIntervalHours).toBe(24);
    expect(normalizeUpdateSettings({ autoCheck: false, checkIntervalHours: 0, autoDownload: false, ignoredVersion: " 1.0.5 " }))
      .toEqual({ autoCheck: false, checkIntervalHours: 0, autoDownload: false, ignoredVersion: "1.0.5" });
  });

  it("补丁合并：未给字段不动，0 不被 || 吞掉", () => {
    const current = { ...UPDATE_SETTINGS_DEFAULTS, ignoredVersion: "1.0.5" };
    expect(applyUpdateSettingsPatch(current, { checkIntervalHours: 0 }).checkIntervalHours).toBe(0);
    expect(applyUpdateSettingsPatch(current, { autoCheck: false })).toEqual({ ...current, autoCheck: false });
    expect(applyUpdateSettingsPatch(current, { ignoredVersion: "" }).ignoredVersion).toBe("");
  });
});
