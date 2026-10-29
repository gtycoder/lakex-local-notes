import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { pruneQuickPurgedIds, type QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./s3v3Ports.js";
import { S3V3_POINTER_KEY } from "./s3v3/protocol/s3v3Keys.js";

/**
 * SD-09：小记 `purged` 墓碑保留窗口（90 天，与回收站自动过期同口径）。
 * 语义约束：窗口只决定「不可恢复删除」跨端传播多久；删除=缺席不变（新设备本来就没有内容），
 * 缺 purgedAt 的 id 保守保留（判不出年龄就不删）。
 */

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  puts: string[] = [];
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.puts.push(key); this.objects.set(key, new Uint8Array(bytes)); }
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

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemDevice implements S3v3DeviceStore {
  state: DeviceState | null = null;
  baseline: DeviceBaseline | null = null;
  quickBodies = new Map<string, Uint8Array>();
  async init(): Promise<void> { /* no-op */ }
  async loadState(): Promise<DeviceState | null> { return this.state ? clone(this.state) : null; }
  async saveState(state: DeviceState): Promise<void> { this.state = clone(state); }
  async loadBaseline(): Promise<DeviceBaseline | null> { return this.baseline ? clone(this.baseline) : null; }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> { this.baseline = clone(baseline); }
  async readBody(): Promise<Uint8Array | null> { return null; }
  async writeBody(): Promise<void> { /* 无文档 */ }
  async deleteBody(): Promise<void> { /* 无文档 */ }
  async writeHistory(_id: string): Promise<string> { return _id; }
  async archiveBody(): Promise<void> { /* no-op */ }
  async listAssets(): Promise<string[]> { return []; }
  async readAsset(): Promise<Uint8Array | null> { return null; }
  async writeAsset(): Promise<void> { /* no-op */ }
  async deleteAssetsDir(): Promise<void> { /* no-op */ }
  async readQuickBody(id: string): Promise<Uint8Array | null> { return this.quickBodies.get(id) ?? null; }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> { this.quickBodies.set(id, new Uint8Array(bytes)); }
  async deleteQuickBody(id: string): Promise<void> { this.quickBodies.delete(id); }
  async listQuickAssets(): Promise<string[]> { return []; }
  async readQuickAsset(): Promise<Uint8Array | null> { return null; }
  async writeQuickAsset(): Promise<void> { /* no-op */ }
  async deleteQuickAssetsDir(): Promise<void> { /* no-op */ }
}

const emptyState = (): DeviceState => ({
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
  folders: [], intents: [], pending: [], remotePurged: [], restorePending: [],
});

const entry = (id: string, body: string) => {
  const bytes = new TextEncoder().encode(body);
  return { id, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", contentHash: sha256Hex(bytes) };
};

async function seedQuick(device: MemDevice, id: string, body: string): Promise<void> {
  const state = device.state ?? emptyState();
  await device.writeQuickBody(id, new TextEncoder().encode(body));
  state.quickNotes.items = [...state.quickNotes.items.filter((q) => q.id !== id), entry(id, body)];
  await device.saveState(state);
}

const readRemoteQuick = async (remote: MemRemote): Promise<QuickNotesIndex> => {
  const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get(S3V3_POINTER_KEY)!)) as { quickNotes: { commit: string } };
  return JSON.parse(new TextDecoder().decode(remote.objects.get("quick-notes/meta/index/" + pointer.quickNotes.commit + ".json")!)) as QuickNotesIndex;
};

const DAY = 86_400_000;

