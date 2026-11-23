/**
 * 「云端首次相遇」引擎闸门（SYNC-PROTOCOL §21）：无共同历史 + 双非空 ⇒ 必须先问；选定后建立关系永不再问；换目标重问。
 * 搭具照抄 s3v3BootstrapMerge.test.ts（MemRemote + FakeDevice + 真 S3v3SyncEngine）。
 */
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { indexHashOf, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { indexKey, lakeBodyKey } from "./s3v3/protocol/s3v3Keys.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-11-23T00:00:00.000Z";
const EPOCH = "22222222-2222-4222-8222-222222222222";
const TARGET = "target-A";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

class FakeDevice implements S3v3DeviceStore {
  state: DeviceState;
  baseline: DeviceBaseline | null;
  bodies = new Map<string, Uint8Array>();
  quickBodies = new Map<string, Uint8Array>();
  writtenBodies: string[] = [];
  constructor(state: DeviceState, baseline: DeviceBaseline | null) { this.state = state; this.baseline = baseline; }
  async init(): Promise<void> {}
  async loadState(): Promise<DeviceState | null> { return this.state; }
  async saveState(s: DeviceState): Promise<void> { this.state = s; }
  async loadBaseline(): Promise<DeviceBaseline | null> { return this.baseline; }
  async saveBaseline(b: DeviceBaseline): Promise<void> { this.baseline = b; }
  async readBody(id: string): Promise<Uint8Array | null> { return this.bodies.get(id) ?? null; }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> { this.bodies.set(id, bytes); this.writtenBodies.push(id); }
  async deleteBody(id: string): Promise<void> { this.bodies.delete(id); }
  async writeHistory(): Promise<string> { return "skip"; }
  async archiveBody(): Promise<void> {}
  async listAssets(): Promise<string[]> { return []; }
  async readAsset(): Promise<Uint8Array | null> { return null; }
  async writeAsset(): Promise<void> {}
  async deleteAssetsDir(): Promise<void> {}
  async readQuickBody(id: string): Promise<Uint8Array | null> { return this.quickBodies.get(id) ?? null; }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> { this.quickBodies.set(id, bytes); }
  async deleteQuickBody(): Promise<void> {}
  async listQuickAssets(): Promise<string[]> { return []; }
  async readQuickAsset(): Promise<Uint8Array | null> { return null; }
  async writeQuickAsset(): Promise<void> {}
  async deleteQuickAssetsDir(): Promise<void> {}
}

const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], purged: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [] });

function localWorld(ids: string[]): DeviceState {
  const st = emptyState();
  st.lake.notes = ids.map((id, i) => ({ id, title: id, parentId: null, sortOrder: i, updatedAt: ISO, contentHash: H("local-" + id) }));
  return st;
}

function seedCloud(remote: MemRemote, ids: string[]): void {
  const lake: LakeIndex = { v: 3, space: "lake", folders: [], notes: ids.map((id, i) => ({ id, title: id, parentId: null, sortOrder: i, updatedAt: ISO, contentHash: H("cloud-" + id) })) };
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], purged: [] };
  const lakeSer = serializeLakeIndex(lake);
  const quickSer = serializeQuickNotesIndex(quick);
  const lakeCommit = indexHashOf(lakeSer);
  const quickCommit = indexHashOf(quickSer);
  void remote.put(indexKey("lake", lakeCommit), enc(lakeSer));
  void remote.put(indexKey("quickNotes", quickCommit), enc(quickSer));
  for (const id of ids) void remote.put(lakeBodyKey(id, H("cloud-" + id)), enc("cloud-" + id));
  void remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch: EPOCH, generation: 5, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));
}

function realBaseline(_remote: MemRemote, ids: string[], targetKey?: string): DeviceBaseline {
  const lake: LakeIndex = { v: 3, space: "lake", folders: [], notes: ids.map((id, i) => ({ id, title: id, parentId: null, sortOrder: i, updatedAt: ISO, contentHash: H("cloud-" + id) })) };
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], purged: [] };
  const lakeCommit = indexHashOf(serializeLakeIndex(lake));
  const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
  return { epoch: EPOCH, generation: 5, lakeCommit, quickNotesCommit: quickCommit, lake, quickNotes: quick, ...(targetKey ? { targetKey } : {}) };
}

