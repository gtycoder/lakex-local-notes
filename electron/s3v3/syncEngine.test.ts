import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import type { LakeNoteEntry } from "../../src/core/s3v3Index.js";
import { S3v3SyncEngine, S3v3SyncError } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string): Promise<Uint8Array | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    if (opts?.gzip) this.objects.set(key, { bytes: new Uint8Array(gzipSync(Buffer.from(bytes), { level: 9 })), gzip: true });
    else this.objects.set(key, { bytes: new Uint8Array(bytes), gzip: false });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
}

const tmp = async (name: string) => fs.mkdtemp(path.join(os.tmpdir(), "s3v3-" + name + "-"));
async function device(name: string) {
  const root = await tmp(name);
  const store = new FileDeviceStore(root);
  await store.init();
  return { root, store };
}
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
const noteOf = (id: string, hash: string, extra: Partial<LakeNoteEntry> = {}): LakeNoteEntry => ({ id, title: "T" + id, parentId: null, sortOrder: 0, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: hash, ...extra });
async function addDoc(store: FileDeviceStore, id: string, body: string, assets: Record<string, string> = {}) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  for (const [fn, content] of Object.entries(assets)) await store.writeAsset(id, fn, new TextEncoder().encode(content));
  const entry = noteOf(id, sha256Hex(bytes), { updatedAt: new Date().toISOString() });
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), entry];
  await store.saveState(state);
  return sha256Hex(bytes);
}
function engine(remote: MemoryRemote, store: FileDeviceStore, id: string) { return new S3v3SyncEngine({ remote, device: store, deviceId: id }); }

