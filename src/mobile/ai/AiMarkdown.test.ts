import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./AiMarkdown";

describe("AI Markdown 解析（最小子集，纯数据）", () => {
  it("标题/段落/列表/引用/代码块", () => {
    const blocks = parseMarkdown("# 标题\n正文一段\n- 甲\n- 乙\n1. 一\n2. 二\n> 引用\n```\ncode\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["h", "p", "ul", "ol", "quote", "code"]);
    expect(blocks[0]).toMatchObject({ kind: "h", level: 1 });
    expect(blocks[5]).toMatchObject({ kind: "code", text: "code" });
  });

  it("行内：粗体 / 行内代码 / 链接只放行 http(s)", () => {
    const tokens = parseInline("a **b** `c` [d](https://e.com) [f](javascript:alert(1))");
    expect(tokens.some((t) => t.kind === "strong" && t.value === "b")).toBe(true);
    expect(tokens.some((t) => t.kind === "code" && t.value === "c")).toBe(true);
    expect(tokens.some((t) => t.kind === "link" && t.href === "https://e.com")).toBe(true);
    expect(tokens.some((t) => t.kind === "link" && t.href.startsWith("javascript"))).toBe(false);
  });

  it("GFM 表格：表头/对齐/单元格文字", () => {
    const blocks = parseMarkdown("| 项 | 结果 |\n| :-- | --: |\n| 通道 | 原生 SSE |\n| 缓存 | 前缀命中 |");
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as { kind: string; align: Array<string | null>; header: Array<Array<{ value: string }>>; rows: Array<Array<Array<{ value: string }>>> };
    expect(table.kind).toBe("table");
    expect(table.align).toEqual(["left", "right"]);
    expect(table.header.map((cells) => cells.map((c) => c.value).join(""))).toEqual(["项", "结果"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1].map((cells) => cells.map((c) => c.value).join(""))).toEqual(["缓存", "前缀命中"]);
  });

  it("未闭合的标记当纯文本，不吞内容", () => {
    const tokens = parseInline("**未闭合 ");
    expect(tokens.map((t) => t.value).join("")).toBe("**未闭合 ");
  });
});
