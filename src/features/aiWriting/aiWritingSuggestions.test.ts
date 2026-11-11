/**
 * 空态「点一点试试」的护栏（261111 用户定稿）。
 *
 * 三条约定写成用例，防止后续加场景时又混进「需要用户先提供上下文」的项：
 * ① 用户点名的 9 个必须在、顺序不许乱；
 * ② label 必须很短（chip 一行放得下、换行整齐，≤14 字）；
 * ③ 不许出现需要用户先给素材才能跑的指令（「把这段话…」「改写下文…」这类）；
 * ④ docs 模式每条 prompt 必须写明「只依据资料 / 不要编造」。
 */
import { describe, expect, it } from "vitest";
import { AI_WRITING_SUGGESTIONS } from "./aiWritingPrompts";

const USER_PICKED = ["今日信息差", "推荐一本新书", "金融行业要闻", "科技行业要闻", "时政要闻", "每天一个心理学知识", "每天了解一段历史", "今日新闻热榜", "AI最新进展"];

describe("AI 写作空态建议", () => {
  it("用户点名的 9 个在对话模式里，且保持这个顺序在前", () => {
    expect(AI_WRITING_SUGGESTIONS.chat.slice(0, USER_PICKED.length).map((item) => item.label)).toEqual(USER_PICKED);
  });

  it("label 短（≤14 字）且不重复；prompt 都非空", () => {
    for (const mode of ["chat", "docs"] as const) {
      const labels = AI_WRITING_SUGGESTIONS[mode].map((item) => item.label);
      expect(new Set(labels).size, mode + " 有重复 label").toBe(labels.length);
      for (const item of AI_WRITING_SUGGESTIONS[mode]) {
        expect(Array.from(item.label).length, item.label + " 太长").toBeLessThanOrEqual(14);
        expect(item.prompt.trim().length, item.label + " prompt 为空").toBeGreaterThan(0);
      }
    }
  });

  it("不许「需要用户先给上下文」的场景（没有素材就跑不了）", () => {
    const banned = ["把这段话", "改写下文", "下面这段", "粘贴", "输入的内容"];
    for (const item of AI_WRITING_SUGGESTIONS.chat) {
      for (const word of banned) {
        expect(item.label + item.prompt).not.toContain(word);
      }
    }
  });

  it("多文档模式每条都写明只依据资料、不要编造", () => {
    for (const item of AI_WRITING_SUGGESTIONS.docs) {
      expect(item.prompt, item.label).toMatch(/只依据资料|不要编造|资料里没有|资料没写|不要添加|不要补充/);
    }
    expect(AI_WRITING_SUGGESTIONS.docs.length).toBeGreaterThanOrEqual(6);
  });
});