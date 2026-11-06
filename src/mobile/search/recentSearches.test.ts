/**
 * 最近搜索（设备本地视图）护栏：解析容错、去重/上限/顺序、清空、存储不可用不抛。
 * 存储键沿用移动端前缀 lakex-local-notes-mobile.*（同 padPanelPrefs / bitable 视图偏好）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
  clearRecentSearches,
  parseRecentSearches,
  pushRecentSearch,
  readRecentSearches,
  recordRecentSearch,
} from "./recentSearches";

function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
  });
  return data;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("最近搜索", () => {
  it("解析容错：坏 JSON/非数组/非字符串/空白项都丢弃，去重大小写不敏感，限长", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{oops")).toEqual([]);
    expect(parseRecentSearches(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseRecentSearches(JSON.stringify([1, null, "  ", "项目", " 项目 ", "Lake", "lake"]))).toEqual(["项目", "Lake"]);
    const many = Array.from({ length: MAX_RECENT_SEARCHES + 5 }, (_, index) => "q" + index);
    expect(parseRecentSearches(JSON.stringify(many))).toHaveLength(MAX_RECENT_SEARCHES);
  });

  it("插入：新的在最前、重复项移到最前、空查询不变、上限 8", () => {
    expect(pushRecentSearch(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(pushRecentSearch(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(pushRecentSearch(["a"], "  ")).toEqual(["a"]);
    const full = Array.from({ length: MAX_RECENT_SEARCHES }, (_, index) => "q" + index);
    const next = pushRecentSearch(full, "new");
    expect(next).toHaveLength(MAX_RECENT_SEARCHES);
    expect(next[0]).toBe("new");
    expect(next).not.toContain("q" + (MAX_RECENT_SEARCHES - 1));
  });

  it("记录/读取/清空往返（落 localStorage）", () => {
    const data = stubStorage();
    expect(readRecentSearches()).toEqual([]);
    expect(recordRecentSearch("移动 搜索")).toEqual(["移动 搜索"]);
    expect(recordRecentSearch("项目")).toEqual(["项目", "移动 搜索"]);
    expect(JSON.parse(data.get(RECENT_SEARCHES_KEY) as string)).toEqual(["项目", "移动 搜索"]);
    expect(readRecentSearches()).toEqual(["项目", "移动 搜索"]);
    clearRecentSearches();
    expect(readRecentSearches()).toEqual([]);
    expect(data.has(RECENT_SEARCHES_KEY)).toBe(false);
  });

  it("存储不可用（缺失/读取抛异常）⇒ 读空、记录不抛（只丢历史，不影响搜索）", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readRecentSearches()).toEqual([]);
    expect(() => recordRecentSearch("项目")).not.toThrow();
    expect(() => clearRecentSearches()).not.toThrow();

    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("denied"); },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(readRecentSearches()).toEqual([]);
    expect(() => recordRecentSearch("项目")).not.toThrow();
    expect(() => clearRecentSearches()).not.toThrow();
    warn.mockRestore();
  });
});
