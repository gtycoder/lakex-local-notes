import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import type { LakeNoteEntry } from "../../src/core/s3v3/protocol/s3v3Index.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class CountingRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  gets: string[] = [];
  puts: string[] = [];
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    this.gets.push(key);
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) {
    this.puts.push(key);
    this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
  reset() { this.gets = []; this.puts = []; }
}

const tmp = async (name: string) => fs.mkdtemp(path.join(os.tmpdir(), "s3v3-adiff-" + name + "-"));
async function device(name: string) { const root = await tmp(name); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
const noteOf = (id: string, hash: string): LakeNoteEntry => ({ id, title: "T" + id, parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: hash });

async function addDoc(store: FileDeviceStore, id: string, body: string, assets: Record<string, string> = {}) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  for (const [fn, content] of Object.entries(assets)) await store.writeAsset(id, fn, new TextEncoder().encode(content));
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), noteOf(id, sha256Hex(bytes))];
  await store.saveState(state);
}
async function addQuick(store: FileDeviceStore, id: string, body: string, assets: Record<string, string> = {}) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeQuickBody(id, bytes);
  for (const [fn, content] of Object.entries(assets)) await store.writeQuickAsset(id, fn, new TextEncoder().encode(content));
  const ts = new Date().toISOString();
  state.quickNotes.items = [...state.quickNotes.items.filter((q) => q.id !== id), { id, createdAt: ts, updatedAt: ts, contentHash: sha256Hex(bytes) }];
  await store.saveState(state);
}
async function touchDoc(store: FileDeviceStore, id: string, body: string) {
  const state = (await store.loadState())!;
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  state.lake.notes = state.lake.notes.map((n) => n.id === id ? { ...n, contentHash: sha256Hex(bytes), updatedAt: new Date(Date.now() + 1000).toISOString() } : n);
  await store.saveState(state);
}
const engine = (remote: S3v3Remote, store: FileDeviceStore, id: string) => new S3v3SyncEngine({ remote, device: store, deviceId: id });

describe("P0 v3 资产下载差集（localHave：size+sha256 相同跳过 GET）", () => {
  it("只改正文/元数据时，对端不再重下整篇附件（lake + quick notes）", async () => {
    const remote = new CountingRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "body-1", { "a.png": "AAAA", "b.png": "BBBB", "c.bin": "CCCC" });
    await addDoc(a.store, "n2", "body-2", { "d.png": "DDDD" });
    await addQuick(a.store, "q1", "quick-1", { "i1.png": "I1", "i2.png": "I2" });
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.store, "B").sync();
    // 对端已有全部资产
    expect(await b.store.listAssets("n1")).toEqual(["a.png", "b.png", "c.bin"]);
    expect(await b.store.listQuickAssets("q1")).toEqual(["i1.png", "i2.png"]);

    // A 只改 n1 正文 + q1 正文（附件全未变）
    await touchDoc(a.store, "n1", "body-1-edited");
    const sb = (await a.store.loadState())!;
    const qbytes = new TextEncoder().encode("quick-1-edited");
    await a.store.writeQuickBody("q1", qbytes);
    sb.quickNotes.items = sb.quickNotes.items.map((q) => q.id === "q1" ? { ...q, contentHash: sha256Hex(qbytes), updatedAt: new Date(Date.now() + 1000).toISOString() } : q);
    await a.store.saveState(sb);
    await engine(remote, a.store, "A").sync();

    remote.reset();
    const r = await engine(remote, b.store, "B").sync();
    expect(r.downloadedNotes).toBe(2); // 两份正文
    // 关键：附件一个都不 GET；声明对象已按 declHash 进程内缓存 ⇒ 也不再重复 GET（P0-1 残余）
    const assetGets = remote.gets.filter((k) => k.startsWith("assets/") || k.startsWith("quick-notes/assets/"));
    expect(assetGets).toEqual([]);
    // v4 契约：声明按「本轮变化的条目」读取（每个 declHash 至多一次），但不重下附件字节。
    const declGets = remote.gets.filter((k) => k.startsWith("meta/assets/") || k.startsWith("quick-notes/meta/assets/"));
    expect(new Set(declGets).size).toBe(declGets.length); // 不重复读同一份声明
    expect(declGets.length).toBeLessThanOrEqual(3);
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("body-1-edited");
  }, 60_000);

  it("本地附件缺失/损坏时只补那一份（其余仍然跳过）", async () => {
    const remote = new CountingRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "v1", { "a.png": "AAAA", "b.png": "BBBB" });
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.store, "B").sync();
    // B 本地删掉 a.png（模拟磁盘/旧版本问题）
    await fs.unlink(path.join(b.root, "assets", "n1", "a.png"));
    await touchDoc(a.store, "n1", "v2");
    await engine(remote, a.store, "A").sync();

    remote.reset();
    await engine(remote, b.store, "B").sync();
    expect(remote.gets.filter((k) => k === "assets/n1/a.png")).toHaveLength(1);
    expect(remote.gets.filter((k) => k === "assets/n1/b.png")).toHaveLength(0);
    expect(await b.store.readAsset("n1", "a.png")).not.toBeNull();
  }, 60_000);
});
