/**
 * Markdown 轻量子集渲染（261004；261005 共用渲染件；261023 解析器抽到 core）。
 *
 * 约束：
 * - **只用 React 元素渲染、绝不 `innerHTML`**：AI 输出与用户输入都不可信，天然防注入、不引 markdown 依赖；
 * - 解析器 = `src/core/markdown.ts`（与移动端 AI 回答共用同一份块/行内解析，含 GFM 表格）；
 * - 渲染样式 = `.md-preview`（./markdown.css，只走 --lake-* 令牌）；表格 261023 起支持；
 * - 链接只把 `http(s)://` 渲染成可点链接（其它一律文本），点击用系统浏览器打开。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  parseInline,
  parseMarkdownBlocks,
  type InlineToken,
  type MarkdownBlock,
  type MarkdownListItem,
} from "../../../core/markdown";
import "./markdown.css";

export { markdownToPlainText, parseMarkdownBlocks } from "../../../core/markdown";
export type { MarkdownBlock, MarkdownListItem } from "../../../core/markdown";

/** 只把 http(s) 链接渲染成链接（其它文本原样）；点击交给系统浏览器（与链接格同款）。 */
function MdLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  return (
    <a href={href} title={href} rel="noreferrer"
      onClick={(event) => { event.preventDefault(); window.open(href, "_blank", "noopener"); }}>{children}</a>
  );
}

function renderInlineTokens(tokens: readonly InlineToken[], keyBase: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = keyBase + "-" + index;
    if (token.type === "text") return <Fragment key={key}>{token.text}</Fragment>;
    if (token.type === "code") return <code key={key}>{token.text}</code>;
    if (token.type === "strong") return <strong key={key}>{renderInlineTokens(token.children, key)}</strong>;
    if (token.type === "del") return <del key={key}>{renderInlineTokens(token.children, key)}</del>;
    if (token.type === "em") return <em key={key}>{renderInlineTokens(token.children, key)}</em>;
    return <MdLink key={key} href={token.href}>{renderInlineTokens(token.children, key)}</MdLink>;
  });
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  return renderInlineTokens(parseInline(text), keyBase);
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

function alignClass(align: "left" | "center" | "right" | null): string {
  return align ? "md-align-" + align : "";
}

/** 代码块（261116 P4，借鉴 chat-demo 的轻量做法）：行号 + 复制，不引高亮库。
 * 行号用 CSS 计数渲染，`user-select: none` + aria-hidden，避免用户手选时把行号一起带走；
 * 复制按钮写的是**原文**（block.text），不是带行号的 DOM 文本。 */
function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1200);
    } catch { /* 剪贴板不可用（无权限/老 WebView）：静默，不阻断阅读 */ }
  };
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <div className="md-code">
      <button type="button" className="md-code__copy" onClick={() => void copy()} aria-label={copied ? "已复制代码" : "复制代码"}>{copied ? "已复制" : "复制"}</button>
      <pre><code>{lines.map((line, i) => <span key={i} className="md-code__line">{line}</span>)}</code></pre>
    </div>
  );
}
function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = ("h" + Math.min(6, Math.max(1, block.level))) as "h1";
      return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
    }
    case "code":
      // key 挂在包装 div 上（CodeBlock 内部是稳定结构，不需要 key 透传）。
      return <CodeBlock key={key} text={block.text} />;
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
    case "table":
      return (
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} className={alignClass(block.align[i] ?? null)}>{renderInline(cell, key + "-h" + i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} className={alignClass(block.align[i] ?? null)}>{renderInline(cell, key + "-" + r + "-" + i)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
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
