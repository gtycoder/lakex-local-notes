import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import type { LakeIndex } from "./s3v3Index.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./s3v3Ports.js";
import type { QuickNotesIndex } from "./s3v3Index.js";
import { S3V3_POINTER_KEY } from "./s3v3Keys.js";

/**
 * v3 · 「云端已彻底删除 · 仅本地」（state.remotePurged）语义护栏（用户 261026 定稿）：
 *  - 远端彻底删除 → 本地副本保留回收站、只打标，不限制恢复；
 *  - 标记必须持久化：否则状态里的回收站副本下一轮会被三方合并当成「本地新建」重新上传（复活）；
 *  - 显式恢复 / 远端重新出现 / 本地主动彻底删除 → 标记清除，且清除后不留下任何 S3 行为。
 */

const H = (text: string) => sha256Hex(new TextEncoder().encode(text));

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  puts: string[] = [];
  deletes: string[] = [];
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.puts.push(key); this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) { this.deletes.push(k); this.objects.delete(k); } }
  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.objects.delete(k);
    this.deletes.push(...keys);
    return keys.length;
  }
  resetLog(): void { this.puts = []; this.deletes = []; }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MemDevice implements S3v3DeviceStore {
  state: DeviceState | null = null;
  baseline: DeviceBaseline | null = null;
  bodies = new Map<string, Uint8Array>();
  assets = new Map<string, Map<string, Uint8Array>>();
  quickBodies = new Map<string, Uint8Array>();
  quickAssets = new Map<string, Map<string, Uint8Array>>();
  archived: string[] = [];
  histories: string[] = [];

  async init(): Promise<void> { /* 无需初始化 */ }
  async loadState(): Promise<DeviceState | null> { return this.state ? clone(this.state) : null; }
  async saveState(state: DeviceState): Promise<void> { this.state = clone(state); }
  async loadBaseline(): Promise<DeviceBaseline | null> { return this.baseline ? clone(this.baseline) : null; }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> { this.baseline = clone(baseline); }
  async readBody(id: string): Promise<Uint8Array | null> { return this.bodies.get(id) ?? null; }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> { this.bodies.set(id, new Uint8Array(bytes)); }
  async deleteBody(id: string): Promise<void> { this.bodies.delete(id); }
  async writeHistory(id: string): Promise<string> { this.histories.push(id); return id; }
  async archiveBody(id: string): Promise<void> { this.archived.push(id); }
  async listAssets(id: string): Promise<string[]> { return [...(this.assets.get(id)?.keys() ?? [])]; }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> { return this.assets.get(id)?.get(filename) ?? null; }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    const map = this.assets.get(id) ?? new Map<string, Uint8Array>();
    map.set(filename, new Uint8Array(bytes)); this.assets.set(id, map);
  }
  async deleteAssetsDir(id: string): Promise<void> { this.assets.delete(id); }
  async readQuickBody(id: string): Promise<Uint8Array | null> { return this.quickBodies.get(id) ?? null; }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> { this.quickBodies.set(id, new Uint8Array(bytes)); }
  async deleteQuickBody(id: string): Promise<void> { this.quickBodies.delete(id); }
  async listQuickAssets(id: string): Promise<string[]> { return [...(this.quickAssets.get(id)?.keys() ?? [])]; }
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> { return this.quickAssets.get(id)?.get(filename) ?? null; }
  async writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    const map = this.quickAssets.get(id) ?? new Map<string, Uint8Array>();
    map.set(filename, new Uint8Array(bytes)); this.quickAssets.set(id, map);
  }
  async deleteQuickAssetsDir(id: string): Promise<void> { this.quickAssets.delete(id); }
}

const emptyState = (): DeviceState => ({
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] } as QuickNotesIndex,
  folders: [], intents: [], pending: [], remotePurged: [], restorePending: [],
});

async function addDoc(device: MemDevice, id: string, body: string): Promise<void> {
  const state = device.state ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await device.writeBody(id, bytes);
  const entry = { id, title: "T" + id, parentId: null, sortOrder: 0, updatedAt: "2026-10-25T00:00:00.000Z", contentHash: sha256Hex(bytes) };
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), entry];
  await device.saveState(state);
}

const engineOf = (remote: MemRemote, device: MemDevice, deviceId: string) => new S3v3SyncEngine({ remote, device, deviceId, lockWaitMs: 2000 });

const readRemoteLake = async (remote: MemRemote): Promise<LakeIndex> => {
  const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get(S3V3_POINTER_KEY)!)) as { lake: { commit: string } };
  return JSON.parse(new TextDecoder().decode(remote.objects.get("meta/index/" + pointer.lake.commit + ".json")!)) as LakeIndex;
};

