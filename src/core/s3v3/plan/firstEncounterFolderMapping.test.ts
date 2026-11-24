import { describe, expect, it } from "vitest";
import { planLakeMerge } from "../../s3v3Merge.js";
import type { LakeFolderEntry, LakeIndex } from "../protocol/index.js";

/**
 * 261124 P0（B1 升级）：firstEncounter **目录无改写层** —— applyEncounterAction 只映射文档/小记，
 * folders 循环裸用原始判定 ⇒ 三个破坏面：
 *  ① 只增不删 / 以本地为准：本地独有目录（基线认识）仍判 remote-purged-trash → remove-folder →
 *     saveFolders 收尾 deleteTreeNode **级联整棵子树进回收站**（用户裁决：删目录必级联 ⇒ P0）；
 *  ② 本地缺席 + 远端有 + 基线有 判 local-delete（把「基线在场」当删除意图）——文档同形状是
 *     decideItem 的 download（无删除意图的本地缺失按云端恢复，syncDecisions.ts:36 只认 purgeIntent）；
 *  ③ 双改时按 updatedAt 裁决，「冲突本机胜」（additive）未兑现。
 * 本文件钉住 ①②③ 的修复语义 + smart/cloud-wins 既有语义不回归。
 */
describe("首次相遇 × 目录改写层（261124 P0 回归）", () => {
  const t = "2026-11-20T00:00:00.000Z";
  const folder = (over: Partial<LakeFolderEntry> = {}): LakeFolderEntry => ({
    id: "g1", title: "分组", parentId: "nb1", sortOrder: 0, nodeType: "group", icon: null, updatedAt: t, space: null,
    ...over,
  });
  const root: LakeFolderEntry = { id: "nb1", title: "笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: t, space: null };
  const idx = (folders: LakeFolderEntry[]): LakeIndex => ({ v: 3, space: "lake", notes: [], folders });
  const base = idx([root, folder()]);
  const run = (mode: "smart" | "additive" | "local-wins" | "cloud-wins", local: LakeFolderEntry[], remote: LakeFolderEntry[], baseIdx: LakeIndex | null) =>
    planLakeMerge(baseIdx, idx(local), idx(remote), {
      restorePending: new Set(), purgeIntents: new Set(), folderPurgeIntents: new Set(), encounter: mode, trashNow: "2026-11-24T00:00:00.000Z",
    });

  it("① additive：本地独有目录（基线认识）⇒ upload 保留（绝不 remote-purged-trash/remove-folder）", () => {
    const plan = run("additive", [root, folder()], [root], base);
    const g = plan.folders.find((f) => f.id === "g1")!;
    expect(g.kind).toBe("upload");
    expect(g.uploadLocal).toBe(true);
  });

  it("① local-wins：本地独有目录（基线认识）⇒ upload 保留", () => {
    const plan = run("local-wins", [root, folder()], [root], base);
    const g = plan.folders.find((f) => f.id === "g1")!;
    expect(g.kind).toBe("upload");
  });

  it("② additive：本地缺席 + 远端有 + 基线有 ⇒ download 补回（不判删除、不发布缺席）", () => {
    const plan = run("additive", [root], [root, folder()], base);
    const g = plan.folders.find((f) => f.id === "g1")!;
    expect(g.kind).toBe("download");
    expect(g.applyRemote).toBe(true);
  });

  it("② local-wins：同形状同样 download 补回（基线认识 ⇒ 绝不当删除传播）", () => {
    const plan = run("local-wins", [root], [root, folder()], base);
    expect(plan.folders.find((f) => f.id === "g1")!.kind).toBe("download");
  });

  it("③ additive：双改冲突本机胜 ⇒ upload（不按 updatedAt 让远端）", () => {
    const remoteNewer = folder({ title: "远端改名", updatedAt: "2026-11-23T00:00:00.000Z" });
    const plan = run("additive", [root, folder({ title: "本地改名", updatedAt: "2026-11-21T00:00:00.000Z" })], [root, remoteNewer], base);
    const g = plan.folders.find((f) => f.id === "g1")!;
    expect(g.kind).toBe("upload");
    expect(g.local?.title).toBe("本地改名");
  });

  it("smart 不回归：本地独有（基线认识）仍是 remote-purged-trash（删除传播语义）", () => {
    const plan = run("smart", [root, folder()], [root], base);
    expect(plan.folders.find((f) => f.id === "g1")!.kind).toBe("remote-purged-trash");
  });

  it("② smart 同样对齐 decideItem：本地缺席 + 基线有 ⇒ download 补回（基线在场不是删除意图，真删除走 purge 意图）", () => {
    const plan = run("smart", [root], [root, folder()], base);
    const g = plan.folders.find((f) => f.id === "g1")!;
    expect(g.kind).toBe("download");
    expect(g.applyRemote).toBe(true);
  });

  it("cloud-wins 不回归：本地独有仍 remote-purged-trash（本地回收站近似，plan 层抑制上行）", () => {
    const plan = run("cloud-wins", [root, folder()], [root], base);
    expect(plan.folders.find((f) => f.id === "g1")!.kind).toBe("remote-purged-trash");
  });

  it("④ 显式删除意图：smart 照常 local-purge；additive 与 notes 同口径「推迟到下一轮」（local-purge→none）", () => {
    const intent = { restorePending: new Set<string>(), purgeIntents: new Set<string>(), folderPurgeIntents: new Set(["g1"]), trashNow: "2026-11-24T00:00:00.000Z" };
    const smartPlan = planLakeMerge(base, idx([root]), idx([root, folder()]), { ...intent, encounter: "smart" });
    expect(smartPlan.folders.find((f) => f.id === "g1")!.kind).toBe("local-purge");
    const addPlan = planLakeMerge(base, idx([root]), idx([root, folder()]), { ...intent, encounter: "additive" });
    expect(addPlan.folders.find((f) => f.id === "g1")!.kind).toBe("none");
    const lwPlan = planLakeMerge(base, idx([root]), idx([root, folder()]), { ...intent, encounter: "local-wins" });
    expect(lwPlan.folders.find((f) => f.id === "g1")!.kind).toBe("local-purge");
  });
});
