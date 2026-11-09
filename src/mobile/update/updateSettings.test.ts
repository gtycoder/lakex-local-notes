import { describe, expect, it } from "vitest";
import {
  UPDATE_SETTINGS_DEFAULTS,
  UPDATE_STATE_DEFAULTS,
  normalizeUpdateSettings,
  normalizeUpdateState,
  parseUpdateSettingsText,
  parseUpdateStateText,
  patchUpdateSettings,
} from "./updateSettings";

describe("更新设置默认值（docs/UPDATE-CENTER.md §4）", () => {
  it("默认：自动检查开 / 24h / 自动下载开 / 仅 Wi-Fi 开 / 不忽略任何版本", () => {
    expect(UPDATE_SETTINGS_DEFAULTS).toEqual({
      autoCheck: true,
      checkIntervalHours: 24,
      autoDownload: true,
      autoDownloadWifiOnly: true,
      ignoredVersion: "",
    });
  });

  it("非法/缺失字段回落默认（坏存档自愈）", () => {
    expect(normalizeUpdateSettings(null)).toEqual(UPDATE_SETTINGS_DEFAULTS);
    expect(normalizeUpdateSettings({ autoCheck: false, checkIntervalHours: 5 })).toEqual({
      ...UPDATE_SETTINGS_DEFAULTS,
      autoCheck: false,
    });
    expect(normalizeUpdateSettings({ checkIntervalHours: 12 }).checkIntervalHours).toBe(12);
    expect(normalizeUpdateSettings({ checkIntervalHours: 24, ignoredVersion: " 1.0.5 " }).ignoredVersion).toBe("1.0.5");
  });

  it("坏 JSON 回落默认；合法 JSON 归一化", () => {
    expect(parseUpdateSettingsText("{bad")).toEqual(UPDATE_SETTINGS_DEFAULTS);
    expect(parseUpdateSettingsText(JSON.stringify({ autoDownload: false, checkIntervalHours: 6 }))).toEqual({
      ...UPDATE_SETTINGS_DEFAULTS,
      autoDownload: false,
      checkIntervalHours: 6,
    });
  });

  it("patch 不改入参，且可清空 ignoredVersion", () => {
    const current = { ...UPDATE_SETTINGS_DEFAULTS, ignoredVersion: "1.0.5" };
    const next = patchUpdateSettings(current, { ignoredVersion: "" });
    expect(next.ignoredVersion).toBe("");
    expect(current.ignoredVersion).toBe("1.0.5");
  });

  it("运行态：lastCheckAt 非法回落 0；sha 转小写；已下载字段保留", () => {
    expect(normalizeUpdateState({ lastCheckAt: -1 })).toEqual(UPDATE_STATE_DEFAULTS);
    const state = normalizeUpdateState({
      lastCheckAt: 1000,
      promptedVersion: "1.0.5",
      downloadedVersion: "1.0.5",
      downloadedPath: "/data/cache/updates/a.apk",
      downloadedSha256: "AB".repeat(32),
    });
    expect(state.downloadedSha256).toBe("ab".repeat(32));
    expect(state.downloadedPath).toBe("/data/cache/updates/a.apk");
    expect(parseUpdateStateText("nope")).toEqual(UPDATE_STATE_DEFAULTS);
  });
});
