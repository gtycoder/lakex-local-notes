import { describe, expect, it } from "vitest";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry } from "../protocol/index.js";
import type { SyncPlan } from "../plan/types.js";
import { buildPublishIndex, type PublishWorld } from "./buildPublishIndex.js";

const note = (id: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({
  id, title: id, parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "h-" + id, ...over,
});
const folder = (id: string, over: Partial<LakeFolderEntry> = {}): LakeFolderEntry => ({
  id, title: id, parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z", ...over,
});
const quick = (id: string, over: Partial<QuickNoteEntry> = {}): QuickNoteEntry => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "h-" + id, ...over,
});

const planWith = (world: PublishWorld | null): SyncPlan => ({
  version: 4, reads: [], writes: [], transfers: [], deletes: [], publishes: { lake: [], quickNotes: [] },
  publish: world, intentChanges: [], warnings: [], total: { ops: 0, bytes: 0 },
});

const remoteWorld = (notes: LakeNoteEntry[] = [], folders: LakeFolderEntry[] = [], items: QuickNoteEntry[] = []): PublishWorld => ({
  lake: { v: 3, space: "lake", notes, folders },
  quickNotes: { v: 3, space: "quickNotes", items, tags: [] },
});

describe("E2-2a buildPublishIndex（纯合成）", () => {
  it("publish=null ⇒ 本轮不提交", () => {
    expect(buildPublishIndex(planWith(null), remoteWorld(), { failedUploads: [], assetsHashes: [] })).toBeNull();
  });

  it("无覆盖时等于 plan.publish（不偷偷改条目）", () => {
    const merged = remoteWorld([note("a", { title: "new", assetsHash: "d1" })], [folder("f")], [quick("q")]);
    const out = buildPublishIndex(planWith(merged), remoteWorld([note("a")]), { failedUploads: [], assetsHashes: [] });
    expect(out).toEqual(merged);
    expect(out).not.toBe(merged); // 不返回调用方对象引用（防外部改动）
  });

  it("上传失败且远端有同 id ⇒ 回退远端旧条目（绝不让索引引用未落盘正文/声明）", () => {
    const merged = remoteWorld([note("a", { title: "local", contentHash: "NEW" })]);
    const remote = remoteWorld([note("a", { title: "remote", contentHash: "OLD" })]);
    const out = buildPublishIndex(planWith(merged), remote, { failedUploads: [{ space: "lake", id: "a" }], assetsHashes: [] })!;
    expect(out.lake.notes).toEqual([note("a", { title: "remote", contentHash: "OLD" })]);
  });

  it("上传失败且远端也没有 ⇒ 从索引移除（新增条目失败不得进索引）", () => {
    const merged = remoteWorld([note("a"), note("b")]);
    const out = buildPublishIndex(planWith(merged), remoteWorld([note("a")]), { failedUploads: [{ space: "lake", id: "b" }], assetsHashes: [] })!;
    expect(out.lake.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("assetsHashes 覆盖 / 清空 assetsHash", () => {
    const merged = remoteWorld([note("a", { assetsHash: "old" }), note("b", { assetsHash: "old" })]);
    const out = buildPublishIndex(planWith(merged), remoteWorld(), {
      failedUploads: [],
      assetsHashes: [{ space: "lake", id: "a", assetsHash: "new" }, { space: "lake", id: "b", assetsHash: undefined }],
    })!;
    expect(out.lake.notes.find((n) => n.id === "a")!.assetsHash).toBe("new");
    expect(out.lake.notes.find((n) => n.id === "b")!.assetsHash).toBeUndefined();
  });

  it("小记同样适用失败回退与 assetsHash，标签整体保留", () => {
    const merged: PublishWorld = {
      lake: { v: 3, space: "lake", notes: [], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: [quick("q", { contentHash: "NEW" }), quick("r")], tags: [{ id: "t", name: "tag", createdAt: "x", updatedAt: "x" }] },
    };
    const remote = remoteWorld([], [], [quick("q", { contentHash: "OLD" })]);
    const out = buildPublishIndex(planWith(merged), remote, {
      failedUploads: [{ space: "quickNotes", id: "q" }],
      assetsHashes: [{ space: "quickNotes", id: "r", assetsHash: "d2" }],
    })!;
    expect(out.quickNotes.items[0].contentHash).toBe("OLD");
    expect(out.quickNotes.items[1].assetsHash).toBe("d2");
    expect(out.quickNotes.tags).toEqual(merged.quickNotes.tags);
  });

  it("文件夹原样带出（无资产/无上传失败语义）", () => {
    const merged = remoteWorld([], [folder("f", { title: "F" })],[ ]);
    const out = buildPublishIndex(planWith(merged), remoteWorld(), { failedUploads: [], assetsHashes: [] })!;
    expect(out.lake.folders.map((f) => f.id)).toEqual(["f"]);
  });
});
