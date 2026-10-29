import { describe, expect, it } from "vitest";
import { S3V3_POINTER_KEY, indexHashOf, indexKey, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex, type S3v3Pointer } from "../protocol/index.js";
import type { SyncPlan } from "../plan/types.js";
import { COMMIT_LOCK_KEY, commitPlan, type CommitPorts } from "./commitPlan.js";

const EPOCH = "11111111-1111-4111-8111-111111111111";
const ISO = "2026-10-28T00:00:00.000Z";
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const lakeWorld = (notes: string[] = []): LakeIndex => ({
  v: 3, space: "lake",
  notes: notes.map((id) => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: "h-" + id })),
  folders: [],
});
const quickWorld = (items: string[] = []): QuickNotesIndex => ({
  v: 3, space: "quickNotes",
  items: items.map((id) => ({ id, createdAt: ISO, updatedAt: ISO, contentHash: "q-" + id })),
  tags: [],
});
const commitOfLake = (idx: LakeIndex) => indexHashOf(serializeLakeIndex(idx));
const commitOfQuick = (idx: QuickNotesIndex) => indexHashOf(serializeQuickNotesIndex(idx));

const pointerOf = (lake: LakeIndex, quick: QuickNotesIndex, generation = 1): S3v3Pointer => ({
  v: 3, epoch: EPOCH, generation, lake: { commit: commitOfLake(lake) }, quickNotes: { commit: commitOfQuick(quick) }, createdAt: ISO, deviceId: "other",
});

const planWith = (lake: LakeIndex, quick: QuickNotesIndex): SyncPlan => ({
  version: 4, reads: [], writes: [], transfers: [], deletes: [], publishes: { lake: [], quickNotes: [] },
  publish: { lake, quickNotes: quick }, intentChanges: [], warnings: [], total: { ops: 0, bytes: 0 },
});

class FakeCommitRemote implements CommitPorts {
  objects = new Map<string, Uint8Array>();
  puts: Array<{ key: string; gzip?: boolean }> = [];
  deleted: string[] = [];
  /** 索引写完后触发（模拟他端抢锁）。 */
  onIndexPut?: () => Promise<void>;
  /** pointer 写完后触发（模拟他端覆盖 pointer）。 */
  onPointerPut?: () => Promise<void>;
  async getRemote(key: string) { return this.objects.get(key) ?? null; }
  async putRemote(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) {
    this.objects.set(key, bytes);
    this.puts.push({ key, gzip: opts?.gzip });
    if (key.startsWith("meta/index/") || key.startsWith("quick-notes/meta/index/")) await this.onIndexPut?.();
    if (key === S3V3_POINTER_KEY) await this.onPointerPut?.();
  }
  async deleteRemoteKeys(keys: string[]) { this.deleted.push(...keys); keys.forEach((k) => this.objects.delete(k)); }
  lockOwner(): string | null {
    const raw = this.objects.get(COMMIT_LOCK_KEY);
    if (!raw) return null;
    try { return (JSON.parse(dec(raw)) as { deviceId?: string }).deviceId ?? null; } catch { return null; }
  }
  setLock(deviceId: string, time = Date.now(), ttl = 120_000) {
    this.objects.set(COMMIT_LOCK_KEY, enc(JSON.stringify({ deviceId, time, ttl })));
  }
  setPointer(p: S3v3Pointer) { this.objects.set(S3V3_POINTER_KEY, enc(JSON.stringify(p))); }
}

const fastOpts = { lockWaitMs: 0, lockSettleMs: 0, sleep: async () => {}, createdAt: ISO };

describe("E2-2b commitPlan：正常发布", () => {
  it("plan 不发布 ⇒ skipped，不产生任何 IO", async () => {
    const ports = new FakeCommitRemote();
    const lake = lakeWorld(["a"]);
    const out = await commitPlan({ plan: { ...planWith(lake, quickWorld()), publish: null }, next: null, base: pointerOf(lake, quickWorld()), deviceId: "me" }, ports, fastOpts);
    expect(out).toEqual({ status: "skipped", reason: "no-publish-plan" });
    expect(ports.puts).toEqual([]);
  });

  it("索引与 base 完全一致 ⇒ unchanged，零写入（零变更轮不碰 S3）", async () => {
    const ports = new FakeCommitRemote();
    const lake = lakeWorld(["a"]);
    const quick = quickWorld();
    ports.setPointer(pointerOf(lake, quick));
    const out = await commitPlan({ plan: planWith(lake, quick), next: { lake, quickNotes: quick }, base: pointerOf(lake, quick), deviceId: "me" }, ports, fastOpts);
    expect(out.status).toBe("unchanged");
    expect(ports.puts).toEqual([]);
  });

  it("只改文档 ⇒ 只写 lake 索引 + pointer（generation+1），锁用完即释放", async () => {
    const ports = new FakeCommitRemote();
    const baseLake = lakeWorld(["a"]);
    const nextLake = lakeWorld(["a", "b"]);
    const quick = quickWorld();
    ports.setPointer(pointerOf(baseLake, quick));
    const out = await commitPlan({ plan: planWith(nextLake, quick), next: { lake: nextLake, quickNotes: quick }, base: pointerOf(baseLake, quick), deviceId: "me" }, ports, fastOpts);
    expect(out.status).toBe("published");
    if (out.status !== "published") return;
    expect(out.generation).toBe(2);
    expect(out.wroteLake).toBe(true);
    expect(out.wroteQuick).toBe(false);
    // 先拿锁 → 写索引 → 写 pointer（锁对象最后被删除，不在 puts 里）
    expect(ports.puts.map((p) => p.key)).toEqual([COMMIT_LOCK_KEY, indexKey("lake", out.lakeCommit), S3V3_POINTER_KEY]);
    expect(ports.puts[1].gzip).toBe(true); // 索引是元数据对象，必须走 gzip
    expect(ports.lockOwner()).toBeNull();   // 锁已释放
    const written = JSON.parse(dec(ports.objects.get(S3V3_POINTER_KEY)!)) as S3v3Pointer;
    expect(written.generation).toBe(2);
    expect(written.lake.commit).toBe(out.lakeCommit);
    expect(written.deviceId).toBe("me");
  });

  it("两边都变 ⇒ 两个索引都写", async () => {
    const ports = new FakeCommitRemote();
    const baseLake = lakeWorld(["a"]);
    const nextLake = lakeWorld(["a", "b"]);
    const baseQuick = quickWorld();
    const nextQuick = quickWorld(["q"]);
    ports.setPointer(pointerOf(baseLake, baseQuick));
    const out = await commitPlan({ plan: planWith(nextLake, nextQuick), next: { lake: nextLake, quickNotes: nextQuick }, base: pointerOf(baseLake, baseQuick), deviceId: "me" }, ports, fastOpts);
    expect(out.status).toBe("published");
    if (out.status !== "published") return;
    expect(out.wroteLake).toBe(true);
    expect(out.wroteQuick).toBe(true);
    expect(ports.puts.some((p) => p.key === indexKey("quickNotes", out.quickNotesCommit))).toBe(true);
  });
});

