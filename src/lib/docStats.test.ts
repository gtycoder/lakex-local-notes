import { describe, expect, it } from "vitest";
import { computeDocStats } from "./docStats";

describe("computeDocStats", () => {
  it("空内容 → 0/0", () => {
    expect(computeDocStats("")).toEqual({ wordCount: 0, imageCount: 0 });
  });

  it("纯文本段落统计可见字符（去标签/解码实体/去首尾空白）", () => {
    const stats = computeDocStats("<p>  你好&nbsp;world &amp; more  </p>");
    expect(stats.wordCount).toBe("你好 world & more".length);
    expect(stats.imageCount).toBe(0);
  });

  it("image card 计数（含属性顺序差异）", () => {
    const content = '<card name="image" data-x="1"></card><p>x</p><card data-y="2" name="image" />';
    expect(computeDocStats(content).imageCount).toBe(2);
  });

  it("非 image card 不计数", () => {
    const content = '<card name="board"></card><card name="codeblock"></card>';
    expect(computeDocStats(content).imageCount).toBe(0);
  });

  it("嵌套标签只保留文本", () => {
    expect(computeDocStats("<div><p>a<b>b</b></p></div>").wordCount).toBe(2);
  });
});
