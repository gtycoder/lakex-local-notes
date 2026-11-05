import { describe, expect, it } from "vitest";
import type { LakeFolderEntry, LakeIndex, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry, QuickNotesIndex } from "../protocol/index.js";
import { planSync, type PlanWorld } from "./plan.js";

/** E1-2 决策层单测：不碰 IO，只锁「同一份三世界快照 → 操作集」的形态。 */

const note = (id: string, contentHash: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({
  id, title: id, parentId: "nb", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash, ...over,
});
const folder = (id: string, over: Partial<LakeFolderEntry> = {}): LakeFolderEntry => ({
  id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z", ...over,
});
const quick = (id: string, contentHash: string, over: Partial<QuickNoteEntry> = {}): QuickNoteEntry => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash, ...over,
});

function world(notes: LakeNoteEntry[] = [], folders: LakeFolderEntry[] = [], items: QuickNoteEntry[] = [], tags: QuickNoteTagEntry[] = []): PlanWorld {
  const lake: LakeIndex = { v: 3, space: "lake", notes, folders };
  const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items, tags };
  return { lake, quickNotes, folders };
}

const state = (over: Partial<Parameters<typeof planSync>[0]["state"]> = {}) => ({
  restorePending: [], purgeIntents: [], folderPurgeIntents: [], ...over,
});

