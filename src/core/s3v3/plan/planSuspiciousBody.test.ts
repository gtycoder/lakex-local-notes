/**
 * P1-4 正文突变保护：plan 层的「不上传、不覆盖本地、不拿可疑内容覆盖云端」。
 *
 * 判据在 core 的 bodyChangeGuard（引擎负责算出 suspiciousBodyIds）；本用例只锁 plan 的消费行为。
 */
import { describe, expect, it } from "vitest";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry, QuickNotesIndex } from "../protocol/index.js";
import { planSync, type PlanWorld } from "./plan.js";

const T0 = "2026-11-01T00:00:00.000Z";
const T1 = "2026-11-02T00:00:00.000Z";

const note = (id: string, contentHash: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({
  id, title: id, parentId: null, sortOrder: 0, updatedAt: T0, contentHash, ...over,
});
function world(notes: LakeNoteEntry[] = [], folders: LakeFolderEntry[] = []): PlanWorld {
  const lake: LakeIndex = { v: 3, space: "lake", notes, folders };
  const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
  return { lake, quickNotes, folders };
}

const state = (over: Partial<Parameters<typeof planSync>[0]["state"]> = {}) => ({
  restorePending: [], purgeIntents: [], folderPurgeIntents: [], ...over,
});

describe("planSync P1-4（suspiciousBodyIds）", () => {
  it("可疑篇：不上传正文、不拉远端、只留档历史 + warning；索引继续用远端版本", () => {
    const baseWorld = world([note("n1", "h0")]);
    const local = world([note("n1", "h1")]); // 行 updatedAt 没前进（外部改动）
    const remote = world([note("n1", "h0")]);
    const plan = planSync({
      local, base: baseWorld, remote,
      state: state({ suspiciousBodyIds: ["n1"] }),
    });

    // 不上传
    expect(plan.transfers.filter((t) => t.op === "put" && t.id === "n1")).toEqual([]);
    // 不把可疑字节写回本地 / 不拉远端覆盖本地文件
    expect(plan.writes.some((w) => w.kind === "apply-remote" && w.id === "n1")).toBe(false);
    expect(plan.reads.some((r) => r.kind === "body" && r.id === "n1")).toBe(false);
    // 留档历史（archive-local, reason=suspicious）
    expect(plan.writes).toContainEqual({ kind: "archive-local", space: "lake", id: "n1", reason: "suspicious" });
    // 结构化 warning（UI/诊断可定位）
    expect(plan.warnings).toContainEqual(expect.objectContaining({
      code: "body_suspicious_external_change", space: "lake", id: "n1", title: "n1",
    }));
    // 单篇没有其它变化 ⇒ 不发布（云端索引保持原样，不会指向可疑内容）
    expect(plan.publish).toBeNull();
  });

  it("另有正常改动触发发布时：可疑篇仍用远端版本进索引（绝不用本地可疑 hash）", () => {
    const baseWorld = world([note("n1", "h0"), note("n2", "h0")]);
    const local = world([note("n1", "h1"), note("n2", "h2", { updatedAt: T1 })]); // n2 = 正常编辑
    const remote = world([note("n1", "h0"), note("n2", "h0")]);
    const plan = planSync({
      local, base: baseWorld, remote,
      state: state({ suspiciousBodyIds: ["n1"] }),
    });

    expect(plan.transfers.some((t) => t.op === "put" && t.id === "n1")).toBe(false);
    expect(plan.transfers.some((t) => t.op === "put" && t.id === "n2")).toBe(true);
    expect(plan.publish).not.toBeNull();
    const published = plan.publish!.lake.notes;
    expect(published.find((n) => n.id === "n1")?.contentHash).toBe("h0"); // 远端版本
    expect(published.find((n) => n.id === "n2")?.contentHash).toBe("h2"); // 正常编辑照常发布
    // 只发布正常那篇（可疑篇不认领 publish）
    expect(plan.publishes.lake).toEqual(["n2"]);
  });

  it("可疑篇远端已缺席：不发布它（不拿可疑内容在云端重建）", () => {
    const baseWorld = world([note("n1", "h0"), note("n2", "h0")]);
    const local = world([note("n1", "h1"), note("n2", "h2", { updatedAt: T1 })]);
    const remote = world([note("n2", "h0")]);
    const plan = planSync({
      local, base: baseWorld, remote,
      state: state({ suspiciousBodyIds: ["n1"] }),
    });
    expect(plan.publish).not.toBeNull();
    expect(plan.publish!.lake.notes.some((n) => n.id === "n1")).toBe(false);
    expect(plan.publish!.lake.notes.some((n) => n.id === "n2")).toBe(true);
  });

  it("正常编辑（不在 suspiciousBodyIds）行为不变：照常 PUT + 发布", () => {
    const baseWorld = world([note("n1", "h0")]);
    const local = world([note("n1", "h1", { updatedAt: T1 })]);
    const plan = planSync({ local, base: baseWorld, remote: baseWorld, state: state() });
    expect(plan.transfers.some((t) => t.op === "put" && t.id === "n1")).toBe(true);
    expect(plan.warnings.some((w) => w.code === "body_suspicious_external_change")).toBe(false);
  });
});
