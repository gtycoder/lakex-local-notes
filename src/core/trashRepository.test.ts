import { describe, expect, it } from "vitest";
import { trashDaysUntilPurge } from "./trashPolicy.js";

describe("trashDaysUntilPurge（C1 共享纯函数）", () => {
  const DAY = 24 * 3600 * 1000;

  it("null/非法输入 → null（不显示）", () => {
    expect(trashDaysUntilPurge(null, 60)).toBeNull();
    expect(trashDaysUntilPurge("", 60)).toBeNull();
    expect(trashDaysUntilPurge("bad-date", 60)).toBeNull();
  });

  it("trashAutoPurgeDays<=0（关闭）→ null", () => {
    const deletedAt = new Date(Date.now() - 3 * DAY).toISOString();
    expect(trashDaysUntilPurge(deletedAt, 0)).toBeNull();
    expect(trashDaysUntilPurge(deletedAt, -1)).toBeNull();
  });

  it("普通窗口：剩余天数向上取整", () => {
    const deletedAt = new Date(Date.now() - 10 * DAY).toISOString();
    expect(trashDaysUntilPurge(deletedAt, 60)).toBe(50);
  });

  it("临近到期：≤7 天返回小值（UI 据此标黄）", () => {
    const deletedAt = new Date(Date.now() - 55 * DAY).toISOString();
    const days = trashDaysUntilPurge(deletedAt, 60) as number;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("已过到期 → 0（不再显示天数，实际由自动过期处理）", () => {
    const deletedAt = new Date(Date.now() - 61 * DAY).toISOString();
    expect(trashDaysUntilPurge(deletedAt, 60)).toBe(0);
  });
});
