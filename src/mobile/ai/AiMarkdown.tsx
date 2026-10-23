/**
 * 移动端 AI 回答渲染（最小子集；261023 起解析器与桌面共用 `src/core/markdown.ts`）。
 *
 * 只渲染 React 节点、绝不 innerHTML（AI 输出不可信）；链接只放行 http(s)。
 * 样式作用域 `.ai-md`（./ai.css），与桌面 `.md-preview` 各自一套，不共享样式。
 */
import { Fragment, type ReactNode } from "react";
import {
  parseInline,
  parseMarkdownBlocks,
  type InlineToken,
  type MarkdownBlock,
  type MarkdownListItem,
} from "../../core/markdown";

function renderInlineTokens(tokens: readonly InlineToken[], keyBase: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = keyBase + "-" + index;
    if (token.type === "text") return <Fragment key={key}>{token.text}</Fragment>;
    if (token.type === "code") return <code key={key} className="ai-md__code">{token.text}</code>;
    if (token.type === "strong") return <strong key={key}>{renderInlineTokens(token.children, key)}</strong>;
    if (token.type === "del") return <del key={key}>{renderInlineTokens(token.children, key)}</del>;
    if (token.type === "em") return <em key={key}>{renderInlineTokens(token.children, key)}</em>;
    if (!/^https?:\/\//i.test(token.href)) return <Fragment key={key}>{renderInlineTokens(token.children, key)}</Fragment>;
    return <a key={key} className="ai-md__link" href={token.href} target="_blank" rel="noreferrer noopener">{renderInlineTokens(token.children, key)}</a>;
  });
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  return renderInlineTokens(parseInline(text), keyBase);
}

function renderList(items: readonly MarkdownListItem[], keyBase: string, ordered: boolean): ReactNode {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className="ai-md__list">
      {items.map((item, index) => (
        <li key={keyBase + "-" + index}>
          {renderInline(item.text, keyBase + "-" + index)}
          {item.children.length > 0 && renderList(item.children, keyBase + "-" + index, ordered)}
        </li>
      ))}
    </Tag>
  );
}

function alignClass(align: "left" | "center" | "right" | null): string {
  return align ? "is-" + align : "";
}

function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  if (block.kind === "code") return <pre key={key} className="ai-md__pre"><code>{block.text}</code></pre>;
  if (block.kind === "hr") return <hr key={key} className="ai-md__hr" />;
  if (block.kind === "heading") {
    const level = Math.min(3, Math.max(1, block.level));
    const Tag = ("h" + level) as "h1";
    return <Tag key={key} className={"ai-md__h ai-md__h" + level}>{renderInline(block.text, key)}</Tag>;
  }
  if (block.kind === "quote") return <blockquote key={key} className="ai-md__quote">{renderInline(block.text.replace(/\n/g, " "), key)}</blockquote>;
  if (block.kind === "list") return <Fragment key={key}>{renderList(block.items, key, block.ordered)}</Fragment>;
  if (block.kind === "table") {
    return (
      <div key={key} className="ai-md__tablewrap">
        <table className="ai-md__table">
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
  }
  return <p key={key} className="ai-md__p">{renderInline(block.text, key)}</p>;
}

export function AiMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return <div className="ai-md">{blocks.map((block, index) => renderBlock(block, "b" + index))}</div>;
}
