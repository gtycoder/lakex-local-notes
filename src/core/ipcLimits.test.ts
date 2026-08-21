import { describe, expect, it } from "vitest";
import {
  MAX_ICON_LENGTH,
  MAX_HISTORY_SNAPSHOTS,
  MAX_INTERVAL_MINUTES,
  MAX_NOTE_CONTENT_BYTES,
  MAX_SEARCH_RESULTS,
  MAX_TITLE_LENGTH,
  IpcInputError,
  assertContentBytes,
  assertOptionalContentBytes,
  assertIcon,
  assertTitle,
  clampHistorySettings,
  clampSearchLimit,
} from "./ipcLimits.js";

describe("ipcLimits", () => {
  it("assertTitle 拒绝空/非字符串/超长", () => {
    expect(assertTitle("  标题  ")).toBe("标题");
    expect(() => assertTitle("")).toThrow(IpcInputError);
    expect(() => assertTitle("   ")).toThrow(IpcInputError);
    expect(() => assertTitle(123)).toThrow(IpcInputError);
    expect(() => assertTitle("x".repeat(MAX_TITLE_LENGTH + 1))).toThrow(IpcInputError);
  });

  it("assertContentBytes 拒绝超限正文", () => {
    expect(assertContentBytes("hello")).toBe("hello");
    expect(() => assertContentBytes("x".repeat(MAX_NOTE_CONTENT_BYTES + 1))).toThrow(IpcInputError);
    expect(() => assertContentBytes(42)).toThrow(IpcInputError);
  });

  it("assertIcon 只允许 null 或短字符串", () => {
    expect(assertIcon(null)).toBeNull();
    expect(assertIcon(undefined)).toBeNull();
    expect(assertIcon("📝")).toBe("📝");
    expect(() => assertIcon("x".repeat(MAX_ICON_LENGTH + 1))).toThrow(IpcInputError);
    expect(() => assertIcon(1)).toThrow(IpcInputError);
  });

  it("clampSearchLimit 封顶且容错非法输入", () => {
    expect(clampSearchLimit(undefined)).toBe(30);
    expect(clampSearchLimit(-5)).toBe(30);
    expect(clampSearchLimit(1.9)).toBe(1);
    expect(clampSearchLimit(10_000)).toBe(MAX_SEARCH_RESULTS);
  });

  it("clampHistorySettings 收窄数字字段", () => {
    expect(clampHistorySettings(null)).toBeNull();
    expect(clampHistorySettings({ maxSnapshots: 999999, retentionDays: -1, cleanupIntervalHours: "x", snapshotIntervalMinutes: 999999 })).toEqual({
      maxSnapshots: MAX_HISTORY_SNAPSHOTS,
      retentionDays: 1,
      cleanupIntervalHours: 24,
      snapshotIntervalMinutes: MAX_INTERVAL_MINUTES,
    });
  });
});

describe("assertOptionalContentBytes (W-4)", () => {
  it("null/undefined 原样放行", () => {
    expect(assertOptionalContentBytes(null)).toBeNull();
    expect(assertOptionalContentBytes(undefined)).toBeNull();
  });

  it("合法字符串原样返回", () => {
    expect(assertOptionalContentBytes("正文")).toBe("正文");
  });

  it("超过 32MiB 拒绝（字节口径）", () => {
    const big = "a".repeat(MAX_NOTE_CONTENT_BYTES + 1);
    expect(() => assertOptionalContentBytes(big)).toThrow(IpcInputError);
  });

  it("非字符串拒绝", () => {
    expect(() => assertOptionalContentBytes(123)).toThrow(IpcInputError);
  });
});