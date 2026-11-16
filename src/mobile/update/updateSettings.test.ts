import { describe, expect, it } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_OPTIONS,
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
    expect(normalizeUpdateSettings({ checkIntervalHours: 24, ignoredVersion: " 1.0.5 " }).ignoredVersion).toBe("1.0.5");
  });

  it("下拉三档 = 24 / 168 / 720（24 小时 / 每周 / 每月），0 不在选项里", () => {
    expect([...UPDATE_CHECK_INTERVAL_OPTIONS]).toEqual([24, 168, 720]);
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).not.toContain(0);
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).not.toContain(6);
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).not.toContain(12);
    for (const hours of [24, 168, 720]) expect(normalizeUpdateSettings({ checkIntervalHours: hours }).checkIntervalHours).toBe(hours);
  });

  it("旧值收敛（与桌面同口径）：6/12 → 24；0 保留为历史「关闭」只读兼容", () => {
    expect(normalizeUpdateSettings({ checkIntervalHours: 6 }).checkIntervalHours).toBe(24);
    expect(normalizeUpdateSettings({ checkIntervalHours: 12 }).checkIntervalHours).toBe(24);
    expect(normalizeUpdateSettings({ checkIntervalHours: 0 }).checkIntervalHours).toBe(0);
  });

  it("坏 JSON 回落默认；合法 JSON 归一化", () => {
    expect(parseUpdateSettingsText("{bad")).toEqual(UPDATE_SETTINGS_DEFAULTS);
    // 旧存档里的 6 小时 ⇒ 收敛到 24（不再作为选项）
    expect(parseUpdateSettingsText(JSON.stringify({ autoDownload: false, checkIntervalHours: 6 }))).toEqual({
      ...UPDATE_SETTINGS_DEFAULTS,
      autoDownload: false,
      checkIntervalHours: 24,
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
