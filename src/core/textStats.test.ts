import { describe, expect, it } from "vitest";
import { countChars, countTextStats, countWords } from "./textStats.js";

describe("countWords（内核 wordCount 同语义）", () => {
  it("空串 → 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n ")).toBe(0);
  });

  it("ASCII 按空白分词", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("a  b\tc\nd")).toBe(4);
    expect(countWords("hello-world")).toBe(1);
    expect(countWords("3.14 2.71")).toBe(2);
  });

  it("非 ASCII 按字素逐个计 1", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("你好 world")).toBe(3);
    expect(countWords("Здравствуй мир")).toBe(13); // 非 ASCII：Здравствуй(10) + мир(3)
  });

  it("中文标点也计入（与内核/云端一致，与旧正则不同）", () => {
    expect(countWords("你好，世界")).toBe(5);
  });

  it("emoji 按字素计", () => {
    expect(countWords("👍")).toBe(1);
  });

  it("连字符：内核把它替换成空格后参与分词", () => {
    // 内核 DI 分支：前一个字符是空白时额外补 1；无论哪种情况，`--` 本身都会变成空格 ⇒ 形成分词边界
    expect(countWords("a -- b")).toBe(3);
    expect(countWords("a--b")).toBe(2);
    // 串首的 `--` 前一个字符不存在（内核 r[-1] 为 undefined，判空失败）⇒ 不补 1，只留分词边界
    expect(countWords("-- a")).toBe(1);
  });
});

describe("countChars", () => {
  it("去掉空白后计数", () => {
    expect(countChars("a b\nc")).toBe(3);
    expect(countChars("你好 世界")).toBe(4);
  });
});

describe("countTextStats（CORE-10：字数/字符数的唯一派生入口）", () => {
  // 两端属性页与状态栏兜底都只调它 ⇒ 下面钉住「同输入同输出」，
  // 以后谁把其中一项改成分开算，这里会先红。
  const corpus = [
    "",
    "   \n\t ",
    "hello world",
    "你好世界",
    "你好，世界\n第二段",
    "Здравствуй мир",
    "👍🏽 emoji 与中文混排",
    "a -- b",
    "# 标题\n\n- 列表\n\n> 引用",
    "3.14 2.71 %",
  ];

  it("与 countWords / countChars 逐项一致（同一输入）", () => {
    for (const text of corpus) {
      expect(countTextStats(text)).toEqual({ wordCount: countWords(text), charCount: countChars(text) });
    }
  });

  it("空/纯空白 → 0/0（属性页显示 0 而不是空白）", () => {
    expect(countTextStats("")).toEqual({ wordCount: 0, charCount: 0 });
    expect(countTextStats("  \n\t ")).toEqual({ wordCount: 0, charCount: 0 });
  });

  it("中文/emoji/连字符口径与内核同语义（与 countWords 单测同一批期望值）", () => {
    expect(countTextStats("你好，世界")).toEqual({ wordCount: 5, charCount: 5 });
    // 字符数是去掉空白后的 UTF-16 长度（现状口径，不改）：emoji 记 2。
    expect(countTextStats("👍")).toEqual({ wordCount: 1, charCount: 2 });
    expect(countTextStats("a -- b")).toEqual({ wordCount: 3, charCount: 4 });
  });
});
