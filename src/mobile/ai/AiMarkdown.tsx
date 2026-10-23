/**
 * 移动端最小 Markdown 渲染（AI 回复用，261023 P1）。
 *
 * 约束：AI 输出是**不可信文本** ⇒ 绝不 dangerouslySetInnerHTML；这里解析成块模型后由 React 渲染，
 * 链接只放行 http(s)（点击交给系统浏览器由上层决定，这里只渲染 <a>）。
 * 支持子集：段落 / 标题(≤h3) / 无序·有序列表 / 引用 / 代码块 / 行内代码 / 粗体 / 链接。
 */
import { Fragment, type ReactNode } from "react";

export type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; value: string; href: string };

export type MdBlock =
  | { kind: "p"; inlines: InlineToken[] }
  | { kind: "h"; level: 1 | 2 | 3; inlines: InlineToken[] }
  | { kind: "ul"; items: InlineToken[][] }
  | { kind: "ol"; items: InlineToken[][] }
  | { kind: "quote"; inlines: InlineToken[] }
  | { kind: "code"; text: string }
  | { kind: "table"; align: Array<"left" | "center" | "right" | null>; header: InlineToken[][]; rows: InlineToken[][][] };

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** 行内解析：链接 → 粗体 → 行内代码 → 纯文本。 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;
  const pushText = (value: string): void => {
    if (value) tokens.push({ kind: "text", value });
  };
  while (rest.length > 0) {
    const link = new RegExp(LINK.source).exec(rest);
    if (!link || link.index === undefined) break;
    pushText(rest.slice(0, link.index));
    tokens.push({ kind: "link", value: link[1], href: link[2] });
    rest = rest.slice(link.index + link[0].length);
  }
  if (rest) pushText(rest);
  // 粗体 / 行内代码在文本 token 内再切
  const out: InlineToken[] = [];
  for (const token of tokens) {
    if (token.kind !== "text") { out.push(token); continue; }
    let value = token.value;
    while (value.length > 0) {
      const bold = value.indexOf("**");
      const code = value.indexOf("`");
      const at = bold < 0 ? code : code < 0 ? bold : Math.min(bold, code);
      if (at < 0) { out.push({ kind: "text", value }); break; }
      if (at > 0) out.push({ kind: "text", value: value.slice(0, at) });
      if (at === bold) {
        const end = value.indexOf("**", at + 2);
        if (end < 0) { out.push({ kind: "text", value: value.slice(at) }); break; }
        out.push({ kind: "strong", value: value.slice(at + 2, end) });
        value = value.slice(end + 2);
      } else {
        const end = value.indexOf("`", at + 1);
        if (end < 0) { out.push({ kind: "text", value: value.slice(at) }); break; }
        out.push({ kind: "code", value: value.slice(at + 1, end) });
        value = value.slice(end + 1);
      }
    }
  }
  return out;
}

/** 一行是否是表头（本行含 | 且下一行是 |---|:--:| 这类分隔行）。 */
function isTableHeader(lines: string[], index: number): boolean {
  if (!lines[index] || !lines[index].includes("|")) return false;
  const next = lines[index + 1];
  if (!next || !next.includes("-")) return false;
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(next);
}

/** 拆表格行：去掉首尾竖线后按 | 分段（单元格内不支持转义竖线，够用即可）。 */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

/** 块级解析：代码块 / 表格 / 标题 / 列表 / 引用 / 段落。 */
export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i += 1; }
      i += 1;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (isTableHeader(lines, i)) {
      const header = splitRow(lines[i]);
      const align = splitRow(lines[i + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      const rows: InlineToken[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]).map((cell) => parseInline(cell)));
        i += 1;
      }
      blocks.push({ kind: "table", align, header: header.map((cell) => parseInline(cell)), rows });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1].length as 1 | 2 | 3, inlines: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*[-*]\s+/, ""))); i += 1; }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*\d+\.\s+/, ""))); i += 1; }
      blocks.push({ kind: "ol", items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
      blocks.push({ kind: "quote", inlines: parseInline(quote.join(" ")) });
      continue;
    }
    if (line.trim() === "") { i += 1; continue; }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3})\s|^\s*[-*]\s+|^\s*\d+\.\s+|^\s*>|^```/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", inlines: parseInline(para.join(" ")) });
  }
  return blocks;
}

function alignClass(align: "left" | "center" | "right" | null): string {
  return align ? "is-" + align : "";
}

function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((token, index) => {
    if (token.kind === "text") return <Fragment key={index}>{token.value}</Fragment>;
    if (token.kind === "strong") return <strong key={index}>{token.value}</strong>;
    if (token.kind === "code") return <code key={index} className="ai-md__code">{token.value}</code>;
    return <a key={index} className="ai-md__link" href={token.href} target="_blank" rel="noreferrer noopener">{token.value}</a>;
  });
}

export function AiMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="ai-md">
      {blocks.map((block, index) => {
        if (block.kind === "code") return <pre key={index} className="ai-md__pre"><code>{block.text}</code></pre>;
        if (block.kind === "h") {
          const Tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
          return <Tag key={index} className={"ai-md__h ai-md__h" + block.level}>{renderInline(block.inlines)}</Tag>;
        }
        if (block.kind === "table") {
          return (
            <div key={index} className="ai-md__tablewrap">
              <table className="ai-md__table">
                <thead>
                  <tr>
                    {block.header.map((cell, k) => (
                      <th key={k} className={alignClass(block.align[k])}>{renderInline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, k) => (
                        <td key={k} className={alignClass(block.align[k])}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === "ul") return <ul key={index} className="ai-md__list">{block.items.map((item, k) => <li key={k}>{renderInline(item)}</li>)}</ul>;
        if (block.kind === "ol") return <ol key={index} className="ai-md__list">{block.items.map((item, k) => <li key={k}>{renderInline(item)}</li>)}</ol>;
        if (block.kind === "quote") return <blockquote key={index} className="ai-md__quote">{renderInline(block.inlines)}</blockquote>;
        return <p key={index} className="ai-md__p">{renderInline(block.inlines)}</p>;
      })}
    </div>
  );
}
