import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AiWritingRepository } from "./aiWritingRepository.js";
import type { DbLike } from "./dbLike.js";

const SCHEMA = `
CREATE TABLE ai_writing_conversations (
  id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'chat', title TEXT NOT NULL,
  prompt_text TEXT, doc_refs TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE ai_writing_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '', reasoning TEXT, duration_ms INTEGER,
  stopped INTEGER NOT NULL DEFAULT 0, error TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX ai_writing_messages_conversation ON ai_writing_messages(conversation_id, sort_order);
`;

function makeRepo() {
  const raw = new Database(":memory:");
  raw.exec(SCHEMA);
  return { raw, repo: new AiWritingRepository(raw as unknown as DbLike) };
}

describe("AiWritingRepository", () => {
  it("建会话 + 追加消息：排序自增、updated_at 推新", () => {
    const { repo } = makeRepo();
    const conversation = repo.createConversation({ mode: "chat", title: "周报" });
    expect(conversation.mode).toBe("chat");
    expect(repo.listConversations().map((item) => item.id)).toEqual([conversation.id]);

    const first = repo.appendMessage({ conversationId: conversation.id, role: "user", content: "写周报" });
    const second = repo.appendMessage({ conversationId: conversation.id, role: "assistant", content: "好的" });
    expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);

    const reloaded = repo.getConversation(conversation.id)!;
    expect(reloaded.updatedAt >= conversation.updatedAt).toBe(true);
    expect(repo.listMessages(conversation.id).map((message) => message.content)).toEqual(["写周报", "好的"]);
  });

  it("回填思考/耗时/停止/错误", () => {
    const { repo } = makeRepo();
    const conversation = repo.createConversation({ mode: "docs", title: "总结" });
    const message = repo.appendMessage({ conversationId: conversation.id, role: "assistant", content: "" });
    const updated = repo.updateMessage(message.id, { content: "片段", reasoning: "思考中", durationMs: 1200, stopped: true })!;
    expect(updated.content).toBe("片段");
    expect(updated.reasoning).toBe("思考中");
    expect(updated.durationMs).toBe(1200);
    expect(updated.stopped).toBe(true);
    expect(repo.updateMessage("missing", { content: "x" })).toBeNull();
  });

  it("输入卡状态（提示词/文档 chip）可保存并恢复", () => {
    const { repo } = makeRepo();
    const conversation = repo.createConversation({
      mode: "docs", title: "t", promptText: "分三点",
      docRefs: [{ kind: "note", id: "n1", title: "资料" }],
    });
    expect(conversation.docRefs).toEqual([{ kind: "note", id: "n1", title: "资料" }]);
    const patched = repo.updateConversationComposer(conversation.id, { docRefs: [{ kind: "quick-note", id: "q1", title: "小记" }], promptText: null })!;
    expect(patched.promptText).toBeNull();
    expect(patched.docRefs[0].kind).toBe("quick-note");
  });

  it("重命名 / 删除级联 / 删最后一条助手消息（重新生成）", () => {
    const { raw, repo } = makeRepo();
    const conversation = repo.createConversation({ mode: "chat", title: "旧名" });
    repo.appendMessage({ conversationId: conversation.id, role: "user", content: "问" });
    repo.appendMessage({ conversationId: conversation.id, role: "assistant", content: "答" });
    expect(repo.renameConversation(conversation.id, "新名")!.title).toBe("新名");

    repo.deleteLastAssistantMessage(conversation.id);
    expect(repo.listMessages(conversation.id).map((message) => message.role)).toEqual(["user"]);

    repo.deleteConversation(conversation.id);
    expect(repo.getConversation(conversation.id)).toBeNull();
    const left = raw.prepare("SELECT COUNT(*) AS n FROM ai_writing_messages").get() as { n: number };
    expect(left.n).toBe(0);
  });

  it("历史列表按最近更新倒序", () => {
    const { repo } = makeRepo();
    const older = repo.createConversation({ mode: "chat", title: "旧" });
    const newer = repo.createConversation({ mode: "chat", title: "新" });
    repo.appendMessage({ conversationId: older.id, role: "user", content: "更新它" });
    expect(repo.listConversations()[0].id).toBe(older.id);
    expect(repo.listConversations().map((item) => item.title)).toContain(newer.title);
  });
});
