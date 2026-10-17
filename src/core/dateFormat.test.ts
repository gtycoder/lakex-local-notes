import { describe, expect, it } from "vitest";
import { formatDateTime, formatHm, formatListTime, formatMd, formatMdHm, formatYmd, sameLocalDay } from "./dateFormat.js";

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

describe("formatListTime（Q10/B：今天/昨天/本周/上周/本月/上月/其余默认绝对）", () => {
  // 2026-10-17 是周六；本周一 = 10-12，上周一 = 10-05。
  const now = at(2026, 10, 17, 18, 40);

  it("今天/昨天始终带 HH:mm（紧凑列表也一样）", () => {
    expect(formatListTime(at(2026, 10, 17, 9, 5), now)).toBe("今天 09:05");
    expect(formatListTime(at(2026, 10, 16, 21, 30), now)).toBe("昨天 21:30");
  });

  it("本周X / 上周X：紧凑列表不带时刻，withClock 带上", () => {
    expect(formatListTime(at(2026, 10, 13, 8, 12), now)).toBe("本周二");
    expect(formatListTime(at(2026, 10, 13, 8, 12), now, true)).toBe("本周二 08:12");
    expect(formatListTime(at(2026, 10, 9, 9, 0), now)).toBe("上周五");
    expect(formatListTime(at(2026, 10, 9, 9, 0), now, true)).toBe("上周五 09:00");
  });

  it("本月D日 / 上月D日；其余（含今年更早）默认 YYYY-MM-DD", () => {
    expect(formatListTime(at(2026, 10, 1, 8, 12), now)).toBe("本月1日");
    expect(formatListTime(at(2026, 10, 1, 8, 12), now, true)).toBe("本月1日 08:12");
    expect(formatListTime(at(2026, 9, 28, 8, 12), now)).toBe("上月28日");
    expect(formatListTime(at(2026, 3, 5, 8, 12), now)).toBe("2026-03-05");
    expect(formatListTime(at(2026, 3, 5, 8, 12), now, true)).toBe("2026-03-05 08:12");
  });

  it("跨年默认 YYYY-MM-DD（withClock 带 HH:mm）", () => {
    expect(formatListTime(at(2025, 12, 31, 23, 59), now)).toBe("2025-12-31");
    expect(formatListTime(at(2025, 12, 31, 23, 59), now, true)).toBe("2025-12-31 23:59");
  });

  it("年初边界：上周跨年时优先「上周」，不被跨年吞掉", () => {
    const jan2 = at(2026, 1, 2, 10, 0); // 周五；本周一 = 2025-12-29
    expect(formatListTime(at(2025, 12, 30, 9, 0), jan2)).toBe("本周二");
    expect(formatListTime(at(2025, 12, 27, 9, 0), jan2)).toBe("上周六");
    expect(formatListTime(at(2025, 12, 20, 9, 0), jan2)).toBe("上月20日");
    expect(formatListTime(at(2025, 11, 30, 9, 0), jan2)).toBe("2025-11-30");
  });

  it("非法日期返回空串", () => {
    expect(formatListTime(new Date("bad"), now)).toBe("");
  });
});
