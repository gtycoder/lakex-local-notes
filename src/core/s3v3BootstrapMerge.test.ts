/**
 * 便携包零基线迁移「合并底稿」基线的同步语义（261123 真机报障，docs/PORTABLE-TRANSFER.md §3.1）。
 *
 * 场景 = 用户四步换机路径第 4 步：桌面（从未配 S3）导出便携包 → 手机导入（合成合并底稿）→
 * 桌面配 S3 并改/删文档上行 → 手机配同一 S3 首同步。安全不变量：
 *  - 首同步**不报错**（旧实现判「基线丢失」中止）；
 *  - 迁移数据不误删：本地新增（小记/文档）**上传**而不是被拉全轮物理丢弃/假删除；
 *  - 删除传播（base 有、云端无 ⇒ 本地收敛出活跃集 + 进 remotePurged 可恢复标记）；
 *  - 增量：未改动条目零传输；改过的下载；基线推进为真基线后第二轮零动作（不重复下载）。
 */
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { indexHashOf, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { indexKey, lakeBodyKey, quickNoteBodyKey } from "./s3v3/protocol/s3v3Keys.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";
import { buildBootstrapBaseline } from "./portable/bootstrapBaseline.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-11-23T00:00:00.000Z";
const EPOCH = "22222222-2222-4222-8222-222222222222";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length }));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
}

