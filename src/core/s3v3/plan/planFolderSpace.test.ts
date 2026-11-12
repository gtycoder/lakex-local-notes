import { describe, expect, it } from "vitest";
import type { LakeFolderEntry, LakeIndex, QuickNotesIndex } from "../protocol/index.js";
import { planSync, type PlanWorld } from "./plan.js";

/**
 * 发布侧「space 必须显式写」（261109，docs/DIARY.md 硬规则 1）。
 *
 * 判据放在 plan 的发布构造点：**非日记目录必须带 own property `space: null`**，
 * 不是省略字段 —— 否则「日记本 ↔ 普通笔记本」的归属变更在 wire 上不可见、两端互刷
 * （tagIds 空集合必须写 `[]` 的教训）。
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

});

describe("日记本单调性（261112 用户裁决 AGENTS §3#25）：space 只允许 null→diary", () => {
  const diary = (over: Partial<LakeFolderEntry> = {}) => folder("nb1", { space: "diary", ...over });
  const plain = (over: Partial<LakeFolderEntry> = {}) => folder("nb1", { space: null, ...over });

  it("远端把日记本发成 null（旧包/脏数据）⇒ 本地权威：重发布 diary，绝不把本地降级", () => {
    const base0 = world([diary()]);
    const remote = world([plain({ updatedAt: "2026-11-10T00:00:00.000Z" })]);
    const plan = planSync({ local: base0, base: base0, remote, state: state() });
    expect(plan.publish).not.toBeNull();
    const entry = plan.publish!.lake.folders.find((f) => f.id === "nb1")!;
    expect(entry.space).toBe("diary");
    // 不允许把远端 null 应用到本地（本地行必须仍是 diary）
    expect(plan.writes.filter((w) => w.kind === "apply-remote-folder")).toEqual([]);
  });

  it("远端彻底缺席（purged）但本地是日记本 ⇒ 重发布 diary，绝不进回收站/被删", () => {
    const local = world([diary()]);
    const plan = planSync({ local, base: world([diary()]), remote: world(), state: state() });
    expect(plan.publish).not.toBeNull();
    const entry = plan.publish!.lake.folders.find((f) => f.id === "nb1")!;
    expect(entry.space).toBe("diary");
    expect(plan.writes.filter((w) => w.kind === "remove-folder")).toEqual([]);
  });

  it("本地行丢了 diary 标记（null）而远端是 diary ⇒ 只升不降：从远端取回 diary（落库写 diary）", () => {
    const base0 = world([diary()]);
    const local = world([plain()]);
    const plan = planSync({ local, base: base0, remote: base0, state: state() });
    const write = plan.writes.find((w) => w.kind === "apply-remote-folder" && w.id === "nb1") as
      { kind: "apply-remote-folder"; meta: { space?: string | null } } | undefined;
    expect(write, "应把远端的 diary 标记应用到本地").toBeTruthy();
    expect(write!.meta.space).toBe("diary");
    // 云端本来就是 diary：无需再发布一次（幂等、不涨 generation）
    expect(plan.publish).toBeNull();
  });

  it("两侧都是 diary 时仍走常规合并（远端更新 ⇒ 下载，不误判为降级）", () => {
    const base0 = world([diary()]);
    const local = world([diary()]);
    const remote = world([diary({ title: "改名后的日记本", updatedAt: "2026-11-10T00:00:00.000Z" })]);
    const plan = planSync({ local, base: base0, remote, state: state() });
    const write = plan.writes.find((w) => w.kind === "apply-remote-folder" && w.id === "nb1");
    expect(write).toBeTruthy();
    expect(plan.publish).toBeNull();
  });
});
