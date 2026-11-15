import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateOnly, formatRelativeTime, formatUpdatedAt } from "./listTime";

/**
 * 261115 修午夜假红：原用例用「真实 now − 60s」再断言「今天」，
 * 在 00:00:00–00:01:00 之间跑必然得到「昨天 23:59」（全量门禁跨午夜时挂过一次）。
 * 用假时钟钉在正午后一分钟，判据与一天中的时刻无关。
 */
describe("移动端列表时间包装", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 15, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("有效 iso 走 core/dateFormat 措辞；无值/坏值返回空串", () => {
    const iso = new Date(Date.now() - 60_000).toISOString();
    expect(formatRelativeTime(iso)).toContain("今天");
    expect(formatDateOnly(iso)).toContain("今天");
    expect(formatUpdatedAt(iso, true)).toContain("今天");
    expect(formatUpdatedAt(undefined)).toBe("");
    expect(formatUpdatedAt("not-a-date")).toBe("");
  });

  it("跨午夜也不假红：23:59 的条目在次日 00:05 显示「昨天」", () => {
    vi.setSystemTime(new Date(2026, 10, 16, 0, 5, 0));
    const iso = new Date(2026, 10, 15, 23, 59, 0).toISOString();
    expect(formatUpdatedAt(iso, true)).toBe("昨天 23:59");
  });
});
