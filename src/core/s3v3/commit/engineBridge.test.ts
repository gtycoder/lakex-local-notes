import { describe, expect, it } from "vitest";
import type { DeviceState } from "../../s3v3DeviceStore.js";
import { indexHashOf, serializeLakeIndex, serializeQuickNotesIndex, type LakeNoteEntry, type QuickNoteEntry } from "../protocol/index.js";
import { finalizeRemotePurged, intentLogOf, mergeRoundIntoState, planStateOf, planWorldOf } from "./engineBridge.js";
import type { RoundResult } from "./runSyncRound.js";

const ISO = "2026-10-28T00:00:00.000Z";
const note = (id: string): LakeNoteEntry => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: "h-" + id });
const quick = (id: string): QuickNoteEntry => ({ id, createdAt: ISO, updatedAt: ISO, contentHash: "q-" + id });

const state = (over: Partial<DeviceState> = {}): DeviceState => {
  const lake = { v: 3 as const, space: "lake" as const, notes: [note("a")], folders: [] };
  const quickNotes = { v: 3 as const, space: "quickNotes" as const, items: [quick("q")], tags: [] };
  return { lake, quickNotes, folders: [], intents: [], pending: [], remotePurged: ["z"], restorePending: [], quickDeletes: ["qd"], quickPurges: ["qp"], quickPurgeTimes: {}, ...over };
};

const round = (over: Partial<RoundResult> = {}): RoundResult => ({
  plan: { version: 4, reads: [], writes: [], transfers: [], deletes: [], publishes: { lake: [], quickNotes: [] }, publish: null, intentChanges: [], warnings: [], total: { ops: 0, bytes: 0 } },
  apply: { entries: [], declarations: [], uploaded: { documents: 0, quickNotes: 0, bytes: 0 }, downloaded: { documents: 0, quickNotes: 0, bytes: 0 }, deletedObjects: 0, warnings: [], failedUploads: [], errors: [] },
  assets: { uploaded: { files: 0, bytes: 0 }, downloaded: { files: 0, bytes: 0 }, assetsHashes: [], warnings: [], errors: [], failedDownloads: [] },
  publish: null,
  commit: { status: "skipped", reason: "no-publish-plan" },
  deleted: 0, remainingPending: [], intents: { intents: [], restorePending: [] },
  nextPointer: { v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit: "x" }, quickNotes: { commit: "y" }, createdAt: ISO },
  warnings: [],
  ...over,
});

describe("E2-3 engineBridge：规划输入映射", () => {
  it("本地世界/标记逐个字段映射（漏传会导致已删条目复活或意图失效）", () => {
    const s = state({ intents: [{ noteId: "a", targetEpoch: "e", targetGeneration: 3 }] });
    const w = planWorldOf(s);
    expect(w.lake).toEqual(s.lake);
    expect(w.quickNotes).toEqual(s.quickNotes);
    expect(planStateOf(s)).toEqual({
      restorePending: [], purgeIntents: ["a"], folderPurgeIntents: [], quickDeletes: ["qd"], purgedQuickIds: ["qp"],
    });
    expect(intentLogOf(s).intents.map((i) => i.noteId)).toEqual(["a"]);
  });
});

describe("E2-3 engineBridge：结果回写", () => {
  it("发布 ⇒ 索引换成发布版；待删队列/意图换成结算结果；其它标记原样保留", () => {
    const s = state();
    const lake = { v: 3 as const, space: "lake" as const, notes: [note("a"), note("b")], folders: [] };
    const quickNotes = { v: 3 as const, space: "quickNotes" as const, items: [], tags: [] };
    const next = mergeRoundIntoState(s, round({
      commit: { status: "published", pointer: round().nextPointer, generation: 2, lakeCommit: indexHashOf(serializeLakeIndex(lake)), quickNotesCommit: indexHashOf(serializeQuickNotesIndex(quickNotes)), wroteLake: true, wroteQuick: true },
      publish: { lake, quickNotes },
      remainingPending: [],
      intents: { intents: [{ noteId: "a", targetEpoch: "e", targetGeneration: 2 }], restorePending: ["b"] },
    }));
    expect(next.lake.notes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(next.intents.map((i) => i.noteId)).toEqual(["a"]);
    expect(next.restorePending).toEqual(["b"]);
    expect(next.remotePurged).toEqual(["z"]); // 标记类字段仍归引擎，映射不擅自清
  });

  it("finalizeRemotePurged：恢复 / 远端重现 ⇒ 标记失效；其余标记必须保留（丢了 = 已删文档被复活上传）", () => {
    const s = state({ remotePurged: ["res", "back", "keep"] });
    // 未变化时返回同一对象（saveState 之前大量轮次走这条快路径，别为无变化造新 state）
    expect(finalizeRemotePurged(s, { remoteIds: ["other"] })).toBe(s);
    const next = finalizeRemotePurged(s, { remoteIds: ["back"], restorePending: ["res"] });
    expect(next).not.toBe(s);
    expect(next.remotePurged).toEqual(["keep"]);
    // 顺序保持输入顺序（不要被 Set 重排：信封/DB 对拍依赖稳定顺序）
    expect(finalizeRemotePurged(state({ remotePurged: ["z", "a", "m"] }), { remoteIds: ["a"] }).remotePurged).toEqual(["z", "m"]);
    // 缺省 restorePending 时读 state 自己的（调用方常省略）
    expect(finalizeRemotePurged(state({ remotePurged: ["x"], restorePending: ["x"] }), { remoteIds: [] }).remotePurged).toEqual([]);
  });

  it("未发布/重试 ⇒ 索引与待删队列保持原样（绝不因为本轮没发布就清空本地真相）", () => {
    const s = state();
    const skipped = mergeRoundIntoState(s, round({ remainingPending: [] }));
    expect(skipped.lake).toEqual(s.lake); // 内容不变（新对象没关系，但绝不丢条目/字段）
    expect(skipped.pending).toEqual([]); // skipped：队列照结算结果（门禁不放行的已出队）
    const retry = mergeRoundIntoState(s, round({ commit: { status: "retry", reason: "pointer-moved" } }));
    expect(retry.lake).toEqual(s.lake);
    expect(retry.pending).toBe(s.pending); // retry：队列保持不动，下一轮重来
  });
});
