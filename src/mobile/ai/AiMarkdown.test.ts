import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiMarkdown } from "./AiMarkdown";

const html = (text: string): string => renderToStaticMarkup(createElement(AiMarkdown, { text }));

describe("AI Markdown 渲染（移动端；解析器与桌面共用）", () => {
  it("标题/段落/粗体/行内代码", () => {
    const out = html("# 标题\n\n这是 **粗** 与 `code`");
    expect(out).toContain('<h1 class="ai-md__h ai-md__h1">标题</h1>');
    expect(out).toContain("<strong>粗</strong>");
    expect(out).toContain('<code class="ai-md__code">code</code>');
  });

  it("GFM 表格：表头/对齐/单元格", () => {
    const out = html("| 项 | 结果 |\n| :-- | --: |\n| 通道 | 原生 SSE |");
    expect(out).toContain('<table class="ai-md__table">');
    expect(out).toContain('<th class="is-left">项</th>');
    expect(out).toContain('<th class="is-right">结果</th>');
    expect(out).toContain('<td class="is-left">通道</td>');
    expect(out).toContain('<td class="is-right">原生 SSE</td>');
  });

  it("列表/代码块/引用", () => {
    const out = html("- 甲\n- 乙\n\n```\ncode\n```\n\n> 引用");
    expect(out).toContain("<li>甲</li>");
    expect(out).toContain('<pre class="ai-md__pre"><code>code</code></pre>');
    expect(out).toContain("<blockquote");
  });

  it("不可信输出：HTML 转义、javascript 链接不渲染成 a", () => {
    const out = html("<img src=x onerror=alert(1)> [x](javascript:alert(1))");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("<a ");
  });

  it("http(s) 链接可点", () => {
    expect(html("[官网](https://example.com)")).toContain('href="https://example.com"');
  });
});
