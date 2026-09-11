import { segmentText } from "./segment.js";

/** LIKE 通配符转义：% → \%，_ → \_，\ → \\（配合 ESCAPE '\\'）。 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

/**
 * 把用户查询串转成 FTS5 MATCH 表达式：
 * - 按空白拆词项；每个词项按分词器切成 token，包成双引号短语（保证位置相邻 = 精确子串）；
 * - 多词项之间用空格连接（FTS5 隐式 AND）；
 * - 1 字/2 字/3+ 字走同一路径，没有长度分支；
 * - 无有效 token → null（调用方短路）。
 */
export function buildMatchExpression(query: string): string | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const phrases: string[] = [];
  for (const term of terms) {
    const tokens = segmentText(term);
    if (tokens.length === 0) continue;
    const inner = tokens.join(" ").replace(/"/g, '""');
    phrases.push('"' + inner + '"');
  }
  return phrases.length > 0 ? phrases.join(" ") : null;
}