describe("SD-09 · 小记 purged 保留窗口（纯函数）", () => {
  const now = new Date("2026-10-28T00:00:00.000Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * DAY).toISOString();

  it("窗口内保留、超窗移除；缺失/非法时间保守保留；结果去重排序", () => {
    const kept = pruneQuickPurgedIds(
      ["recent", "old", "unknown", "bad", "recent"],
      { recent: daysAgo(30), old: daysAgo(120), bad: "not-a-date" },
      now,
    );
    expect(kept).toEqual(["bad", "recent", "unknown"]);
  });

  it("边界：正好 90 天算窗口内；retentionDays<=0 关闭裁剪（全保留）", () => {
    expect(pruneQuickPurgedIds(["edge"], { edge: daysAgo(90) }, now)).toEqual(["edge"]);
    expect(pruneQuickPurgedIds(["old"], { old: daysAgo(365) }, now, 0)).toEqual(["old"]);
  });
});

describe("SD-09 · 引擎发布时裁剪 purged", () => {
  it("本地已知超窗（91 天）的墓碑在下一轮同步被移除，云端索引与 state 一起收敛", async () => {
    const remote = new MemRemote();
    const a = new MemDevice();
    await seedQuick(a, "q1", "keep");
    await seedQuick(a, "qOld", "gone");
    let clock = Date.parse("2026-10-01T00:00:00.000Z");
    const engine = () => new S3v3SyncEngine({ remote, device: a, deviceId: "A", lockWaitMs: 2000, now: () => new Date(clock) });
    await engine().sync({ onEmptyCloud: "upload" });
    expect((await readRemoteQuick(remote)).items.map((q) => q.id).sort()).toEqual(["q1", "qOld"]);

    // 本地彻底删除 qOld 并发布墓碑（时间 = 当前时钟，窗口内）。
    const state = a.state!;
    state.quickNotes.items = state.quickNotes.items.filter((q) => q.id !== "qOld");
    state.quickPurges = ["qOld"];
    state.quickPurgeTimes = { qOld: new Date(clock).toISOString() };
    await a.saveState(state);
    await engine().sync();
    expect((await readRemoteQuick(remote)).purged).toEqual(["qOld"]);

    // 91 天后：窗口外 → 云端索引与本地账本都不再保留该 id（删除=缺席语义不变）。
    clock += 91 * DAY;
    await engine().sync();
    const remoteQuick = await readRemoteQuick(remote);
    expect(remoteQuick.purged ?? []).toEqual([]);
    expect(remoteQuick.items.map((q) => q.id)).toEqual(["q1"]);
    expect(a.state!.quickPurges ?? []).toEqual([]);
    expect(a.state!.quickPurgeTimes ?? {}).toEqual({});
    expect(a.quickBodies.has("q1")).toBe(true);
  });

  it("接收端首次收到他端墓碑时补记时间：到期后不会被他端无限复活", async () => {
    const remote = new MemRemote();
    const a = new MemDevice();
    const b = new MemDevice();
    await seedQuick(a, "q1", "keep");
    await seedQuick(a, "qOld", "gone");
    let clock = Date.parse("2026-10-01T00:00:00.000Z");
    const engineOf = (device: MemDevice, deviceId: string) => new S3v3SyncEngine({ remote, device, deviceId, lockWaitMs: 2000, now: () => new Date(clock) });
    await engineOf(a, "A").sync({ onEmptyCloud: "upload" });
    await engineOf(b, "B").sync();

    const sa = a.state!;
    sa.quickNotes.items = sa.quickNotes.items.filter((q) => q.id !== "qOld");
    sa.quickPurges = ["qOld"];
    sa.quickPurgeTimes = { qOld: new Date(clock).toISOString() };
    await a.saveState(sa);
    await engineOf(a, "A").sync();
    expect((await readRemoteQuick(remote)).purged).toEqual(["qOld"]);

    // B 不认识这个 id（没有本地 purge 时间）⇒ 收到远端墓碑时补记当前时间，先完整保留窗口。
    await engineOf(b, "B").sync();
    expect(b.state!.quickPurgeTimes?.qOld).toBe(new Date(clock).toISOString());
    expect((await readRemoteQuick(remote)).purged).toEqual(["qOld"]);

    // 91 天后由 B 发布：窗口到期即移除，不会把 A 已裁掉的墓碑再写回云端。
    clock += 91 * DAY;
    await engineOf(b, "B").sync();
    expect((await readRemoteQuick(remote)).purged ?? []).toEqual([]);
    expect(b.state!.quickPurges ?? []).toEqual([]);
  });

  it("缺失 purgedAt 的墓碑保守保留（判不出年龄就不删）", async () => {
    const remote = new MemRemote();
    const a = new MemDevice();
    await seedQuick(a, "q1", "keep");
    const clock = Date.parse("2026-10-01T00:00:00.000Z");
    const engine = () => new S3v3SyncEngine({ remote, device: a, deviceId: "A", lockWaitMs: 2000, now: () => new Date(clock) });
    await engine().sync({ onEmptyCloud: "upload" });
    const state = a.state!;
    state.quickPurges = ["qLegacy"]; // 没有 quickPurgeTimes（历史数据/他端墓碑）
    await a.saveState(state);
    await engine().sync();
    expect((await readRemoteQuick(remote)).purged).toEqual(["qLegacy"]);
    expect(a.state!.quickPurges ?? []).toEqual(["qLegacy"]);
  });
});
