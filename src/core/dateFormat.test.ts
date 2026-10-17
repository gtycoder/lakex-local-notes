import { describe, expect, it } from "vitest";
import { formatDateTime, formatHm, formatMd, formatMdHm, formatYmd, sameLocalDay } from "./dateFormat.js";

/** 构造**本地**时间（避免测试机时区影响；格式化函数全部走本地 getter）。 */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe("dateFormat（C1-5 纯格式化单一来源）", () => {
  it("各格式逐字符固定（补零）", () => {
    const d = at(2026, 10, 17, 9, 5);
    expect(formatHm(d)).toBe("09:05");
    expect(formatMd(d)).toBe("10-17");
    expect(formatMdHm(d)).toBe("10-17 09:05");
    expect(formatYmd(d)).toBe("2026-10-17");
    expect(formatDateTime(d)).toBe("2026-10-17 09:05");
    expect(formatMd(at(2026, 1, 2))).toBe("01-02");
    expect(formatYmd(at(2026, 1, 2))).toBe("2026-01-02");
  });

  it("午夜/末端边界不越日（纯本地 getter）", () => {
    expect(formatDateTime(at(2026, 12, 31, 23, 59))).toBe("2026-12-31 23:59");
    expect(formatDateTime(at(2027, 1, 1, 0, 0))).toBe("2027-01-01 00:00");
  });

  it("sameLocalDay 只看本地日历日", () => {
    expect(sameLocalDay(at(2026, 10, 17, 0, 0), at(2026, 10, 17, 23, 59))).toBe(true);
    expect(sameLocalDay(at(2026, 10, 17, 23, 59), at(2026, 10, 18, 0, 0))).toBe(false);
    expect(sameLocalDay(at(2026, 10, 17), at(2025, 10, 17))).toBe(false);
  });
});
