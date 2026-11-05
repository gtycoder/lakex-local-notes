import { describe, expect, it } from "vitest";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry, QuickNotesIndex } from "../protocol/index.js";
import { planSync, type PlanWorld } from "./plan.js";

/** 261105 P1：文档标签关系 = 集合 + 关系版本 LWW（lake 索引 tagIds/tagsUpdatedAt）。 */
const note = (id: string, contentHash: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({
  id, title: id, parentId: "nb", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash, ...over,
});
const folder = (id: string, over: Partial<LakeFolderEntry> = {}): LakeFolderEntry => ({
  id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z", ...over,
});
function world(notes: LakeNoteEntry[]): PlanWorld {
  const lake: LakeIndex = { v: 3, space: "lake", notes, folders: [folder("nb")] };
  const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
  return { lake, quickNotes, folders: [folder("nb")] };
}
const state = () => ({ restorePending: [], purgeIntents: [], folderPurgeIntents: [] });
const TAG_A = "t_aaaaaaaaaaaaaaaa";
const TAG_B = "t_bbbbbbbbbbbbbbbb";
const TAG_C = "t_cccccccccccccccc";

describe("planSync：文档标签关系同步（261105 P1）", () => {
  it("远端关系版本更新：正文 hash 不变也生成 apply-remote（携带 tagIds/tagsUpdatedAt）", () => {
    const base = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
    const remote = world([note("a", "h1", { tagIds: [TAG_B], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]);
    const plan = planSync({ local: base, base, remote, state: state() });
    const write = plan.writes.find((w) => w.kind === "apply-remote" && w.space === "lake" && w.id === "a");
    expect(write).toBeTruthy();
    expect(write && write.kind === "apply-remote" ? write.meta.tagIds : null).toEqual([TAG_B]);
    expect(plan.transfers).toHaveLength(0); // 正文没变：不 PUT
    expect(plan.publish).toBeNull(); // 纯拉取轮不发布索引
  });

  it("本地关系版本更新（集合不同）：发布索引且 tagIds 排序成集合；正文 hash 不变也传播", () => {
    const base = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
    const local = world([note("a", "h1", { tagIds: [TAG_C, TAG_B], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]);
    const plan = planSync({ local, base, remote: base, state: state() });
    expect(plan.transfers).toHaveLength(0);
    expect(plan.publishes.lake).toContain("a");
    expect(plan.publish).not.toBeNull();
    expect(plan.publish?.lake.notes.find((n) => n.id === "a")?.tagIds).toEqual([TAG_B, TAG_C]);
  });

  it("集合不同但版本相同：本机顺序视图算作本地更新（本地胜，发布）", () => {
    const base = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]);
    const local = world([note("a", "h1", { tagIds: [TAG_B], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]);
    const plan = planSync({ local, base, remote: base, state: state() });
    expect(plan.publishes.lake).toContain("a");
    expect(plan.publish?.lake.notes.find((n) => n.id === "a")?.tagIds).toEqual([TAG_B]);
  });

  it("远端旧索引没有 tagIds 字段：绝不清空本地关系；本地有关系则发布时用本地关系补字段", () => {
    const local = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]);
    // 旧索引无标签字段 + 远端 updatedAt 更新 ⇒ 元数据 apply-remote；发布条目仍必须带本地标签关系。
    const remote = world([note("a", "h1", { updatedAt: "2026-03-01T00:00:00.000Z" })]);
    const plan = planSync({ local, base: null, remote, state: state() });
    expect(plan.writes.some((w) => w.kind === "apply-remote" && w.space === "lake" && w.id === "a")).toBe(true);
    expect(plan.publishes.lake).toContain("a");
    expect(plan.publish?.lake.notes.find((n) => n.id === "a")?.tagIds).toEqual([TAG_A]);
    expect(plan.publish?.lake.notes.find((n) => n.id === "a")?.tagsUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("两边都没有标签字段：零变更（publish=null、无 writes）", () => {
    const w = world([note("a", "h1")]);
    const plan = planSync({ local: w, base: w, remote: w, state: state() });
    expect(plan.publish).toBeNull();
    expect(plan.writes).toHaveLength(0);
  });

  it("远端显式空集合（版本更新）= 删除文档上的全部标签：apply-remote 携带空 tagIds", () => {
    const base = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
    const remote = world([note("a", "h1", { tagIds: [], tagsUpdatedAt: "2026-03-01T00:00:00.000Z" })]);
    const plan = planSync({ local: base, base, remote, state: state() });
    const write = plan.writes.find((w) => w.kind === "apply-remote" && w.space === "lake" && w.id === "a");
    expect(write && write.kind === "apply-remote" ? write.meta.tagIds : null).toEqual([]);
  });

  // ---- 261105 Review-A 修复：删光标签的收敛（P0）与发布字段合成（P1-1/P1-2） ----

  it("P0 本地删光最后一个标签（版本推进）⇒ 发布条目必须显式带 tagIds: []（对端才能区分「删光」与「旧索引无字段」）", () => {
    const base = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
    const local = world([note("a", "h1", { tagIds: [], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]);
    const plan = planSync({ local, base, remote: base, state: state() });
    const published = plan.publish?.lake.notes.find((n) => n.id === "a");
    expect(published?.tagIds).toEqual([]);
    expect(published?.tagsUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(plan.publishes.lake).toContain("a");
  });

  it("P0 对端收到显式空集合 + 新版本 ⇒ apply-remote 清空本地关系（不再复活）", () => {
    const base = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
    const remote = world([note("a", "h1", { tagIds: [], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]);
    const plan = planSync({ local: base, base, remote, state: state() });
    const write = plan.writes.find((w) => w.kind === "apply-remote" && w.id === "a");
    expect(write && write.kind === "apply-remote" ? write.meta.tagIds : null).toEqual([]);
  });

  it("P1-1 远端标签更新 + 本地内容要发布 ⇒ 发布条目使用远端标签（不拿本地旧标签覆盖远端）", () => {
    const base = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
    const local = world([note("a", "h2", { tagIds: [TAG_A], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]); // 本地改了正文
    const remote = world([note("a", "h1", { tagIds: [TAG_B], tagsUpdatedAt: "2026-02-01T00:00:00.000Z" })]); // 远端改了标签
    const plan = planSync({ local, base, remote, state: state() });
    const published = plan.publish?.lake.notes.find((n) => n.id === "a");
    expect(published?.tagIds).toEqual([TAG_B]);
    expect(published?.tagsUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(published?.contentHash).toBe("h2"); // 内容仍用本地（本轮上传）
  });

  it("P1-2 版本相同、集合不同 ⇒ 两端确定性 tie-break 选同一赢家（不互刷）", () => {
    const lt = "2026-01-01T00:00:00.000Z";
    const aLocal = world([note("a", "h1", { tagIds: [TAG_A], tagsUpdatedAt: lt })]);
    const bRemote = world([note("a", "h1", { tagIds: [TAG_B], tagsUpdatedAt: lt })]);
    const fromA = planSync({ local: aLocal, base: aLocal, remote: bRemote, state: state() });
    const fromB = planSync({ local: bRemote, base: bRemote, remote: aLocal, state: state() });
    const pickA = fromA.publish?.lake.notes.find((n) => n.id === "a")?.tagIds;
    const pickB = fromB.publish?.lake.notes.find((n) => n.id === "a")?.tagIds;
    // 两端必须选出同一个集合（TAG_A vs TAG_B 的字典序赢家）
    expect(pickA).toBeTruthy();
    expect(pickB).toBeTruthy();
    expect(pickA).toEqual(pickB);
  });
});
