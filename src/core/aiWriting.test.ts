import { describe, expect, it } from "vitest";
import {
  AI_WRITING_DOC_CHARS,
  AI_WRITING_MAX_DOCS,
  AI_WRITING_MAX_ATTACHMENTS,
  AI_WRITING_MAX_HISTORY_TURNS,
  AI_WRITING_SYSTEM_PROMPT,
  AI_WRITING_MODE_CAPABILITIES,
  aiWritingAttachmentErrorHint,
  aiWritingAttachmentModeError,
  aiWritingModeCapabilities,
  aiWritingTitleFrom,
  filterAiWritingAttachmentsForMode,
  normalizeAiWritingAttachments,
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

describe("AI 写作图片附件（261116 Phase 1）", () => {
  const ref = (filename: string, noteId = "n1") => ({ noteId, filename });

  it("附件只挂本轮 user：text 在前、image 在后；历史轮仍是纯文本（不重发旧图）", () => {
    const messages = buildAiWritingMessages({
      mode: "chat",
      input: "这是什么",
      history: [{ role: "user", content: "上一轮问题" }, { role: "assistant", content: "上一轮回答" }],
      attachments: [ref("a.png"), ref("b.jpg")],
    });
    const historyTurns = messages.slice(1, -1);
    expect(historyTurns.every((message) => typeof message.content === "string")).toBe(true);
    expect(messages[messages.length - 1].content).toEqual([
      { type: "text", text: "这是什么" },
      { type: "image", asset: ref("a.png") },
      { type: "image", asset: ref("b.jpg") },
    ]);
  });

  it("归一附件：坏项丢弃、同文档同文件去重、上限截断到 AI_MAX_IMAGES", () => {
    const raw = [
      { noteId: "n1", filename: "a.png" },
      { noteId: "n1", filename: "a.png" },
      { noteId: "", filename: "x.png" },
      { noteId: "n2" },
      { noteId: "n2", filename: "b.png", name: "封面" },
    ];
    expect(normalizeAiWritingAttachments(raw)).toEqual([
      { noteId: "n1", filename: "a.png" },
      { noteId: "n2", filename: "b.png", name: "封面" },
    ]);
    const many = Array.from({ length: AI_WRITING_MAX_ATTACHMENTS + 3 }, (_, index) => ({ noteId: "n", filename: index + ".png" }));
    expect(normalizeAiWritingAttachments(many).length).toBe(AI_WRITING_MAX_ATTACHMENTS);
  });

  it("带图失败的提示：只在 400/参数类错误后追加，且不点名任何具体模型", () => {
    const hinted = aiWritingAttachmentErrorHint("请求参数有误（检查模型名与温度）：400 invalid_request_error", 2);
    expect(hinted).toContain("请求参数有误");
    expect(hinted).toContain("本次带了 2 个附件");
    expect(hinted).toContain("支持视觉的模型");
    expect(aiWritingAttachmentErrorHint("网络不可达：检查网络或 Base URL", 2)).toBe("网络不可达：检查网络或 Base URL");
    expect(aiWritingAttachmentErrorHint(null, 2)).toBeNull();
    expect(aiWritingAttachmentErrorHint("请求参数有误", 0)).toBe("请求参数有误");
  });
});

describe("AI 写作模式判据表（261116 第四稿）", () => {
  const localRef = { kind: "local" as const, token: "t1", name: "main.ts", size: 12, mimeType: "text/plain" };
  const docA = { kind: "note" as const, id: "n1", title: "文档 A" };
  const assetA = { noteId: "n1", filename: "a.png" };
  const assetB = { noteId: "n2", filename: "b.png" };

  it("表是单一来源：chat 不选文档、两类附件都可用；docs 必须选文档、只允许所选文档资产", () => {
    expect(AI_WRITING_MODE_CAPABILITIES).toEqual({
      chat: { docs: false, docAssets: true, localFiles: true, attachmentsLimitedToDocs: false },
      docs: { docs: true, docAssets: true, localFiles: false, attachmentsLimitedToDocs: true },
    });
    expect(aiWritingModeCapabilities("chat").localFiles).toBe(true);
    expect(aiWritingModeCapabilities("docs").localFiles).toBe(false);
  });

  it("请求组装按模式过滤：chat 收资产图 + 本机文件；docs 只收已选文档的资产图", () => {
    const chat = buildAiWritingMessages({ mode: "chat", input: "看看这些", attachments: [assetA, assetB, localRef] });
    expect(chat[chat.length - 1].content).toEqual([
      { type: "text", text: "看看这些" },
      { type: "image", asset: assetA },
      { type: "image", asset: assetB },
      { type: "local_file", file: localRef },
    ]);
    const docs = buildAiWritingMessages({
      mode: "docs",
      input: "问答",
      docs: [{ title: "文档 A", text: "正文" }],
      docRefs: [docA],
      attachments: [assetA, assetB, localRef],
    });
    expect(docs[docs.length - 1].content).toEqual([
      { type: "text", text: "问答\n\n【参考资料】\n【资料 1】文档 A\n正文" },
      { type: "image", asset: assetA },
    ]);
  });

  it("filter 与 IPC 判据一致：docs 混入本机文件给出可执行错误", () => {
    expect(filterAiWritingAttachmentsForMode("docs", [assetB, localRef], [docA])).toEqual([]);
    expect(filterAiWritingAttachmentsForMode("chat", [assetB, localRef], [])).toEqual([assetB, localRef]);
    expect(aiWritingAttachmentModeError("docs", [localRef], [docA])).toContain("不能混入本机文件");
    expect(aiWritingAttachmentModeError("docs", [assetB], [docA])).toContain("必须来自已选文档");
    expect(aiWritingAttachmentModeError("chat", [assetB, localRef], [])).toBeNull();
  });
});
