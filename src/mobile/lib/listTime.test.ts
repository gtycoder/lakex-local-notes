import { describe, expect, it } from "vitest";
import { formatDateOnly, formatRelativeTime, formatUpdatedAt } from "./listTime";

describe("移动端列表时间包装", () => {
  it("有效 iso 走 core/dateFormat 措辞；无值/坏值返回空串", () => {
    const iso = new Date(Date.now() - 60_000).toISOString();
    expect(formatRelativeTime(iso)).toContain("今天");
    expect(formatDateOnly(iso)).toContain("今天");
    expect(formatUpdatedAt(iso, true)).toContain("今天");
    expect(formatUpdatedAt(undefined)).toBe("");
    expect(formatUpdatedAt("not-a-date")).toBe("");
  });
});
