import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { indexHashOf, indexKey, serializeLakeIndex, type LakeNoteEntry, type S3v3Pointer } from "../protocol/index.js";
import { S3v3SyncEngine } from "../../s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../s3v3Ports.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../../s3v3DeviceStore.js";
import { planSync } from "../plan/plan.js";
import { applyPlan } from "../apply/applyPlan.js";
import { commitPlan } from "./commitPlan.js";
import { buildPublishIndex } from "./buildPublishIndex.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-28T00:00:00.000Z";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  async get(key: string) { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array) { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]) { keys.forEach((k) => this.objects.delete(k)); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); ks.forEach((k) => this.objects.delete(k)); return ks.length; }
}
class MemDevice implements S3v3DeviceStore {
  state: DeviceState; baseline: DeviceBaseline | null;
  bodies = new Map<string, Uint8Array>();
  constructor(state: DeviceState, baseline: DeviceBaseline | null) { this.state = state; this.baseline = baseline; }
  async init() {}
  async loadState() { return this.state; }
  async saveState(s: DeviceState) { this.state = s; }
  async loadBaseline() { return this.baseline; }
  async saveBaseline(b: DeviceBaseline) { this.baseline = b; }
  async readBody(id: string) { return this.bodies.get(id) ?? null; }
  async writeBody(id: string, bytes: Uint8Array) { this.bodies.set(id, bytes); }
  async deleteBody(id: string) { this.bodies.delete(id); }
  async writeHistory() { return "h"; }
  async archiveBody() {}
  async listAssets() { return []; }
  async readAsset() { return null; }
  async writeAsset() {}
  async deleteAssetsDir() {}
  async readQuickBody() { return null; }
  async writeQuickBody() {}
  async deleteQuickBody() {}
  async listQuickAssets() { return []; }
  async readQuickAsset() { return null; }
  async writeQuickAsset() {}
  async deleteQuickAssetsDir() {}
}
const doc = (id: string, text: string): LakeNoteEntry => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H(text) });
const lake = (notes: LakeNoteEntry[]) => ({ v: 3 as const, space: "lake" as const, notes, folders: [] });
const quick = () => ({ v: 3 as const, space: "quickNotes" as const, items: [], tags: [] });
const stateOf = (notes: LakeNoteEntry[]): DeviceState => ({ lake: lake(notes), quickNotes: quick(), folders: [], intents: [], pending: [], remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [] });

/** 金标准：空桶首传的期望值由协议序列化函数直接算出（不依赖旧引擎）。 */
describe("E2-3 首传金标准", () => {
  it("commit(null) 首传：gen1、索引字节 = 本地索引序列化、正文上传", async () => {
    const local = [doc("a", "v1")];
    const remote = new MemRemote();
    const dev = new MemDevice(stateOf(local), null);
    dev.bodies.set("a", enc("v1"));
    const plan = planSync({ local: { lake: lake(local), quickNotes: quick(), folders: [] }, base: null, remote: { lake: lake([]), quickNotes: quick(), folders: [] }, state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [] } });
    const ports = {
      getRemote: async (k: string) => remote.get(k), putRemote: async (k: string, b: Uint8Array) => remote.put(k, b),
      deleteRemoteKeys: async (ks: string[]) => remote.deleteMany(ks), deleteRemotePrefix: async (p: string) => remote.deleteByPrefix(p),
      readLocalBody: async (_s: string, id: string) => dev.readBody(id), writeLocalBody: async (_s: string, id: string, b: Uint8Array) => dev.writeBody(id, b),
      archiveLocal: async () => {}, deleteLocalBody: async (_s: string, id: string) => dev.deleteBody(id),
      listLocalAssets: async () => [], readLocalAsset: async () => null, writeLocalAsset: async () => {},
      loadIntentLog: async () => ({ intents: [], restorePending: [] }), saveIntentLog: async () => {},
      loadPending: async () => [], savePending: async () => {},
    };
    const applied = await applyPlan(plan, ports as never);
    const next = buildPublishIndex(plan, { lake: lake(local), quickNotes: quick() }, { failedUploads: applied.failedUploads, assetsHashes: [] });
    const out = await commitPlan({ plan, next, base: null, deviceId: "v4" }, ports as never, { lockWaitMs: 0, lockSettleMs: 0, sleep: async () => {}, createdAt: ISO });
    expect(out.status).toBe("published");
    const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get("meta/pointer.json")!)) as S3v3Pointer;
    expect(pointer.generation).toBe(1);
    expect(pointer.lake.commit).toBe(indexHashOf(serializeLakeIndex(lake(local))));
    expect(new TextDecoder().decode(remote.objects.get(indexKey("lake", pointer.lake.commit))!)).toBe(serializeLakeIndex(lake(local)));
  });

  it("引擎首轮（内核）与金标准一致：gen1 + 基线写入", async () => {
    const local = [doc("a", "v1")];
    const remote = new MemRemote();
    const dev = new MemDevice(stateOf(local), null);
    dev.bodies.set("a", enc("v1"));
    await new S3v3SyncEngine({ remote, device: dev, deviceId: "e" }).sync({ onEmptyCloud: "upload" });
    const pointer = JSON.parse(new TextDecoder().decode(remote.objects.get("meta/pointer.json")!)) as S3v3Pointer;
    expect(pointer.generation).toBe(1);
    expect(pointer.lake.commit).toBe(indexHashOf(serializeLakeIndex(lake(local))));
    expect(dev.baseline?.generation).toBe(1);
    expect(dev.baseline?.lakeCommit).toBe(pointer.lake.commit);
  });
});

