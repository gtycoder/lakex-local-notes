import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { indexHashOf, indexKey, lakeBodyKey, serializeLakeIndex, serializeQuickNotesIndex, type LakeFolderEntry, type LakeNoteEntry, type S3v3Pointer } from "../protocol/index.js";
import type { AssetDeclEntry } from "../protocol/index.js";
import type { PendingDelete } from "../../s3v3Gate.js";
import { emptyIntentLog, type IntentLogState } from "./intentLog.js";
import { runSyncRound, type RoundPorts } from "./runSyncRound.js";
import type { PlanWorld } from "../plan/plan.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-28T00:00:00.000Z";
const EPOCH = "11111111-1111-4111-8111-111111111111";

const doc = (id: string, text: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H(text), ...over });
const world = (notes: LakeNoteEntry[], folders: LakeFolderEntry[] = []): PlanWorld => ({ lake: { v: 3, space: "lake", notes, folders }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders });

class MemPorts implements RoundPorts {
  remote = new Map<string, Uint8Array>();
  local = new Map<string, Uint8Array>();
  assetsLocal = new Map<string, AssetDeclEntry[]>();
  pending: PendingDelete[] = [];
  intents: IntentLogState = emptyIntentLog();
  async getRemote(key: string) { return this.remote.get(key) ?? null; }
  async putRemote(key: string, bytes: Uint8Array) { this.remote.set(key, bytes); }
  async deleteRemoteKeys(keys: string[]) { keys.forEach((k) => this.remote.delete(k)); }
  async deleteRemotePrefix(prefix: string) { const ks = [...this.remote.keys()].filter((k) => k.startsWith(prefix)); ks.forEach((k) => this.remote.delete(k)); return ks.length; }
  async readLocalBody(space: string, id: string) { return this.local.get(space + ":" + id) ?? null; }
  async writeLocalBody(space: string, id: string, bytes: Uint8Array) { this.local.set(space + ":" + id, bytes); }
  async archiveLocal() {}
  async deleteLocalBody(space: string, id: string) { this.local.delete(space + ":" + id); }
  async listLocalAssets(space: string, id: string) { return this.assetsLocal.get(space + ":" + id) ?? []; }
  async readLocalAsset(space: string, id: string, filename: string) { return this.local.get(space + ":" + id + "/" + filename) ?? null; }
  async writeLocalAsset(space: string, id: string, filename: string, bytes: Uint8Array) { this.local.set(space + ":" + id + "/" + filename, bytes); }
  async loadIntentLog() { return this.intents; }
  async saveIntentLog(s: IntentLogState) { this.intents = s; }
  async loadPending() { return this.pending; }
  async savePending(p: PendingDelete[]) { this.pending = p; }
}

async function seeded(base: PlanWorld) {
  const ports = new MemPorts();
  const lakeSer = serializeLakeIndex(base.lake);
  const quickSer = serializeQuickNotesIndex(base.quickNotes);
  const lakeCommit = indexHashOf(lakeSer);
  const quickCommit = indexHashOf(quickSer);
  ports.remote.set(indexKey("lake", lakeCommit), enc(lakeSer));
  ports.remote.set(indexKey("quickNotes", quickCommit), enc(quickSer));
  for (const n of base.lake.notes) ports.remote.set(lakeBodyKey(n.id, n.contentHash), enc("BODY:" + n.contentHash));
  const pointer: S3v3Pointer = { v: 3, epoch: EPOCH, generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO, deviceId: "seed" };
  ports.remote.set("meta/pointer.json", enc(JSON.stringify(pointer)));
  return { ports, pointer };
}

describe("E2-3 runSyncRound（四相编排）", () => {
  it("本地更新 ⇒ 发布新一代：正文上传、索引更新、意图与待删队列保持干净", async () => {
    const base = world([doc("a", "v1")]);
    const { ports, pointer } = await seeded(base);
    ports.local.set("lake:a", enc("v2"));
    const local = world([doc("a", "v2", { updatedAt: "2026-10-28T01:00:00.000Z" })]);
    const out = await runSyncRound({ local, base, remote: base, basePointer: pointer, deviceId: "me" }, ports);
    expect(out.commit.status).toBe("published");
    expect(out.nextPointer.generation).toBe(2);
    expect(dec(ports.remote.get(lakeBodyKey("a", H("v2")))!)).toBe("v2");
    expect(out.intents.intents).toEqual([]);
    expect(out.remainingPending).toEqual([]);
    expect(out.deleted).toBe(0);
  });

  it("本地彻底删除（带意图）⇒ 发布已删索引 + 对象被清理，意图被钉到新代", async () => {
    const base = world([doc("a", "v1")]);
    const { ports, pointer } = await seeded(base);
    // 真实链路里意图来自持久账本（state.intents），plan 的 purgeIntents 由它派生。
    ports.intents = { intents: [{ noteId: "a", targetEpoch: EPOCH, targetGeneration: 1 }], restorePending: [] };
    const out = await runSyncRound({
      local: world([]), base, remote: base, basePointer: pointer, deviceId: "me",
      state: { restorePending: [], purgeIntents: ["a"], folderPurgeIntents: [] },
    }, ports);
    expect(out.commit.status).toBe("published");
    const publishedIndex = JSON.parse(dec(ports.remote.get(indexKey("lake", out.nextPointer.lake.commit))!)) as { notes: Array<{ id: string }> };
    expect(publishedIndex.notes.map((n) => n.id)).toEqual([]); // 索引里已经没有该文档
    expect(ports.remote.has(lakeBodyKey("a", H("v1")))).toBe(false);
    expect(out.intents.intents.map((i) => i.noteId)).toEqual(["a"]);
    expect(out.intents.intents[0].targetGeneration).toBe(2); // 发布后钉到新代（防迟到覆盖）
  });

  it("零变更 ⇒ 不发布、不清理；意图按「更高代 + 索引缺席」结算", async () => {
    const base = world([doc("a", "v1")]);
    const { ports, pointer } = await seeded(base);
    ports.intents = { intents: [{ noteId: "a", targetEpoch: EPOCH, targetGeneration: 1 }], restorePending: [] };
    const out = await runSyncRound({ local: base, base, remote: base, basePointer: pointer, deviceId: "me" }, ports);
    // 零变更 ⇒ plan.publish=null ⇒ commit 短路成 skipped（等价于 unchanged：不写任何对象）
    expect(out.commit.status).toBe("skipped");
    expect(out.nextPointer.generation).toBe(1);
    expect(out.deleted).toBe(0);
    expect(out.intents.intents).toHaveLength(1); // 同代不清（防迟到覆盖）
  });
});