describe("E2-2b commitPlan：并发防护（无 CAS 的三道闸）", () => {
  it("他端持新鲜锁 ⇒ retry lock-busy，且不写索引/指针、不误删他端的锁", async () => {
    const ports = new FakeCommitRemote();
    const baseLake = lakeWorld(["a"]);
    const quick = quickWorld();
    ports.setPointer(pointerOf(baseLake, quick));
    ports.setLock("other");
    const out = await commitPlan({ plan: planWith(lakeWorld(["a", "b"]), quick), next: { lake: lakeWorld(["a", "b"]), quickNotes: quick }, base: pointerOf(baseLake, quick), deviceId: "me" }, ports, fastOpts);
    expect(out).toEqual({ status: "retry", reason: "lock-busy" });
    expect(ports.puts).toEqual([]);
    expect(ports.lockOwner()).toBe("other");
  });

  it("拿锁后读回 pointer 已被他端推进 ⇒ retry pointer-moved，未写任何索引", async () => {
    const ports = new FakeCommitRemote();
    const baseLake = lakeWorld(["a"]);
    const quick = quickWorld();
    const moved = pointerOf(lakeWorld(["a", "b"]), quick, 2);
    ports.setPointer(moved); // 已不同于 base
    const out = await commitPlan({ plan: planWith(lakeWorld(["a", "b"]), quick), next: { lake: lakeWorld(["a", "b"]), quickNotes: quick }, base: pointerOf(baseLake, quick), deviceId: "me" }, ports, fastOpts);
    expect(out).toEqual({ status: "retry", reason: "pointer-moved" });
    expect(ports.puts.filter((p) => p.key.startsWith("meta/index/"))).toEqual([]);
    expect(ports.lockOwner()).toBeNull(); // 自己的锁已释放
  });

  it("写完索引后锁被抢 ⇒ retry lock-lost，指针不写", async () => {
    const ports = new FakeCommitRemote();
    const baseLake = lakeWorld(["a"]);
    const nextLake = lakeWorld(["a", "b"]);
    const quick = quickWorld();
    ports.setPointer(pointerOf(baseLake, quick));
    ports.onIndexPut = async () => { ports.setLock("other"); };
    const out = await commitPlan({ plan: planWith(nextLake, quick), next: { lake: nextLake, quickNotes: quick }, base: pointerOf(baseLake, quick), deviceId: "me" }, ports, fastOpts);
    expect(out).toEqual({ status: "retry", reason: "lock-lost" });
    expect(ports.puts.some((p) => p.key === S3V3_POINTER_KEY)).toBe(false);
  });

  it("写完 pointer 后被他端覆盖 ⇒ retry readback-mismatch", async () => {
    const ports = new FakeCommitRemote();
    const baseLake = lakeWorld(["a"]);
    const nextLake = lakeWorld(["a", "b"]);
    const quick = quickWorld();
    ports.setPointer(pointerOf(baseLake, quick));
    ports.onPointerPut = async () => { ports.setPointer(pointerOf(lakeWorld(["z"]), quick, 9)); };
    const out = await commitPlan({ plan: planWith(nextLake, quick), next: { lake: nextLake, quickNotes: quick }, base: pointerOf(baseLake, quick), deviceId: "me" }, ports, fastOpts);
    expect(out).toEqual({ status: "retry", reason: "readback-mismatch" });
  });

  it("过期锁可被接管（TTL 失效 ≠ 死锁）", async () => {
    const ports = new FakeCommitRemote();
    const baseLake = lakeWorld(["a"]);
    const nextLake = lakeWorld(["a", "b"]);
    const quick = quickWorld();
    ports.setPointer(pointerOf(baseLake, quick));
    ports.setLock("other", 0, 1); // time=0 ⇒ 早已过期
    const out = await commitPlan({ plan: planWith(nextLake, quick), next: { lake: nextLake, quickNotes: quick }, base: pointerOf(baseLake, quick), deviceId: "me" }, ports, fastOpts);
    expect(out.status).toBe("published");
    expect(ports.lockOwner()).toBeNull();
  });
});
