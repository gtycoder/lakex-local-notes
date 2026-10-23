import { describe, expect, it } from "vitest";
import { AI_CORPUS_BEGIN, AI_CORPUS_END, buildAiCorpusBlock, buildAiSystemPrompt } from "./aiCorpus";

const doc = (title: string, text: string, totalChars = text.length, takenChars = text.length, truncated = false) =>
  ({ title, text, totalChars, takenChars, truncated });

describe("AI 资料块（固定前缀，必须逐字节稳定）", () => {
  it("空资料 ⇒ 空字符串（调用方不注入资料消息）", () => {
    expect(buildAiCorpusBlock([])).toBe("");
  });

  it("单篇：带标题/字数/起止标记", () => {
    const block = buildAiCorpusBlock([doc("周报", "本周完成 A。")]);
    expect(block.startsWith(AI_CORPUS_BEGIN)).toBe(true);
    expect(block.endsWith(AI_CORPUS_END)).toBe(true);
    expect(block).toContain("共 1 篇");
    expect(block).toContain("《周报》（" + "本周完成 A。".length + " 字）");
    expect(block).toContain("本周完成 A。");
  });

  it("多篇：顺序与编号稳定，截断标注节选", () => {
    const block = buildAiCorpusBlock([
      doc("A", "aaa", 10, 3, true),
      doc("B", "bbb"),
    ]);
    expect(block).toContain("共 2 篇 · 约 6 字");
    expect(block).toContain("【资料 1/2】《A》（10 字，节选前 3 字）");
    expect(block).toContain("【资料 2/2】《B》（3 字）");
    expect(block.indexOf("《A》")).toBeLessThan(block.indexOf("《B》"));
  });

  it("同样入参永远得到同样字节串（缓存前提）", () => {
    const docs = [doc("A", "aa"), doc("B", "bb")];
    expect(buildAiCorpusBlock(docs)).toBe(buildAiCorpusBlock(docs));
  });

  it("系统提示按有无资料切换规则措辞", () => {
    const withCorpus = buildAiSystemPrompt("BASE", true);
    const without = buildAiSystemPrompt("BASE", false);
    expect(withCorpus.startsWith("BASE")).toBe(true);
    expect(withCorpus).toContain("资料规则");
    expect(without).toContain("本轮没有提供资料");
    expect(without).not.toContain("资料规则");
  });
});
