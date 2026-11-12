import { describe, expect, it } from "vitest";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry, QuickNotesIndex } from "../protocol/index.js";
import { planSync, type PlanWorld } from "./plan.js";

/**
 * 261112 发版复核 F-01：位置赢家=本地（例如本地已从回收站恢复）而远端条目仍带回收站字段时，
 * apply-remote 的 meta 与发布条目必须**显式写 null**，不能保留远端 trashedAt/deletedFromParentId
 * （否则落库会把本地恢复回滚、发布端写出过期回收站位置）。
 */
const note = (id: string, contentHash: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({
  id, title: id, parentId: "nb", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash, ...over,
});
const folder = (id: string): LakeFolderEntry => ({
  id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z",
});
function world(notes: LakeNoteEntry[], folders: LakeFolderEntry[] = [folder("nb")]): PlanWorld {
  const lake: LakeIndex = { v: 3, space: "lake", notes, folders };
  const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
  return { lake, quickNotes, folders };
}
const state = () => ({ restorePending: [], purgeIntents: [], folderPurgeIntents: [] });

describe("planSync F-01：位置赢家=本地时必须清掉远端回收站字段", () => {
  it("本地已恢复（active）+ 远端仍 trashed 且正文更新 ⇒ apply-remote meta 与发布条目位置均为 null", () => {
    const base = world([note("a", "h1", { parentId: "notebook-trash", trashedAt: "T1", deletedFromParentId: "nb" })]);
    const local = world([note("a", "h1", { parentId: "nb" })]); // 已显式恢复
    const remote = world([note("a", "h2", { parentId: "notebook-trash", trashedAt: "T1", deletedFromParentId: "nb" })]);
    const plan = planSync({ local, base, remote, state: state() });
    const apply = plan.writes.find((w) => w.kind === "apply-remote" && w.id === "a");
    expect(apply).toBeTruthy();
    if (apply && apply.kind === "apply-remote") {
      expect(apply.meta.parentId ?? null).toBe("nb");
      expect(apply.meta.trashedAt ?? null).toBeNull();
      expect(apply.meta.deletedFromParentId ?? null).toBeNull();
    }
    expect(plan.publish).not.toBeNull();
    const published = plan.publish!.lake.notes.find((n) => n.id === "a");
    expect(published).toBeTruthy();
    expect(published!.parentId ?? null).toBe("nb");
    expect(published!.trashedAt ?? null).toBeNull();
    expect(published!.deletedFromParentId ?? null).toBeNull();
  });
});