class FakeDevice implements S3v3DeviceStore {
  state: DeviceState;
  baseline: DeviceBaseline | null;
  bodies = new Map<string, Uint8Array>();
  quickBodies = new Map<string, Uint8Array>();
  writtenBodies: string[] = [];
  savedBaselines: Array<DeviceBaseline | null> = [];
  constructor(state: DeviceState, baseline: DeviceBaseline | null) { this.state = state; this.baseline = baseline; }
  async init(): Promise<void> {}
  async loadState(): Promise<DeviceState | null> { return this.state; }
  async saveState(s: DeviceState): Promise<void> { this.state = s; }
  async loadBaseline(): Promise<DeviceBaseline | null> { return this.baseline; }
  async saveBaseline(b: DeviceBaseline): Promise<void> { this.baseline = b; this.savedBaselines.push(b); }
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

/** 桌面导出时刻的世界（= 迁移包内容 = 合并底稿 base）。 */
function seedExportWorld(): { lake: LakeIndex; quick: QuickNotesIndex } {
  return {
    lake: {
      v: 3, space: "lake", folders: [],
      notes: [
        { id: "n1", title: "不变", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H("doc-unchanged") },
        { id: "n2", title: "桌面后来改了", parentId: null, sortOrder: 1, updatedAt: ISO, contentHash: H("doc-v1") },
        { id: "n3", title: "桌面后来删了", parentId: null, sortOrder: 2, updatedAt: ISO, contentHash: H("doc-deleted-later") },
      ],
    },
    quick: {
      v: 3, space: "quickNotes", items: [
        { id: "q1", createdAt: ISO, updatedAt: ISO, contentHash: H("qn-keep") },
        { id: "q2", createdAt: ISO, updatedAt: ISO, contentHash: H("qn-deleted-later") },
      ],
    },
  };
}

/** 首同步现场：手机（导入后又新增 n4/q3）× 云端（桌面改 n2、删 n3/q2）。 */
function seedScenario(): { remote: MemRemote; device: FakeDevice } {
  const world = seedExportWorld();
  const base = buildBootstrapBaseline({
    notes: world.lake.notes,
    folders: [],
    quickItems: world.quick.items,
    quickTags: [],
    quickPurged: [],
  });
  // 本地 = 导出世界 + 导入后新增（n4 文档、q3 小记）—— 旧实现拉全轮会把它们假删除/物理丢弃。
  const localLake: LakeIndex = {
    v: 3, space: "lake", folders: [],
    notes: [...world.lake.notes, { id: "n4", title: "手机新增", parentId: null, sortOrder: 3, updatedAt: ISO, contentHash: H("doc-new-on-phone") }],
  };
  const localQuick: QuickNotesIndex = {
    v: 3, space: "quickNotes", items: [...world.quick.items, { id: "q3", createdAt: ISO, updatedAt: ISO, contentHash: H("qn-new-on-phone") }],
  };
  const state: DeviceState = {
    lake: localLake, quickNotes: localQuick, folders: [], intents: [], pending: [],
    remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
  };
  const device = new FakeDevice(state, base);
  for (const n of localLake.notes) device.bodies.set(n.id, enc(n.id === "n2" ? "doc-v1" : n.id === "n3" ? "doc-deleted-later" : n.id === "n4" ? "doc-new-on-phone" : "doc-unchanged"));
  for (const q of localQuick.items) device.quickBodies.set(q.id, enc(q.id === "q1" ? "qn-keep" : q.id === "q2" ? "qn-deleted-later" : "qn-new-on-phone"));

  // 云端 = 桌面配置 S3 后的世界：n2 改成 v2、n3/q2 删除，其余照旧（全部已上传）。
  const remoteLake: LakeIndex = {
    v: 3, space: "lake", folders: [],
    notes: [
      { id: "n1", title: "不变", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H("doc-unchanged") },
      { id: "n2", title: "桌面后来改了", parentId: null, sortOrder: 1, updatedAt: ISO, contentHash: H("doc-v2") },
    ],
  };
  const remoteQuick: QuickNotesIndex = {
    v: 3, space: "quickNotes", items: [{ id: "q1", createdAt: ISO, updatedAt: ISO, contentHash: H("qn-keep") }],
  };
  const remote = new MemRemote();
  const lakeSer = serializeLakeIndex(remoteLake);
  const quickSer = serializeQuickNotesIndex(remoteQuick);
  const lakeCommit = indexHashOf(lakeSer);
  const quickCommit = indexHashOf(quickSer);
  void remote.put(indexKey("lake", lakeCommit), enc(lakeSer));
  void remote.put(indexKey("quickNotes", quickCommit), enc(quickSer));
  void remote.put(lakeBodyKey("n1", H("doc-unchanged")), enc("doc-unchanged"));
  void remote.put(lakeBodyKey("n2", H("doc-v2")), enc("doc-v2"));
  void remote.put(quickNoteBodyKey(H("qn-keep")), enc("qn-keep"));
  void remote.put("meta/pointer.json", enc(JSON.stringify({
    v: 3, epoch: EPOCH, generation: 5,
    lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO,
  })));
  return { remote, device };
}

describe("合并底稿首同步（261123 四步换机路径）", () => {
  it("不报错；增量合并：改过的下载、本地新增上传、远端删的传播出活跃集、未改零传输；基线推进为真基线", async () => {
    const { remote, device } = seedScenario();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    // 261123 闸门（SYNC-PROTOCOL §21）：bootstrap 底稿也算未建立关系 ⇒ 需要显式选择；
    // 「智能合并」= 本用例钉的既有语义（按包内基线判真删）。
    const report = await engine.sync({ onEmptyCloud: "upload", firstEncounter: { mode: "smart" } });

    // 首同步成功（旧实现这里抛「基线丢失/中止」类失败）。
    expect(report.warnings ?? []).toEqual([]);
    // n2（桌面导出后修改）⇒ 下载。
    expect(device.writtenBodies).toContain("n2");
    // n1（未改）⇒ 零传输：不下载、不上传。
    expect(device.writtenBodies).not.toContain("n1");
    expect(report.uploadedNotes).toBe(2); // n4 + q3
    // 本地新增的 n4/q3 **上传**（不被假删除/丢弃）：云上出现正文对象。
    expect([...remote.objects.keys()]).toContain(lakeBodyKey("n4", H("doc-new-on-phone")));
    expect([...remote.objects.keys()]).toContain(quickNoteBodyKey(H("qn-new-on-phone")));
    // n3（云端删除传播）：不再作为活跃内容保留——出活跃集或进回收站（trashedAt，可恢复）；
    // q2 出小记活跃集；n3 进 remotePurged「云端已删除·仅本地」标记（可恢复，不是物理丢失）。
    // q2 的可恢复副本标记在平台持久层的 quick-missing 三态（knownCloud ⇒ 软删进小记回收站，
    // 不走 discardQuickNote 物理丢弃；见 state/deviceStore.ts 与 deviceStoreMeta.test.ts）。
    const n3 = device.state.lake.notes.find((n) => n.id === "n3");
    expect(n3 === undefined || !!n3.trashedAt).toBe(true);
    expect(device.state.quickNotes.items.some((q) => q.id === "q2")).toBe(false);
    expect(device.state.remotePurged ?? []).toContain("n3");
    // 基线推进为真基线（bootstrap 标记消失）。
    expect(device.baseline?.bootstrap ?? false).toBe(false);
    expect(device.baseline?.epoch).toBe(EPOCH);
  });

  it("第二轮幂等：零下载零发布（基线已推进，不会拿导出快照反复重下）", async () => {
    const { remote, device } = seedScenario();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    await engine.sync({ onEmptyCloud: "upload", firstEncounter: { mode: "smart" } });
    const writesAfterFirst = device.writtenBodies.length;
    const report2 = await engine.sync({ onEmptyCloud: "upload" }); // 已建立关系：不再询问（ask-once）
    expect(device.writtenBodies.length).toBe(writesAfterFirst);
    expect(report2.downloadedNotes ?? 0).toBe(0);
    expect(report2.uploadedNotes ?? 0).toBe(0);
    expect(report2.published ?? false).toBe(false);
  });

  it("空桶：合并底稿走首传（全部上传、发布 generation 1、基线变真基线）", async () => {
    const world = seedExportWorld();
    const base = buildBootstrapBaseline({ notes: world.lake.notes, folders: [], quickItems: world.quick.items, quickTags: [], quickPurged: [] });
    const state: DeviceState = {
      lake: world.lake, quickNotes: world.quick, folders: [], intents: [], pending: [],
      remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
    };
    const device = new FakeDevice(state, base);
    for (const n of world.lake.notes) device.bodies.set(n.id, enc(n.id === "n1" ? "doc-unchanged" : n.id === "n2" ? "doc-v1" : "doc-deleted-later"));
    for (const q of world.quick.items) device.quickBodies.set(q.id, enc(q.id === "q1" ? "qn-keep" : "qn-deleted-later"));
    const remote = new MemRemote();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    const report = await engine.sync({ onEmptyCloud: "upload" });
    expect(report.published ?? false).toBe(true);
    // 证据以云上对象为准：3 文档 + 2 小记正文全部上传（计数口径在首传轮不走 apply.uploaded）。
    for (const n of world.lake.notes) expect([...remote.objects.keys()]).toContain(lakeBodyKey(n.id, n.contentHash));
    for (const q of world.quick.items) expect([...remote.objects.keys()]).toContain(quickNoteBodyKey(q.contentHash));
    expect(device.baseline?.bootstrap ?? false).toBe(false);
    expect(device.baseline?.generation).toBe(1);
  });
});
