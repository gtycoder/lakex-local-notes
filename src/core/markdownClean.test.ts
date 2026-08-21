import { describe, expect, it } from "vitest";
import { cleanLakeMarkdown } from "./markdownClean.js";

describe("cleanLakeMarkdown", () => {
  it("剥掉 font/span 标签并保留内部文本", () => {
    const md = '# <font style="color:rgb(25, 27, 31);">标题</font>\n[<font style="color:rgb(25, 27, 31);">链接文字</font>](https://x.com)';
    expect(cleanLakeMarkdown(md)).toBe("# 标题\n[链接文字](https://x.com)");
  });

  it("span 标签同样清除", () => {
    expect(cleanLakeMarkdown("<span style=\"color:#fff\">文本</span>")).toBe("文本");
  });

  it("代码块内部原样保留", () => {
    const md = "```html\n<font color=\"red\">字面量</font>\n```";
    expect(cleanLakeMarkdown(md)).toBe(md);
  });

  it("图片引用不受影响", () => {
    const md = "![](http://127.0.0.1:19876/n/1.png)";
    expect(cleanLakeMarkdown(md)).toBe(md);
  });
});