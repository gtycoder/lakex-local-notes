import { describe, expect, it } from "vitest";
import { PORTABLE_LIMIT_BYTES, assertPortableSize, parsePortableManifest, portableExportAvailability, type PortableExportAvailabilityInput } from "./portableFormat";

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

  it("导出可用性：未配置/关闭/从未同步/有待同步 ⇒ 禁用并给原因；已启用且干净 ⇒ 可用", () => {
    const base: PortableExportAvailabilityInput = { s3Configured: true, sync: { enabled: true, autoMode: "manual" }, lastSyncedAt: "2026-11-09T00:00:00Z", pending: { documents: 0, folders: 0, quickNotes: 0 } };
    expect(portableExportAvailability(base)).toEqual({ available: true });
    expect(portableExportAvailability({ ...base, s3Configured: false })).toMatchObject({ available: false });
    expect(portableExportAvailability({ ...base, s3Configured: false, sync: null })).toMatchObject({ available: false });
    expect(portableExportAvailability({ ...base, sync: { enabled: false, autoMode: "manual" } })).toMatchObject({ available: false });
    expect(portableExportAvailability({ ...base, lastSyncedAt: null })).toMatchObject({ available: false });
    const pending = portableExportAvailability({ ...base, pending: { documents: 2, folders: 1, quickNotes: 3 } });
    expect(pending.available).toBe(false);
    if (!pending.available) expect(pending.reason).toContain("6");
    // 自动模式同样可用（manual 不是禁用条件：默认 autoMode 就是 manual）
    expect(portableExportAvailability({ ...base, sync: { enabled: true, autoMode: "interval" } })).toEqual({ available: true });
  });
});
