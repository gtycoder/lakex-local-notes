import { describe, expect, it } from "vitest";
import { planSync } from "./plan.js";
import type { LakeIndex, QuickNotesIndex } from "../protocol/index.js";

/**
 * 261124 ①P3-3（审计①）：enforceDiarySpaceMonotone 对**所有**目录计划条目做日记单调改写
 *（含 remote-purged-trash / local-purge / local-delete），改写后 kind 变 upload/download ⇒
 * 逃过 plan 的三类发布排除（F-01b「回收站副本永不 upload」）。
 * 判定：对「日记本不可删除」（AGENTS §3#25）这是**修复方向**（他端/脏数据把日记本弄没时
 * 重新发布/取回），**有意行为**；本文件钉住交互矩阵，防止将来「顺手修排除」把它弄丢。
 */
describe("①P3-3：日记目录复活是有意行为（不可删除裁决 × 发布排除交互）", () => {
  const T0 = "2026-11-20T00:00:00.000Z";
  const diary = (over: Record<string, unknown> = {}) => ({ id: "diary-nb", title: "日记", parentId: null, sortOrder: 0, updatedAt: T0, nodeType: "notebook", icon: null, space: "diary", ...over });
  const lakeOf = (folders: Array<Record<string, unknown>>): LakeIndex => ({ v: 3, space: "lake", notes: [], folders: folders as never });
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
  const run = (base: LakeIndex | null, local: LakeIndex, remote: LakeIndex, encounter?: string, folderPurgeIntents: string[] = []) => planSync({
    base: base ? { lake: base, quickNotes: quick } as never : null as never,
    local: { lake: local, quickNotes: quick },
    remote: { lake: remote, quickNotes: quick },
    now: "2026-11-23T00:00:00.000Z",
    encounter: encounter as never,
    state: { restorePending: [], purgeIntents: [], folderPurgeIntents, quickDeletes: [], purgedQuickIds: [], quickPurges: [], quickPurgeTimes: {}, pendingTagDeletes: [], removedTagIds: [], forcePublish: false },
  } as never);

  it("remote-purged-trash 形状（base 有 / local 有 diary / remote 无）⇒ 复活发布 diary 条目（有意）", () => {
    const plan = run(lakeOf([diary()]), lakeOf([diary()]), lakeOf([]));
    const published = plan.publish?.lake.folders.find((f) => f.id === "diary-nb") as unknown as Record<string, unknown> | undefined;
    expect(published, "日记本缺席必须复活发布（不可删除）").toBeTruthy();
    expect(published!.space).toBe("diary");
  });

  it("local-purge 形状（purge 意图 + remote 仍 diary）⇒ 改写为 download 取回（有意；该意图本不该存在）", () => {
    const plan = run(lakeOf([]), lakeOf([]), lakeOf([diary()]), undefined, ["diary-nb"]);
    const writes = plan.writes as unknown as Array<{ kind: string; id: string }>;
    // 单调改写后不再是 purge ⇒ 不产生删除写、改为取回写（逃过发布排除 = 有意）
    expect(writes.some((w) => w.id === "diary-nb" && (w.kind === "remove-folder" || w.kind === "local-purge"))).toBe(false);
    expect(writes.some((w) => w.id === "diary-nb" && w.kind === "apply-remote-folder"), "日记本被 purge 意图删掉时必须取回").toBe(true);
  });

  it("encounter 模式矩阵：日记目录永不被删除；非 cloud-wins 模式下复活发布（cloud-wins 有意抑制当轮）", () => {
    for (const mode of [undefined, "smart", "additive", "local-wins", "cloud-wins"]) {
      const plan = run(lakeOf([diary()]), lakeOf([diary()]), lakeOf([]), mode);
      const writes = plan.writes as unknown as Array<{ kind: string; id: string }>;
      expect(writes.some((w) => w.id === "diary-nb" && w.kind === "remove-folder"), "mode=" + String(mode) + "：日记目录不得被删除").toBe(false);
      const published = plan.publish?.lake.folders.find((f) => f.id === "diary-nb");
      if (mode === "cloud-wins") {
        // cloud-wins：本地变更当轮不上行（有意），但删除也绝不发生（不可删除裁决）
        expect(published).toBeFalsy();
      } else {
        expect(published, "mode=" + String(mode) + "：日记本缺席必须复活发布").toBeTruthy();
        expect((published as unknown as { space: string }).space).toBe("diary");
      }
    }
  });
});
