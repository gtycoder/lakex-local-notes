import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./s3v3Ports.js";
import type { LakeIndex, QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { S3V3_POINTER_KEY } from "./s3v3/protocol/s3v3Keys.js";

/**
 * P1 并发发布锁回归（261028）：
 *  - 6 端同时发布 ⇒ 内部退避等锁，谁都不该把 lock-busy 当同步失败（并发压测 17.5% 失败率的护栏）；
 *  - 锁被别人长期占着 ⇒ 有界等待后明确抛 lock-busy（不无限空转、不静默无结果）；
 *  - 锁短时被占 ⇒ 等锁预算内自动等到并发布成功。
 */

const enc = (text: string) => new TextEncoder().encode(text);
const H = (text: string) => sha256Hex(enc(text));
const ISO = "2026-10-28T00:00:00.000Z";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix))
      .map((key) => ({ key, size: this.objects.get(key)!.length }));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    return keys.length;
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemDevice implements S3v3DeviceStore {
  state: DeviceState | null = null;
  baseline: DeviceBaseline | null = null;
  bodies = new Map<string, Uint8Array>();
  quickBodies = new Map<string, Uint8Array>();
  async init(): Promise<void> { /* 无 IO */ }
  async loadState(): Promise<DeviceState | null> { return this.state ? clone(this.state) : null; }
  async saveState(state: DeviceState): Promise<void> { this.state = clone(state); }
  async loadBaseline(): Promise<DeviceBaseline | null> { return this.baseline ? clone(this.baseline) : null; }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> { this.baseline = clone(baseline); }
  async readBody(id: string): Promise<Uint8Array | null> { return this.bodies.get(id) ?? null; }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> { this.bodies.set(id, new Uint8Array(bytes)); }
  async deleteBody(id: string): Promise<void> { this.bodies.delete(id); }
  async writeHistory(): Promise<string> { return "skip"; }
  async archiveBody(): Promise<void> { /* 无归档 */ }
  async listAssets(): Promise<string[]> { return []; }
  async readAsset(): Promise<Uint8Array | null> { return null; }
  async writeAsset(): Promise<void> { /* 本用例无资产 */ }
  async deleteAssetsDir(): Promise<void> { /* 同上 */ }
  async readQuickBody(id: string): Promise<Uint8Array | null> { return this.quickBodies.get(id) ?? null; }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> { this.quickBodies.set(id, new Uint8Array(bytes)); }
  async deleteQuickBody(id: string): Promise<void> { this.quickBodies.delete(id); }
  async listQuickAssets(): Promise<string[]> { return []; }
  async readQuickAsset(): Promise<Uint8Array | null> { return null; }
  async writeQuickAsset(): Promise<void> { /* 本用例无资产 */ }
  async deleteQuickAssetsDir(): Promise<void> { /* 同上 */ }
}

const emptyState = (): DeviceState => ({
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] } as QuickNotesIndex,
  folders: [], intents: [], pending: [], remotePurged: [], restorePending: [],
});

async function addDoc(device: MemDevice, id: string, body: string): Promise<void> {
  const state = device.state ?? emptyState();
  const bytes = enc(body);
  await device.writeBody(id, bytes);
  const entry = { id, title: "T" + id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H(body) };
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), entry];
  await device.saveState(state);
}

const engineOf = (remote: MemRemote, device: MemDevice, deviceId: string, publishLockWaitMs?: number) =>
  new S3v3SyncEngine({ remote, device, deviceId, lockWaitMs: 2000, ...(publishLockWaitMs !== undefined ? { publishLockWaitMs } : {}) });

const remoteLake = (remote: MemRemote): LakeIndex => {
  const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get(S3V3_POINTER_KEY)!)) as { lake: { commit: string } };
  return JSON.parse(new TextDecoder().decode(remote.objects.get("meta/index/" + pointer.lake.commit + ".json")!)) as LakeIndex;
};

function holdForeignLock(remote: MemRemote): void {
  remote.objects.set("meta/lock.json", enc(JSON.stringify({ deviceId: "other-device", time: Date.now(), ttl: 120_000 })));
}

