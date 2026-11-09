import { describe, expect, it } from "vitest";
import type { LakeFolderEntry, LakeIndex, QuickNotesIndex } from "../protocol/index.js";
import { planSync, type PlanWorld } from "./plan.js";

/**
 * 发布侧「space 必须显式写」（261109，docs/DIARY.md 硬规则 1）。
 *
 * 判据放在 plan 的发布构造点：**非日记目录必须带 own property `space: null`**，
 * 不是省略字段 —— 否则「取消日记标记」在 wire 上不可见、两端互刷（tagIds 空集合必须写 `[]` 的教训）。
 */
const folder = (id: string, over: Partial<LakeFolderEntry> = {}): LakeFolderEntry => ({
  id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null,
  updatedAt: "2026-11-09T00:00:00.000Z", ...over,
});

function world(folders: LakeFolderEntry[] = []): PlanWorld {
  const lake: LakeIndex = { v: 3, space: "lake", notes: [], folders };
  const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
  return { lake, quickNotes, folders };
}

const state = () => ({ restorePending: [], purgeIntents: [], folderPurgeIntents: [] });

describe("plan 发布：folders[].space 显式写", () => {
  it("日记本发布 space=\"diary\"；非日记（显式 null / 缺字段）一律发布 space=null（own property）", () => {
    const local = world([
      folder("nb-diary", { space: "diary" }),
      folder("nb-plain", { space: null }),
      folder("nb-missing"), // 缺字段（旧行）
    ]);
    const plan = planSync({ local, base: world(), remote: world(), state: state() });
    expect(plan.publish).not.toBeNull();
    const published = plan.publish!.lake.folders;
    const byId = new Map(published.map((f) => [f.id, f]));

    expect(byId.get("nb-diary")!.space).toBe("diary");
    for (const id of ["nb-plain", "nb-missing"]) {
      const entry = byId.get(id)!;
      // 关键：是"字段存在且为 null"，不是"没有这个字段"
      expect(Object.prototype.hasOwnProperty.call(entry, "space"), id + " 必须显式写 space").toBe(true);
      expect(entry.space).toBeNull();
    }
  });

  it("取消日记标记能发布出去（本地从 diary → null 时发布 null，而不是沿用旧值）", () => {
    // 目录元数据变更的既有传播判据是 updatedAt（与改名/换图标同口径）：改 space 的那次写入必须 bump updated_at。
    const base0 = world([folder("nb1", { space: "diary" })]);
    const local = world([folder("nb1", { space: null, updatedAt: "2026-11-10T00:00:00.000Z" })]);
    const plan = planSync({ local, base: base0, remote: base0, state: state() });
    expect(plan.publish).not.toBeNull();
    const entry = plan.publish!.lake.folders.find((f) => f.id === "nb1")!;
    expect(entry.space).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(entry, "space")).toBe(true);
  });
});
