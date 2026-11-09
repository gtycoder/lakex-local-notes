import { describe, expect, it } from "vitest";
import { parseUpdateManifest } from "../../core/update/updateManifest";
import { HOUR_MS, androidUpdateAsset, decideAutoDownload, ignoreVersion, isVersionIgnored, shouldAutoCheck } from "./updatePolicy";
import { UPDATE_SETTINGS_DEFAULTS, type UpdateSettings } from "./updateSettings";

const settings = (patch: Partial<UpdateSettings> = {}): UpdateSettings => ({ ...UPDATE_SETTINGS_DEFAULTS, ...patch });

const manifest = () =>
  parseUpdateManifest({
    schemaVersion: 1,
    version: "1.0.5",
    versionCode: 11005,
    publishedAt: "2026-11-09T00:00:00Z",
    notes: "## 更新内容\n- 支持应用内更新",
    releasePageUrl: "https://github.com/gtycoder/lakex-local-notes/releases/tag/v1.0.5",
    assets: [
      { os: "macos", arch: "arm64", filename: "a-arm64.dmg", url: "https://x/a.dmg", sha256: "a".repeat(64), size: 10 },
      {
        os: "android",
        arch: null,
        filename: "LakexLocalNotes-1.0.5-android-release.apk",
        url: "https://x/a.apk",
        sha256: "d".repeat(64),
        size: 13,
      },
    ],
  });

describe("自动检查节流", () => {
  it("关闭自动检查 / 间隔 0 一律不自动检查", () => {
    expect(shouldAutoCheck(settings({ autoCheck: false }), 0, Date.now())).toBe(false);
    expect(shouldAutoCheck(settings({ checkIntervalHours: 0 }), 0, Date.now())).toBe(false);
  });

  it("从未检查过立刻到期", () => {
    expect(shouldAutoCheck(settings(), 0, 1_000_000)).toBe(true);
  });

  it("默认 24h：23h 内不重复，超过 24h 再查", () => {
    const now = 1_000 * HOUR_MS;
    expect(shouldAutoCheck(settings(), now - 23 * HOUR_MS, now)).toBe(false);
    expect(shouldAutoCheck(settings(), now - 24 * HOUR_MS, now)).toBe(true);
  });

  it("6h/12h 间隔按各自阈值判", () => {
    const now = 1_000 * HOUR_MS;
    expect(shouldAutoCheck(settings({ checkIntervalHours: 6 }), now - 6 * HOUR_MS, now)).toBe(true);
    expect(shouldAutoCheck(settings({ checkIntervalHours: 12 }), now - 11 * HOUR_MS, now)).toBe(false);
  });
});

describe("忽略版本", () => {
  it("版本号相等才忽略；换版本自动恢复", () => {
    const ignored = ignoreVersion(settings(), "1.0.5");
    expect(isVersionIgnored(ignored, "1.0.5")).toBe(true);
    expect(isVersionIgnored(ignored, "1.0.6")).toBe(false);
    expect(isVersionIgnored(settings(), "1.0.5")).toBe(false);
  });

  it("ignoreVersion 返回新对象，不改入参", () => {
    const current = settings();
    ignoreVersion(current, "1.0.5");
    expect(current.ignoredVersion).toBe("");
  });
});

describe("Android 资产选择", () => {
  it("只取 os=android 的 apk（忽略桌面资产）", () => {
    const asset = androidUpdateAsset(manifest());
    expect(asset?.filename).toBe("LakexLocalNotes-1.0.5-android-release.apk");
    expect(asset?.url.startsWith("https://")).toBe(true);
  });

  it("缺 android 包 / 非 https / 非 apk 一律 null", () => {
    const parsed = manifest();
    expect(
      androidUpdateAsset({ ...parsed, assets: parsed.assets.filter((a) => a.os !== "android") }),
    ).toBeNull();
    const https = androidUpdateAsset(parsed);
    expect(
      androidUpdateAsset({
        ...parsed,
        assets: [{ ...https!, url: "http://x/a.apk" }],
      }),
    ).toBeNull();
    expect(
      androidUpdateAsset({
        ...parsed,
        assets: [{ ...https!, filename: "update.exe" }],
      }),
    ).toBeNull();
  });
});

describe("自动下载闸门（默认开，仅 Wi-Fi）", () => {
  it("默认 + Wi-Fi ⇒ 自动下载", () => {
    expect(decideAutoDownload({ settings: settings(), manifest: manifest(), isNative: true, network: { wifi: true, metered: false } })).toEqual({
      download: true,
    });
  });

  it("关掉自动下载 / 版本被忽略 / 非原生 / 无 Android 包 ⇒ 不下载", () => {
    expect(
      decideAutoDownload({ settings: settings({ autoDownload: false }), manifest: manifest(), isNative: true, network: { wifi: true, metered: false } }),
    ).toEqual({ download: false, reason: "disabled" });
    expect(
      decideAutoDownload({
        settings: settings({ ignoredVersion: "1.0.5" }),
        manifest: manifest(),
        isNative: true,
        network: { wifi: true, metered: false },
      }),
    ).toEqual({ download: false, reason: "ignored" });
    expect(
      decideAutoDownload({ settings: settings(), manifest: manifest(), isNative: false, network: { wifi: true, metered: false } }),
    ).toEqual({ download: false, reason: "no_native" });
    const parsed = manifest();
    expect(
      decideAutoDownload({
        settings: settings(),
        manifest: { ...parsed, assets: parsed.assets.filter((a) => a.os !== "android") },
        isNative: true,
        network: { wifi: true, metered: false },
      }),
    ).toEqual({ download: false, reason: "no_asset" });
  });

  it("仅 Wi-Fi=开：蜂窝不自动下载；关掉后蜂窝也下载", () => {
    const cellular = { wifi: false, metered: true };
    expect(decideAutoDownload({ settings: settings(), manifest: manifest(), isNative: true, network: cellular })).toEqual({
      download: false,
      reason: "wifi_required",
    });
    expect(
      decideAutoDownload({
        settings: settings({ autoDownloadWifiOnly: false }),
        manifest: manifest(),
        isNative: true,
        network: cellular,
      }),
    ).toEqual({ download: true });
  });

  it("离线（没有网络）不下载", () => {
    expect(decideAutoDownload({ settings: settings(), manifest: manifest(), isNative: true, network: null })).toEqual({
      download: false,
      reason: "offline",
    });
  });
});
