import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { countRemoteOps } from "../../src/core/s3v3/remoteStats.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import { indexHashOf, serializeQuickNotesIndex, serializeLakeIndex, type QuickNotesIndex } from "../../src/core/s3v3/protocol/s3v3Index.js";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { setQuickNotesStoreForV3 } from "./quickNotesRegistry.js";
import { pushQuickNoteWithV3 } from "./desktopSync.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";
import type { SyncResult } from "../syncTypes.js";
import { Store } from "../store.js";
import { QuickNotesStore } from "../quickNotes.js";

/**
 * 「保存并同步」快路径（261110）：
 *  · 最短链：1 pointer 读（+锁内 CAS/写后校验，共 3 次与整轮同协议）+ 1 quick 索引读 +
 *    1 quick 索引写 + 1 pointer 写 + 1 正文 PUT；**不读 lake 索引、不 GET 别的小记正文**；
 *  · 轻量状态：不跑 `loadState`（桌面 2 万文档时那是全库 stat/hash）；
 *  · 基线只更新本条（lake 部分原样）；重复点「保存并同步」零上传（内容寻址对象已存在）；
 *  · 高优先域由 wiring 测试锁（不等整轮 / 不进维护队列）。
 */
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
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
}

/** 计数版文件设备：断言单条推送没走「重建整个世界」的 loadState。 */
class SpyFileDevice extends FileDeviceStore {
  loadStateCalls = 0;
  quickStateCalls = 0;
  override async loadState() { this.loadStateCalls += 1; return await super.loadState(); }
  override async loadQuickPushState(id: string) { this.quickStateCalls += 1; return await super.loadQuickPushState(id); }
}

const tmp = async (name: string) => fs.mkdtemp(path.join(os.tmpdir(), "s3v3-fast-" + name + "-"));
async function freshFileStore(name: string) { const root = await tmp(name); const store = new SpyFileDevice(root); await store.init(); return store; }
const emptyState = (): DeviceState => ({
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
  folders: [], intents: [], pending: [], remotePurged: [], restorePending: [],
});
async function addQuick(store: FileDeviceStore, id: string, body: string, updatedAt = new Date().toISOString()) {
  const bytes = enc(body);
  await store.writeQuickBody(id, bytes);
  const state = (await store.loadState()) ?? emptyState();
  state.quickNotes.items = [...state.quickNotes.items.filter((q) => q.id !== id), {
    id, createdAt: "2026-10-25T00:00:00.000Z", updatedAt, contentHash: sha256Hex(bytes),
  }];
  await store.saveState(state);
  return sha256Hex(bytes);
}
const pointerOf = async (remote: MemoryRemote) => JSON.parse(dec((await remote.get("meta/pointer.json"))!)) as { generation: number; lake: { commit: string }; quickNotes: { commit: string } };
const keysWithPrefix = (keys: string[], prefix: string) => keys.filter((k) => k.startsWith(prefix));

