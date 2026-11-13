import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {},
  loadAssetBytesFs: async () => null,
  removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  statNoteAssetSizesFs: async () => null,
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));

import { gunzipSync, gzipSync } from "node:zlib";
import { countRemoteOps } from "../../core/s3v3/remoteStats.js";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { saveQuickNote } from "../data/quickNotesRepository.js";
import { loadV3State } from "../data/v3StateRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { runMobileV3PushQuickNote, runMobileV3Sync } from "./sync.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";

/**
 * 移动端「保存并同步」快路径（261110）：
 *  · 与桌面同一套最短链判据（指针/索引/正文 PUT 数固定，不读 lake 索引/别的小记正文）；
 *  · 轻量状态：不跑 MobileDeviceStore.loadState（不重建世界）；单条快路径走合并读
 *    loadQuickPushSnapshot（task-83：一次读 sync_v3_state 同时给出 baseline + 单行 + 标记）；
 *  · 基线只更新本条；重复点零上传。
 */
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

const SETTINGS = { endpoint: "https://example.com", region: "cn-north-1", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "p" };

class SpyDevice extends MobileDeviceStore {
  loadStateCalls = 0;
  quickStateCalls = 0;
  snapshotCalls = 0;
  saveBaselineCalls = 0;
  override async loadState() { this.loadStateCalls += 1; return await super.loadState(); }
  override async loadQuickPushState(id: string) { this.quickStateCalls += 1; return await super.loadQuickPushState(id); }
  override async loadQuickPushSnapshot(id: string) { this.snapshotCalls += 1; return await super.loadQuickPushSnapshot(id); }
  override async saveBaseline(baseline: Parameters<MobileDeviceStore["saveBaseline"]>[0]) {
    this.saveBaselineCalls += 1;
    return await super.saveBaseline(baseline);
  }
}

const pointerOf = async (remote: MemoryRemote) => JSON.parse(dec((await remote.get("meta/pointer.json"))!)) as { generation: number; lake: { commit: string } };
const keysWithPrefix = (keys: string[], prefix: string) => keys.filter((k) => k.startsWith(prefix));
const isDirty = async (db: SqlJsAsyncDb, id: string) => (await db.prepare("SELECT is_dirty FROM quick_notes WHERE id=?").get(id) as { is_dirty: number }).is_dirty;

