import { beforeEach, describe, expect, it } from "vitest";
import { EMOJI_RECENTS_KEYS, pushEmojiRecent, readEmojiRecents } from "./emojiRecents";

/** 极简 localStorage 桩（vitest 跑在 node 环境，没有 window.localStorage）。 */
function installStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  } as Storage;
  return map;
}

describe("emojiRecents（设备本地「最近使用」）", () => {
  let map: Map<string, string>;
  beforeEach(() => { map = installStorage(); });

  it("空态返回空表", () => {
    expect(readEmojiRecents()).toEqual([]);
  });

  it("最新在前且去重", () => {
    pushEmojiRecent("😀");
    pushEmojiRecent("🐶");
    pushEmojiRecent("😀");
    expect(readEmojiRecents()).toEqual(["😀", "🐶"]);
  });

  it("写的是 JSON 数组（键名固定）", () => {
    pushEmojiRecent("😀");
    expect(JSON.parse(map.get(EMOJI_RECENTS_KEYS.icon) as string)).toEqual(["😀"]);
  });

  it("坏数据 / 非数组 / 非字符串成员都安全降级", () => {
    map.set(EMOJI_RECENTS_KEYS.icon, "{not json");
    expect(readEmojiRecents()).toEqual([]);
    map.set(EMOJI_RECENTS_KEYS.icon, JSON.stringify({ a: 1 }));
    expect(readEmojiRecents()).toEqual([]);
    map.set(EMOJI_RECENTS_KEYS.icon, JSON.stringify(["😀", 42, "", "🐶"]));
    expect(readEmojiRecents()).toEqual(["😀", "🐶"]);
  });

  it("按入口分桶：icon 与 input 互不影响（AGENTS §3#14）", () => {
    pushEmojiRecent("😀", "icon");
    pushEmojiRecent("🐶", "input");
    expect(readEmojiRecents("icon")).toEqual(["😀"]);
    expect(readEmojiRecents("input")).toEqual(["🐶"]);
    expect(map.has(EMOJI_RECENTS_KEYS.input)).toBe(true);
  });

  it("上限 24 条（超出丢最旧）", () => {
    for (let i = 0; i < 30; i++) pushEmojiRecent("e" + i);
    const list = readEmojiRecents();
    expect(list).toHaveLength(24);
    expect(list[0]).toBe("e29");
  });

  it("没有 localStorage 时不抛错（隐私模式降级）", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => pushEmojiRecent("😀")).not.toThrow();
    expect(readEmojiRecents()).toEqual([]);
  });
});
