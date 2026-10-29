import { describe, expect, it } from "vitest";
import { validatePointer, S3V3_HASH_RE } from "./s3v3/protocol/s3v3Types.js";
import { classifyCloudState } from "./s3v3/protocol/s3v3Pointer.js";
import { decideItem, type ItemDecisionInput } from "./s3v3Decision.js";
import { gatePendingDelete, type CurrentWorld, type PendingDelete } from "./s3v3Gate.js";
import { shouldClearDeletionIntent } from "./s3v3Intent.js";

const H = (c: string) => c.repeat(64);
const EPOCH = "123e4567-e89b-42d3-a456-426614174000";
const EPOCH2 = "223e4567-e89b-42d3-a456-426614174000";
const base = { epoch: EPOCH, generation: 5, lakeCommit: H("a"), quickNotesCommit: H("b") };

describe("validatePointer", () => {
  it("合法 pointer 通过", () => {
    const p = { v: 3, epoch: EPOCH, generation: 1, lake: { commit: H("a") }, quickNotes: { commit: H("b") }, createdAt: "2026-10-25T00:00:00.000Z" };
    expect(validatePointer(p).ok).toBe(true);
  });
  it("版本/epoch/hash 非法被拒", () => {
    expect(validatePointer({ ...base, v: 2 }).ok).toBe(false);
    expect(validatePointer({ v: 3, epoch: "not-uuid", generation: 1, lake: { commit: H("a") }, quickNotes: { commit: H("b") }, createdAt: "x" }).ok).toBe(false);
    expect(validatePointer({ v: 3, epoch: EPOCH, generation: 1, lake: { commit: "short" }, quickNotes: { commit: H("b") }, createdAt: "x" }).ok).toBe(false);
  });
  it("hash 形态常量", () => {
    expect(S3V3_HASH_RE.test(H("a"))).toBe(true);
    expect(S3V3_HASH_RE.test("xyz")).toBe(false);
  });
});

describe("classifyCloudState", () => {
  it.each([
    ["无基线", { pointer: null, baseline: null, cloudHasObjects: false }, "no-baseline"],
    ["pointer 缺失 + 空云", { pointer: null, baseline: base, cloudHasObjects: false }, "empty-cloud"],
    ["pointer 缺失 + 有对象", { pointer: null, baseline: base, cloudHasObjects: true }, "pointer-corrupt"],
    ["epoch 不同", { pointer: { ...base, epoch: EPOCH2 }, baseline: base, cloudHasObjects: true }, "epoch-mismatch"],
    ["generation 倒退", { pointer: { ...base, generation: 4 }, baseline: base, cloudHasObjects: true }, "generation-rollback"],
    ["同 generation 同 commit", { pointer: { v: 3, epoch: EPOCH, generation: 5, lake: { commit: H("a") }, quickNotes: { commit: H("b") }, createdAt: "x" }, baseline: base, cloudHasObjects: true }, "ok"],
    ["同 generation 不同 commit（分叉）", { pointer: { v: 3, epoch: EPOCH, generation: 5, lake: { commit: H("c") }, quickNotes: { commit: H("b") }, createdAt: "x" }, baseline: base, cloudHasObjects: true }, "fork"],
    ["generation 前进", { pointer: { v: 3, epoch: EPOCH, generation: 6, lake: { commit: H("c") }, quickNotes: { commit: H("b") }, createdAt: "x" }, baseline: base, cloudHasObjects: true }, "ok"],
  ])("%s → %s", (_name, input, expected) => {
    expect(classifyCloudState(input as never)).toBe(expected);
  });
});

describe("decideItem（三方决策表）", () => {
  const cases: Array<[string, ItemDecisionInput, string]> = [
    ["restore 优先", { basePresent: true, baseHash: H("a"), localPresent: true, localHash: H("c"), remotePresent: false, remoteHash: null, restorePending: true, localPurgeIntent: false }, "restore-upload"],
    ["本地删除意图压远端", { basePresent: true, baseHash: H("a"), localPresent: false, localHash: null, remotePresent: true, remoteHash: H("c"), restorePending: false, localPurgeIntent: true }, "local-purge-wins"],
    ["无基线 + 本地新建", { basePresent: false, baseHash: null, localPresent: true, localHash: H("a"), remotePresent: false, remoteHash: null, restorePending: false, localPurgeIntent: false }, "upload"],
    ["无基线 + 远端新建", { basePresent: false, baseHash: null, localPresent: false, localHash: null, remotePresent: true, remoteHash: H("a"), restorePending: false, localPurgeIntent: false }, "download"],
    ["有基线 + 本地删（云端仍在）", { basePresent: true, baseHash: H("a"), localPresent: false, localHash: null, remotePresent: true, remoteHash: H("a"), restorePending: false, localPurgeIntent: false }, "download"],
    ["有基线 + 远端已删", { basePresent: true, baseHash: H("a"), localPresent: true, localHash: H("a"), remotePresent: false, remoteHash: null, restorePending: false, localPurgeIntent: false }, "remote-purged-move-to-trash"],
    ["两边都没变", { basePresent: true, baseHash: H("a"), localPresent: true, localHash: H("a"), remotePresent: true, remoteHash: H("a"), restorePending: false, localPurgeIntent: false }, "none"],
    ["本地改", { basePresent: true, baseHash: H("a"), localPresent: true, localHash: H("c"), remotePresent: true, remoteHash: H("a"), restorePending: false, localPurgeIntent: false }, "upload"],
    ["远端改", { basePresent: true, baseHash: H("a"), localPresent: true, localHash: H("a"), remotePresent: true, remoteHash: H("c"), restorePending: false, localPurgeIntent: false }, "download"],
    ["两边都改 → 先提交者胜", { basePresent: true, baseHash: H("a"), localPresent: true, localHash: H("c"), remotePresent: true, remoteHash: H("b"), restorePending: false, localPurgeIntent: false }, "remote-wins-keep-history"],
    ["无基线两端同 hash", { basePresent: false, baseHash: null, localPresent: true, localHash: H("a"), remotePresent: true, remoteHash: H("a"), restorePending: false, localPurgeIntent: false }, "none"],
  ];
  it.each(cases)("%s → %s", (_name, input, expected) => {
    expect(decideItem(input)).toBe(expected);
  });
});

