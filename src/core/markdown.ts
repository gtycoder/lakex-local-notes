/**
 * Markdown 轻量子集的**唯一解析器**（261023：从桌面 `MarkdownView` 抽出，两端共用）。
 *
 * 只产纯数据（块 + 行内 token），不碰 React / DOM / node，因此桌面与移动端各自渲染、
 * 样式各走各的设计系统（桌面 `.md-preview`、移动端 `.ai-md`）。
 *
 * 子集：标题 h1–h6 / 段落 / 粗体 / 斜体 / 删除线 / 行内代码 / 代码块 / 引用 /
 * 有序·无序列表（按缩进嵌套）/ 链接 / 分割线 / **GFM 表格**（261023 新增）；
 * 图片不做（按原文文本呈现，与桌面既有口径一致）。
 */
export interface MarkdownListItem {
  text: string;
  children: MarkdownListItem[];
}

export type MarkdownAlign = "left" | "center" | "right";

export type MarkdownBlock =
  | { kind: "code"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: MarkdownListItem[] }
  | { kind: "hr" }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; align: Array<MarkdownAlign | null>; header: string[]; rows: string[][] };

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HR_RE = /^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const FENCE_RE = /^\s*\x60\x60\x60/;

/** 表头 + 下一行 |---|:--:| 分隔行。 */
function isTableHeader(lines: string[], index: number): boolean {
  if (!lines[index] || !lines[index].includes("|")) return false;
  const next = lines[index + 1];
  if (!next || !next.includes("-")) return false;
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(next);
}

/** 拆表格行（首尾竖线去掉后按 | 分段；单元格内不支持转义竖线，够用即可）。 */
function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

/** 解析为块级结构（纯函数；渲染与纯文本预览共用）。 */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (FENCE_RE.test(line)) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !FENCE_RE.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    if (isTableHeader(lines, i)) {
      const header = splitTableRow(lines[i]);
      const align = splitTableRow(lines[i + 1]).map((cell): MarkdownAlign | null => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", align, header, rows });
      continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] }); i++; continue; }
    if (HR_RE.test(line)) { blocks.push({ kind: "hr" }); i++; continue; }
    if (QUOTE_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) { buf.push(lines[i].replace(QUOTE_RE, "")); i++; }
      blocks.push({ kind: "quote", text: buf.join("\n") });
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: MarkdownListItem[] = [];
      const stack: Array<{ indent: number; item: MarkdownListItem }> = [];
      while (i < lines.length && LIST_ITEM_RE.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) {
        const match = lines[i].match(LIST_ITEM_RE)!;
        const indent = match[1].length;
        const item: MarkdownListItem = { text: match[3], children: [] };
        while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
        if (stack.length) stack[stack.length - 1].item.children.push(item);
        else items.push(item);
        stack.push({ indent, item });
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim()
      && !FENCE_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) && !QUOTE_RE.test(lines[i])
      && !LIST_ITEM_RE.test(lines[i]) && !HR_RE.test(lines[i]) && !isTableHeader(lines, i)
    ) { buf.push(lines[i]); i++; }
    blocks.push({ kind: "paragraph", text: buf.join("\n") });
  }
  return blocks;
}

// ── 行内 ────────────────────────────────────────────────────────────────
export type InlineToken =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineToken[] }
  | { type: "em"; children: InlineToken[] }
  | { type: "del"; children: InlineToken[] }
  | { type: "link"; href: string; children: InlineToken[] };

/** 行内语法（顺序即优先级：行内代码 > 粗体 > 删除线 > 斜体 > 链接）。 */
const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/;

/** 行内解析（递归：粗体/斜体/删除线/链接的 children 可再带行内标记）。 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;
  while (rest) {
    const match = rest.match(INLINE_RE);
    if (!match || match.index === undefined) { tokens.push({ type: "text", text: rest }); break; }
    if (match.index > 0) tokens.push({ type: "text", text: rest.slice(0, match.index) });
    const token = match[0];
    if (token.startsWith("`")) tokens.push({ type: "code", text: token.slice(1, -1) });
    else if (token.startsWith("**") || token.startsWith("__")) tokens.push({ type: "strong", children: parseInline(token.slice(2, -2)) });
    else if (token.startsWith("~~")) tokens.push({ type: "del", children: parseInline(token.slice(2, -2)) });
    else if (token.startsWith("*") || token.startsWith("_")) tokens.push({ type: "em", children: parseInline(token.slice(1, -1)) });
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) tokens.push({ type: "link", href: link[2], children: parseInline(link[1]) });
      else tokens.push({ type: "text", text: token });
    }
    rest = rest.slice(match.index + token.length);
  }
  return tokens;
}

/** 行内 token → 纯文本（单元格单行预览 / 纯文本导出用）。 */
export function inlineToPlain(tokens: readonly InlineToken[]): string {
  let out = "";
  for (const token of tokens) {
    if (token.type === "text" || token.type === "code") out += token.text;
    else out += inlineToPlain(token.children);
  }
  return out;
}

/** 单行纯文本预览（去标记；块之间空格连接，列表项用逗号分隔）。 */
export function markdownToPlainText(source: string): string {
  const parts: string[] = [];
  for (const block of parseMarkdownBlocks(source)) {
    if (block.kind === "code") { if (block.text.trim()) parts.push(block.text.trim()); }
    else if (block.kind === "heading" || block.kind === "paragraph" || block.kind === "quote") {
      parts.push(inlineToPlain(parseInline(block.text.replace(/\n/g, " "))));
    } else if (block.kind === "list") {
      const flat: string[] = [];
      const walk = (items: MarkdownListItem[]) => {
        for (const item of items) { flat.push(inlineToPlain(parseInline(item.text))); walk(item.children); }
      };
      walk(block.items);
      parts.push(flat.join("，"));
    } else if (block.kind === "table") {
      const cells = [block.header, ...block.rows].flat();
      parts.push(cells.map((cell) => inlineToPlain(parseInline(cell))).join(" "));
    }
  }
  return parts.filter(Boolean).join(" ").trim();
}
