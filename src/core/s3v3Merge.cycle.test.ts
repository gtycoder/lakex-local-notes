import { describe, expect, it } from "vitest";
import { idsWithCyclicAncestors, planLakeMerge, type LakeMergeContext } from "./s3v3Merge.js";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry } from "./s3v3/protocol/s3v3Index.js";

/**
 * P1-6 父环防护（core）：
 * 远端索引可注入目录父环；旧实现里 wouldCycle 只拦"上传会成环"，下载侧照单全收，
 * 落库后 descendantIds / 递归 CTE 无限展开 ⇒ 删除/移动/回收站卡死。
 * 现在合并层必须：① 识别「祖先链含环」的 id；② 拒绝远端父关系（有本地/基线父则保持）；
 * ③ 产出结构化 warning（detail 带 cycle-parent），绝不静默。
 */

const ctx: LakeMergeContext = { restorePending: new Set(), purgeIntents: new Set(), folderPurgeIntents: new Set() };
const NOW = "2026-11-05T00:00:00.000Z";

function folder(id: string, parentId: string | null, nodeType: "notebook" | "group" = "group"): LakeFolderEntry {
  return { id, title: id, parentId, sortOrder: 0, nodeType, icon: null, updatedAt: NOW };
}
function note(id: string, parentId: string | null): LakeNoteEntry {
  return { id, title: id, parentId, sortOrder: 0, updatedAt: NOW, contentHash: "a".repeat(64) };
}
function lake(folders: LakeFolderEntry[], notes: LakeNoteEntry[] = []): LakeIndex {
  return { v: 3, space: "lake", notes, folders };
}
/** 用计划里的远端父关系重建一棵树，断言仍无环（防"修了 warning 但环还在"）。 */
function parentMapOfPlan(plan: ReturnType<typeof planLakeMerge>): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const p of [...plan.notes, ...plan.folders]) if (p.remote) map.set(p.id, p.remote.parentId);
  return map;
}

describe("P1-6 父环防护：合并层拒绝远端环", () => {
  it("纯远端环 A→B→C→A：三节点全部拒绝父关系（落 null）并给 warning", () => {
    const remote = lake([
      folder("nb", null, "notebook"),
      folder("a", "b"), folder("b", "c"), folder("c", "a"),
    ]);
    const plan = planLakeMerge(null, lake([]), remote, ctx);
    const cycleWarnings = (plan.warnings ?? []).filter((w) => (w.detail ?? "").includes("cycle-parent"));
    expect(cycleWarnings.map((w) => w.id).sort()).toEqual(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) {
      const entry = plan.folders.find((p) => p.id === id)!;
      expect(entry.remote?.parentId).toBeNull();
    }
  });

  it("远端父关系把本地树接成环：保持本地原父（不写环）", () => {
    const local = lake([folder("nb", null, "notebook"), folder("a", "nb"), folder("b", "a")]);
    // 远端把 a 的父改成 b、b 的父改成 a ⇒ 合并后 a↔b 成环
    const remote = lake([folder("nb", null, "notebook"), folder("a", "b"), folder("b", "a")]);
    const plan = planLakeMerge(null, local, remote, ctx);
    expect((plan.warnings ?? []).some((w) => (w.detail ?? "").includes("cycle-parent"))).toBe(true);
    const a = plan.folders.find((p) => p.id === "a")!;
    const b = plan.folders.find((p) => p.id === "b")!;
    expect(a.remote?.parentId).toBe("nb"); // 保持本地原父
    expect(b.remote?.parentId).toBe("a");  // b 的本地原父
    expect(idsWithCyclicAncestors(parentMapOfPlan(plan)).size).toBe(0);
  });

  it("父子环里的文档（note）同样拒绝父关系并 warning", () => {
    const remote = lake(
      [folder("nb", null, "notebook"), folder("a", "b"), folder("b", "a")],
      [note("n1", "a")],
    );
    const plan = planLakeMerge(null, lake([]), remote, ctx);
    expect((plan.warnings ?? []).some((w) => w.id === "n1" && (w.detail ?? "").includes("cycle-parent"))).toBe(true);
    expect(plan.notes.find((p) => p.id === "n1")!.remote?.parentId).toBeNull();
  });

  it("无环时零 warning、父关系原样（不误伤正常数据）", () => {
    const remote = lake([folder("nb", null, "notebook"), folder("a", "nb")], [note("n1", "a")]);
    const plan = planLakeMerge(null, lake([]), remote, ctx);
    expect(plan.warnings ?? []).toEqual([]);
    expect(plan.folders.find((p) => p.id === "a")!.remote?.parentId).toBe("nb");
    expect(plan.notes.find((p) => p.id === "n1")!.remote?.parentId).toBe("a");
  });
});

describe("P1-6 idsWithCyclicAncestors（visited 线性、有限）", () => {
  it("自指 / 二节点环 / 喂养进环的子孙都命中", () => {
    const map = new Map<string, string | null>([
      ["self", "self"],
      ["a", "b"], ["b", "a"],
      ["child", "a"],
      ["root", null], ["ok", "root"],
    ]);
    expect([...idsWithCyclicAncestors(map)].sort()).toEqual(["a", "b", "child", "self"]);
  });

  it("10 万节点长链不爆栈/不死循环（有界）", () => {
    const map = new Map<string, string | null>();
    const N = 100_000;
    for (let i = 0; i < N; i += 1) map.set("n" + i, i === 0 ? null : "n" + (i - 1));
    const t0 = Date.now();
    const cyclic = idsWithCyclicAncestors(map);
    expect(cyclic.size).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});
