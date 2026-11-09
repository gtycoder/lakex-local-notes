import { describe, expect, it } from "vitest";
import {
  applyUpdateSettingsPatch,
  normalizeUpdateSettings,
  UPDATE_SETTINGS_DEFAULTS,
} from "./updateTypes";

describe("updateTypes（更新中心设置）", () => {
  it("缺省/坏值回默认：自动检查开、24h、自动下载开、未忽略", () => {
    expect(normalizeUpdateSettings(null)).toEqual(UPDATE_SETTINGS_DEFAULTS);
    expect(normalizeUpdateSettings({ autoCheck: "yes", checkIntervalHours: 7, autoDownload: 1, ignoredVersion: 5 })).toEqual(UPDATE_SETTINGS_DEFAULTS);
  });

  it("合法值原样保留（0 = 关闭是合法间隔）", () => {
    expect(normalizeUpdateSettings({ autoCheck: false, checkIntervalHours: 0, autoDownload: false, ignoredVersion: " 1.0.5 " }))
      .toEqual({ autoCheck: false, checkIntervalHours: 0, autoDownload: false, ignoredVersion: "1.0.5" });
    for (const hours of [6, 12, 24]) expect(normalizeUpdateSettings({ checkIntervalHours: hours }).checkIntervalHours).toBe(hours);
  });

  it("补丁合并：未给字段不动，0 不被 || 吞掉", () => {
    const current = { ...UPDATE_SETTINGS_DEFAULTS, ignoredVersion: "1.0.5" };
    expect(applyUpdateSettingsPatch(current, { checkIntervalHours: 0 }).checkIntervalHours).toBe(0);
    expect(applyUpdateSettingsPatch(current, { autoCheck: false })).toEqual({ ...current, autoCheck: false });
    expect(applyUpdateSettingsPatch(current, { ignoredVersion: "" }).ignoredVersion).toBe("");
  });
});
