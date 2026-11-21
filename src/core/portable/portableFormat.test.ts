import { describe, expect, it } from "vitest";
import { PORTABLE_LIMIT_BYTES, assertPortableSize, isMobileSnapshotManifest, parsePortableManifest, portableExportAvailability, portableExportCloudActive, type PortableExportAvailabilityInput } from "./portableFormat";

const validDesktop = {
  format: "lakex-local-notes-portable",
  formatVersion: 2,
  appVersion: "1.5.5",
  exportedAt: "2026-11-22T02:00:00Z",
  source: { platform: "desktop" },
  layout: "desktop-workspace",
  limitBytes: PORTABLE_LIMIT_BYTES,
  counts: { notes: 1, folders: 0, quickNotes: 0, tags: 0, assets: 0, bytes: 10 },
  baseline: { epoch: "e", generation: 1, lakeCommit: "lc", quickNotesCommit: "qc" },
};

describe("portableFormat（大统一迁移包 v2 共享格式/可用性）", () => {
  it("清单校验：desktop/mobile 两种布局都合法，坏 format/版本/上限/布局/counts/baseline 拒绝", () => {
    expect(parsePortableManifest(validDesktop).counts.notes).toBe(1);
    expect(parsePortableManifest({ ...validDesktop, baseline: null }).baseline).toBeNull();
    const validMobile = { ...validDesktop, source: { platform: "mobile" }, layout: "mobile-snapshot" };
    const parsedMobile = parsePortableManifest(validMobile);
    expect(parsedMobile.source.platform).toBe("mobile");
    expect(isMobileSnapshotManifest(parsedMobile)).toBe(true);
    expect(isMobileSnapshotManifest(parsePortableManifest(validDesktop))).toBe(false);
    for (const broken of [
      { ...validDesktop, format: "x" },
      { ...validDesktop, formatVersion: 1 },          // v1 不写兼容（261122：旧包用新版重导）
      { ...validDesktop, formatVersion: 3 },
      { ...validDesktop, limitBytes: 1 },
      { ...validDesktop, layout: "mobile-snapshot" }, // 布局与来源不匹配
      { ...validMobile, layout: "desktop-workspace" },
      { ...validDesktop, source: { platform: "ios" } },
      { ...validDesktop, source: {} },
      { ...validDesktop, counts: { notes: -1 } },
      { ...validDesktop, counts: undefined },
      { ...validDesktop, baseline: { epoch: "e" } },
    ]) {
      expect(() => parsePortableManifest(broken)).toThrow();
    }
  });

  it("4GiB 上限：99% 以内放行，逼近上限抛错（261122 维持 4GiB，不做 5GiB）", () => {
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
