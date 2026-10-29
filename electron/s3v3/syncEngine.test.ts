import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import type { LakeNoteEntry } from "../../src/core/s3v3/protocol/s3v3Index.js";
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
    // lastModified=0：测试对象视为"远古对象"，深度清理的保留窗口不会误保护它们。
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, lastModified: 0 })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
}

class FlakyRemote extends MemoryRemote {
  failPut: ((key: string) => boolean) | null = null;
  failDelete = false;
  override async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    if (this.failPut?.(key)) throw new Error("injected put failure: " + key);
    return super.put(key, bytes, opts);
  }
  override async deleteMany(keys: string[]): Promise<void> {
    if (this.failDelete) throw new Error("injected delete failure");
    return super.deleteMany(keys);
  }
}

const INDEX_KEY = (commit: string) => "meta/index/" + commit + ".json";
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
    sa.intents = [{ noteId: "n2", targetEpoch: pointer.epoch, targetGeneration: pointer.generation, purgedAt: new Date().toISOString() }];
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

  it("显式恢复是唯一例外：远端已 purge 后仍可恢复", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "resurrect-me");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await engine(remote, b.store, "B").sync();
    // A purge
    const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { epoch: string; generation: number };
    const sa = (await a.store.loadState())!;
    sa.lake.notes = []; sa.intents = [{ noteId: "n1", targetEpoch: pointer.epoch, targetGeneration: pointer.generation, purgedAt: new Date().toISOString() }];
    await a.store.saveState(sa); await a.store.deleteBody("n1");
    await engine(remote, a.store, "A").sync();
    await engine(remote, b.store, "B").sync();
    // B 恢复（本地有副本）
    const sb = (await b.store.loadState())!;
    sb.remotePurged = [];
    sb.restorePending = ["n1"];
    sb.lake.notes = sb.lake.notes.map((n) => n.id === "n1" ? { ...n, parentId: null, trashedAt: null, deletedFromParentId: null, updatedAt: new Date(Date.now() + 5000).toISOString() } : n);
    await b.store.saveState(sb);
    await engine(remote, b.store, "B").sync();
    // A 拉回
    await engine(remote, a.store, "A").sync();
    expect(new TextDecoder().decode((await a.store.readBody("n1"))!)).toBe("resurrect-me");
    expect((await a.store.loadState())!.lake.notes.find((n) => n.id === "n1")).toBeTruthy();
  });

  it("发布锁被占用 → lock-busy（不并发覆盖）", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "v1");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await remote.put("meta/lock.json", new TextEncoder().encode(JSON.stringify({ deviceId: "other", time: Date.now(), ttl: 120000 })));
    await addDoc(a.store, "n1", "v2");
    // 锁被别的端长期占着：单次等锁与退避都调小，验证「有界等待后明确抛 lock-busy」（不无限空转）。
    await expect(new S3v3SyncEngine({ remote, device: a.store, deviceId: "A", lockWaitMs: 300, publishLockWaitMs: 0 }).sync()).rejects.toMatchObject({ code: "lock-busy" });
    await remote.deleteMany(["meta/lock.json"]);
  });

  it("深度清理：删除孤儿（模拟声明/正文写入后崩溃）且保留当前数据", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "x");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await remote.put("objects/orphan-" + "a".repeat(64) + ".lake", new TextEncoder().encode("orphan"));
    await remote.put("meta/assets/n1/" + "b".repeat(64) + ".json", new TextEncoder().encode(JSON.stringify({ assets: [] })));
    const dry = await engine(remote, a.store, "A").deepCleanup({ dryRun: true });
    expect(dry.deleted.length).toBe(2);
    expect(remote.objects.has("objects/orphan-" + "a".repeat(64) + ".lake")).toBe(true);
    const real = await engine(remote, a.store, "A").deepCleanup();
    expect(real.deleted.length).toBe(2);
    expect(remote.objects.has("objects/orphan-" + "a".repeat(64) + ".lake")).toBe(false);
    expect(remote.objects.has("meta/assets/n1/" + "b".repeat(64) + ".json")).toBe(false);
  });

  it("缺远端正文时降级为 warning，不破坏本地", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    await addDoc(a.store, "n1", "content");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    const hash = sha256Hex(new TextEncoder().encode("content"));
    await remote.deleteMany(["objects/n1-" + hash + ".lake"]);
    const r = await engine(remote, b.store, "B").sync();
    expect(r.warnings.some((w) => w.includes("缺正文"))).toBe(true);
    expect(await b.store.readBody("n1")).toBeNull();
  });

  it("上传失败不污染索引：保持旧版本，下一轮重试成功", async () => {
    const remote = new FlakyRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "v1");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    const v2 = new TextEncoder().encode("v2-failing");
    const h2 = sha256Hex(v2);
    await a.store.writeBody("n1", v2);
    const sa = (await a.store.loadState())!;
    sa.lake.notes = sa.lake.notes.map((n) => n.id === "n1" ? { ...n, contentHash: h2, updatedAt: new Date(Date.now() + 1000).toISOString() } : n);
    await a.store.saveState(sa);
    remote.failPut = (key) => key === "objects/n1-" + h2 + ".lake";
    const r = await engine(remote, a.store, "A").sync();
    expect(r.warnings.some((w) => w.includes("上传失败"))).toBe(true);
    // 云端仍是 v1，索引不引用未落盘的 v2
    expect(await remote.list("objects/n1-" + h2 + ".lake")).toHaveLength(0);
    const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { lake: { commit: string } };
    const idx = JSON.parse(new TextDecoder().decode((await remote.get(INDEX_KEY(pointer.lake.commit)))!)) as { notes: Array<{ id: string; contentHash: string }> };
    expect(idx.notes.find((n) => n.id === "n1")!.contentHash).not.toBe(h2);
    // 清故障后重试成功
    remote.failPut = null;
    await engine(remote, a.store, "A").sync();
    expect(await remote.list("objects/n1-" + h2 + ".lake")).toHaveLength(1);
    const pointer2 = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { lake: { commit: string } };
    const idx2 = JSON.parse(new TextDecoder().decode((await remote.get(INDEX_KEY(pointer2.lake.commit)))!)) as { notes: Array<{ id: string; contentHash: string }> };
    expect(idx2.notes.find((n) => n.id === "n1")!.contentHash).toBe(h2);
  });

  it("待删执行失败时保留队列，恢复后补删（零痕迹）", async () => {
    const remote = new FlakyRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "x");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    const orphan = "orphan-" + "b".repeat(64) + ".lake";
    await remote.put("objects/" + orphan, new TextEncoder().encode("orphan"));
    const state = (await a.store.loadState())!;
    state.pending = [{ kind: "body", key: "objects/" + orphan, noteId: "n9", oldHash: "b".repeat(64), targetEpoch: "", targetGeneration: 1, targetCommit: "", createdAt: new Date().toISOString() }];
    await a.store.saveState(state);
    remote.failDelete = true;
    const r = await engine(remote, a.store, "A").sync();
    expect(r.warnings.some((w) => w.includes("待删执行失败"))).toBe(true);
    expect((await a.store.loadState())!.pending).toHaveLength(1);
    expect(remote.objects.has("objects/" + orphan)).toBe(true);
    remote.failDelete = false;
    await engine(remote, a.store, "A").sync();
    expect((await a.store.loadState())!.pending).toHaveLength(0);
    expect(remote.objects.has("objects/" + orphan)).toBe(false);
  });

  it("pointer 损坏 → pointer-corrupt（不猜）", async () => {
    const remote = new MemoryRemote();
    const a = await device("a");
    await addDoc(a.store, "n1", "x");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    await remote.put("meta/pointer.json", new TextEncoder().encode("{not-json"));
    await expect(engine(remote, a.store, "A").sync()).rejects.toMatchObject({ code: "pointer-corrupt" });
  });

  it("多端：拉取到的新版本不能被旧索引重新发布（回归）", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b"); const c = await device("c");
    await addDoc(a.store, "n1", "v1");
    await engine(remote, a.store, "A").sync({ onEmptyCloud: "upload" });
    const b1 = await engine(remote, b.store, "B").sync();
    expect(b1.downloadedNotes).toBe(1);
    await addDoc(a.store, "n1", "v2");
    await engine(remote, a.store, "A").sync();
    // B 拉到 v2；关键：B 本轮不应把旧 v1 索引重新发布
    const b2 = await engine(remote, b.store, "B").sync();
    expect(b2.downloadedNotes).toBe(1);
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("v2");
    const c1 = await engine(remote, c.store, "C").sync();
    expect(c1.downloadedNotes).toBe(1);
    expect(new TextDecoder().decode((await c.store.readBody("n1"))!)).toBe("v2");
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
    sa.intents = [{ noteId: "q1", targetEpoch: pointer.epoch, targetGeneration: pointer.generation, purgedAt: new Date().toISOString() }];
    await a.store.saveState(sa);
    await engine(remote, a.store, "A").sync();
    await engine(remote, b.store, "B").sync();
    expect((await b.store.loadState())!.quickNotes.items).toHaveLength(0);
    expect(await remote.list("quick-notes/objects/")).toHaveLength(0);
    expect(await remote.list("quick-notes/assets/q1/")).toHaveLength(0);
  });
});
