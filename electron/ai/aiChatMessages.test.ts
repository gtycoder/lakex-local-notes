import { describe, expect, it } from "vitest";
import { AI_MAX_MESSAGES, AI_MAX_TOTAL_CHARS, assertMessages } from "./aiChatMessages.js";

/**
 * AI 对话消息护栏（261005）。
 * 修的问题：原来取**最前面** 40 条，长对话超过上限时把**最新的问答**丢掉（表现为"突然失忆/答非所问"）。
 * 现在保留**最近 40 条** ⇒ 当前这轮提问一定在。
 */
describe("assertMessages：保留最近 N 条", () => {
  it("超过 40 条时丢掉最前面的，保留最新 40 条（当前提问一定在）", () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: "m" + i }));
    const out = assertMessages(raw);
    expect(out).toHaveLength(AI_MAX_MESSAGES);
    expect(out[0].content).toBe("m10");              // m0..m9 被丢掉
    expect(out[out.length - 1].content).toBe("m49"); // 最新的还在
  });

  it("不超过上限时全量保留", () => {
    expect(assertMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]))
      .toEqual([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
  });

  it("角色归一：未知角色当 user，system/assistant 保留；空内容跳过", () => {
    const out = assertMessages([
      { role: "system", content: "s" },
      { role: "tool", content: "x" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "a" },
    ]);
    expect(out).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "x" },
      { role: "assistant", content: "a" },
    ]);
  });

  it("坏输入 / 全空 / 超长分别报错", () => {
    expect(() => assertMessages([])).toThrow();
    expect(() => assertMessages("nope")).toThrow();
    expect(() => assertMessages([{ role: "user", content: "" }])).toThrow();
    expect(() => assertMessages([{ role: "user", content: "x".repeat(AI_MAX_TOTAL_CHARS + 1) }])).toThrow(/内容过长/);
  });
});
