import { describe, expect, it } from "vitest";
import { runQuickPush } from "./pipeline.js";
import type { QuickPushDeps, QuickPushDevice, QuickPushRemote } from "./types.js";
import { sha256Hex } from "../../syncUtils.js";
import {
  indexHashOf, parseQuickNotesIndexBytes, pruneQuickPurgedIds, serializeLakeIndex, serializeQuickNotesIndex,
  type LakeIndex, type QuickNoteEntry, type QuickNotesIndex,
} from "../protocol/s3v3Index.js";
import { indexKey, quickNoteBodyKey, S3V3_POINTER_KEY } from "../protocol/s3v3Keys.js";
import { LOCK_DEADLINE_MS, LOCK_KEY, LOCK_SETTLE_MS, LOCK_TTL_MS } from "../protocol/publishLock.js";
import { validatePointer, type S3v3Pointer } from "../protocol/s3v3Types.js";
import { S3v3SyncError } from "../protocol/syncErrors.js";

/**
 * 逐字节对拍（261110）：**冻结的旧实现**（从 HEAD 8bf41e65 的 S3v3Engine.pushQuickNoteOnce 原样抄来，
 * 只把 this.xxx 换成 deps.xxx；用于证明独立管线发布出来的 remote 对象/pointer/baseline 与旧实现完全一致）。
 *
 * 只覆盖无资产夹具（资产的顺序/并发不影响发布字节；有资产的发布字节由 pipeline.test 的
 * 「别端新增/删除/改标签」用例锁结构，adapter 用例锁真实图片上传）。
 */
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const NOW = new Date("2026-11-11T00:00:00.000Z");
const iso = () => NOW.toISOString();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class FakeRemote implements QuickPushRemote {
  objects = new Map<string, Uint8Array>();
  async get(key: string) { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array) { this.objects.set(key, new Uint8Array(bytes)); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
}
class FakeDevice implements QuickPushDevice {
  baseline: any = null;
  quickState: any = null;
  state: any = null;
  body: Uint8Array | null = null;
  synced: Array<{ id: string; hash: string }> = [];
  savedBalances: any[] = [];
  markers: any[] = [];
  async loadBaseline() { return this.baseline; }
  async loadQuickPushState() { return this.quickState; }
  async loadState() { return this.state; }
  async readQuickBody() { return this.body; }
  async markQuickNoteSynced(id: string, hash: string) { this.synced.push({ id, hash }); }
  async saveBaseline(b: any) { this.savedBalances.push(b); this.baseline = b; }
  async persistSyncMarkers(m: any) { this.markers.push(m); }
  async listQuickAssets(_id: string) { return []; }
  async readQuickAsset(_id: string, _filename: string) { return null; }
}

const lakeIndex = (): LakeIndex => ({ v: 3, space: "lake", notes: [], folders: [] });
const qEntry = (id: string, body: string): QuickNoteEntry => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: sha256Hex(enc(body)),
});
function fixture() {
  const lake = lakeIndex();
  const lakeCommit = indexHashOf(serializeLakeIndex(lake));
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [qEntry("q2", "other")], tags: [{ id: "t1", name: "T", createdAt: iso(), updatedAt: iso() }] };
  const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
  const epoch = "11111111-1111-4111-8111-111111111111";
  const remote = new FakeRemote();
  remote.objects.set(S3V3_POINTER_KEY, enc(JSON.stringify({
    v: 3, epoch, generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: iso(), deviceId: "D",
  } satisfies S3v3Pointer)));
  remote.objects.set(indexKey("quickNotes", quickCommit), enc(serializeQuickNotesIndex(quick)));
  const device = new FakeDevice();
  device.baseline = { epoch, generation: 1, lakeCommit, quickNotesCommit: quickCommit, lake, quickNotes: quick };
  const local = qEntry("q1", "hello");
  device.quickState = { quickNote: local, restorePending: [], remotePurged: [], quickPurges: [], quickPurgeTimes: {} };
  device.state = { lake, quickNotes: quick, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] };
  device.body = enc("hello");
  const deps: QuickPushDeps = { remote, device, deviceId: "D", now: () => NOW };
  return { remote, device, deps, lake, lakeCommit, quickCommit, epoch };
}

