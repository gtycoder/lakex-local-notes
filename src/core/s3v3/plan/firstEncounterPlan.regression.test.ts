import { describe, expect, it } from "vitest";
import { planSync } from "./plan.js";
import type { LakeIndex, QuickNotesIndex } from "../protocol/index.js";

/**
 * 261124 真机数据事故回归：迁移丢行 + 配置指纹不一致 + 「以本地为准」曾把**基线里认识的文档**
 * 当「云端多出」发布成已删 ⇒ 他端整批进回收站。三条不变量：
 *  ① 基线已知条目 = 普通下载补回（绝不 trashOverride、绝不发布成已删）；
 *  ② 真·云端多出（基线也不认识）才走 download-to-trash；
 *  ③ download-to-trash 的发布条目带 trashedAt（round now）与 deletedFromParentId（原父，可还原）。
 */
describe("首次相遇 × 基线豁免（plan 级事故回归）", () => {
  const note = (id: string) => ({ id, title: id, parentId: "f617e71c-e06e-48a3-9199-e1b19f281a95", sortOrder: 0, updatedAt: "2026-11-20T00:00:00.000Z", contentHash: "hash-" + id });
  const folder = { id: "f617e71c-e06e-48a3-9199-e1b19f281a95", title: "父文档", parentId: "root-1", sortOrder: 0, nodeType: "note", icon: null, updatedAt: "2026-11-20T00:00:00.000Z", space: null } as never;
  const root = { id: "root-1", title: "笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-11-20T00:00:00.000Z", space: null } as never;
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [] };
  const mk = (withNotes: boolean): LakeIndex => ({ v: 3, space: "lake", notes: withNotes ? [note("n1")] : [], folders: [folder, root] });
  const run = (base: { lake: LakeIndex; quickNotes: QuickNotesIndex } | null) => planSync({
    base: base as never,
    local: { lake: mk(false), quickNotes: quick },
    remote: { lake: mk(true), quickNotes: quick },
    encounter: "local-wins",
    now: "2026-11-23T13:29:00.275Z",
    state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [], quickDeletes: [], purgedQuickIds: [], quickPurges: [], quickPurgeTimes: {}, pendingTagDeletes: [], removedTagIds: [], forcePublish: false },
  } as never);

  it("① 基线已知 + 本机缺行 + 远端在 ⇒ 普通下载（零 trashOverride、零发布）", () => {
    const plan = run({ lake: mk(true), quickNotes: quick });
    const writes = plan.writes.filter((w) => w.id === "n1");
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("apply-remote");
    const meta = (writes[0] as { meta: Record<string, unknown> }).meta;
    expect(meta.trashedAt).toBeUndefined(); // 绝不进回收站
    expect(meta.parentId).toBe("f617e71c-e06e-48a3-9199-e1b19f281a95");
    expect(plan.publish).toBeNull(); // 纯下载不发布
  });

  it("②③ 真·云端多出（无基线）⇒ download-to-trash：发布条目 trashedAt=round now、deletedFromParentId=原父", () => {
    const plan = run(null);
    const writes = plan.writes.filter((w) => w.id === "n1");
    expect((writes[0] as { meta: Record<string, unknown> }).meta.trashedAt).toBe("2026-11-23T13:29:00.275Z");
    const pub = plan.publish?.lake.notes.find((n) => n.id === "n1");
    expect(pub?.trashedAt).toBe("2026-11-23T13:29:00.275Z");
    expect(pub?.parentId).toBeNull();
    expect((pub as unknown as Record<string, unknown>).deletedFromParentId).toBe("f617e71c-e06e-48a3-9199-e1b19f281a95");
  });
});
