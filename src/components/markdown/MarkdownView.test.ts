import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView, markdownToPlainText, parseMarkdownBlocks } from "./MarkdownView";

function html(source: string): string {
  return renderToStaticMarkup(createElement(MarkdownView, { source }));
}

describe("Markdown 轻量子集渲染（261004）", () => {
  it("渲染出的作用域类 = 排版 CSS 的单一来源（.md-preview，261005 从 bitable 提出）", () => {
    expect(html("文字")).toContain('class="md-preview"');
  });

  it("标题 / 段落 / 粗斜体 / 删除线 / 行内代码", () => {
    const out = html("# 标题\n\n这是 **粗** 与 *斜* 与 ~~删~~ 与 `code`");
    expect(out).toContain("<h1>标题</h1>");
    expect(out).toContain("<strong>粗</strong>");
    expect(out).toContain("<em>斜</em>");
    expect(out).toContain("<del>删</del>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain("<p>");
  });

  it("代码块 / 引用 / 列表（含嵌套）/ 分割线", () => {
    const out = html("```\nconst a = 1;\n```\n\n> 引用一\n> 引用二\n\n- 一\n- 二\n  - 二一\n\n---\n");
    expect(out).toContain("<pre><code>const a = 1;</code></pre>");
    expect(out).toContain("<blockquote><p>引用一</p><p>引用二</p></blockquote>");
    expect(out).toContain("<li>一</li>");
    expect(out).toContain("<li>二<ul><li>二一</li></ul></li>");
    expect(out).toContain("<hr/>");
  });

  it("有序列表；链接只认 http(s)（其它一律文本）", () => {
    expect(html("1. 甲\n2. 乙")).toContain("<ol><li>甲</li><li>乙</li></ol>");
    expect(html("[官网](https://example.com/a)")).toContain('<a href="https://example.com/a"');
    const unsafe = html("[x](javascript:alert(1))");
    expect(unsafe).not.toContain("<a");
  });

  it("HTML 原样转义（不用 innerHTML，AI 输出不可信）", () => {
    const out = html("<img src=x onerror=alert(1)>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("markdownToPlainText：去标记的单行预览", () => {
    expect(markdownToPlainText("# 标题\n\n这是 **粗** 与 [官网](https://a.b)\n\n- 甲\n- 乙")).toBe("标题 这是 粗 与 官网 甲 · 乙");
    expect(markdownToPlainText("```\ncode line\n```")).toBe("code line");
    expect(markdownToPlainText("")).toBe("");
  });

  it("parseMarkdownBlocks：有序/无序相邻不同型拆块", () => {
    const blocks = parseMarkdownBlocks("- 甲\n\n1. 乙");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "list"]);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
  });
});