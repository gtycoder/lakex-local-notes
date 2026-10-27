import { describe, expect, it } from "vitest";
import {
  AI_CONVERSATION_MAX_BYTES,
  AI_CONVERSATION_TTL_MS,
  conversationPreview,
  conversationTitle,
  parseConversation,
  parseLegacyConversation,
  serializeConversation,
  type ConversationSnapshot,
} from "./aiConversationPersist";

const snap = (overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-10-23T00:00:00.000Z",
  corpus: [{ id: "d1", title: "文档", text: "正文".repeat(50), totalChars: 200 }],
  sendIds: ["d1"],
  messages: [
    { role: "user", text: "总结一下这篇文档" },
    { role: "assistant", text: "好的，共 3 个要点。" },
  ],
  ...overrides,
});

describe("AI 历史对话（多会话）序列化", () => {
  it("往返：id/消息/资料快照/发送清单；meta 带标题与预览", () => {
    const out = serializeConversation(snap())!;
    expect(out).toBeTruthy();
    expect(out.meta.title).toBe("总结一下这篇文档");
    expect(out.meta.preview).toContain("总结一下这篇文档");
    expect(out.meta.messageCount).toBe(2);
    expect(out.meta.docs).toEqual([{ id: "d1", title: "文档" }]);
    const parsed = parseConversation(out.json)!;
    expect(parsed.id).toBe(snap().id);
    expect(parsed.corpus[0].title).toBe("文档");
    expect(parsed.messages[1].text).toBe("好的，共 3 个要点。");
  });

  it("流式中的半截回复存为「已停止」", () => {
    const out = serializeConversation(snap({ messages: [{ role: "user", text: "问" }, { role: "assistant", text: "半截", streaming: true }] }))!;
    expect(parseConversation(out.json)!.messages[1]).toMatchObject({ text: "半截", stopped: true });
  });

  it("消息图片引用往返（不把 base64 塞进 JSON）", () => {
    const ref = { id: "11111111-1111-4111-8111-111111111111", mime: "image/png", ext: "png" };
    const out = serializeConversation(snap({ messages: [{ role: "user", text: "看图\n[图片]", images: [ref] }, { role: "assistant", text: "红色" }] }))!;
    expect(out.json).not.toContain("base64");
    const parsed = parseConversation(out.json)!;
    expect(parsed.messages[0].images).toEqual([ref]);
  });

  it("非法图片引用被丢弃", () => {
    const out = serializeConversation(snap({ messages: [{ role: "user", text: "x", images: [{ id: "../evil", mime: "image/png", ext: "png" }] }] }))!;
    expect(parseConversation(out.json)!.messages[0].images).toBeUndefined();
  });

  it("空会话 / 超大（>2MiB）不落盘", () => {
    expect(serializeConversation({ id: "x".repeat(8), createdAt: new Date().toISOString(), corpus: [], sendIds: [], messages: [] })).toBeNull();
    expect(serializeConversation(snap({ messages: [{ role: "user", text: "x".repeat(AI_CONVERSATION_MAX_BYTES) }] }))).toBeNull();
  });

  it("过期 / 版本不符 / 损坏 ⇒ null", () => {
    const out = serializeConversation(snap())!;
    expect(parseConversation(out.json, Date.now() + AI_CONVERSATION_TTL_MS + 1000)).toBeNull();
    expect(parseConversation("{bad")).toBeNull();
    expect(parseConversation(JSON.stringify({ v: 99 }))).toBeNull();
  });

  it("v1 旧文件可迁移（生成 id/createdAt，标题从消息推导）", () => {
    const legacy = JSON.stringify({
      v: 1,
      updatedAt: "2026-10-23T00:00:00.000Z",
      corpus: [{ id: "d1", title: "文档", text: "正文", totalChars: 2 }],
      sendIds: ["d1"],
      messages: [{ role: "user", text: "旧对话" }, { role: "assistant", text: "旧回答" }],
    });
    const migrated = parseLegacyConversation(legacy, "22222222-2222-4222-8222-222222222222")!;
    expect(migrated.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(migrated.createdAt).toBe("2026-10-23T00:00:00.000Z");
    expect(migrated.title).toBe("旧对话");
  });

  it("标题/预览派生", () => {
    expect(conversationTitle([{ role: "user", text: "  第一行\n第二行  " }])).toBe("第一行 第二行");
    expect(conversationTitle([{ role: "assistant", text: "hi" }])).toBe("AI 对话");
    expect(conversationPreview([{ role: "user", text: "问" }, { role: "assistant", text: "答" }])).toBe("问 答");
  });
});