// ===== 冻结的旧实现（HEAD 版 pushQuickNoteOnce，去掉 assets 分支）=====
async function legacyPushOnce(deps: QuickPushDeps, id: string) {
  const readPointer = async (): Promise<S3v3Pointer | null> => {
    const bytes = await deps.remote.get(S3V3_POINTER_KEY);
    if (!bytes) return null;
    const parsed = validatePointer(JSON.parse(dec(bytes)));
    if (!parsed.ok) throw new S3v3SyncError("pointer-corrupt", parsed.reason);
    return parsed.pointer;
  };
  const lockOwner = async () => {
    const raw = await deps.remote.get(LOCK_KEY);
    if (!raw) return null;
    try { return (JSON.parse(dec(raw)) as { deviceId: string }).deviceId; } catch { return null; }
  };
  const acquireLock = async () => {
    const deadline = Date.now() + LOCK_DEADLINE_MS;
    for (;;) {
      const owner = await lockOwner();
      if (owner && owner !== deps.deviceId) {
        const raw = await deps.remote.get(LOCK_KEY);
        let fresh = false;
        if (raw) { try { const l = JSON.parse(dec(raw)) as { time: number; ttl: number }; fresh = Date.now() - l.time < (l.ttl ?? LOCK_TTL_MS); } catch { fresh = false; } }
        if (fresh) { if (Date.now() > deadline) return false; await sleep(60); continue; }
      }
      await deps.remote.put(LOCK_KEY, enc(JSON.stringify({ deviceId: deps.deviceId, time: Date.now(), ttl: LOCK_TTL_MS })));
      await sleep(LOCK_SETTLE_MS);
      if (await lockOwner() === deps.deviceId) return true;
      if (Date.now() > deadline) return false;
    }
  };
  const releaseLock = async () => {
    const raw = await deps.remote.get(LOCK_KEY);
    if (!raw) return;
    try { if ((JSON.parse(dec(raw)) as { deviceId: string }).deviceId === deps.deviceId) await deps.remote.deleteMany([LOCK_KEY]); } catch { /* ignore */ }
  };

  const pointer0 = await readPointer();
  if (!pointer0) return { status: "full-sync", reason: "no-cloud" };
  const baseline = await deps.device.loadBaseline();
  if (!baseline) return { status: "full-sync", reason: "no-baseline" };
  if (baseline.epoch !== pointer0.epoch || baseline.generation !== pointer0.generation || baseline.lakeCommit !== pointer0.lake.commit) {
    return { status: "full-sync", reason: "cloud-changed" };
  }
  const light = await deps.device.loadQuickPushState!(id);
  const local = light!.quickNote!;
  const restore = new Set(light!.restorePending);
  const remoteIndexBytes = await deps.remote.get(indexKey("quickNotes", pointer0.quickNotes.commit));
  if (!remoteIndexBytes) throw new S3v3SyncError("index-missing", "小记索引缺失");
  const remoteIndex = parseQuickNotesIndexBytes(remoteIndexBytes).index;
  const remoteEntry = remoteIndex.items.find((q) => q.id === id) ?? null;
  const remoteTombs = remoteIndex.purged ?? [];
  if (remoteTombs.includes(id) && !restore.has(id)) return { status: "full-sync", reason: "remote-deleted" };
  const body = await deps.device.readQuickBody(id);
  if (!body) throw new S3v3SyncError("quick-body-missing", "本地小记正文缺失");
  const contentHash = sha256Hex(body);
  if (remoteEntry?.contentHash !== contentHash) await deps.remote.put(quickNoteBodyKey(contentHash), body);
  const entry: QuickNoteEntry = { ...local, contentHash };
  delete (entry as { assetsHash?: string }).assetsHash;
  const items = [...remoteIndex.items.filter((q) => q.id !== id), entry].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const purged = pruneQuickPurgedIds(remoteTombs.filter((x) => x !== id), light!.quickPurgeTimes, NOW);
  const nextIndex: QuickNotesIndex = {
    v: 3, space: "quickNotes", items,
    ...(remoteIndex.tags !== undefined ? { tags: remoteIndex.tags } : {}),
    ...(purged.length ? { purged: [...purged].sort() } : {}),
  };
  const serialized = serializeQuickNotesIndex(nextIndex);
  const commit = indexHashOf(serialized);
  const uploadedContent = remoteEntry?.contentHash !== contentHash;
  const unchanged = !uploadedContent && commit === pointer0.quickNotes.commit && !restore.has(id);
  let generation = pointer0.generation;
  if (!unchanged) {
    if (!(await acquireLock())) throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步");
    try {
      const now = await readPointer();
      if (!now || now.epoch !== pointer0.epoch || now.generation !== pointer0.generation
        || now.lake.commit !== pointer0.lake.commit || now.quickNotes.commit !== pointer0.quickNotes.commit) throw new S3v3SyncError("publish-conflict", "retry");
      await deps.remote.put(indexKey("quickNotes", commit), new TextEncoder().encode(serialized));
      generation = pointer0.generation + 1;
      const nextPointer: S3v3Pointer = {
        v: 3, epoch: pointer0.epoch, generation,
        lake: { commit: pointer0.lake.commit }, quickNotes: { commit },
        createdAt: iso(), deviceId: deps.deviceId,
      };
      if (await lockOwner() !== deps.deviceId) throw new S3v3SyncError("publish-conflict", "retry");
      await deps.remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(nextPointer)));
      if (await readPointer() === null) throw new S3v3SyncError("publish-conflict", "retry");
    } finally {
      await releaseLock();
    }
  }
  if (deps.device.markQuickNoteSynced) await deps.device.markQuickNoteSynced(id, contentHash);
  await deps.device.saveBaseline({
    epoch: pointer0.epoch, generation, lakeCommit: pointer0.lake.commit,
    quickNotesCommit: commit, lake: baseline.lake, quickNotes: nextIndex,
  });
  return { status: "pushed", uploadedContent, uploadedAssets: 0, unchanged, generation };
}

