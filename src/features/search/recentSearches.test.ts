/** 最近搜索（localStorage 设备本地；去重 / 上限 / 可清空）——261106 搜索增强。 */
import { describe, expect, it } from "vitest";
import {
  RECENT_SEARCH_LIMIT,
  RECENT_SEARCH_STORAGE_KEY,
  clearRecentSearches,
  normalizeRecentQuery,
  parseRecentSearches,
  pushRecentSearch,
  readRecentSearches,
  writeRecentSearches,
  type RecentSearchStorage,
} from "./recentSearches";

function memoryStorage(initial: Record<string, string> = {}): RecentSearchStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe("最近搜索：存取与去重", () => {
  it("归一化：去首尾空白、合并连续空白、限长", () => {
    expect(normalizeRecentQuery("  客户   方案  ")).toBe("客户 方案");
    expect(normalizeRecentQuery("   ")).toBe("");
    expect(normalizeRecentQuery("x".repeat(200)).length).toBe(120);
  });

  it("新查询置顶；不区分大小写去重；空查询忽略", () => {
    const first = pushRecentSearch([], "Lake");
    expect(first).toEqual(["Lake"]);
    const second = pushRecentSearch(first, "标签");
    expect(second).toEqual(["标签", "Lake"]);
    const again = pushRecentSearch(second, "lake");
    expect(again).toEqual(["lake", "标签"]);
    expect(pushRecentSearch(again, "   ")).toEqual(["lake", "标签"]);
  });

  it(`上限 ${RECENT_SEARCH_LIMIT} 条：超出截断，最旧的被挤掉`, () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_SEARCH_LIMIT + 3; i += 1) list = pushRecentSearch(list, "q" + i);
    expect(list).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(list[0]).toBe("q" + (RECENT_SEARCH_LIMIT + 2));
    expect(list).not.toContain("q0");
  });

  it("坏存储值：非数组/混入非字符串/重复项 一律安全收敛", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("nope")).toEqual([]);
    expect(parseRecentSearches([1, null, "  ", "a", "A", "b"])).toEqual(["a", "b"]);
  });

  it("读写清空走 localStorage；读失败/坏 JSON ⇒ 空数组", () => {
    const storage = memoryStorage();
    expect(readRecentSearches(storage)).toEqual([]);
    expect(writeRecentSearches(["标签", "Lake"], storage)).toBe(true);
    expect(JSON.parse(storage.data.get(RECENT_SEARCH_STORAGE_KEY) ?? "[]")).toEqual(["标签", "Lake"]);
    expect(readRecentSearches(storage)).toEqual(["标签", "Lake"]);
    clearRecentSearches(storage);
    expect(readRecentSearches(storage)).toEqual([]);
    expect(storage.data.has(RECENT_SEARCH_STORAGE_KEY)).toBe(false);

    storage.data.set(RECENT_SEARCH_STORAGE_KEY, "{坏 JSON");
    expect(readRecentSearches(storage)).toEqual([]);
  });

  it("存储不可用（隐私模式）时退化为空/写失败，不抛错", () => {
    expect(readRecentSearches(null)).toEqual([]);
    expect(writeRecentSearches(["a"], null)).toBe(false);
    expect(() => clearRecentSearches(null)).not.toThrow();
  });
});
