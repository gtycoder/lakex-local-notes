import { describe, expect, it } from "vitest";
import type { DeletionIntent } from "../../s3v3Intent.js";
import { addDeleteIntent, addRestoreIntent, emptyIntentLog, pendingPurgeIds, settlePublished, settleUnpublished, type IntentLogState } from "./intentLog.js";

const EPOCH = "11111111-1111-4111-8111-111111111111";
const intent = (noteId: string, generation: number, over: Partial<DeletionIntent> = {}): DeletionIntent => ({
  noteId, targetEpoch: EPOCH, targetGeneration: generation, ...over,
});
const withIntents = (intents: DeletionIntent[], restorePending: string[] = []): IntentLogState => ({ intents, restorePending });

describe("E2-3 IntentLog：add 段", () => {
  it("空日志基线", () => {
    expect(emptyIntentLog()).toEqual({ intents: [], restorePending: [] });
    expect(pendingPurgeIds(emptyIntentLog())).toEqual([]);
  });

  it("彻底删除记意图；同 id 重复删只留最新世代（幂等）", () => {
    const a = addDeleteIntent(emptyIntentLog(), { noteId: "n", epoch: EPOCH, generation: 3 });
    const b = addDeleteIntent(a, { noteId: "n", epoch: EPOCH, generation: 4, purgedAt: "2026-10-28T00:00:00.000Z" });
    expect(b.intents).toHaveLength(1);
    expect(b.intents[0].targetGeneration).toBe(4);
    expect(b.intents[0].purgedAt).toBe("2026-10-28T00:00:00.000Z");
    expect(pendingPurgeIds(b)).toEqual(["n"]);
  });

  it("显式恢复撤掉同 id 的删除意图（恢复是唯一提前清除条件）", () => {
    const a = addDeleteIntent(emptyIntentLog(), { noteId: "n", epoch: EPOCH, generation: 3 });
    const b = addRestoreIntent(a, "n");
    expect(b.intents).toEqual([]);
    expect(b.restorePending).toEqual(["n"]);
    expect(addRestoreIntent(b, "n").restorePending).toEqual(["n"]); // 幂等
  });

  it("删除动作会清掉 pending 的恢复标记（后写者胜）", () => {
    const a = addRestoreIntent(emptyIntentLog(), "n");
    const b = addDeleteIntent(a, { noteId: "n", epoch: EPOCH, generation: 5 });
    expect(b.restorePending).toEqual([]);
    expect(b.intents).toHaveLength(1);
  });
});

describe("E2-3 IntentLog：bump（发布成功）", () => {
  it("本轮真正发布的 purge 意图钉到新 generation（防迟到覆盖）", () => {
    const a = withIntents([intent("n", 2)]);
    const b = settlePublished(a, { epoch: EPOCH, generation: 5, publishedIds: ["n"] });
    expect(b.intents[0].targetGeneration).toBe(5);
  });

  it("没发布的意图不动；epoch 不同不 bump", () => {
    const a = withIntents([intent("p", 2), intent("q", 2, { targetEpoch: "22222222-2222-4222-8222-222222222222" })]);
    const b = settlePublished(a, { epoch: EPOCH, generation: 5, publishedIds: ["q"] });
    expect(b.intents.find((i) => i.noteId === "p")!.targetGeneration).toBe(2);
    expect(b.intents.find((i) => i.noteId === "q")!.targetGeneration).toBe(2);
  });

  it("恢复成功的 id 同时出队列（intent + restorePending 都清）", () => {
    const a = withIntents([intent("n", 2)], ["n"]);
    const b = settlePublished(a, { epoch: EPOCH, generation: 3, publishedIds: ["n"], restoredIds: ["n"] });
    expect(b.intents).toEqual([]);
    expect(b.restorePending).toEqual([]);
  });
});

describe("E2-3 IntentLog：clear（未发布轮）", () => {
  it("更高代且索引明确不含该 id ⇒ 清除", () => {
    const a = withIntents([intent("n", 2)]);
    const b = settleUnpublished(a, { epoch: EPOCH, generation: 3, indexIds: [] });
    expect(b.intents).toEqual([]);
  });

  it("同代 / 索引仍含该 id ⇒ 保留（迟到覆盖的护栏）", () => {
    const a = withIntents([intent("n", 2)]);
    expect(settleUnpublished(a, { epoch: EPOCH, generation: 2, indexIds: [] }).intents).toHaveLength(1);
    expect(settleUnpublished(a, { epoch: EPOCH, generation: 9, indexIds: ["n"] }).intents).toHaveLength(1);
  });

  it("epoch 变了不认（换桶/回滚后意图休眠而非误清）", () => {
    const a = withIntents([intent("n", 2)]);
    const b = settleUnpublished(a, { epoch: "22222222-2222-4222-8222-222222222222", generation: 9, indexIds: [] });
    expect(b.intents).toHaveLength(1);
  });
});
