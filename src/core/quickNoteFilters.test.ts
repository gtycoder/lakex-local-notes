import { describe, expect, it } from "vitest";
import { matchesQuickNoteTimeFilter, quickNoteTimeFilterLabel, type QuickNoteTimeFilter } from "./quickNoteFilters";

const at = (iso: string) => iso;
const now = new Date(2026, 9, 24, 12, 0, 0); // 2026-10-24 12:00 本地

describe("quickNoteFilters（时间档）", () => {
  it("全部时间放行；非法创建时间只在全部时间下放行", () => {
    expect(matchesQuickNoteTimeFilter("not-a-date", { kind: "any" }, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter("not-a-date", { kind: "today" }, now)).toBe(false);
    expect(matchesQuickNoteTimeFilter(at("2020-01-01T00:00:00"), { kind: "any" }, now)).toBe(true);
  });

  it("今天 / 近 7 天 / 近 30 天按本地日界", () => {
    expect(matchesQuickNoteTimeFilter(at("2026-10-24T00:00:00"), { kind: "today" }, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter(at("2026-10-23T23:59:59"), { kind: "today" }, now)).toBe(false);
    expect(matchesQuickNoteTimeFilter(at("2026-10-18T00:00:00"), { kind: "last7" }, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter(at("2026-10-17T23:59:59"), { kind: "last7" }, now)).toBe(false);
    expect(matchesQuickNoteTimeFilter(at("2026-09-25T00:00:00"), { kind: "last30" }, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter(at("2026-09-24T23:59:59"), { kind: "last30" }, now)).toBe(false);
  });

  it("去年今日只认同月同日、上一年", () => {
    expect(matchesQuickNoteTimeFilter(at("2025-10-24T08:00:00"), { kind: "lastYearToday" }, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter(at("2026-10-24T08:00:00"), { kind: "lastYearToday" }, now)).toBe(false);
    expect(matchesQuickNoteTimeFilter(at("2025-10-23T08:00:00"), { kind: "lastYearToday" }, now)).toBe(false);
  });

  it("自定范围含首尾两天；缺一端按开区间", () => {
    const range: QuickNoteTimeFilter = { kind: "custom", from: "2026-10-01", to: "2026-10-24" };
    expect(matchesQuickNoteTimeFilter(at("2026-10-01T00:00:00"), range, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter(at("2026-10-24T23:59:59"), range, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter(at("2026-09-30T23:59:59"), range, now)).toBe(false);
    expect(matchesQuickNoteTimeFilter(at("2026-09-01T00:00:00"), { kind: "custom", from: "2026-10-01", to: "" }, now)).toBe(false);
    expect(matchesQuickNoteTimeFilter(at("2026-09-01T00:00:00"), { kind: "custom", from: "", to: "2026-10-01" }, now)).toBe(true);
    expect(matchesQuickNoteTimeFilter(at("2026-10-01T00:00:00"), { kind: "custom", from: "bad", to: "" }, now)).toBe(false);
  });

  it("文案覆盖全部档位与自定范围", () => {
    expect(quickNoteTimeFilterLabel({ kind: "any" })).toBe("全部时间");
    expect(quickNoteTimeFilterLabel({ kind: "last7" })).toBe("近 7 天");
    expect(quickNoteTimeFilterLabel({ kind: "custom", from: "2026-10-01", to: "2026-10-24" })).toBe("2026-10-01 至 2026-10-24");
    expect(quickNoteTimeFilterLabel({ kind: "custom", from: "", to: "" })).toBe("自定范围");
  });
});
