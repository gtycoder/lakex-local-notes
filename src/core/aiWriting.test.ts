import { describe, expect, it } from "vitest";
import {
  AI_WRITING_DOC_CHARS,
  AI_WRITING_MAX_DOCS,
  AI_WRITING_MAX_HISTORY_TURNS,
  AI_WRITING_SYSTEM_PROMPT,
  aiWritingTitleFrom,
  buildAiWritingDocsBlock,
  buildAiWritingMessages,
  groupAiWritingHistory,
  pickAiWritingHistory,
  type AiWritingConversation,
} from "./aiWriting";

function conversation(overrides: Partial<AiWritingConversation> = {}): AiWritingConversation {
  return {
    id: "c1", mode: "chat", title: "标题", promptText: null, docRefs: [],
    createdAt: "2026-11-09T10:00:00.000Z", updatedAt: "2026-11-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("aiWritingTitleFrom", () => {
  it("取首条消息首行并去掉 Markdown 标记", () => {
    expect(aiWritingTitleFrom("## 帮我写一段周报\n\n内容")).toBe("帮我写一段周报");
    expect(aiWritingTitleFrom("- 列表项")).toBe("列表项");
    expect(aiWritingTitleFrom("> 引用开场")).toBe("引用开场");
  });
  it("超长标题截到 24 字、空输入回落", () => {
    expect(Array.from(aiWritingTitleFrom("一".repeat(40))).length).toBe(24);
    expect(aiWritingTitleFrom("   \n  ")).toBe("新的对话");
  });
});

describe("groupAiWritingHistory", () => {
  it("按今天/昨天/更早分组且组内倒序", () => {
    const now = new Date(2026, 10, 9, 12, 0, 0);
    const groups = groupAiWritingHistory([
      conversation({ id: "old", updatedAt: new Date(2026, 10, 1, 9, 0, 0).toISOString() }),
      conversation({ id: "y1", updatedAt: new Date(2026, 10, 8, 9, 0, 0).toISOString() }),
      conversation({ id: "t1", updatedAt: new Date(2026, 10, 9, 8, 0, 0).toISOString() }),
      conversation({ id: "t2", updatedAt: new Date(2026, 10, 9, 11, 0, 0).toISOString() }),
    ], now);
    expect(groups.map((group) => group.label)).toEqual(["今天", "昨天", "更早"]);
    expect(groups[0].conversations.map((item) => item.id)).toEqual(["t2", "t1"]);
  });
});

describe("buildAiWritingDocsBlock", () => {
  it("单篇超限截断并标注", () => {
    const block = buildAiWritingDocsBlock([{ title: "长文", text: "字".repeat(AI_WRITING_DOC_CHARS + 100) }]);
    expect(block).toContain("【资料 1】长文");
    expect(block).toContain("已截断");
    expect(block.length).toBeLessThan(AI_WRITING_DOC_CHARS + 200);
  });
  it("篇数上限 = " + AI_WRITING_MAX_DOCS, () => {
    const docs = Array.from({ length: AI_WRITING_MAX_DOCS + 5 }, (_, index) => ({ title: "d" + index, text: "x" }));
    const block = buildAiWritingDocsBlock(docs);
    expect(block).toContain("【资料 " + AI_WRITING_MAX_DOCS + "】");
    expect(block).not.toContain("【资料 " + (AI_WRITING_MAX_DOCS + 1) + "】");
  });
});

describe("pickAiWritingHistory", () => {
  it("只取最近 N 轮且保持正序", () => {
    const history = Array.from({ length: AI_WRITING_MAX_HISTORY_TURNS + 4 }, (_, index) => ({ role: "user" as const, content: "t" + index }));
    const picked = pickAiWritingHistory(history);
    expect(picked.length).toBe(AI_WRITING_MAX_HISTORY_TURNS);
    expect(picked[0].content).toBe("t4");
    expect(picked[picked.length - 1].content).toBe("t" + (AI_WRITING_MAX_HISTORY_TURNS + 3));
  });
});

describe("buildAiWritingMessages", () => {
  it("system 打头，历史在前、本轮在最后", () => {
    const messages = buildAiWritingMessages({
      mode: "chat",
      input: "写个周报",
      history: [{ role: "user", content: "上一轮" }, { role: "assistant", content: "上一轮回答" }],
    });
    expect(messages[0]).toEqual({ role: "system", content: AI_WRITING_SYSTEM_PROMPT });
    expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[messages.length - 1].content).toBe("写个周报");
  });

  it("提示词作为本轮要求并入用户消息；多文档模式附加资料块", () => {
    const messages = buildAiWritingMessages({
      mode: "docs",
      input: "总结",
      promptText: "请分三点",
      docs: [{ title: "资料A", text: "正文A" }],
    });
    const last = messages[messages.length - 1].content as string;
    expect(last).toContain("【要求】请分三点");
    expect(last).toContain("【参考资料】");
    expect(last).toContain("【资料 1】资料A");
    expect(last).toContain("正文A");
  });

  it("对话写作模式不带资料块", () => {
    const messages = buildAiWritingMessages({ mode: "chat", input: "你好", docs: [{ title: "A", text: "B" }] });
    expect(String(messages[messages.length - 1].content)).not.toContain("【参考资料】");
  });
});
