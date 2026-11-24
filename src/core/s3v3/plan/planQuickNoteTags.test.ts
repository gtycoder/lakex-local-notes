import { describe, expect, it } from "vitest";
import { planSync } from "./plan.js";
import type { LakeIndex, QuickNotesIndex } from "../protocol/index.js";

/**
 * 261124 B2（审计①P1-3）：小记「删光标签」不传播 + tie-break 复活。
 * plan 发布对空 tagIds 省略字段（文档侧 261105 已修「空集合也写 []」、小记漏修）⇒
 * 接收侧 COALESCE 保留旧集合，两个 tie-break 回合后被删的标签复活回两端。
 */
describe("B2：小记空 tagIds 显式发布（删光标签可传播）", () => {
  const T0 = "2026-11-20T00:00:00.000Z";
  const T2 = "2026-11-22T00:00:00.000Z";
  const H = "0000000000000000000000000000000000000000000000000000000000000000";
  const quickItem = (over: Record<string, unknown> = {}) => ({ id: "q1", createdAt: T0, updatedAt: T0, contentHash: H, ...over });
  const lake: LakeIndex = { v: 3, space: "lake", notes: [], folders: [] };
  const qidx = (items: Array<Record<string, unknown>>, tags: Array<Record<string, unknown>> = []): QuickNotesIndex => ({ v: 3, space: "quickNotes", items: items as never, tags: tags as never });

  it("本地删光标签（空集合 + 新版本）⇒ 发布条目显式带 tagIds: []（旧实现省略 ⇒ 不传播）", () => {
    // 真实 state 形状（loadState 投影）：空集合**不带字段**——夹具若显式传 tagIds:[] 会被
    // baseItem 的展开携带传播，掩盖缺陷（第一版夹具就栽在这，教训：断言前先对齐真实形状）。
    const base = qidx([quickItem({ tagIds: ["t1"], tagsUpdatedAt: T0 })]);
    const local = qidx([quickItem({ tagsUpdatedAt: T2, updatedAt: T2 })]);
    const remote = qidx([quickItem({ tagIds: ["t1"], tagsUpdatedAt: T0 })]);
    const plan = planSync({
      base: { lake, quickNotes: base } as never,
      local: { lake, quickNotes: local },
      remote: { lake, quickNotes: remote },
      now: "2026-11-23T00:00:00.000Z",
      state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [], quickDeletes: [], purgedQuickIds: [], quickPurges: [], quickPurgeTimes: {}, pendingTagDeletes: [], removedTagIds: [], forcePublish: false },
    } as never);
    const pub = plan.publish?.quickNotes.items.find((q) => q.id === "q1") as unknown as Record<string, unknown>;
    expect(pub).toBeTruthy();
    expect(pub.tagIds).toEqual([]); // 显式空集合（对齐文档侧 261105 P0 修复）
    expect(pub.tagsUpdatedAt).toBe(T2);
  });

  it("对照：未带版本的条目不写 tagIds 字段（保持既有 wire 形状，不无中生有）", () => {
    const local = qidx([quickItem({ updatedAt: T2 })]);
    const plan = planSync({
      base: null as never,
      local: { lake, quickNotes: local },
      remote: { lake, quickNotes: qidx([]) },
      now: "2026-11-23T00:00:00.000Z",
      state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [], quickDeletes: [], purgedQuickIds: [], quickPurges: [], quickPurgeTimes: {}, pendingTagDeletes: [], removedTagIds: [], forcePublish: false },
    } as never);
    const pub = plan.publish?.quickNotes.items.find((q) => q.id === "q1") as unknown as Record<string, unknown>;
    expect(pub.tagIds).toBeUndefined();
    expect(pub.tagsUpdatedAt).toBeUndefined();
  });
});
