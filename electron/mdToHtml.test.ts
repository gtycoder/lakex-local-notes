import { describe, expect, it } from "vitest";
import { mdToHtml, wrapHtmlPage } from "./mdToHtml.js";

describe("mdToHtml", () => {
  it("标题/段落/粗体/斜体/行内代码", () => {
    const html = mdToHtml("# 标题\n\n一段 **粗体** 和 *斜体* 以及 `code`。");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<p>一段");
  });

  it("链接与图片", () => {
    const html = mdToHtml("[百度](https://baidu.com)\n\n![图](http://127.0.0.1:19876/n/a.png)");
    expect(html).toContain('<a href="https://baidu.com">百度</a>');
    expect(html).toContain('<img src="http://127.0.0.1:19876/n/a.png" alt="图" />');
  });

  it("列表与引用", () => {
    const html = mdToHtml("- 甲\n- 乙\n\n> 引用");
    expect(html).toContain("<ul><li>甲</li><li>乙</li></ul>");
    expect(html).toContain("<blockquote>引用</blockquote>");
  });

  it("代码块原样保留且 HTML 被转义", () => {
    const html = mdToHtml("```html\n<p>你好</p>\n```");
    expect(html).toContain("<pre><code>&lt;p&gt;你好&lt;/p&gt;");
  });

  it("wrapHtmlPage 输出完整文档", () => {
    const page = wrapHtmlPage("测试", "<p>内容</p>");
    expect(page).toContain("<title>测试</title>");
    expect(page).toContain("<meta charset=\"utf-8\"");
    expect(page).toContain("<p>内容</p>");
  });
});
