import { describe, expect, it } from "vitest";
import { lakeHtmlToMarkdown, lakeHtmlToPlain } from "./lakeCaches.js";

describe("lakeHtmlToMarkdown（锁定态缓存兜底转换）", () => {
  it("段落与换行：<p> 分段、<br> 换行", () => {
    const html = '<p id="a"><span>第一行</span></p><p id="b"><span>第二行</span><br>续行</p>';
    expect(lakeHtmlToMarkdown(html)).toBe("第一行\n第二行\n续行");
  });

  it("剥 font/span/a 保留文本与链接文本", () => {
    const html = '<p><font style="color:#fff">红字</font><a href="https://x.com">链接</a></p>';
    expect(lakeHtmlToMarkdown(html)).toBe("红字链接");
  });

  it("codeblock 卡片：取 value JSON 的 text/plain 字段（不执行 JSON）", () => {
    const value = `data:${encodeURIComponent(JSON.stringify({ "text/plain": "const a = 1;", "data-content": "ignored" }))}`;
    const html = `<p><card type="block" name="codeblock" value="${value}"></card></p>`;
    expect(lakeHtmlToMarkdown(html)).toBe("const a = 1;");
  });

  it("codeblock 卡片无 text/plain 时回退 data-content 或剥标签文本", () => {
    const value = `data:${encodeURIComponent(JSON.stringify({ "data-content": "代码段" }))}`;
    const html = `<p><card name="codeblock" value="${value}"></card>尾</p>`;
    expect(lakeHtmlToMarkdown(html)).toBe("代码段尾");
  });

  it("未知卡片无文本时剥标签保留内部文本", () => {
    const html = '<p>前<card name="board" value="data:%7B%7D">画板占位</card>后</p>';
    expect(lakeHtmlToMarkdown(html)).toBe("前画板占位后");
  });

  it("HTML 实体解码 + 空白规整", () => {
    const html = "<p>&amp; &lt;tag&gt; &quot;q&quot; &nbsp;</p>";
    expect(lakeHtmlToMarkdown(html)).toBe('& <tag> "q"');
  });

  it("空输入返回空串", () => {
    expect(lakeHtmlToMarkdown("")).toBe("");
    expect(lakeHtmlToMarkdown("<p><br></p>")).toBe("");
  });
});

describe("lakeHtmlToPlain", () => {
  it("与 markdown 兜底同源（纯文本）", () => {
    const html = '<p><span>你好</span><a href="https://x.com">世界</a></p>';
    expect(lakeHtmlToPlain(html)).toBe("你好世界");
  });
});
