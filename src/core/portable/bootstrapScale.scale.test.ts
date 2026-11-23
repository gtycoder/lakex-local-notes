
import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { sha256Hex } from "../syncUtils.js";
import { indexHashOf, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "../s3v3/protocol/s3v3Index.js";
import { indexKey, lakeBodyKey, quickNoteBodyKey } from "../s3v3/protocol/s3v3Keys.js";
import { S3v3SyncEngine } from "../s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "../s3v3Ports.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../s3v3DeviceStore.js";
import { buildBootstrapBaseline } from "./bootstrapBaseline.js";

/**
 * 同步链路规模档（261123 lead 点单；测试规模口径 = 5k 文档 / 1万附件量级，5k 条目索引）：
 * ③ 合并底稿合成 5k 条目耗时/内存（防 O(n²)）；
 * ⑤ 迁移后首同步（bootstrap 三方合并 5k 条目索引）轮时长 + 四步语义正确性；
 * 第二轮幂等（零动作）。
 * 默认 skip：LLN_SCALE=1 npx vitest run src/core/portable/bootstrapScale.scale.test.ts
 * 报告行 "SCALE-REPORT"（JSON）打 stdout 供 lead 汇总。
 */

const SCALE = !!process.env.LLN_SCALE;
const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-11-23T00:00:00.000Z";
const EPOCH = "22222222-2222-4222-8222-222222222222";
const memMb = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const report = (tag: string, data: Record<string, unknown>): void => {
  console.log("SCALE-REPORT " + JSON.stringify({ tag, ...data }));
};

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

const NOTES = 5_000;
const QUICK = 1_000;
const CHANGED = 100;      // 桌面导出后修改的文档（下载）
const DEL_NOTES = 50;     // 桌面导出后删除的文档（传播）
const DEL_QUICK = 50;     // 桌面导出后删除的小记（传播）
const LOCAL_NEW_NOTES = 200;  // 导入后手机新增（上传）
const LOCAL_NEW_QUICK = 100;

const noteId = (i: number) => "n" + String(i).padStart(6, "0");
const quickId = (i: number) => "q" + String(i).padStart(6, "0");

function exportWorld(): { lake: LakeIndex; quick: QuickNotesIndex } {
  const lake: LakeIndex = {
    v: 3, space: "lake", folders: [],
    notes: Array.from({ length: NOTES }, (_, i) => ({
      id: noteId(i), title: "Doc " + i, parentId: null, sortOrder: i, updatedAt: ISO, contentHash: H("body-" + noteId(i)),
    })),
  };
  const quick: QuickNotesIndex = {
    v: 3, space: "quickNotes",
    items: Array.from({ length: QUICK }, (_, i) => ({ id: quickId(i), createdAt: ISO, updatedAt: ISO, contentHash: H("qn-" + quickId(i)) })),
  };
  return { lake, quick };
}

describe.skipIf(!SCALE)("合并底稿规模档（5k 文档/1万附件量级）", () => {
  it("③ 合成 5k 条目：耗时/内存 + 防 O(n²)（1k→5k 时间比 < 15×）", () => {
    const world = exportWorld();
    const rows1k = { notes: world.lake.notes.slice(0, 1000), folders: [], quickItems: world.quick.items.slice(0, 200), quickTags: [], quickPurged: [] };
    const rows5k = { notes: world.lake.notes, folders: [], quickItems: world.quick.items, quickTags: [], quickPurged: [] };
    const heap0 = memMb();
    const t1 = performance.now();
    const b1 = buildBootstrapBaseline(rows1k);
    const t1k = performance.now() - t1;
    const t5 = performance.now();
    const b5 = buildBootstrapBaseline(rows5k);
    const t5k = performance.now() - t5;
    expect(b1.lake.notes).toHaveLength(1000);
    expect(b5.lake.notes).toHaveLength(NOTES);
    expect(b5.quickNotes.items).toHaveLength(QUICK);
    expect(t5k).toBeLessThan(10_000);
    expect(t5k).toBeLessThan(Math.max(t1k, 5) * 15); // 线性 ~5×，留 3× 余量防抖
    report("bootstrap-synth", { rows1k: 1200, rows5k: NOTES + QUICK, t1kMs: +t1k.toFixed(1), t5kMs: +t5k.toFixed(1), heapDeltaMb: memMb() - heap0 });
  });

  it("⑤ 迁移后首同步：5k 条目 bootstrap 三方合并 + 增量/删除传播/本地新增上传 + 第二轮零动作", async () => {
    const world = exportWorld();
    const heap0 = memMb();
    // 合并底稿 = 导出时刻世界
    const base = buildBootstrapBaseline({ notes: world.lake.notes, folders: [], quickItems: world.quick.items, quickTags: [], quickPurged: [] });

    // 云端 = 桌面配 S3 后：改 CHANGED 篇、删 DEL_NOTES/DEL_QUICK，其余照旧
    const changedHash = (i: number) => H("body-" + noteId(i) + "-v2");
    const remoteLakeNotes = world.lake.notes
      .filter((n) => !n.id.startsWith(noteId(NOTES - DEL_NOTES).slice(0, 1)) || Number(n.id.slice(1)) < NOTES - DEL_NOTES)
      .map((n) => {
        const i = Number(n.id.slice(1));
        return i < CHANGED ? { ...n, contentHash: changedHash(i) } : n;
      });
    const remoteLake: LakeIndex = { v: 3, space: "lake", folders: [], notes: remoteLakeNotes };
    const remoteQuick: QuickNotesIndex = {
      v: 3, space: "quickNotes",
      items: world.quick.items.filter((q) => Number(q.id.slice(1)) < QUICK - DEL_QUICK),
    };
    const remote = new MemRemote();
    const lakeSer = serializeLakeIndex(remoteLake);
    const quickSer = serializeQuickNotesIndex(remoteQuick);
    const lakeCommit = indexHashOf(lakeSer);
    const quickCommit = indexHashOf(quickSer);
    void remote.put(indexKey("lake", lakeCommit), enc(lakeSer));
    void remote.put(indexKey("quickNotes", quickCommit), enc(quickSer));
    for (const n of remoteLake.notes) void remote.put(lakeBodyKey(n.id, n.contentHash), enc(Number(n.id.slice(1)) < CHANGED ? "body-" + n.id + "-v2" : "body-" + n.id)); // 字节 = contentHash 原像
    for (const q of remoteQuick.items) void remote.put(quickNoteBodyKey(q.contentHash), enc("qn-" + q.id));
    void remote.put("meta/pointer.json", enc(JSON.stringify({
      v: 3, epoch: EPOCH, generation: 5, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO,
    })));

    // 本地 = 导入世界 + 导入后新增
    const localNotes = [
      ...world.lake.notes,
      ...Array.from({ length: LOCAL_NEW_NOTES }, (_, k) => ({
        id: "new-n" + String(k).padStart(5, "0"), title: "新" + k, parentId: null, sortOrder: NOTES + k, updatedAt: ISO, contentHash: H("new-doc-" + k),
      })),
    ];
    const localQuick = [
      ...world.quick.items,
      ...Array.from({ length: LOCAL_NEW_QUICK }, (_, k) => ({
        id: "new-q" + String(k).padStart(5, "0"), createdAt: ISO, updatedAt: ISO, contentHash: H("new-qn-" + k),
      })),
    ];
    const state: DeviceState = {
      lake: { v: 3, space: "lake", folders: [], notes: localNotes },
      quickNotes: { v: 3, space: "quickNotes", items: localQuick },
      folders: [], intents: [], pending: [], remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
    };
    const device = new FakeDevice(state, base);
    // 字节 = contentHash 原像（引擎下载/上传时校验 sha256 与索引一致）
    for (const n of localNotes) device.bodies.set(n.id, enc(n.id.startsWith("new-n") ? "new-doc-" + Number(n.id.slice(5)) : "body-" + n.id));
    for (const q of localQuick) device.quickBodies.set(q.id, enc(q.id.startsWith("new-q") ? "new-qn-" + Number(q.id.slice(5)) : "qn-" + q.id));

    const engine = new S3v3SyncEngine({ remote, device, deviceId: "phone" });
    const t0 = performance.now();
    const r1 = await engine.sync({ onEmptyCloud: "upload" });
    const firstSyncMs = performance.now() - t0;
    expect(r1.warnings ?? []).toEqual([]);
    // 改过的下载
    for (let i = 0; i < Math.min(5, CHANGED); i++) expect(device.writtenBodies).toContain(noteId(i));
    // 未改的零传输
    expect(device.writtenBodies).not.toContain(noteId(CHANGED + 1));
    // 本地新增上传
    expect(r1.uploadedNotes).toBe(LOCAL_NEW_NOTES + LOCAL_NEW_QUICK);
    // 删除传播：远端删的出活跃集或进回收站（trashedAt，可恢复）+ 进 remotePurged 标记
    const deleted = device.state.lake.notes.find((n) => n.id === noteId(NOTES - 1));
    expect(deleted === undefined || !!deleted.trashedAt).toBe(true);
    expect(device.state.remotePurged ?? []).toContain(noteId(NOTES - 1));
    expect(device.state.quickNotes.items.some((q) => q.id === quickId(QUICK - 1))).toBe(false);
    // 基线推进为真基线
    expect(device.baseline?.bootstrap ?? false).toBe(false);
    expect(device.baseline?.epoch).toBe(EPOCH);

    const writesAfterFirst = device.writtenBodies.length;
    const t1 = performance.now();
    const r2 = await engine.sync({ onEmptyCloud: "upload" });
    const secondSyncMs = performance.now() - t1;
    expect(r2.downloadedNotes ?? 0).toBe(0);
    expect(r2.uploadedNotes ?? 0).toBe(0);
    expect(r2.published ?? false).toBe(false);
    expect(device.writtenBodies.length).toBe(writesAfterFirst);

    report("engine-first-sync-5k", {
      indexNotes: NOTES, indexQuick: QUICK, changed: CHANGED, deleted: DEL_NOTES + DEL_QUICK,
      localNew: LOCAL_NEW_NOTES + LOCAL_NEW_QUICK,
      firstSyncMs: Math.round(firstSyncMs), secondSyncMs: Math.round(secondSyncMs),
      downloaded: r1.downloadedNotes ?? 0, uploaded: r1.uploadedNotes ?? 0,
      heapDeltaMb: memMb() - heap0, remoteObjects: remote.objects.size,
    });
  }, 300_000);
});
