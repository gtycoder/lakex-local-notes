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
describe("mdToHtml 危险协议过滤", () => {
  it("javascript: 链接降级为纯文本，不生成 <a>", () => {
    const html = mdToHtml("[点我](javascript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).toContain("点我");
  });

  it("data:/file:/vbscript: 链接同样被拦截", () => {
    expect(mdToHtml("[a](data:text/html,x)")).not.toContain("<a");
    expect(mdToHtml("[a](file:///etc/passwd)")).not.toContain("<a");
  });

  it("http/https/mailto 链接正常保留", () => {
    expect(mdToHtml("[官网](https://example.com)")).toContain('<a href="https://example.com">官网</a>');
    expect(mdToHtml("[邮件](mailto:a@b.c)")).toContain("<a");
    expect(mdToHtml("[相对](./x.md)")).toContain('<a href="./x.md">相对</a>');
  });

  it("javascript: 图片被丢弃，http 与 data:image 图片保留", () => {
    expect(mdToHtml("![x](javascript:alert(1))")).not.toContain("<img");
    expect(mdToHtml("![x](https://example.com/a.png)")).toContain('<img src="https://example.com/a.png"');
    expect(mdToHtml("![x](data:image/png;base64,AAAA)")).toContain('<img src="data:image/png;base64,AAAA"');
  });
});