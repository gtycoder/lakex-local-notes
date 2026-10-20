import { describe, expect, it } from "vitest";
import { LAKE_EMOJIS } from "./lakeEmojis";
import { EMOJI_ZH_KEYWORDS, emojiZhKeywords } from "./emojiZhKeywords";
import { filterEmojiChars, matchEmoji } from "./emojiSearch";

describe("表情搜索（中文关键词 + 英文短名）", () => {
  it("中文子串能搜到：房 → 房子/房屋，苹果 → 🍎", () => {
    expect(filterEmojiChars("房")).toContain("🏠");
    expect(filterEmojiChars("苹果")).toEqual(expect.arrayContaining(["🍎", "🍏"]));
    expect(filterEmojiChars("笑").length).toBeGreaterThan(5);
  });

  it("英文短名照样能搜：house → 🏠，smile → 😄", () => {
    expect(filterEmojiChars("house")).toContain("🏠");
    expect(filterEmojiChars("smile")).toContain("😄");
    expect(filterEmojiChars("house")).not.toContain("🍎");
  });

  it("粘贴一个表情精确命中；空查询返回全部；大小写不敏感", () => {
    expect(filterEmojiChars("🍎")).toContain("🍎");
    expect(filterEmojiChars("")).toHaveLength(LAKE_EMOJIS.length);
    expect(filterEmojiChars("HOUSE")).toContain("🏠");
  });

  it("关键词表覆盖大部分表情，且每个值都非空", () => {
    const chars = Object.keys(EMOJI_ZH_KEYWORDS);
    expect(chars.length).toBeGreaterThan(1000);
    for (const char of chars) expect(EMOJI_ZH_KEYWORDS[char].trim().length).toBeGreaterThan(0);
    expect(emojiZhKeywords("😀")).toContain("笑脸");
  });

  it("带变体选择符的字符也能查到中文关键词（去掉 FE0F 再查）", () => {
    // ☺️ = U+263A + U+FE0F
    const withVs = "☺️";
    expect(matchEmoji({ name: "relaxed", char: withVs }, "笑")).toBe(true);
  });
});
