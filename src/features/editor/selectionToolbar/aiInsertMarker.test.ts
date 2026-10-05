import { describe, expect, it } from "vitest";
import { AI_INSERT_HINT, buildAiInsertMarkdown } from "./aiInsertMarker";

/**
 * AI「插入到选区后」标记护栏（261005）。
 * 用户定稿：不用引用（Lake 容器装不下表格），改成前后分隔线 + 「以下内容由 AI 生成」提示，正文原生插入。
 */
describe("buildAiInsertMarkdown", () => {
  it("分隔线 + 提示 + 正文 + 分隔线", () => {
    const out = buildAiInsertMarkdown("第一行\n第二行");
    const lines = out.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[lines.length - 1]).toBe("---");
    expect(out).toContain(AI_INSERT_HINT);
    expect(AI_INSERT_HINT).toContain("AI 生成");
    // 提示在正文之前、且是独立段落（前后有空行）
    expect(out.indexOf(AI_INSERT_HINT)).toBeLessThan(out.indexOf("第一行"));
    expect(out).toContain(AI_INSERT_HINT + "\n\n" + "第一行\n第二行");
  });

  it("规范化 CRLF 并去掉首尾空白；空输入也能得到合法标记", () => {
    expect(buildAiInsertMarkdown("  a\r\nb  ")).toContain("\n\na\nb\n\n---");
    expect(buildAiInsertMarkdown("")).toBe("---\n\n" + AI_INSERT_HINT + "\n\n\n\n---");
  });

  it("不把正文改写成引用（不再有 > 前缀）", () => {
    expect(buildAiInsertMarkdown("表格前后\n\n| a | b |")).not.toMatch(/^> /m);
  });
});
