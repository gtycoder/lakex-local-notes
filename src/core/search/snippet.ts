const DEFAULT_BEFORE = 60;
const DEFAULT_AFTER = 120;

/**
 * 全量 HTML 实体转义（含引号）：摘要会经 `dangerouslySetInnerHTML` 注入，文本节点只需
 * `&<>`，但若日后被拼进属性（title/class 片段）必须已有 `"`/`'` 转义——这里一次做全。
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Range {
  start: number;
  end: number;
}

function collectRanges(windowLower: string, terms: string[]): Range[] {
  const ranges: Range[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const index = windowLower.indexOf(needle, from);
      if (index < 0) break;
      ranges.push({ start: index, end: index + needle.length });
      from = index + needle.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/**
 * 从原始纯文本生成带 <mark> 的安全 HTML 摘要（两端共用）。
 * - 不用 FTS5 的 snippet()/highlight()：存的是分词后文本，且两端要一致；
 * - 命中词高亮（多词都标、重叠合并），窗口外截断加省略号；
 * - 输出已 HTML 转义，只有 <mark> 是标签（调用方可直接 innerHTML）。
 */
export function buildSnippet(
  plain: string,
  query: string,
  opts: { before?: number; after?: number } = {},
): string {
  const before = opts.before ?? DEFAULT_BEFORE;
  const after = opts.after ?? DEFAULT_AFTER;
  const text = plain ?? "";
  if (!text) return "";
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const fallback = escapeHtml(text.slice(0, before + after));
  if (terms.length === 0) return fallback;

  const lower = text.toLowerCase();
  let hit = -1;
  let hitLength = 0;
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index >= 0 && (hit < 0 || index < hit)) {
      hit = index;
      hitLength = term.length;
    }
  }
  if (hit < 0) return fallback;

  const start = Math.max(0, hit - before);
  const end = Math.min(text.length, hit + hitLength + after);
  const windowText = text.slice(start, end);
  const ranges = collectRanges(windowText.toLowerCase(), terms);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  let out = "";
  let cursor = 0;
  for (const range of ranges) {
    out += escapeHtml(windowText.slice(cursor, range.start));
    out += "<mark>" + escapeHtml(windowText.slice(range.start, range.end)) + "</mark>";
    cursor = range.end;
  }
  out += escapeHtml(windowText.slice(cursor));
  return prefix + out + suffix;
}
