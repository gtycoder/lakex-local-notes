import { describe, expect, it } from "vitest";
import {
  ANDROID_RELEASE_CERT_SHA256,
  compareVersions,
  formatBytes,
  isNewerManifest,
  parseUpdateManifest,
  pickAsset,
} from "./updateManifest";

const valid = (): unknown => ({
  schemaVersion: 1,
  version: "1.0.5",
  versionCode: 11005,
  publishedAt: "2026-11-09T00:00:00Z",
  notes: "## 更新\n- 修复",
  releasePageUrl: "https://github.com/gtycoder/lakex-local-notes/releases/tag/v1.0.5",
  assets: [
    { os: "macos", arch: "arm64", filename: "a-arm64.dmg", url: "https://x/a.dmg", sha256: "a".repeat(64), size: 10 },
    { os: "macos", arch: "x64", filename: "a-x64.dmg", url: "https://x/b.dmg", sha256: "b".repeat(64), size: 11 },
    { os: "windows", arch: "x64", filename: "a.exe", url: "https://x/a.exe", sha256: "c".repeat(64), size: 12 },
    { os: "android", arch: null, filename: "a.apk", url: "https://x/a.apk", sha256: "d".repeat(64), size: 13 },
  ],
});

describe("updateManifest", () => {
  it("解析合法清单并归一化 sha256 小写", () => {
    const m = parseUpdateManifest(valid());
    expect(m.version).toBe("1.0.5");
    expect(m.assets).toHaveLength(4);
    expect(m.assets[0].sha256).toBe("a".repeat(64));
  });

  it("拒绝坏清单", () => {
    expect(() => parseUpdateManifest(null)).toThrow();
    expect(() => parseUpdateManifest({ ...(valid() as object), version: "1.0" })).toThrow();
    expect(() => parseUpdateManifest({ ...(valid() as object), assets: [] })).toThrow();
    const badSha = valid() as { assets: Array<Record<string, unknown>> };
    badSha.assets[0].sha256 = "xyz";
    expect(() => parseUpdateManifest(badSha)).toThrow();
  });

  it("semver 比较", () => {
    expect(compareVersions("1.0.5", "1.0.4")).toBeGreaterThan(0);
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.5", "1.0.5")).toBe(0);
  });

  it("versionCode 优先，回退 semver", () => {
    const m = parseUpdateManifest(valid());
    expect(isNewerManifest(m, { version: "1.0.4", versionCode: 11004 })).toBe(true);
    expect(isNewerManifest(m, { version: "1.0.5", versionCode: 11005 })).toBe(false);
    expect(isNewerManifest(m, { version: "1.0.4" })).toBe(true);
  });

  it("按平台选包：arch 精确优先，无 arch 取通用", () => {
    const m = parseUpdateManifest(valid());
    expect(pickAsset(m, "macos", "arm64")?.filename).toBe("a-arm64.dmg");
    expect(pickAsset(m, "macos", "x64")?.filename).toBe("a-x64.dmg");
    expect(pickAsset(m, "android", null)?.filename).toBe("a.apk");
    expect(pickAsset(m, "windows", null)?.filename).toBe("a.exe");
  });

  it("字节格式化与证书常量", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(ANDROID_RELEASE_CERT_SHA256).toHaveLength(64);
  });
});
