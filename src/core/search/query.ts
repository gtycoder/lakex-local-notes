import { isCjkChar, segmentText } from "./segment.js";

/** LIKE 通配符转义：% → \%，_ → \_，\ → \\（配合 ESCAPE '\\'）。 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

/** FTS5 查询保留字（大小写不敏感）：裸词成形时会被当操作符，再加 `*` 直接是 `near "AND": syntax error`。 */
const FTS5_RESERVED_WORDS = new Set(["and", "or", "not", "near"]);

/**
 * 把用户查询串转成 FTS5 MATCH 表达式：
 * - 按空白拆词项；每个词项按分词器切成 token，包成双引号短语（保证位置相邻 = 精确子串）；
 * - 多词项之间用空格连接（FTS5 隐式 AND）；
 * - 1 字/2 字/3+ 字走同一路径，没有长度分支；
 * - 无有效 token → null（调用方短路）。
 */
export function buildMatchExpression(query: string): string | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (const term of terms) {
    const tokens = segmentText(term);
    if (tokens.length === 0) continue;
    // 单个拉丁/数字词（≥2 字符）→ FTS5 前缀查询：`Lak` 命中 `Lake`。
    // 单字符不前缀（避免 C→cdp… 这类爆炸）；中文单字/混合词仍用引号短语保证精确相邻。
    if (tokens.length === 1 && tokens[0].length >= 2 && !isCjkChar(tokens[0])) {
      const token = tokens[0];
      // 保留字不能走前缀：`AND*` / `OR*` / `NOT*` 会被 FTS5 当操作符（CORE-02）；按短语加引号做字面匹配
      if (FTS5_RESERVED_WORDS.has(token.toLowerCase())) {
        parts.push('"' + token.replace(/"/g, '""') + '"');
        continue;
      }
      parts.push(token + "*");
      continue;
    }
    const inner = tokens.join(" ").replace(/"/g, '""');
    parts.push('"' + inner + '"');
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
