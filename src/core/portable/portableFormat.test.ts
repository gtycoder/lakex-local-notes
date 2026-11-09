import { describe, expect, it } from "vitest";
import { PORTABLE_LIMIT_BYTES, assertPortableSize, parsePortableManifest, portableExportAvailability, portableExportCloudActive, type PortableExportAvailabilityInput } from "./portableFormat";

describe("portableFormat（共享格式/可用性）", () => {
  it("清单校验：合法通过、坏 format/版本/hasHistory/上限/counts 拒绝", () => {
    const valid = {
      format: "lakex-local-notes-portable",
      formatVersion: 1,
      appVersion: "1.0.4",
      exportedAt: "2026-11-09T12:00:00Z",
      source: { platform: "desktop" },
      hasHistory: false,
      limitBytes: PORTABLE_LIMIT_BYTES,
      counts: { notes: 1, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 10 },
      baseline: { epoch: "e", generation: 1, lakeCommit: "lc", quickNotesCommit: "qc" },
    };
    expect(parsePortableManifest(valid).counts.notes).toBe(1);
    expect(parsePortableManifest({ ...valid, baseline: null }).baseline).toBeNull();
    for (const broken of [
      { ...valid, format: "x" },
      { ...valid, formatVersion: 2 },
      { ...valid, hasHistory: true },
      { ...valid, limitBytes: 1 },
      { ...valid, counts: { notes: -1 } },
      { ...valid, baseline: { epoch: "e" } },
    ]) {
      expect(() => parsePortableManifest(broken)).toThrow();
    }
  });

  it("4GiB 上限：99% 以内放行，逼近上限抛错", () => {
    expect(() => assertPortableSize(1024)).not.toThrow();
    expect(() => assertPortableSize(PORTABLE_LIMIT_BYTES * 0.99)).not.toThrow();
    expect(() => assertPortableSize(PORTABLE_LIMIT_BYTES * 0.995)).toThrow("4GiB");
  });

  it("导出可用性：始终允许（离线可导）；只有启用云同步时才要求导出前先同步", () => {
    const base: PortableExportAvailabilityInput = { s3Configured: true, sync: { enabled: true, autoMode: "manual" }, lastSyncedAt: "2026-11-09T00:00:00Z", pending: { documents: 0, folders: 0, quickNotes: 0 } };
    // 不再因未配置/关闭/从未同步/待同步而禁用
    for (const input of [
      base,
      { ...base, s3Configured: false },
      { ...base, s3Configured: false, sync: null },
      { ...base, sync: { enabled: false, autoMode: "manual" } },
      { ...base, lastSyncedAt: null },
      { ...base, pending: { documents: 2, folders: 1, quickNotes: 3 } },
    ] as PortableExportAvailabilityInput[]) {
      expect(portableExportAvailability(input)).toEqual({ available: true });
    }
    // 云同步是否启用（决定 UI 是否先 sync 一次）
    expect(portableExportCloudActive(base)).toBe(true);
    expect(portableExportCloudActive({ ...base, sync: { enabled: true, autoMode: "interval" } })).toBe(true);
    expect(portableExportCloudActive({ ...base, s3Configured: false })).toBe(false);
    expect(portableExportCloudActive({ ...base, sync: { enabled: false, autoMode: "manual" } })).toBe(false);
  });
});
