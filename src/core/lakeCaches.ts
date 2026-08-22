/**
 * Lake 正文（.lake 持久化 HTML 片段）→ 文本缓存的兜底转换。
 *
 * 背景：编辑态保存时由 Lake 内核 getDocument("text/markdown") 生成高质量缓存；
 * 但锁定态（Viewer）实例不暴露该能力，导致锁定文档可能没有 md_cache/text_cache，
 * 全文搜索、复制 Markdown、导出资料包都覆盖不到。这里从磁盘 .lake 正文解析出
 * 可用缓存（无需打开编辑器），作为锁定切换/打开文档时的兜底。
 *
 * 策略（刻意保守，不引依赖、不执行卡片内 JSON）：
 * - <p> 段落 → 换行分段；<br> → 换行
 * - <a href=...>链接</a> → 链接文本（保留可读性）
 * - <card ... value="data:..."> 卡片 → 优先取 value 内 JSON 的 text/plain 或 data-content
 *   纯文本字段（不执行，仅正则提取）；取不到则剥标签保留内部文本
 * - 其余标签一律剥掉、保留文本；HTML 实体解码（&amp; &lt; &gt; &quot; &#39; &nbsp;）
 */
export function lakeHtmlToMarkdown(lakeHtml: string): string {
  const text = decodeEntities(stripTagsPreserveText(lakeHtml));
  return normalizeLines(text);
}

export function lakeHtmlToPlain(lakeHtml: string): string {
  // 纯文本与 markdown 兜底同源（Lake 无额外标记符号）
  return lakeHtmlToMarkdown(lakeHtml);
}

/** 提取 <card> 的纯文本（value 内嵌 JSON 的 text/plain 或 data-content，不执行） */
function cardText(card: string): string | null {
  const valueMatch = /value="([^"]*)"/.exec(card);
  if (!valueMatch) return null;
  const raw = valueMatch[1];
  // data:%7B...%7D → 解码一次 URI 得到 JSON；失败则回退
  let json: unknown = null;
  try {
    const decoded = decodeURIComponent(raw);
    json = JSON.parse(decoded.replace(/^data:/, ""));
  } catch {
    // 也可能直接是 JSON 文本（无 data: 前缀）
    try { json = JSON.parse(raw.replace(/^data:/, "")); } catch { /* 忽略 */ }
  }
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const candidate =
    (typeof obj["text/plain"] === "string" ? obj["text/plain"] : null) ??
    (typeof obj["text"] === "string" ? obj["text"] : null) ??
    (typeof obj["data-content"] === "string" ? obj["data-content"] : null);
  return candidate;
}

function stripTagsPreserveText(html: string): string {
  let out = "";
  let i = 0;
  const len = html.length;
  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt + 1, gt).trim();
    const isClose = tag.startsWith("/");
    const tagName = (isClose ? tag.slice(1) : tag).split(/[\s/]/)[0].toLowerCase();
    if (tagName === "br") {
      out += "\n";
    } else if (tagName === "card") {
      const whole = html.slice(lt, gt + 1);
      const text = cardText(whole) ?? "";
      out += text;
    } else if (tagName === "p" && isClose) {
      out += "\n";
    }
    // 其余开/闭标签：丢弃标签本身（保留内部文本由后续迭代继续）
    i = gt + 1;
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&rdquo;/gi, "\u201d");
}

/** 把连续空行压成至多一个空行，行尾空白去掉 */
function normalizeLines(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
