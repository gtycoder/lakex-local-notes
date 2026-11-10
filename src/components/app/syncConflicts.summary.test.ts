import { describe, expect, it } from "vitest";
import { syncConflictsSummary } from "./syncConflicts";

const row = (kind: "remote_wins" | "remote_purged" | "save_external_changed", ackedAt?: string) => ({
  id: kind + (ackedAt ?? ""), noteId: "n1", space: "lake" as const, kind,
  at: "2026-11-10T02:00:37.987Z", title: "2026-11-26", ackedAt: ackedAt ?? null, resolvedAt: null,
});

describe("同步记录摘要文案（261110）", () => {
  it("没有未读 ⇒ 空串（区块不渲染）", () => {
    expect(syncConflictsSummary([])).toBe("");
    expect(syncConflictsSummary([row("remote_wins", "T")])).toBe("");
  });

  it("保存守卫单独出现时说人话，而不是叫「同步覆盖/删除」", () => {
    expect(syncConflictsSummary([row("save_external_changed")])).toBe("最近有 1 条记录（保存时磁盘被改）");
  });

  it("多种 kind 聚合（同类多条带数量）", () => {
    expect(syncConflictsSummary([
      row("remote_wins"), row("remote_wins"), row("save_external_changed"),
    ])).toBe("最近有 3 条记录（远端覆盖本地 2 条，保存时磁盘被改）");
  });
});
