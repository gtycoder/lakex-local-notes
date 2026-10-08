/**
 * 正文 → 搜索/缓存文本（**按文档类型分派**，桌面与移动共用同一口径）。
 *
 * 背景：doc 的正文是 Lake HTML，可以走 `lakeHtmlToMarkdown/Plain`；而 usheet / bitable / board 的正文是
 * **内部 JSON**，喂给 Lake 解析器只会得到一堆 JSON 碎片（搜索索引里全是 `"kind":"bitable"` 这类噪声）。
 * 桌面 `Store.searchTextFor` 一直按 kind 分派，移动端过去是 `text_cache ?? lakeHtmlToPlain(content)` ⇒
 * 同步过来的表格/多维表/画板在移动端搜索里就是 JSON 碎片。这里收成单一来源，两端共用。
 */
import { bitableToSearchText } from "./bitableDoc.js";
import { boardToSearchText } from "./boardDoc.js";
import { lakeHtmlToMarkdown, lakeHtmlToPlain } from "./lakeCaches.js";
import type { NoteKind } from "./noteKind.js";
import { usheetToSearchText } from "./usheetDoc.js";

export interface NoteSearchText {
  /** Markdown 镜像（仅 doc 有；非 doc 恒为 null）。 */
  markdown: string | null;
  /** 纯文本（用于全文搜索 / 摘要 / 字数）。 */
  plain: string | null;
}

/** 按 kind 派生搜索/缓存文本；未知 kind 按 doc 处理（与 `normalizeNoteKind` 一致）。 */
export function searchTextForKind(kind: NoteKind, content: string | null | undefined): NoteSearchText {
  const body = typeof content === "string" ? content : "";
  if (kind === "usheet") return { markdown: null, plain: usheetToSearchText(body) };
  if (kind === "bitable") return { markdown: null, plain: bitableToSearchText(body) };
  if (kind === "board") return { markdown: null, plain: boardToSearchText(body) };
  return { markdown: lakeHtmlToMarkdown(body), plain: lakeHtmlToPlain(body) };
}