const objectBytes = (remote: FakeRemote) => [...remote.objects.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, Buffer.from(v).toString("base64")] as const);

describe("独立管线 vs 旧实现（逐字节对拍）", () => {
  it("同一夹具：发布的 remote 对象（索引/正文/pointer）、baseline 增量、返回值完全一致", async () => {
    const legacyFixture = fixture();
    const legacyResult = await legacyPushOnce(legacyFixture.deps, "q1");
    const newFixture = fixture();
    const newResult = await runQuickPush(newFixture.deps, "q1");
    expect(newResult).toEqual(legacyResult);
    // 1) 远端对象逐字节一致（key 集合 + 每个对象的 base64 内容）
    expect(objectBytes(newFixture.remote)).toEqual(objectBytes(legacyFixture.remote));
    // 2) 发布出来的 quick 索引字节与 pointer 字节显式再对一次
    const np = validatePointer(JSON.parse(dec(newFixture.remote.objects.get(S3V3_POINTER_KEY)!)));
    const lp = validatePointer(JSON.parse(dec(legacyFixture.remote.objects.get(S3V3_POINTER_KEY)!)));
    if (!np.ok || !lp.ok) throw new Error("pointer invalid");
    expect(np.pointer.quickNotes.commit).toBe(lp.pointer.quickNotes.commit);
    expect(dec(newFixture.remote.objects.get(indexKey("quickNotes", np.pointer.quickNotes.commit))!))
      .toBe(dec(legacyFixture.remote.objects.get(indexKey("quickNotes", lp.pointer.quickNotes.commit))!));
    expect(dec(newFixture.remote.objects.get(S3V3_POINTER_KEY)!)).toBe(dec(legacyFixture.remote.objects.get(S3V3_POINTER_KEY)!));
    // 3) baseline 增量一致（lake 部分原样；quick 索引逐字节一致）
    const nb = newFixture.device.savedBalances.at(-1);
    const lb = legacyFixture.device.savedBalances.at(-1);
    expect(nb.generation).toBe(lb.generation);
    expect(nb.lakeCommit).toBe(lb.lakeCommit);
    expect(nb.lake).toEqual(lb.lake);
    expect(serializeQuickNotesIndex(nb.quickNotes)).toBe(serializeQuickNotesIndex(lb.quickNotes));
    // 4) 只标本条 synced
    expect(newFixture.device.synced).toEqual([{ id: "q1", hash: sha256Hex(enc("hello")) }]);
  });
});
