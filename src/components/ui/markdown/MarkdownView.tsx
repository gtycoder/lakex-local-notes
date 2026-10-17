/**
 * Markdown 轻量子集渲染（261004；261005 提升为**共用渲染件**，bitable 与 AI 面板共用）。
 *
 * 约束：
 * - **只用 React 元素渲染、绝不 `innerHTML`**：AI 输出与用户输入都不可信，这样天然防注入，也不引入 markdown 依赖；
 * - 只支持**常用子集**（用户 261004 定稿）：标题 h1–h6 / 段落 / 粗体 / 斜体 / 删除线 / 行内代码 /
 *   代码块 / 引用 / 有序·无序列表（按缩进嵌套）/ 链接 / 分割线；表格与图片**首版不做**（按原文文本呈现）；
 * - 只把 `http(s)://` 链接渲染成可点链接（其它一律文本），点击用系统浏览器打开（与链接格同款 `window.open`）。
 */
import { Fragment, useMemo, type ReactNode } from "react";
import "./markdown.css";

export interface MarkdownListItem {
  text: string;
  children: MarkdownListItem[];
}

export type MarkdownBlock =
  | { kind: "code"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: MarkdownListItem[] }
  | { kind: "hr" }
  | { kind: "paragraph"; text: string };

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HR_RE = /^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const FENCE_RE = /^\s*```/;

/** 解析为块级结构（纯函数，渲染与纯文本预览共用；可单测）。 */
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
      i++; // 跳过闭合围栏（缺失时吃到结尾）
      blocks.push({ kind: "code", text: buf.join("\n") });
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
      // 缩进栈：更深缩进的项挂到最近父项下（支持嵌套；同缩进为同级）。
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
    // 段落：连续的非空、非其它块起始的行合并为一段（内部换行渲染为 <br/>，对中文更友好）。
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim()
      && !FENCE_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) && !QUOTE_RE.test(lines[i])
      && !LIST_ITEM_RE.test(lines[i]) && !HR_RE.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    blocks.push({ kind: "paragraph", text: buf.join("\n") });
  }
  return blocks;
}

/** 行内语法（顺序即优先级：行内代码 > 粗体 > 删除线 > 斜体 > 链接）。 */
const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/;
const INLINE_RE_G = new RegExp(INLINE_RE.source, "g");

/** 行内标记 → 纯文本（单元格单行预览 / 纯文本导出用）。 */
function inlinePlain(text: string): string {
  return text.replace(INLINE_RE_G, (raw: string, code?: string, bold1?: string, bold2?: string, del?: string, em1?: string, em2?: string, link?: string) => {
    if (code) return code.slice(1, -1);
    if (bold1 || bold2) return (bold1 ?? bold2 ?? "").slice(2, -2);
    if (del) return del.slice(2, -2);
    if (em1 || em2) return (em1 ?? em2 ?? "").slice(1, -1);
    if (link) { const m = link.match(/^\[([^\]]+)\]/); return m ? m[1] : link; }
    return raw;
  });
}

/** Markdown → 单行纯文本预览（去掉所有标记；块之间以空格连接）。 */
export function markdownToPlainText(source: string): string {
  const parts: string[] = [];
  for (const block of parseMarkdownBlocks(source)) {
    if (block.kind === "code") { if (block.text.trim()) parts.push(block.text.trim()); }
    else if (block.kind === "heading" || block.kind === "paragraph" || block.kind === "quote") parts.push(inlinePlain(block.text.replace(/\n/g, " ")));
    else if (block.kind === "list") {
      const flat: string[] = [];
      const walk = (items: MarkdownListItem[]) => { for (const item of items) { flat.push(inlinePlain(item.text)); walk(item.children); } };
      walk(block.items);
      parts.push(flat.join(" · "));
    }
  }
  return parts.filter(Boolean).join(" ").trim();
}

/** 只把 http(s) 链接渲染成链接（其它文本原样）；点击交给系统浏览器（与链接格同款）。 */
function MdLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  return (
    <a href={href} title={href} rel="noreferrer"
      onClick={(event) => { event.preventDefault(); window.open(href, "_blank", "noopener"); }}>{children}</a>
  );
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let index = 0;
  while (rest) {
    const match = rest.match(INLINE_RE);
    if (!match || match.index === undefined) { nodes.push(rest); break; }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const token = match[0];
    const key = keyBase + "-" + index++;
    if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**") || token.startsWith("__")) nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith("~~")) nodes.push(<del key={key}>{renderInline(token.slice(2, -2), key)}</del>);
    else if (token.startsWith("*") || token.startsWith("_")) nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) nodes.push(<MdLink key={key} href={link[2]}>{renderInline(link[1], key)}</MdLink>);
      else nodes.push(token);
    }
    rest = rest.slice(match.index + token.length);
  }
  return nodes;
}

function renderListItem(item: MarkdownListItem, key: string, ordered: boolean): ReactNode {
  const Tag = ordered ? "ol" : "ul";
  return (
    <li key={key}>
      {renderInline(item.text, key)}
      {item.children.length > 0 && <Tag>{item.children.map((child, i) => renderListItem(child, key + "-" + i, ordered))}</Tag>}
    </li>
  );
}

function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = ("h" + Math.min(6, Math.max(1, block.level))) as "h1";
      return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
    }
    case "code":
      return <pre key={key}><code>{block.text}</code></pre>;
    case "hr":
      return <hr key={key} />;
    case "quote":
      return (
        <blockquote key={key}>
          {block.text.split("\n").map((line, i) => <p key={key + "-" + i}>{renderInline(line, key + "-" + i)}</p>)}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, i) => renderListItem(item, key + "-" + i, block.ordered));
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    default:
      return (
        <p key={key}>
          {block.text.split("\n").map((line, i) => (
            <Fragment key={key + "-" + i}>{i > 0 && <br />}{renderInline(line, key + "-" + i)}</Fragment>
          ))}
        </p>
      );
  }
}

/** 渲染入口：块级 + 行内子集 → React 元素（样式作用域 = `.md-preview`，排版在 ./markdown.css）。 */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(source), [source]);
  if (blocks.length === 0) return null;
  return (
    <div className={"md-preview" + (className ? " " + className : "")}>
      {blocks.map((block, index) => renderBlock(block, "b" + index))}
    </div>
  );
}