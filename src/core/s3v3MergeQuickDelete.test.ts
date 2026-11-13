/**
 * 261113（C1 真实桶实测）：小记「他端删除 → 本端恢复」跨端失效 + 删除回弹。
 * 根因之一：planQuickNotesMerge 的 local-delete 分支**不比较时间戳** —— 本地旧墓碑永久压过
 * 他端的显式恢复（恢复会 bump updatedAt），并把缺席反复发布回云端。
 * 判据（与 Lake 文档同口径：删除压编辑只压「基线那一版」）：
 *   远端条目 updatedAt > 基线 ⇒ 远端恢复赢（download）；否则本地删除赢（local-delete）。
 */
import { describe, expect, it } from "vitest";
import type { QuickNoteEntry, QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { planQuickNotesMerge } from "./s3v3Merge.js";

const quick = (id: string, updatedAt: string, contentHash = "h-" + id): QuickNoteEntry => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt, contentHash,
});
const qworld = (items: QuickNoteEntry[]): QuickNotesIndex => ({ v: 3, space: "quickNotes", items, tags: [] });

describe("小记 local-delete vs 远端恢复（261113 C1）", () => {
  it("远端条目比基线新（他端显式恢复）⇒ 让远端赢（download），不发布缺席", () => {
    const base = qworld([quick("q1", "T1")]);
    const local = qworld([]);              // 本地已删（墓碑在 localDeletes 里）
    const remote = qworld([quick("q1", "T2")]); // 他端恢复，updatedAt 已 bump
    const plan = planQuickNotesMerge(base, local, remote, new Set(), new Set(), new Set(["q1"]));
    const item = plan.items.find((i) => i.id === "q1")!;
    expect(item.kind).toBe("download");
    expect(item.applyRemote).toBe(true);
    expect(item.uploadLocal).toBe(false);
  });

  it("远端条目与基线同版（只是我们单方面删了）⇒ 删除压编辑照旧（local-delete）", () => {
    const base = qworld([quick("q1", "T1")]);
    const local = qworld([]);
    const remote = qworld([quick("q1", "T1")]);
    const plan = planQuickNotesMerge(base, local, remote, new Set(), new Set(), new Set(["q1"]));
    expect(plan.items.find((i) => i.id === "q1")!.kind).toBe("local-delete");
  });
});
