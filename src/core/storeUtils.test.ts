import { describe, expect, it } from "vitest";
import { extractAssetRefs, isSafePathSegment, sanitizeFileName, selectHistoryDrops } from "./storeUtils.js";

describe("storeUtils", () => {
  it("extracts unique Lake asset references without matching unrelated filenames", () => {
    const content = [
      "1234567890123_deadbeef.png",
      "1234567890123_deadbeef.png",
      "1234567890123_deadbeef.webp",
      "not-a-lake-asset.png",
      "1234567890123_DEADBEEF.png",
    ].join(" ");
    expect([...extractAssetRefs(content)]).toEqual([
      "1234567890123_deadbeef.png",
      "1234567890123_deadbeef.webp",
    ]);
  });

  it("sanitizes filenames and keeps a non-empty fallback", () => {
    expect(sanitizeFileName(' a/b:c*?"d<>| ')).toBe("a_b_c___d___");
    expect(sanitizeFileName("  ")).toBe("未命名");
  });


  it("does not drop the only snapshot when timestamps repeat", () => {
    const now = Date.now();
    const timestamp = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
    expect(selectHistoryDrops([timestamp, timestamp], { maxSnapshots: 10, retentionDays: 30 }).has(timestamp)).toBe(false);
  });

  it("accepts a single safe path segment and rejects traversal separators", () => {
    expect(isSafePathSegment("note-123")).toBe(true);
    expect(isSafePathSegment(".")).toBe(false);
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment("a/b")).toBe(false);
    expect(isSafePathSegment("a\\b")).toBe(false);
    expect(isSafePathSegment("")).toBe(false);
  });
});