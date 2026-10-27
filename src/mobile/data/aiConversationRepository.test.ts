import { describe, expect, it } from "vitest";
import { AI_CONVERSATION_MAX_AGE_MS, pickPruneIds, type AiConversationMeta } from "./aiConversationRepository";

const meta = (id: string, updatedAt: string): AiConversationMeta => ({
  id, title: id, preview: "", createdAt: updatedAt, updatedAt, messageCount: 1, bytes: 1, docs: [],
});

describe("AI 历史淘汰（纯函数）", () => {
  it("超过 50 条时淘汰最旧的", () => {
    const now = Date.parse("2026-10-23T00:00:00.000Z");
    const metas = Array.from({ length: 52 }, (_, i) => meta("c" + i, new Date(now - i * 1000).toISOString()));
    expect(pickPruneIds(metas, now)).toEqual(["c50", "c51"]);
  });

  it("超过 30 天的淘汰，不论条数", () => {
    const now = Date.parse("2026-10-23T00:00:00.000Z");
    const metas = [meta("fresh", new Date(now - 1000).toISOString()), meta("old", new Date(now - AI_CONVERSATION_MAX_AGE_MS - 1000).toISOString())];
    expect(pickPruneIds(metas, now)).toEqual(["old"]);
  });
});