describe("P1 · 并发发布锁（261028）", () => {
  it("6 端同时发布：内部等锁/退避，谁都不因 lock-busy 失败，最终收敛到同一份索引", async () => {
    const remote = new MemRemote();
    const devices = Array.from({ length: 6 }, () => new MemDevice());
    // 建立云端世界 + 各端基线（串行）。
    await addDoc(devices[0]!, "seed", "seed-body");
    await engineOf(remote, devices[0]!, "d0").sync({ onEmptyCloud: "upload" });
    for (let i = 1; i < devices.length; i++) await engineOf(remote, devices[i]!, "d" + i).sync();
    // 每端各加 2 篇，同时发布。
    for (let i = 0; i < devices.length; i++) {
      await addDoc(devices[i]!, "d" + i + "-a", "body-" + i + "-a");
      await addDoc(devices[i]!, "d" + i + "-b", "body-" + i + "-b");
    }
    const settled = await Promise.allSettled(devices.map((d, i) => engineOf(remote, d, "d" + i).sync()));
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(0);
    // 收敛：再各跑一轮把别人的发布拉下来，然后断言云端与 6 端 id 集合完全一致。
    for (let i = 0; i < devices.length; i++) await engineOf(remote, devices[i]!, "d" + i).sync();
    const cloudIds = remoteLake(remote).notes.map((n) => n.id).sort();
    expect(cloudIds).toHaveLength(13);
    for (const device of devices) {
      expect((device.state?.lake.notes ?? []).map((n) => n.id).sort()).toEqual(cloudIds);
    }
    // 零变更轮不再发布（收敛稳定）。
    const idle = await engineOf(remote, devices[0]!, "d0").sync();
    expect(idle.published).toBe(false);
  }, 120_000);

  it("锁被别的端长期占着：有界等待后明确抛 lock-busy（不无限空转）", async () => {
    const remote = new MemRemote();
    const device = new MemDevice();
    await addDoc(device, "n1", "body");
    await engineOf(remote, device, "d0", 120).sync({ onEmptyCloud: "upload" });
    await addDoc(device, "n2", "body2");
    holdForeignLock(remote);
    const startedAt = Date.now();
    let code: string | undefined;
    try {
      await engineOf(remote, device, "d0", 120).sync();
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe("lock-busy");
    // 单次等待 120ms + 3 次尝试的有界退避：远小于 20s 预算，也远小于锁 TTL。
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 30_000);

  it("锁只被短暂占用：等锁预算内自动拿到并发布成功（不把并发当失败）", async () => {
    const remote = new MemRemote();
    const device = new MemDevice();
    await addDoc(device, "n1", "body");
    await engineOf(remote, device, "d0", 3000).sync({ onEmptyCloud: "upload" });
    await addDoc(device, "n2", "body2");
    holdForeignLock(remote);
    const release = setTimeout(() => { remote.objects.delete("meta/lock.json"); }, 300);
    try {
      const report = await engineOf(remote, device, "d0", 3000).sync();
      expect(report.published).toBe(true);
      expect(remoteLake(remote).notes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    } finally {
      clearTimeout(release);
    }
  }, 30_000);

  it("单次等锁预算用尽 ⇒ 外层退避重试后仍发布成功（lock-busy 不再直接变成用户可见失败）", async () => {
    const remote = new MemRemote();
    const device = new MemDevice();
    await addDoc(device, "n1", "body");
    await engineOf(remote, device, "d0", 3000).sync({ onEmptyCloud: "upload" });
    await addDoc(device, "n2", "body2");
    holdForeignLock(remote);
    // 单次等锁只有 60ms（必然 lock-busy），锁 500ms 后释放 ⇒ 靠引擎外层退避重试完成发布。
    const release = setTimeout(() => { remote.objects.delete("meta/lock.json"); }, 500);
    const engine = engineOf(remote, device, "d0", 60);
    try {
      const report = await engine.sync();
      expect(report.published).toBe(true);
      expect(engine.publishLockBusyRetries).toBeGreaterThanOrEqual(1);
      expect(remoteLake(remote).notes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    } finally {
      clearTimeout(release);
    }
  }, 30_000);
});
