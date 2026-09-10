/**
 * 移动端搜索 fallback（Phase 0B-5）：sql.js 无 FTS5（已实测 no such module），一期用 LIKE。
 * 标题 LIKE + 正文 LIKE；两字以内查询也走 LIKE（不依赖 trigram）。
 * 纯查询构造（可单测）：escapeLike 转义 %/_；buildLikePattern 组装；行→结果映射。
 */
import type { SearchResult } from "./searchTypes.js";

/** LIKE 通配符转义：% → \%，_ → \_（配合 ESCAPE '\\'）。 */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => "\\" + ch);
}

/** 组装 LIKE 模式：非空查询 → %term%（两端模糊）；空查询返回 null（调用方短路）。 */
export function buildLikePattern(term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  return "%" + escapeLike(trimmed) + "%";
}

/** 行 → SearchResult：matchType 由调用方判定（标题是否命中），snippet 优先标题、正文兜底截断 120 字。 */
export function toSearchResult(row: {
  id: string; title: string; content: string; updated_at: string; parent_id: string | null; parent_title: string | null;
}, titleHit: boolean): SearchResult {
  const snippet = titleHit
    ? row.title
    : (row.content.length > 120 ? row.content.slice(0, 120) + "…" : row.content);
  return {
    id: row.id,
    title: row.title,
    snippet,
    matchType: titleHit ? "title" : "body",
    updatedAt: row.updated_at,
    parentTitle: row.parent_title,
  };
}

/** 组装搜索 SQL（参数化 + ESCAPE）；返回 [sql, params]。 */
export function buildSearchSql(pattern: string): [string, string[]] {
  const sql = `SELECT n.id, n.title, n.content, n.updated_at, n.parent_id, f.title AS parent_title
    FROM notes n LEFT JOIN folders f ON n.parent_id = f.id
    WHERE n.trashed_at IS NULL AND (n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\')
    ORDER BY n.updated_at DESC LIMIT 50`;
  return [sql, [pattern, pattern]];
}
