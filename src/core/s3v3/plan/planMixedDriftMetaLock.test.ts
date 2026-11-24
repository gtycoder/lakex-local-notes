import { describe, expect, it } from "vitest";
import { planSync } from "./plan.js";
import type { LakeIndex, QuickNotesIndex } from "../protocol/index.js";

/**
 * 261124 A6（审计①P1-1）：「本地改名 × 他端加锁」并发 ⇒ 改名双丢。
 * s3v3Merge 的 none 分支在该形状同时置 applyRemote && uploadLocal；plan 发布底稿整取
 * p.remote（只有位置/锁/标签三维合成，无 title LWW）+ apply-remote 按远端 meta 重建行 ⇒
 * 本地新标题在**发布与落库双双回滚**（违反 §9.2「元数据内容一致时按 updatedAt 后写胜」+
 * §9.8「位置/锁/元数据相互正交」）。
 */
describe("A6：内容一致时元数据 LWW 与锁正交（改名×加锁不互丢）", () => {
  const T0 = "2026-11-20T00:00:00.000Z";
  const T1 = "2026-11-21T00:00:00.000Z"; // 远端锁时间
  const T2 = "2026-11-22T00:00:00.000Z"; // 本地改名时间
  const H = "0000000000000000000000000000000000000000000000000000000000000000";
  const entry = (over: Record<string, unknown> = {}) => ({ id: "n1", title: "旧标题", parentId: null, sortOrder: 0, updatedAt: T0, contentHash: H, ...over });
  const idx = (notes: Array<Record<string, unknown>>): LakeIndex => ({ v: 3, space: "lake", notes: notes as never, folders: [] });
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
  const run = (base: LakeIndex, local: LakeIndex, remote: LakeIndex) => planSync({
    base: { lake: base, quickNotes: quick } as never,
    local: { lake: local, quickNotes: quick },
    remote: { lake: remote, quickNotes: quick },
    now: "2026-11-23T00:00:00.000Z",
    state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [], quickDeletes: [], purgedQuickIds: [], quickPurges: [], quickPurgeTimes: {}, pendingTagDeletes: [], removedTagIds: [], forcePublish: false },
  } as never);

  it("本地改名（updatedAt 更晚）× 他端加锁（lockedAt 更晚）⇒ 发布标题=本地新名、锁=远端新锁", () => {
    const base = idx([entry()]);
    const local = idx([entry({ title: "本地改名", updatedAt: T2 })]);
    const remote = idx([entry({ isLocked: true, lockedAt: T1 })]);
    const plan = run(base, local, remote);
    const pub = plan.publish?.lake.notes.find((n) => n.id === "n1") as unknown as Record<string, unknown>;
    expect(pub).toBeTruthy();
    expect(pub.title).toBe("本地改名"); // 元数据 LWW（本地新）
    expect(pub.isLocked).toBe(true);   // 锁 LWW（远端新）
    expect(pub.lockedAt).toBe(T1);
  });

  it("apply-remote 写回的 meta 同样保本地新标题（落库不回滚）", () => {
    const base = idx([entry()]);
    const local = idx([entry({ title: "本地改名", updatedAt: T2 })]);
    const remote = idx([entry({ isLocked: true, lockedAt: T1 })]);
    const plan = run(base, local, remote);
    const writes = plan.writes.filter((w) => w.kind === "apply-remote" && w.id === "n1") as unknown as Array<{ meta: Record<string, unknown> }>;
    expect(writes).toHaveLength(1);
    expect(writes[0].meta.title).toBe("本地改名");
    expect(writes[0].meta.lockedAt).toBe(T1);
  });

  it("对照：内容一致时远端元数据更新 ⇒ 发布标题=远端（LWW 反向不回归）", () => {
    const base = idx([entry()]);
    const local = idx([entry({ isLocked: true, lockedAt: T1 })]);
    const remote = idx([entry({ title: "远端改名", updatedAt: T2 })]);
    const plan = run(base, local, remote);
    const pub = plan.publish?.lake.notes.find((n) => n.id === "n1") as unknown as Record<string, unknown>;
    expect(pub.title).toBe("远端改名");
    expect(pub.isLocked).toBe(true);
  });
});