/** 双端就绪：A 上传 n1/n2，B 拉齐。返回双端与 A 的当前 pointer。 */
async function twoDevices() {
  const remote = new MemRemote();
  const a = new MemDevice(); const b = new MemDevice();
  await addDoc(a, "n1", "keep");
  await addDoc(a, "n2", "gone");
  await engineOf(remote, a, "A").sync({ onEmptyCloud: "upload" });
  await engineOf(remote, b, "B").sync();
  return { remote, a, b };
}

/** A 端彻底删除 n2（删本地正文 + 写删除意图），并发布出去。 */
async function purgeOnA(remote: MemRemote, a: MemDevice): Promise<void> {
  const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get(S3V3_POINTER_KEY)!)) as { epoch: string; generation: number };
  const state = a.state!;
  state.lake.notes = state.lake.notes.filter((n) => n.id !== "n2");
  state.intents = [{ noteId: "n2", targetEpoch: pointer.epoch, targetGeneration: pointer.generation, purgedAt: "2026-10-26T00:00:00.000Z" }];
  await a.saveState(state);
  await a.deleteBody("n2");
  await engineOf(remote, a, "A").sync();
}

describe("v3 · 云端已彻底删除 · 仅本地（remotePurged）", () => {
  it("小记：restorePending 优先于远端 purge 墓碑 → 恢复走 upload 而不是 local-purge", async () => {
    const { planQuickNotesMerge } = await import("./s3v3Merge.js");
    const item = { id: "q1", createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z", contentHash: "h" };
    const base = { v: 3 as const, space: "quickNotes" as const, items: [item], tags: [] };
    const local = { v: 3 as const, space: "quickNotes" as const, items: [item], tags: [] };
    const remote = { ...base, purged: ["q1"] };
    expect(planQuickNotesMerge(base, local, remote, new Set(), new Set(["q1"]), new Set(), new Set(["q1"])).items[0]?.kind).toBe("local-purge");
    expect(planQuickNotesMerge(base, local, remote, new Set(["q1"]), new Set(["q1"]), new Set(), new Set(["q1"])).items[0]?.kind).toBe("upload");
  });

  it("远端彻底删除 → 本地回收站副本保留 + 标记持久化；多轮同步不复活", async () => {
    const { remote, a, b } = await twoDevices();
    await purgeOnA(remote, a);
    expect((await readRemoteLake(remote)).notes.some((n) => n.id === "n2")).toBe(false);

    await engineOf(remote, b, "B").sync();
    const sb = b.state!;
    const n2 = sb.lake.notes.find((n) => n.id === "n2")!;
    expect(n2).toBeTruthy();
    expect(n2.trashedAt).toBeTruthy();
    expect(n2.parentId).toBe("notebook-trash"); // 回收站父节点与 Store/移动端一致（TRASH_NOTEBOOK_ID）
    expect(sb.remotePurged).toEqual(["n2"]);
    expect(b.bodies.has("n2")).toBe(true); // 本地副本保留（可恢复）

    // 连续两轮：标记不得丢、副本不得被当「本地新建」重新上传
    for (let round = 0; round < 2; round++) {
      remote.resetLog();
      await engineOf(remote, b, "B").sync();
      expect(b.state!.remotePurged).toEqual(["n2"]);
      expect(remote.puts.some((k) => k.startsWith("objects/n2-"))).toBe(false);
      expect((await readRemoteLake(remote)).notes.some((n) => n.id === "n2")).toBe(false);
      expect(remote.objects.size).toBeGreaterThan(0);
    }
  });

  it("显式恢复：标记清除并重新上传，他端拉回（恢复不被标记限制）", async () => {
    const { remote, a, b } = await twoDevices();
    await purgeOnA(remote, a);
    await engineOf(remote, b, "B").sync();
    expect(b.state!.remotePurged).toEqual(["n2"]);

    // B 从回收站恢复（适配器负责清 trashedAt + 置 restorePending + bump updatedAt，语义见协议 §4.3）
    const state = b.state!;
    state.lake.notes = state.lake.notes.map((n) => n.id === "n2" ? { ...n, parentId: null, trashedAt: null, deletedFromParentId: null, updatedAt: "2026-10-26T05:00:00.000Z" } : n);
    state.restorePending = ["n2"];
    await b.saveState(state);

    await engineOf(remote, b, "B").sync();
    expect(b.state!.remotePurged).toEqual([]);
    expect((await readRemoteLake(remote)).notes.some((n) => n.id === "n2")).toBe(true);
    expect(remote.objects.has("objects/n2-" + H("gone") + ".lake")).toBe(true);

    await engineOf(remote, a, "A").sync();
    expect(a.bodies.has("n2")).toBe(true); // 他端恢复后重新下载
    expect(new TextDecoder().decode(a.bodies.get("n2")!)).toBe("gone");
  });

  it("他端恢复（远端重新出现同 id）→ 标记清除，本地跟随远端且不盖回旧副本", async () => {
    const { remote, a, b } = await twoDevices();
    await purgeOnA(remote, a);
    await engineOf(remote, b, "B").sync();
    expect(b.state!.remotePurged).toEqual(["n2"]);

    // 模拟第三端把 n2 恢复回云端：直接改远端 lake 索引 + 指针（内容对象仍在，A 的 purge 已删？→ 重新放回）
    const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get(S3V3_POINTER_KEY)!)) as { epoch: string; generation: number; lake: { commit: string } };
    const index = await readRemoteLake(remote);
    const hash = H("gone-restored");
    await remote.put("objects/n2-" + hash + ".lake", new TextEncoder().encode("gone-restored"));
    index.notes = [...index.notes, { id: "n2", title: "T n2", parentId: null, sortOrder: 0, updatedAt: "2026-10-26T03:00:00.000Z", contentHash: hash }].sort((x, y) => (x.id < y.id ? -1 : 1));
    const { serializeLakeIndex, indexHashOf } = await import("./s3v3Index.js");
    const serialized = serializeLakeIndex(index);
    const commit = indexHashOf(serialized);
    await remote.put("meta/index/" + commit + ".json", new TextEncoder().encode(serialized));
    await remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify({ ...pointer, generation: pointer.generation + 1, lake: { commit } })));

    await engineOf(remote, b, "B").sync();
    const sb = b.state!;
    expect(sb.remotePurged).toEqual([]);
    const n2 = sb.lake.notes.find((n) => n.id === "n2")!;
    expect(n2.trashedAt ?? null).toBeNull(); // 跟随远端恢复，而不是把回收站副本盖回去
    expect(n2.contentHash).toBe(hash);
    expect(new TextDecoder().decode(b.bodies.get("n2")!)).toBe("gone-restored");
    // 不产生反向覆盖：远端索引仍是恢复后的条目
    expect((await readRemoteLake(remote)).notes.find((n) => n.id === "n2")?.contentHash).toBe(hash);
  });

  it("本地主动彻底删除标记副本后：标记清除、之后多轮不再产生任何 S3 行为", async () => {
    const { remote, a, b } = await twoDevices();
    await purgeOnA(remote, a);
    await engineOf(remote, b, "B").sync();
    expect(b.state!.remotePurged).toEqual(["n2"]);

    // B 把「云端已删除·仅本地」的副本也彻底删掉（删本地正文 + 写删除意图）
    const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get(S3V3_POINTER_KEY)!)) as { epoch: string; generation: number };
    const state = b.state!;
    state.lake.notes = state.lake.notes.filter((n) => n.id !== "n2");
    state.intents = [...state.intents, { noteId: "n2", targetEpoch: pointer.epoch, targetGeneration: pointer.generation, purgedAt: "2026-10-26T04:00:00.000Z" }];
    await b.saveState(state);
    await b.deleteBody("n2");

    for (let round = 0; round < 2; round++) {
      remote.resetLog();
      await engineOf(remote, b, "B").sync();
      expect(b.state!.remotePurged).toEqual([]); // 标记不残留
      expect(remote.puts.length).toBe(0);        // 不重传
      expect(remote.deletes.length).toBe(0);     // 不重复删（对象在 A 端 purge 时已清）
      expect(b.bodies.has("n2")).toBe(false);    // 不复活
      expect((await readRemoteLake(remote)).notes.some((n) => n.id === "n2")).toBe(false);
    }
  });

  it("标记随适配器持久化：跨进程重载后仍生效（不复活）", async () => {
    const { remote, a, b } = await twoDevices();
    await purgeOnA(remote, a);
    await engineOf(remote, b, "B").sync();
    // 模拟「重启后重新 loadState」：状态从落盘读回（MemDevice 内部已是 clone 存储）
    const reloaded = await b.loadState();
    expect(reloaded!.remotePurged).toEqual(["n2"]);
    remote.resetLog();
    await engineOf(remote, b, "B").sync();
    expect(remote.puts.some((k) => k.startsWith("objects/n2-"))).toBe(false);
  });
});
