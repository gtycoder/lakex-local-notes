import { describe, expect, it } from "vitest";
import {
  AI_CONVERSATION_TTL_MS,
  parseConversation,
  serializeConversation,
  type ConversationSnapshot,
} from "./aiConversationPersist";

const snapshot = (overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
  corpus: [{ id: "d1", title: "文档", text: "正文".repeat(50), totalChars: 200 }],
  sendIds: ["d1"],
  messages: [
    { role: "user", text: "总结一下" },
    { role: "assistant", text: "好的" },
  ],
  ...overrides,
});

describe("AI 会话持久化（只保留最近一次）", () => {
  it("往返：消息 + 资料快照 + 发送清单", () => {
    const raw = serializeConversation(snapshot());
    expect(raw).toBeTruthy();
    const parsed = parseConversation(raw)!;
    expect(parsed.corpus[0].title).toBe("文档");
    expect(parsed.sendIds).toEqual(["d1"]);
    expect(parsed.messages.map((m) => m.text)).toEqual(["总结一下", "好的"]);
  });

  it("流式中的半截回复存为「已停止」", () => {
    const raw = serializeConversation(snapshot({ messages: [{ role: "user", text: "问" }, { role: "assistant", text: "半截", streaming: true }] }));
    expect(parseConversation(raw)!.messages[1]).toMatchObject({ text: "半截", stopped: true });
  });

  it("空会话不落盘（返回 null）", () => {
    expect(serializeConversation({ corpus: [], sendIds: [], messages: [] })).toBeNull();
  });

  it("过期（>30 天）视为无效", () => {
    const raw = serializeConversation(snapshot())!;
    expect(parseConversation(raw, Date.now() + AI_CONVERSATION_TTL_MS + 1000)).toBeNull();
  });

  it("版本不符 / 损坏 JSON / 超限 ⇒ null", () => {
    expect(parseConversation("{bad json")).toBeNull();
    expect(parseConversation(JSON.stringify({ v: 999, updatedAt: new Date().toISOString(), corpus: [], sendIds: [], messages: [] }))).toBeNull();
    expect(parseConversation(null)).toBeNull();
  });

  it("sendIds 只保留仍存在的资料", () => {
    const raw = serializeConversation(snapshot({ sendIds: ["d1", "gone"] }))!;
    expect(parseConversation(raw)!.sendIds).toEqual(["d1"]);
  });
});