describe("S3v3 同步引擎（双端）", () => {
  it("初始化上传 + 新设备拉取（含附件）", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "hello", { "a.png": "PNG-A" });
    const r1 = await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    expect(r1.published).toBe(true);
    expect(r1.generation).toBe(1);
    expect(remote.objects.has("meta/pointer.json")).toBe(true);
    const r2 = await engine(remote, b.store, "B").sync();
    expect(r2.downloadedNotes).toBe(1);
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("hello");
    expect(new TextDecoder().decode((await b.store.readAsset("n1", "a.png"))!)).toBe("PNG-A");
  });

  it("增量双端互传 + 冲突时远端胜出且本地留历史", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "v1");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.store, "B").sync();
    // A 改并发布
    await addDoc(a.store, "n1", "v2-A");
    await engine(remote, a.store, "A").sync();
    // B 本地也改，同步时冲突 → 远端胜、本地历史
    await addDoc(b.store, "n1", "v2-B");
    const r = await engine(remote, b.store, "B").sync();
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("v2-A");
    const hist = await fs.readdir(path.join(b.root, "history"));
    expect(hist.length).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("软删进回收站跨端可见 + 恢复", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "content");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.store, "B").sync();
    // A 移动到回收站
    const sa = (await a.store.loadState())!;
    sa.lake.notes[0] = { ...sa.lake.notes[0], parentId: "trash", trashedAt: new Date().toISOString(), deletedFromParentId: null, updatedAt: new Date(Date.now() + 1000).toISOString() };
    await a.store.saveState(sa);
    await engine(remote, a.store, "A").sync();
    await engine(remote, b.store, "B").sync();
    const sb = (await b.store.loadState())!;
    expect(sb.lake.notes[0].trashedAt).toBeTruthy();
    expect(await b.store.readBody("n1")).not.toBeNull();
    // A 恢复
    const sa2 = (await a.store.loadState())!;
    sa2.lake.notes[0] = { ...sa2.lake.notes[0], parentId: null, trashedAt: null, deletedFromParentId: null, updatedAt: new Date(Date.now() + 2000).toISOString() };
    sa2.restorePending = ["n1"];
    await a.store.saveState(sa2);
    await engine(remote, a.store, "A").sync();
    await engine(remote, b.store, "B").sync();
    const sb2 = (await b.store.loadState())!;
    expect(sb2.lake.notes.find((n) => n.id === "n1")?.trashedAt ?? null).toBeNull();
  });

  it("彻底删除零痕迹 + 对端保留回收站副本 + 删除意图最终清除", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "keep");
    await addDoc(a.store, "n2", "gone", { "x.png": "X" });
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.store, "B").sync();
    // A purge n2：删本地 + 删除意图
    const sa = (await a.store.loadState())!;
    sa.lake.notes = sa.lake.notes.filter((n) => n.id !== "n2");
    sa.intents = [...sa.intents, { noteId: "n2", targetEpoch: sa.intents[0]?.targetEpoch ?? "", targetGeneration: 0 }].map((it) => ({ ...it }));
    // targetEpoch 用当前 pointer 的 epoch（从云端读）
    const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { epoch: string; generation: number };
    sa.intents = [{ noteId: "n2", targetEpoch: pointer.epoch, targetGeneration: pointer.generation }];
    await a.store.saveState(sa);
    await a.store.deleteBody("n2"); await a.store.deleteAssetsDir("n2");
    await engine(remote, a.store, "A").sync();
    expect(await remote.list("objects/n2-")).toHaveLength(0);
    expect(await remote.list("assets/n2/")).toHaveLength(0);
    expect(await remote.list("meta/assets/n2/")).toHaveLength(0);
    // B 同步：n2 进本地回收站（保留副本），不上传
    await engine(remote, b.store, "B").sync();
    const sb = (await b.store.loadState())!;
    const n2 = sb.lake.notes.find((n) => n.id === "n2")!;
    expect(n2.trashedAt).toBeTruthy();
    expect(await b.store.readBody("n2")).not.toBeNull();
    // A 再发布一次（改 n1）后，删除意图在下一轮清除
    await addDoc(a.store, "n1", "keep2");
    await engine(remote, a.store, "A").sync();
    await engine(remote, a.store, "A").sync();
    const sa2 = (await a.store.loadState())!;
    expect(sa2.intents.find((i) => i.noteId === "n2")).toBeUndefined();
  });

  it("待删门禁：仍被引用则跳过并出队，不误删", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "x");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    const hash = sha256Hex(new TextEncoder().encode("x"));
    const state = (await a.store.loadState())!;
    state.pending = [{
      kind: "body", key: "objects/n1-" + hash + ".lake", noteId: "n1", oldHash: hash,
      targetEpoch: "", targetGeneration: 1, targetCommit: "", createdAt: new Date().toISOString(),
    }];
    await a.store.saveState(state);
    await engine(remote, a.store, "A").sync();
    expect(remote.objects.has("objects/n1-" + hash + ".lake")).toBe(true);
    expect((await a.store.loadState())!.pending).toHaveLength(0);
  });

  it("fork 检测：同 generation 不同 commit 抛错", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "x");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    const p = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!));
    await remote.put("meta/pointer.json", new TextEncoder().encode(JSON.stringify({ ...p, lake: { commit: sha256Hex(new TextEncoder().encode("other")) } })));
    await expect(engine(remote, a.store, "A").sync()).rejects.toMatchObject({ code: "fork" });
  });

  it("云端为空时的选择：默认报错、stay 不写、upload 初始化", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "x");
    await expect(engine(remote, a.store, "A").sync()).rejects.toBeInstanceOf(S3v3SyncError);
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "stay" });
    expect(remote.objects.size).toBe(0);
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    expect(remote.objects.has("meta/pointer.json")).toBe(true);
  });

  it("小记：上传/拉取/删除无痕", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    let sa = (await a.store.loadState()) ?? emptyState();
    const qbody = new TextEncoder().encode("quick");
    await a.store.writeQuickBody("q1", qbody);
    await a.store.writeQuickAsset("q1", "i.png", new TextEncoder().encode("IMG"));
    sa.quickNotes.items = [{ id: "q1", createdAt: "c", updatedAt: "u", contentHash: sha256Hex(qbody) }];
    await a.store.saveState(sa);
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.store, "B").sync();
    const sb = (await b.store.loadState())!;
    expect(sb.quickNotes.items).toHaveLength(1);
    expect(new TextDecoder().decode((await b.store.readQuickBody("q1"))!)).toBe("quick");
    // A 删除小记
    sa = (await a.store.loadState())!;
    sa.quickNotes.items = [];
    const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { epoch: string; generation: number };
    sa.intents = [{ noteId: "q1", targetEpoch: pointer.epoch, targetGeneration: pointer.generation }];
    await a.store.saveState(sa);
    await engine(remote, a.store, "A").sync();
    await engine(remote, b.store, "B").sync();
    expect((await b.store.loadState())!.quickNotes.items).toHaveLength(0);
    expect(await remote.list("quick-notes/objects/")).toHaveLength(0);
    expect(await remote.list("quick-notes/assets/q1/")).toHaveLength(0);
  });
});