describe("引擎：单条推送最短链 + 轻量状态（261110）", () => {
  it("请求数固定（不随库增长）：3 pointer 读 / 1 quick 索引读 / 1 正文 PUT / 1 索引写 / 1 pointer 写；不读 lake/别的小记", async () => {
    const remote = new MemoryRemote();
    const a = await freshFileStore("count");
    await addQuick(a, "q1", "one");
    await addQuick(a, "q2", "two");
    await new S3v3SyncEngine({ remote, device: a, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
    const before = await a.loadBaseline();
    // 本地改 q1 的正文（updatedAt 前进）
    await addQuick(a, "q1", "one-v2", new Date(Date.now() + 5000).toISOString());

    a.loadStateCalls = 0;
    a.quickStateCalls = 0;
    const phases: Array<{ phase: string; ms: number }> = [];
    const counted = countRemoteOps(remote);
    const engine = new S3v3SyncEngine({
      remote: counted.remote, device: a, deviceId: "A",
      onPhase: (phase, ms) => phases.push({ phase, ms }),
    });
    const out = await engine.pushQuickNote("q1");
    expect(out.status).toBe("pushed");

    const stats = counted.stats;
    // pointer：锁内 CAS 读 + 写后校验（261110 独立管线：入口那次 pointer 读已省，锁内只读一次）。
    expect(stats.getKeys.filter((k) => k === "meta/pointer.json")).toHaveLength(2);
    // quick 索引只读一次；lake 索引一次都不读。
    expect(keysWithPrefix(stats.getKeys, "quick-notes/meta/index/")).toHaveLength(1);
    expect(keysWithPrefix(stats.getKeys, "meta/index/")).toHaveLength(0);
    // 不 GET 任何正文/声明（本条正文在本地；无资产）。
    expect(keysWithPrefix(stats.getKeys, "quick-notes/objects/")).toHaveLength(0);
    expect(keysWithPrefix(stats.getKeys, "quick-notes/meta/assets/")).toHaveLength(0);
    // 上传：正文 1 + quick 索引 1 + pointer 1 + 发布锁 1。
    expect(keysWithPrefix(stats.putKeys, "quick-notes/objects/")).toHaveLength(1);
    expect(keysWithPrefix(stats.putKeys, "quick-notes/meta/index/")).toHaveLength(1);
    expect(stats.putKeys.filter((k) => k === "meta/pointer.json")).toHaveLength(1);
    expect(stats.puts).toBe(4);

    // 轻量状态：没跑 loadState（全库世界重建），只跑 loadQuickPushState。
    expect(a.loadStateCalls).toBe(0);
    expect(a.quickStateCalls).toBe(1);
    // 分段埋点齐全（LOGGING 约定：label=sync.push-single，phases=…）。
    for (const name of ["push-pointer", "push-state", "push-index", "push-body", "push-upload", "push-publish", "push-baseline"]) {
      expect(phases.map((p) => p.phase), "缺阶段 " + name).toContain(name);
    }

    // 基线：lake 原样；只更新这一条；generation +1。
    const after = await a.loadBaseline();
    expect(after!.lake).toEqual(before!.lake);
    const r1 = after!.quickNotes.items.find((q) => q.id === "q1")!;
    expect(r1.contentHash).toBe(sha256Hex(enc("one-v2")));
    expect(after!.quickNotes.items.find((q) => q.id === "q2")).toEqual(before!.quickNotes.items.find((q) => q.id === "q2"));
    expect(after!.generation).toBe(before!.generation + 1);
    // 记账只标这一条（I2 守卫），别的小记不被动。
    expect((await a.loadState())!.quickNotes.items.find((q) => q.id === "q1")!.updatedAt).toBe(r1.updatedAt);
  });

  it("重复点「保存并同步」（内容没变）：零上传、零发布，基线不变", async () => {
    const remote = new MemoryRemote();
    const a = await freshFileStore("unchanged");
    await addQuick(a, "q1", "one");
    await new S3v3SyncEngine({ remote, device: a, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
    const counted = countRemoteOps(remote);
    const out = await new S3v3SyncEngine({ remote: counted.remote, device: a, deviceId: "A" }).pushQuickNote("q1");
    expect(out.status).toBe("pushed");
    if (out.status !== "pushed") throw new Error("unreachable");
    expect(out.unchanged).toBe(true);
    expect(counted.stats.puts).toBe(0);
    expect(counted.stats.putKeys).toEqual([]);
    expect((await pointerOf(remote)).generation).toBe(1);
  });

  it("不存在的小记：读到 pointer/baseline 后直接 not-found —— 不读 quick 索引、不 GET 正文", async () => {
    const remote = new MemoryRemote();
    const a = await freshFileStore("notfound");
    await addQuick(a, "q1", "one");
    await new S3v3SyncEngine({ remote, device: a, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
    const counted = countRemoteOps(remote);
    const out = await new S3v3SyncEngine({ remote: counted.remote, device: a, deviceId: "A" }).pushQuickNote("nope");
    expect(out).toEqual({ status: "not-found" });
    expect(keysWithPrefix(counted.stats.getKeys, "quick-notes/meta/index/")).toHaveLength(0);
    expect(keysWithPrefix(counted.stats.getKeys, "quick-notes/objects/")).toHaveLength(0);
  });
});

describe("桌面适配层：pushQuickNoteWithV3（261110）", () => {
  async function desktopDevice(label: string) {
    const root = await tmp("desk-" + label);
    const store = new Store(root);
    store.bootstrap();
    const quick = new QuickNotesStore(root);
    const adapter = new DesktopStoreDevice(store, root, { quickNotes: quick, skipQuickNotesGuard: true });
    await adapter.init();
    return { root, store, quick, adapter };
  }
  const baselinePath = (root: string) => path.join(root, "sync-v3", "baseline.json.gz");

  it("走进「高优先域」适配层：1 正文 PUT / 1 索引写 / 1 pointer 写；不触发回退整轮；基线只更新本条；重复零上传", async () => {
    const remote = new MemoryRemote();
    const a = await desktopDevice("fast");
    setQuickNotesStoreForV3(a.quick);
    const q1 = a.quick.createQuickNote({ text: "one", draftId: "d1", stagedImageIds: [] });
    const q2 = a.quick.createQuickNote({ text: "two", draftId: "d2", stagedImageIds: [] });
    const engine = new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "D" });
    await engine.sync({ onEmptyCloud: "upload" });
    const before = JSON.parse(gunzipSync(await fs.readFile(baselinePath(a.root))).toString("utf8")) as { generation: number; lake: unknown; quickNotes: { items: Array<{ id: string }> } };
    a.quick.updateQuickNote(q1.id, { text: "one-v2", draftId: "d3", stagedImageIds: [] });

    const fullSync = vi.fn(async () => ({}) as SyncResult);
    const counted = countRemoteOps(remote);
    const out = await pushQuickNoteWithV3(a.store, q1.id, { remote: counted.remote, fullSync });
    expect(out.status).toBe("pushed");
    if (out.status !== "pushed") throw new Error("unreachable");
    expect(out.uploadedContent).toBe(true);
    expect(fullSync).not.toHaveBeenCalled();
    expect(keysWithPrefix(counted.stats.getKeys, "meta/index/")).toHaveLength(0);
    expect(keysWithPrefix(counted.stats.putKeys, "quick-notes/objects/")).toHaveLength(1);
    expect(keysWithPrefix(counted.stats.putKeys, "quick-notes/meta/index/")).toHaveLength(1);
    expect(counted.stats.putKeys.filter((k) => k === "meta/pointer.json")).toHaveLength(1);

    const after = JSON.parse(gunzipSync(await fs.readFile(baselinePath(a.root))).toString("utf8")) as typeof before;
    expect(after.lake).toEqual(before.lake); // 小记推送不得动 lake
    expect(after.generation).toBe(before.generation + 1);
    expect(after.quickNotes.items.find((q) => q.id === q2.id)).toEqual(before.quickNotes.items.find((q) => q.id === q2.id));
    // 只标这一条 synced（下一轮整轮必须把它当已同步）。
    expect(a.quick.listQuickNotes().find((q) => q.id === q1.id)!.syncState).toBe("synced");
    expect(a.quick.listQuickNotes().find((q) => q.id === q2.id)!.syncState).toBe("synced");

    // 后续整轮：基线已跟上 ⇒ 这条被当已同步，不重传、不发布。
    const genAfterPush = JSON.parse(gunzipSync(await fs.readFile(baselinePath(a.root))).toString("utf8")).generation;
    const nextRound = await new S3v3SyncEngine({ remote, device: a.adapter, deviceId: "D" }).sync();
    expect(nextRound.published).toBe(false);
    expect(nextRound.uploadedQuickNotes).toBe(0);
    expect(JSON.parse(gunzipSync(await fs.readFile(baselinePath(a.root))).toString("utf8")).generation).toBe(genAfterPush);

    // 重复点：零上传、不涨 generation。
    const counted2 = countRemoteOps(remote);
    const out2 = await pushQuickNoteWithV3(a.store, q1.id, { remote: counted2.remote, fullSync });
    expect(out2.status).toBe("pushed");
    if (out2.status !== "pushed") throw new Error("unreachable");
    expect(out2.unchanged).toBe(true);
    expect(counted2.stats.puts).toBe(0);
    // 重复点：只读一次 pointer（不取锁/不读索引/不写），generation 不涨。
    expect(counted2.stats.total).toBe(1);
    expect(counted2.stats.getKeys).toEqual(["meta/pointer.json"]);
    expect(JSON.parse(gunzipSync(await fs.readFile(baselinePath(a.root))).toString("utf8")).generation).toBe(after.generation);
  });

  it("回退整轮只发生在必要时：远端墓碑且本机无恢复标记 ⇒ full-sync + 调一次 fullSync（不静默降级）", async () => {
    const remote = new MemoryRemote();
    const a = await desktopDevice("fallback");
    setQuickNotesStoreForV3(a.quick);
    const q1 = a.quick.createQuickNote({ text: "one", draftId: "d1", stagedImageIds: [] });
    const base = await a.adapter.loadBaseline();
    expect(base).toBeNull();
    // 造一个「远端存在 pointer + quick 索引把 q1 标记 purged」的世界，并给本机一份同代基线。
    const lake = { v: 3 as const, space: "lake" as const, notes: [], folders: [] };
    const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], purged: [q1.id] };
    const lakeCommit = indexHashOf(serializeLakeIndex(lake));
    const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
    await remote.put("meta/index/" + lakeCommit + ".json", enc(serializeLakeIndex(lake)), { gzip: true });
    await remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(serializeQuickNotesIndex(quick)), { gzip: true });
    const pointer = { v: 3, epoch: "33333333-3333-4333-8333-333333333333", generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: new Date().toISOString(), deviceId: "D" };
    await remote.put("meta/pointer.json", enc(JSON.stringify(pointer)));
    await a.adapter.saveBaseline({ epoch: pointer.epoch, generation: 1, lakeCommit, quickNotesCommit: quickCommit, lake, quickNotes: quick });
    const fullSync = vi.fn(async () => ({
      uploaded: 0, downloaded: 0, conflicts: 0, manifestId: "v3-g1", completedAt: new Date().toISOString(),
    }) as unknown as SyncResult);
    const out = await pushQuickNoteWithV3(a.store, q1.id, { remote, fullSync });
    expect(out.status).toBe("full-sync");
    if (out.status !== "full-sync") throw new Error("unreachable");
    expect(out.reason).toBe("remote-deleted");
    expect(fullSync).toHaveBeenCalledTimes(1);
  });
});
