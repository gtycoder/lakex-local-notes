import { describe, expect, it } from "vitest";
import { inlineToPlain, markdownToPlainText, parseInline, parseMarkdownBlocks } from "./markdown";

describe("Markdown 共用解析器（桌面 + 移动端）", () => {
  it("块级：标题/段落/代码块/引用/列表/分割线", () => {
    const blocks = parseMarkdownBlocks("# 标题\n\n正文\n\n```\ncode\n```\n\n> 引用\n\n- 甲\n  - 甲一\n\n---");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "code", "quote", "list", "hr"]);
    expect(blocks[4]).toMatchObject({ kind: "list", ordered: false });
    const list = blocks[4] as { items: Array<{ text: string; children: Array<{ text: string }> }> };
    expect(list.items[0].text).toBe("甲");
    expect(list.items[0].children[0].text).toBe("甲一");
  });

  it("GFM 表格：表头 / 对齐 / 行", () => {
    const blocks = parseMarkdownBlocks("| 项 | 结果 |\n| :-- | --: |\n| 通道 | 原生 SSE |\n| 缓存 | 前缀命中 |");
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as { kind: string; align: Array<string | null>; header: string[]; rows: string[][] };
    expect(table.kind).toBe("table");
    expect(table.align).toEqual(["left", "right"]);
    expect(table.header).toEqual(["项", "结果"]);
    expect(table.rows).toEqual([["通道", "原生 SSE"], ["缓存", "前缀命中"]]);
  });

  it("表格不会吞掉后面的段落", () => {
    const blocks = parseMarkdownBlocks("| a |\n| --- |\n| 1 |\n\n后续段落");
    expect(blocks.map((b) => b.kind)).toEqual(["table", "paragraph"]);
  });

  it("行内：粗体/斜体/删除线/代码/链接（递归）", () => {
    const tokens = parseInline("**粗** 与 *斜* 与 ~~删~~ 与 `code` 与 [官网](https://a.b)");
    expect(tokens.some((t) => t.type === "strong")).toBe(true);
    expect(tokens.some((t) => t.type === "em")).toBe(true);
    expect(tokens.some((t) => t.type === "del")).toBe(true);
    expect(tokens.some((t) => t.type === "code" && t.text === "code")).toBe(true);
    const link = tokens.find((token): token is Extract<typeof tokens[number], { type: "link" }> => token.type === "link");
    expect(link?.href).toBe("https://a.b");
    expect(inlineToPlain(link?.children ?? [])).toBe("官网");
  });

  it("纯文本预览：去标记、列表用 · 分隔", () => {
    expect(markdownToPlainText("# 标题\n\n这是 **粗** 与 [官网](https://a.b)\n\n- 甲\n- 乙")).toBe("标题 这是 粗 与 官网 甲 · 乙");
    expect(markdownToPlainText("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe("a b 1 2");
    expect(markdownToPlainText("")).toBe("");
  });
});
