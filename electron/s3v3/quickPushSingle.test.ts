import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { serializeLakeIndex, serializeQuickNotesIndex, indexHashOf, type LakeIndex, type QuickNotesIndex } from "../../src/core/s3v3Index.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, lastModified: 0 })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
}

const tmp = async (name: string) => fs.mkdtemp(path.join(os.tmpdir(), "s3v3-push-" + name + "-"));
async function freshStore(name: string) { const root = await tmp(name); const store = new FileDeviceStore(root); await store.init(); return store; }
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
const engine = (remote: MemoryRemote, store: FileDeviceStore, id = "A") => new S3v3SyncEngine({ remote, device: store, deviceId: id });

async function addQuick(store: FileDeviceStore, id: string, body: string, opts: { updatedAt?: string; tagIds?: string[]; tagsUpdatedAt?: string } = {}) {
  const now = opts.updatedAt ?? new Date().toISOString();
  const bytes = enc(body);
  await store.writeQuickBody(id, bytes);
  const state = (await store.loadState()) ?? emptyState();
  state.quickNotes.items = [...state.quickNotes.items.filter((q) => q.id !== id), {
    id, createdAt: "2026-10-25T00:00:00.000Z", updatedAt: now, contentHash: sha256Hex(bytes),
    ...(opts.tagIds ? { tagIds: opts.tagIds } : {}), ...(opts.tagsUpdatedAt ? { tagsUpdatedAt: opts.tagsUpdatedAt } : {}),
  }];
  await store.saveState(state);
  return sha256Hex(bytes);
}
const pointerOf = async (remote: MemoryRemote) => JSON.parse(dec((await remote.get("meta/pointer.json"))!));
const quickIndexOf = async (remote: MemoryRemote, commit: string) => JSON.parse(dec((await remote.get("quick-notes/meta/index/" + commit + ".json"))!)) as QuickNotesIndex;

describe("单条小记推送（parity E2：只 upsert 这一条）", () => {
  it("只替换该条；其余条目/标签逐字节不变；lake commit 不动；generation +1；重复推送 unchanged", async () => {
    const remote = new MemoryRemote();
    const a = await freshStore("a");
    await addQuick(a, "q1", "one", { tagIds: ["t1"], tagsUpdatedAt: "2026-10-25T01:00:00.000Z" });
    await addQuick(a, "q2", "two");
    const st = (await a.loadState())!;
    st.quickNotes.tags = [{ id: "t1", name: "Tag", sortOrder: 0, createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z" }];
    await a.saveState(st);
    await engine(remote, a).sync({ onEmptyCloud: "upload" });

    const p0 = await pointerOf(remote);
    const idx0 = await quickIndexOf(remote, p0.quickNotes.commit);
    const q2Before = idx0.items.find((q) => q.id === "q2");
    const tagsBefore = JSON.stringify(idx0.tags ?? []);

    // 本地改 q1（正文 + updatedAt）
    const v2 = await addQuick(a, "q1", "one-v2", { updatedAt: new Date(Date.now() + 5000).toISOString(), tagIds: ["t1"], tagsUpdatedAt: "2026-10-25T01:00:00.000Z" });
    const r = await engine(remote, a).pushQuickNote("q1");
    expect(r.status).toBe("pushed");
    if (r.status !== "pushed") throw new Error("unreachable");
    expect(r.uploadedContent).toBe(true);
    expect(r.generation).toBe(p0.generation + 1);

    const p1 = await pointerOf(remote);
    expect(p1.generation).toBe(p0.generation + 1);
    expect(p1.lake.commit).toBe(p0.lake.commit); // 小记推送不得动 lake
    const idx1 = await quickIndexOf(remote, p1.quickNotes.commit);
    expect(idx1.items.find((q) => q.id === "q1")!.contentHash).toBe(v2);
    expect(idx1.items.find((q) => q.id === "q2")).toEqual(q2Before);
    expect(idx1.items.length).toBe(2);
    expect(JSON.stringify(idx1.tags ?? [])).toBe(tagsBefore);
    expect(idx1.purged ?? []).toEqual(idx0.purged ?? []);

    // 再推一次：内容没变 → unchanged，不涨 generation
    const r2 = await engine(remote, a).pushQuickNote("q1");
    expect(r2.status).toBe("pushed");
    if (r2.status !== "pushed") throw new Error("unreachable");
    expect(r2.unchanged).toBe(true);
    expect(r2.generation).toBe(p1.generation);
    expect((await pointerOf(remote)).generation).toBe(p1.generation);
  });

  it("云端无 pointer → full-sync(no-cloud)；云端已初始化但本地无该条 → not-found", async () => {
    const remote = new MemoryRemote();
    const a = await freshStore("b");
    await addQuick(a, "q1", "x");
    const r = await engine(remote, a).pushQuickNote("q1");
    expect(r).toEqual({ status: "full-sync", reason: "no-cloud" });
    // 先让云端有 pointer/baseline（否则 no-cloud 先于 not-found 命中）
    await engine(remote, a).sync({ onEmptyCloud: "upload" });
    const r2 = await engine(remote, a).pushQuickNote("nope");
    expect(r2).toEqual({ status: "not-found" });
  });

  it("baseline 与 pointer 不同代 → full-sync(cloud-changed)", async () => {
    const remote = new MemoryRemote();
    const a = await freshStore("c");
    await addQuick(a, "q1", "x");
    await engine(remote, a).sync({ onEmptyCloud: "upload" });
    const p = await pointerOf(remote);
    remote.objects.set("meta/pointer.json", { bytes: enc(JSON.stringify({ ...p, generation: p.generation + 1 })), gzip: false });
    const r = await engine(remote, a).pushQuickNote("q1");
    expect(r).toEqual({ status: "full-sync", reason: "cloud-changed" });
  });

  it("远端墓碑且本机无恢复标记 → full-sync(remote-deleted)", async () => {
    const remote = new MemoryRemote();
    const a = await freshStore("d");
    await addQuick(a, "q1", "x");
    const lake: LakeIndex = { v: 3, space: "lake", notes: [], folders: [] };
    const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], purged: ["q1"] };
    const lakeCommit = indexHashOf(serializeLakeIndex(lake));
    const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
    await remote.put("meta/index/" + lakeCommit + ".json", enc(serializeLakeIndex(lake)), { gzip: true });
    await remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(serializeQuickNotesIndex(quick)), { gzip: true });
    const pointer = { v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: new Date().toISOString(), deviceId: "A" };
    await remote.put("meta/pointer.json", enc(JSON.stringify(pointer)));
    await a.saveBaseline({ epoch: pointer.epoch, generation: 1, lakeCommit, quickNotesCommit: quickCommit, lake, quickNotes: quick });
    const r = await engine(remote, a).pushQuickNote("q1");
    expect(r).toEqual({ status: "full-sync", reason: "remote-deleted" });
  });
});
