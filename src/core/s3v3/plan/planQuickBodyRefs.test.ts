/**
 * 261113（P1 修复）：小记正文对象按 contentHash 内容寻址，**多条小记可共用同一个对象**
 * （同文本小记字节相同；冲突留档复制必然同 hash —— 协议 §3 的「跨小记去重」是特性）。
 * 因此 purge/旧正文清理都必须先查引用：还有条目引用同一 hash 时不能删对象，
 * 否则「删一条 / 改一条」会顺手毁掉另一条的云端正文（小记没有历史快照）。
 */
import { describe, expect, it } from "vitest";
import type { QuickNoteEntry } from "../protocol/index.js";
import { planSync } from "./plan.js";
import type { PlanState, PlanWorld } from "./plan.js";

const quick = (id: string, over: Partial<QuickNoteEntry> = {}): QuickNoteEntry => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "h-" + id, ...over,
});

const world = (items: QuickNoteEntry[]): PlanWorld => ({
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items, tags: [] },
  folders: [],
});

const state = (over: Partial<PlanState> = {}): PlanState => ({
  restorePending: [], purgeIntents: [], folderPurgeIntents: [], ...over,
});

describe("小记 purge 的正文对象引用检查（261113 P1）", () => {
  it("另一条小记共用同一 contentHash ⇒ 不删正文对象", () => {
    const base = world([quick("q1", { contentHash: "shared" }), quick("q2", { contentHash: "shared" })]);
    const plan = planSync({ local: base, base, remote: base, state: state({ purgedQuickIds: ["q1"] }) });
    const del = plan.deletes.find((d) => d.space === "quickNotes");
    expect(del).toBeTruthy();
    expect(del!.keys ?? []).toHaveLength(0);
  });

  it("没有别的引用 ⇒ 仍按 hash 删正文对象（原行为不回退）", () => {
    const base = world([quick("q1", { contentHash: "only" }), quick("q2", { contentHash: "h-q2" })]);
    const plan = planSync({ local: base, base, remote: base, state: state({ purgedQuickIds: ["q1"] }) });
    const del = plan.deletes.find((d) => d.space === "quickNotes");
    expect(del).toBeTruthy();
    expect(del!.keys).toEqual(["quick-notes/objects/only.qnote"]);
  });
});
