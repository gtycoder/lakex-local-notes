import { LAKE_EMOJIS, type LakeEmoji } from "./lakeEmojis";
import { emojiZhKeywords } from "./emojiZhKeywords";

/**
 * 表情搜索的**唯一判据**（261020）：英文短名 / CLDR 中文关键词 / 粘贴一个表情精确命中。
 *
 * 为什么需要这一层：`LAKE_EMOJIS` 只有英文短名（smile、house），搜「房」「苹果」原本一条都出不来；
 * 中文关键词来自 CLDR zh 注解（见 emojiZhKeywords.ts），用 `includes()` 做子串匹配 ⇒「房」能命中「房子」。
 * 面板（桌面）与测试都只调这里，不在组件里各写一份过滤条件。
 */
export function matchEmoji(emoji: LakeEmoji, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (emoji.char === query.trim()) return true;
  if (emoji.name.toLowerCase().includes(q)) return true;
  return emojiZhKeywords(emoji.char).includes(q);
}

/** 按查询返回命中的表情字符（保持目录顺序；空查询 = 全部）。 */
export function filterEmojiChars(query: string): string[] {
  return LAKE_EMOJIS.filter((emoji) => matchEmoji(emoji, query)).map((emoji) => emoji.char);
}