const world: CurrentWorld = {
  lakeCommit: H("a"),
  quickNotesCommit: H("b"),
  notes: [{ id: "n1", contentHash: H("a"), assetsHash: H("d") }],
  quickNotes: [{ id: "q1", contentHash: H("b"), assetsHash: H("e") }],
  declarations: { n1: { declHash: H("d"), filenames: ["a.png"] } },
  quickDeclarations: { q1: { declHash: H("e"), filenames: ["q.png"] } },
};
const basePending = { key: "k", targetEpoch: EPOCH, targetGeneration: 5, targetCommit: H("a"), createdAt: "2026-10-25T00:00:00.000Z" };

describe("gatePendingDelete（执行门禁）", () => {
  const cases: Array<[string, PendingDelete, boolean]> = [
    ["旧正文仍被引用 → 跳过", { ...basePending, kind: "body", noteId: "n1", oldHash: H("a") }, false],
    ["旧正文已被替换 → 删", { ...basePending, kind: "body", noteId: "n1", oldHash: H("c") }, true],
    ["条目已不存在 → 删", { ...basePending, kind: "body", noteId: "n9", oldHash: H("a") }, true],
    ["附件仍被声明引用 → 跳过", { ...basePending, kind: "asset", noteId: "n1", filename: "a.png" }, false],
    ["附件已移出声明 → 删", { ...basePending, kind: "asset", noteId: "n1", filename: "b.png" }, true],
    ["声明版本仍被引用 → 跳过", { ...basePending, kind: "declaration", noteId: "n1", oldDeclHash: H("d") }, false],
    ["声明版本已被替换 → 删", { ...basePending, kind: "declaration", noteId: "n1", oldDeclHash: H("c") }, true],
    ["purge 前缀但条目仍在 → 跳过", { ...basePending, kind: "purge-prefix", noteId: "n1" }, false],
    ["purge 前缀且条目消失 → 删", { ...basePending, kind: "purge-prefix", noteId: "n9" }, true],
    ["旧索引仍被指针引用 → 跳过", { ...basePending, kind: "index", space: "lake", oldIndexHash: H("a") }, false],
    ["旧索引已替换 → 删", { ...basePending, kind: "index", space: "lake", oldIndexHash: H("c") }, true],
    ["小记正文仍被引用 → 跳过", { ...basePending, kind: "quick-note-body", noteId: "q1", oldHash: H("b") }, false],
    ["小记图片仍被声明引用 → 跳过", { ...basePending, kind: "quick-note-asset", noteId: "q1", filename: "q.png" }, false],
    ["小记声明仍被引用 → 跳过", { ...basePending, kind: "quick-note-declaration", noteId: "q1", oldDeclHash: H("e") }, false],
    ["小记 purge 但条目仍在 → 跳过", { ...basePending, kind: "quick-note-purge-prefix", noteId: "q1" }, false],
  ];
  it.each(cases)("%s", (_name, item, expected) => {
    expect(gatePendingDelete(item, world).execute).toBe(expected);
  });
  it("声明与索引不一致时保守跳过", () => {
    const w2: CurrentWorld = { ...world, declarations: { n1: { declHash: H("f"), filenames: ["a.png"] } } };
    const item: PendingDelete = { ...basePending, kind: "asset", noteId: "n1", filename: "a.png" };
    expect(gatePendingDelete(item, w2).execute).toBe(false);
  });
});

describe("deletionIntent 生命周期", () => {
  const intent = { noteId: "n1", targetEpoch: EPOCH, targetGeneration: 5 };
  const ctx = (over: Partial<{ pointerEpoch: string; pointerGeneration: number; indexHasId: boolean; restored: boolean }>) => ({
    pointerEpoch: EPOCH,
    pointerGeneration: 6,
    indexHasId: false,
    restored: false,
    ...over,
  });
  it("更高 generation 且索引不含该 id → 清除", () => {
    expect(shouldClearDeletionIntent(intent, ctx({}))).toBe(true);
  });
  it("发布成功但 generation 未前进 → 不清除", () => {
    expect(shouldClearDeletionIntent(intent, ctx({ pointerGeneration: 5 }))).toBe(false);
  });
  it("同 generation 不同 commit（分叉）→ 不清除", () => {
    expect(shouldClearDeletionIntent(intent, ctx({ pointerGeneration: 5, indexHasId: true }))).toBe(false);
  });
  it("更高 generation 但索引又含该 id（迟到覆盖）→ 不清除", () => {
    expect(shouldClearDeletionIntent(intent, ctx({ indexHasId: true }))).toBe(false);
  });
  it("显式 restore 是唯一提前清除条件", () => {
    expect(shouldClearDeletionIntent(intent, ctx({ pointerGeneration: 5, indexHasId: true, restored: true }))).toBe(true);
  });
  it("epoch 不同 → 保留（由换世界流程处理）", () => {
    expect(shouldClearDeletionIntent(intent, ctx({ pointerEpoch: EPOCH2 }))).toBe(false);
    expect(shouldClearDeletionIntent(intent, ctx({ pointerEpoch: EPOCH2, restored: true }))).toBe(true);
  });
});