describe("首次相遇闸门（引擎）", () => {
  it("无基线 + 云端非空 + 本地非空 + 未选 ⇒ 抛 first-encounter-decision-required 并带 N/M/K 事实", async () => {
    const remote = new MemRemote();
    seedCloud(remote, ["a", "b"]);
    const device = new FakeDevice(localWorld(["a", "local-new"]), null);
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    let err: { code?: string; message?: string } | null = null;
    try { await engine.sync({ onEmptyCloud: "upload" }); } catch (e) { err = e as { code?: string; message?: string }; }
    expect(err?.code).toBe("first-encounter-decision-required");
    const facts = JSON.parse(String(err?.message));
    expect(facts).toEqual({ localNotes: 2, cloudNotes: 2, overlapNotes: 1 });
  });

  it("本地为空 ⇒ 不问（新设备直接拉取）", async () => {
    const remote = new MemRemote();
    seedCloud(remote, ["a"]);
    const device = new FakeDevice(emptyState(), null);
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    const report = await engine.sync({ onEmptyCloud: "upload" });
    expect(report.downloadedNotes ?? 0).toBe(1);
  });

  it("已有关系（真基线 + 同 targetKey）⇒ 不问，正常合并轮", async () => {
    const remote = new MemRemote();
    seedCloud(remote, ["a"]);
    const device = new FakeDevice(localWorld(["a"]), realBaseline(remote, ["a"], TARGET));
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    const report = await engine.sync({ onEmptyCloud: "upload", targetKey: TARGET });
    expect(report).toBeTruthy();
  });

  it("换目标（基线 targetKey 不符）⇒ 重新判定首次相遇（再问）", async () => {
    const remote = new MemRemote();
    seedCloud(remote, ["a"]);
    const device = new FakeDevice(localWorld(["a", "local-new"]), realBaseline(remote, ["a"], "target-OLD"));
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    let err: { code?: string } | null = null;
    try { await engine.sync({ onEmptyCloud: "upload", targetKey: TARGET }); } catch (e) { err = e as { code?: string }; }
    expect(err?.code).toBe("first-encounter-decision-required");
  });

  it("选定后建立关系：ask-once（第二轮无 mode 不再问）+ targetKey 盖章", async () => {
    const remote = new MemRemote();
    seedCloud(remote, ["a"]);
    const device = new FakeDevice(localWorld(["a", "local-new"]), null);
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    const report = await engine.sync({ onEmptyCloud: "upload", targetKey: TARGET, firstEncounter: { mode: "additive" } });
    expect(report.published ?? false).toBe(true);
    expect(device.baseline?.targetKey).toBe(TARGET);
    // 第二轮：已建立关系 ⇒ 即使不带 mode 也正常跑（不再抛询问错误）。
    const engine2 = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    const report2 = await engine2.sync({ onEmptyCloud: "upload", targetKey: TARGET });
    expect(report2).toBeTruthy();
  });

  it("additive 选定：本地内容全量上传（不被拉全轮假删除/丢弃）", async () => {
    const remote = new MemRemote();
    seedCloud(remote, ["a"]);
    const device = new FakeDevice(localWorld(["a", "local-new"]), null);
    // 正文字节必须在设备上（apply 读正文才能 PUT）。
    device.bodies.set("a", enc("local-a"));
    device.bodies.set("local-new", enc("local-local-new"));
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    const report = await engine.sync({ onEmptyCloud: "upload", targetKey: TARGET, firstEncounter: { mode: "additive" } });
    // 本地独有 local-new 必须进发布（上传），而不是被判「云端已删」。
    expect(report.published ?? false).toBe(true);
    const remoteIds = [...remote.objects.keys()];
    expect(remoteIds.some((k) => k.startsWith("objects/local-new-"))).toBe(true);
  });
});