describe("planSync（v4 E1-2 决策层）", () => {
  it("零变更：publish=null、无 reads/writes/transfers/deletes", () => {
    const w = world([note("a", "h1")]);
    const plan = planSync({ local: w, base: w, remote: w, state: state() });
    expect(plan.publish).toBeNull();
    expect(plan.reads).toHaveLength(0);
    expect(plan.writes).toHaveLength(0);
    expect(plan.transfers).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.total.ops).toBe(0);
  });

  it("远端更新：apply-remote + 拉正文；纯拉取轮不发布索引", () => {
    const base = world([note("a", "h1")]);
    const remote = world([note("a", "h2")]);
    const plan = planSync({ local: base, base, remote, state: state() });
    expect(plan.writes.some((w) => w.kind === "apply-remote" && w.id === "a")).toBe(true);
    expect(plan.reads.some((r) => r.kind === "body" && r.id === "a" && r.hash === "h2")).toBe(true);
    expect(plan.transfers).toHaveLength(0);
    expect(plan.publish).toBeNull(); // 索引已在云端；v3 纯拉取不发布
  });

  it("本地更新：PUT 正文 + 发布索引（不读远端正文）", () => {
    const base = world([note("a", "h1")]);
    const local = world([note("a", "h2")]);
    const plan = planSync({ local, base, remote: base, state: state() });
    const put = plan.transfers.find((t) => t.op === "put" && t.id === "a");
    expect(put?.space).toBe("lake");
    expect(plan.reads.some((r) => r.kind === "body" && r.id === "a")).toBe(false);
    expect(plan.publish).not.toBeNull();
  });

  it("本地 purge 意图：生成 user-purge 删除（含对象前缀）并发布", () => {
    const base = world([note("a", "h1")]);
    const local = world([]);
    const plan = planSync({ local, base, remote: base, state: state({ purgeIntents: ["a"] }) });
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0]?.prefixes).toContain("objects/a-");
    expect(plan.publish?.lake.notes).toHaveLength(0);
  });

  it("显式恢复（无基线）：upload + PUT 正文", () => {
    const local = world([note("a", "h1")]);
    const plan = planSync({ local, base: null, remote: world([]), state: state({ restorePending: ["a"] }) });
    expect(plan.transfers.some((t) => t.op === "put" && t.id === "a")).toBe(true);
    expect(plan.publish?.lake.notes[0]?.id).toBe("a");
  });

  it("冲突（先提交者胜）：远端胜 + 本地留档 + 结构化 warning；本端不重发索引", () => {
    const base = world([note("a", "h1")]);
    const local = world([note("a", "h2")]);
    const remote = world([note("a", "h3")]);
    const plan = planSync({ local, base, remote, state: state() });
    expect(plan.writes.some((w) => w.kind === "archive-local" && w.id === "a")).toBe(true);
    expect(plan.warnings.some((w) => w.code === "conflict_kept_history")).toBe(true);
    expect(plan.writes.some((w) => w.kind === "apply-remote" && w.id === "a" && w.bodyHash === "h3")).toBe(true);
    expect(plan.publish).toBeNull();
  });

  it("小记：远端更新走同一决策层（space=quickNotes；纯拉取不发布）", () => {
    const base = world([], [], [quick("q1", "h1")]);
    const remote = world([], [], [quick("q1", "h2")]);
    const plan = planSync({ local: base, base, remote, state: state() });
    expect(plan.writes.some((w) => w.kind === "apply-remote" && w.space === "quickNotes" && w.id === "q1")).toBe(true);
    expect(plan.publish).toBeNull();
  });

  it("目录：远端新增 → 纯拉取轮不发布", () => {
    const base = world([], []);
    const remote = world([], [folder("f1")]);
    const plan = planSync({ local: base, base, remote, state: state() });
    expect(plan.publish).toBeNull();
  });

  it("total.ops 等于各操作数组长度之和（确定性进度分母）", () => {
    const base = world([note("a", "h1")]);
    const remote = world([note("a", "h2")]);
    const plan = planSync({ local: base, base, remote, state: state() });
    const expected = plan.reads.length + plan.writes.length + plan.transfers.length + plan.deletes.length;
    expect(plan.total.ops).toBe(expected);
  });
});
  it("发布集 publishes：metadata-only 轮次（正文未变、只改标题/锁）必须出现，且没有 body PUT", () => {
    const base = world([note("a", "h1")]);
    const local = world([note("a", "h1", { title: "renamed", isLocked: true, updatedAt: "2026-02-02T00:00:00.000Z" })]);
    const plan = planSync({ local, base, remote: base, state: state() });
    // 这是 E2-1b 的前提：只看 transfers 会漏掉这类上传（正文没变 ⇒ 没有 body PUT）。
    expect(plan.transfers.filter((t) => t.op === "put")).toHaveLength(0);
    expect(plan.publishes.lake).toEqual(["a"]);
    expect(plan.publishes.quickNotes).toEqual([]);
    expect(plan.publish).not.toBeNull();
  });

  it("发布集 publishes：纯拉取轮为空（远端更新 / 零变更都不该进发布集）", () => {
    const base = world([note("a", "h1")]);
    const remote = world([note("a", "h2")]);
    const pullOnly = planSync({ local: base, base, remote, state: state() });
    expect(pullOnly.publishes).toEqual({ lake: [], quickNotes: [] });
    const noop = planSync({ local: base, base, remote: base, state: state() });
    expect(noop.publishes).toEqual({ lake: [], quickNotes: [] });
  });

  it("发布集 publishes：小记按空间分开记录", () => {
    const base = world([], [], [quick("q", "h1")]);
    const local = world([], [], [quick("q", "h2")]);
    const plan = planSync({ local, base, remote: base, state: state() });
    expect(plan.publishes.quickNotes).toEqual(["q"]);
    expect(plan.publishes.lake).toEqual([]);
    expect(plan.transfers.some((t) => t.op === "put" && t.space === "quickNotes" && t.id === "q")).toBe(true);
  });
  describe("标签目录同步（261105 审计修复）", () => {
    const tid = "t_0123456789abcdef";
    const tag = (name: string, over: Partial<QuickNoteTagEntry> = {}): QuickNoteTagEntry => ({
      id: tid, name,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...over,
    });

    it("本地改名/置顶（没有小记变更）也必须发布，并带上合并后的目录", () => {
      const old = tag("旧名");
      const renamed = { ...old, name: "新名", updatedAt: "2026-02-01T00:00:00.000Z" };
      const plan = planSync({
        local: world([], [], [], [renamed]), base: world([], [], [], [old]), remote: world([], [], [], [old]), state: state(),
      });
      expect(plan.publish).not.toBeNull();
      expect(plan.publish!.quickNotes.tags?.map((entry) => entry.name)).toEqual(["新名"]);
    });

    it("纯远端目录更新：不重复发布，但 plan.quickTags 采用远端版本（供状态回写）", () => {
      const old = tag("旧名");
      const renamed = { ...old, name: "新名", updatedAt: "2026-02-01T00:00:00.000Z" };
      const plan = planSync({
        local: world([], [], [], [old]), base: world([], [], [], [old]), remote: world([], [], [], [renamed]), state: state(),
      });
      expect(plan.publish).toBeNull();
      expect(plan.quickTags?.map((entry) => entry.name)).toEqual(["新名"]);
    });

    it("标签关系只改本机顺序（集合相同）⇒ 不发布：顺序是设备本地视图", () => {
      const base = world([], [], [quick("q", "h1", { tagIds: ["a", "b"], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
      const local = world([], [], [quick("q", "h1", { tagIds: ["b", "a"], tagsUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
      const plan = planSync({ local, base, remote: base, state: state() });
      expect(plan.publish).toBeNull();
      expect(plan.publishes.quickNotes).toEqual([]);
    });

    it("聚合发布不丢远端标签：本端小记变更时发布的 tags 是 LWW 合并结果", () => {
      const source = tag("来源");
      const remoteNewer = { ...source, name: "远端改名", updatedAt: "2026-02-01T00:00:00.000Z" };
      const base = world([], [], [quick("q", "h1")], [source]);
      const local = world([], [], [quick("q", "h2")], [source]);
      const remote = world([], [], [quick("q", "h1")], [remoteNewer]);
      const plan = planSync({ local, base, remote, state: state() });
      expect(plan.publish).not.toBeNull();
      expect(plan.publish!.quickNotes.tags?.map((entry) => entry.name)).toEqual(["远端改名"]);
    });
  });
