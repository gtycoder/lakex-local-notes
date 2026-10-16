import { describe, expect, it } from "vitest";
import { computeDocStats, kernelWordCount, resolveDocStats } from "./docStats.js";

describe("computeDocStats（正文兜底：内核 wordCount 同语义）", () => {
  it("空内容 → 0/0", () => {
    expect(computeDocStats("")).toEqual({ wordCount: 0, imageCount: 0 });
  });

  it("段落按词/字素统计（不再是字符数）", () => {
    // 旧口径是去标签后的字符数（17）；261016 起与内核一致：你好(2) + world(1) + &(1) + more(1)
    expect(computeDocStats("<p>  你好&nbsp;world &amp; more  </p>").wordCount).toBe(5);
  });

  it("image card 计数（含属性顺序差异）", () => {
    const content = '<card name="image" data-x="1"></card><p>x</p><card data-y="2" name="image" />';
    expect(computeDocStats(content).imageCount).toBe(2);
  });

  it("非 image card 不计数", () => {
    const content = '<card name="board"></card><card name="codeblock"></card>';
    expect(computeDocStats(content).imageCount).toBe(0);
  });

  it("嵌套标签只保留文本（行内标签拼接不产生分词边界）", () => {
    // a<b>b</b> → 纯文本 "ab" ⇒ 1 个词（旧口径按字符数是 2）
    expect(computeDocStats("<div><p>a<b>b</b></p></div>").wordCount).toBe(1);
  });
});

describe("kernelWordCount", () => {
  it("内核返回值优先", () => {
    expect(kernelWordCount({ queryCommandValue: () => 42 })).toBe(42);
  });

  it("非数值/缺失/抛错 → null", () => {
    expect(kernelWordCount(null)).toBeNull();
    expect(kernelWordCount({})).toBeNull();
    expect(kernelWordCount({ queryCommandValue: () => undefined })).toBeNull();
    expect(kernelWordCount({ queryCommandValue: () => "abc" })).toBeNull();
    expect(kernelWordCount({ queryCommandValue: () => { throw new Error("viewer"); } })).toBeNull();
  });
});

describe("resolveDocStats", () => {
  it("内核值 > 0 时直接采用（不再解析正文）", () => {
    expect(resolveDocStats(7, "<p>你好 world</p>")).toEqual({ wordCount: 7, imageCount: 0 });
  });

  it("内核返回 0 而正文非空 → 正文兜底（防切文档闪 0）", () => {
    expect(resolveDocStats(0, "<p>你好 world</p>").wordCount).toBe(3);
  });

  it("内核为 null → 正文兜底；图片数照常", () => {
    const stats = resolveDocStats(null, '<p>你好</p><card name="image"></card>');
    expect(stats).toEqual({ wordCount: 2, imageCount: 1 });
  });
});