describe("移动端单条推送最短链（261110）", () => {
  it("请求数固定 + 轻量状态 + 基线只更新本条 + 重复零上传", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    const remote = new MemoryRemote();
    await saveQuickNote(db, "q1", "one");
    await saveQuickNote(db, "q2", "two");
    await runMobileV3Sync(db, SETTINGS, { remote, deviceId: "M", emptyCloud: "upload" });
    const before = (await loadV3State(db)).baseline as { generation: number; lake: unknown; quickNotes: { items: Array<{ id: string }> } };

    await saveQuickNote(db, "q1", "one-v2");
    expect(await isDirty(db, "q1")).toBe(1);

    const spy = new SpyDevice(db);
    const counted = countRemoteOps(remote);
    const phases: Array<{ phase: string; ms: number }> = [];
    const out = await runMobileV3PushQuickNote(db, SETTINGS, "q1", { remote: counted.remote, deviceId: "M", device: spy });
    expect(out.status).toBe("pushed");
    if (out.status !== "pushed") throw new Error("unreachable");
    expect(out.uploadedContent).toBe(true);

    const stats = counted.stats;
    // pointer：锁内 CAS 读 + 写后校验（入口那次已省；共 2 次）。
    expect(stats.getKeys.filter((k) => k === "meta/pointer.json")).toHaveLength(2);
    expect(keysWithPrefix(stats.getKeys, "quick-notes/meta/index/")).toHaveLength(1);
    expect(keysWithPrefix(stats.getKeys, "meta/index/")).toHaveLength(0);
    expect(keysWithPrefix(stats.getKeys, "quick-notes/objects/")).toHaveLength(0);
    expect(keysWithPrefix(stats.putKeys, "quick-notes/objects/")).toHaveLength(1);
    expect(keysWithPrefix(stats.putKeys, "quick-notes/meta/index/")).toHaveLength(1);
    expect(stats.putKeys.filter((k) => k === "meta/pointer.json")).toHaveLength(1);
    expect(spy.loadStateCalls).toBe(0);
    // task-83：合并读一次取齐（不再分别走 loadBaseline + loadQuickPushState）。
    expect(spy.snapshotCalls).toBe(1);
    expect(spy.quickStateCalls).toBe(0);

    // 基线：lake 原样、只更新这条、generation +1；本行已标 synced。
    const after = (await loadV3State(db)).baseline as typeof before;
    expect(after.lake).toEqual(before.lake);
    expect(after.generation).toBe(before.generation + 1);
    expect(after.quickNotes.items.find((q) => q.id === "q2")).toEqual(before.quickNotes.items.find((q) => q.id === "q2"));
    expect(await isDirty(db, "q1")).toBe(0);

    // 后续整轮：基线已跟上 ⇒ 这条被当已同步，不重传、不发布。
    // 261113（D7 修好）：无标签小记不再被端口合成 tag 版本 ⇒ 这里必须**零发布**（此前会多一轮
    // 「只含元数据」的再发布：gen+1、只 PUT 一份 quick-notes 索引）。
    const countedNext = countRemoteOps(remote);
    const nextRound = await runMobileV3Sync(db, SETTINGS, { remote: countedNext.remote, deviceId: "M" });
    expect(nextRound.uploadedQuickNotes).toBe(0);
    expect(nextRound.uploadedNotes).toBe(0);
    expect(keysWithPrefix(countedNext.stats.putKeys, "quick-notes/meta/index/")).toHaveLength(0);
    expect(keysWithPrefix(countedNext.stats.putKeys, "meta/index/")).toHaveLength(0);
    const genAfterFullRound = ((await loadV3State(db)).baseline as { generation: number }).generation;
    expect(genAfterFullRound).toBe(after.generation);

    // 重复点：零上传，不涨 generation，且**不重写基线**（D1：字节不变就没必要整份归位）。
    const counted2 = countRemoteOps(remote);
    const spy2 = new SpyDevice(db);
    const out2 = await runMobileV3PushQuickNote(db, SETTINGS, "q1", { remote: counted2.remote, deviceId: "M", device: spy2 });
    expect(out2.status).toBe("pushed");
    if (out2.status !== "pushed") throw new Error("unreachable");
    expect(out2.unchanged).toBe(true);
    expect(counted2.stats.puts).toBe(0);
    expect(counted2.stats.total).toBe(1);
    expect(counted2.stats.getKeys).toEqual(["meta/pointer.json"]);
    expect((await pointerOf(remote)).generation).toBe(genAfterFullRound);
    expect(spy2.saveBaselineCalls).toBe(0);
    void phases;
    await db.close();
  }, 30_000);

  it("未配置/关闭云同步在 bridge 层 fail-closed（零请求、明确文案）", async () => {
    // 静态口径：bridge.syncQuickNote 一次读设置 + canTouchNetwork 判据（不重复读 secret）。
    const fs = await import("node:fs");
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const BRIDGE_QUICK = read("src/mobile/bridge/quickNotes.ts");
    expect(BRIDGE_QUICK).toContain("mobileCloudContext()");
    expect(BRIDGE_QUICK).toContain("canTouchNetwork(state)");
    expect(BRIDGE_QUICK).toContain("runPriority(\"syncQuickNote\"");
    // pushSingleQuickNote 接收已读出的 cfg（避免 secret 二次读）
    expect(read("src/mobile/bridge/sync.ts")).toContain("deps.cfg ?? await syncDomain.getS3Settings()");
  });
});
