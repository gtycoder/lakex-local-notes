import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { assetKey, buildAssetDeclaration, declarationKey, indexHashOf, indexKey, lakeBodyKey, serializeLakeIndex, serializeQuickNotesIndex, type LakeFolderEntry, type LakeNoteEntry, type S3v3Pointer } from "../protocol/index.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../s3v3Ports.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../../s3v3DeviceStore.js";
import { planSync, type PlanWorld } from "../plan/plan.js";
import { applyPlan, type ApplyPorts } from "../apply/applyPlan.js";
import { applyAssets, type AssetPorts } from "../apply/applyAssets.js";
import { buildPublishIndex } from "./buildPublishIndex.js";
import { commitPlan, type CommitPorts } from "./commitPlan.js";

/** E2 端到端：plan → apply → assets → buildPublishIndex → commitPlan，断言产出符合金标准（不依赖旧引擎）。 */

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-28T00:00:00.000Z";
const EPOCH = "11111111-1111-4111-8111-111111111111";

class MemRemote implements S3v3Remote, CommitPorts {
  objects = new Map<string, Uint8Array>();
  async getRemote(key: string) { return this.objects.get(key) ?? null; }
  async putRemote(key: string, bytes: Uint8Array) { this.objects.set(key, bytes); }
  async deleteRemoteKeys(keys: string[]) { keys.forEach((k) => this.objects.delete(k)); }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array) { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]) { keys.forEach((k) => this.objects.delete(k)); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); keys.forEach((k) => this.objects.delete(k)); return keys.length; }
}

class DefDevice implements S3v3DeviceStore {
  state: DeviceState;
  baseline: DeviceBaseline | null;
  bodies = new Map<string, Uint8Array>();
  constructor(state: DeviceState, baseline: DeviceBaseline | null) { this.state = state; this.baseline = baseline; }
  async init() {}
  async loadState() { return this.state; }
  async saveState(s: DeviceState) { this.state = s; }
  async loadBaseline() { return this.baseline; }
  async saveBaseline(b: DeviceBaseline) { this.baseline = b; }
  async readBody(id: string) { return this.bodies.get(id) ?? null; }
  async writeBody(id: string, bytes?: Uint8Array) { if (bytes) this.bodies.set(id, bytes); }
  async deleteBody(id: string) { this.bodies.delete(id); }
  async writeHistory() { return "h"; }
  async archiveBody() {}
  assets = new Map<string, Map<string, Uint8Array>>();
  setAsset(id: string, filename: string, bytes: Uint8Array) {
    const m = this.assets.get(id) ?? new Map<string, Uint8Array>();
    m.set(filename, bytes);
    this.assets.set(id, m);
  }
  async listAssets(id: string) { return [...(this.assets.get(id)?.keys() ?? [])].sort(); }
  async readAsset(id: string, filename: string) { return this.assets.get(id)?.get(filename) ?? null; }
  async writeAsset(id: string, filename: string, bytes: Uint8Array) { this.setAsset(id, filename, bytes); }
  async deleteAssetsDir() {}
  async readQuickBody() { return null; }
  async writeQuickBody() {}
  async deleteQuickBody() {}
  async listQuickAssets() { return []; }
  async readQuickAsset() { return null; }
  async writeQuickAsset() {}
  async deleteQuickAssetsDir() {}
}

/** 正文 hash → 原文（夹具用：seed 必须写入 hash 自洽的字节，否则引擎下载会报 hash 不符）。 */
const BODY_TEXT = new Map<string, string>();
const doc = (id: string, text: string, over: Partial<LakeNoteEntry> = {}): LakeNoteEntry => {
  const hash = H(text);
  BODY_TEXT.set(hash, text);
  return { id, title: id, parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: hash, ...over };
};
const world = (notes: LakeNoteEntry[], folders: LakeFolderEntry[] = []): PlanWorld => ({
  lake: { v: 3, space: "lake", notes, folders },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
  folders,
});
const stateOf = (w: PlanWorld): DeviceState => ({
  lake: w.lake, quickNotes: w.quickNotes, folders: w.folders,
  intents: [], pending: [], remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
});

/** 云端基线：pointer generation=1，索引与正文就位。 */
function seed(remote: MemRemote, base: PlanWorld, generation = 1): S3v3Pointer {
  const lakeSer = serializeLakeIndex(base.lake);
  const quickSer = serializeQuickNotesIndex(base.quickNotes);
  const lakeCommit = indexHashOf(lakeSer);
  const quickCommit = indexHashOf(quickSer);
  remote.objects.set(indexKey("lake", lakeCommit), enc(lakeSer));
  remote.objects.set(indexKey("quickNotes", quickCommit), enc(quickSer));
  for (const n of base.lake.notes) remote.objects.set(lakeBodyKey(n.id, n.contentHash), enc(BODY_TEXT.get(n.contentHash) ?? ("body-" + n.id + "-" + n.contentHash)));
  const pointer: S3v3Pointer = { v: 3, epoch: EPOCH, generation, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO, deviceId: "seed" };
  remote.objects.set("meta/pointer.json", enc(JSON.stringify(pointer)));
  return pointer;
}

function baselineOf(base: PlanWorld): DeviceBaseline {
  return { epoch: EPOCH, generation: 1, lakeCommit: indexHashOf(serializeLakeIndex(base.lake)), quickNotesCommit: indexHashOf(serializeQuickNotesIndex(base.quickNotes)), lake: base.lake, quickNotes: base.quickNotes };
}


async function runPipeline(input: { local: PlanWorld; base: PlanWorld; remote?: PlanWorld; remoteGeneration?: number; deviceBodies?: Map<string, Uint8Array>; assets?: Array<{ id: string; filename: string; body: string }>; purgeIntents?: string[] }) {
  const remoteWorld = input.remote ?? input.base;
  const remote = new MemRemote();
  const basePointer = seed(remote, remoteWorld, input.remoteGeneration ?? 1);
  const device = new DefDevice(stateOf(input.local), baselineOf(input.base));
  device.bodies = input.deviceBodies ?? new Map();
  for (const a of input.assets ?? []) device.setAsset(a.id, a.filename, enc(a.body));
  const ports: ApplyPorts = {
    getRemote: (key) => remote.getRemote(key),
    putRemote: (key, bytes) => remote.putRemote(key, bytes),
    deleteRemoteKeys: (keys) => remote.deleteRemoteKeys(keys),
    deleteRemotePrefix: (prefix) => remote.deleteByPrefix(prefix),
    readLocalBody: (space, id) => (space === "lake" ? device.readBody(id) : Promise.resolve(null)),
    writeLocalBody: (_space, id, bytes) => device.writeBody(id, bytes ?? undefined),
    archiveLocal: () => Promise.resolve(),
    deleteLocalBody: (_space, id) => device.deleteBody(id),
  };
  const plan = planSync({ local: input.local, base: input.base, remote: remoteWorld, state: { restorePending: [], purgeIntents: input.purgeIntents ?? [], folderPurgeIntents: [] } });
  const applied = await applyPlan(plan, ports);
  const assetPorts: AssetPorts = {
    getRemote: (key) => remote.getRemote(key),
    putRemote: (key, bytes) => remote.putRemote(key, bytes),
    listLocalAssets: async (space, id) => {
      if (space !== "lake") return [];
      const filenames = await device.listAssets(id);
      const out = [];
      for (const filename of filenames) {
        const bytes = (await device.readAsset(id, filename))!;
        out.push({ filename, size: bytes.length, hash: H(dec(bytes)) });
      }
      return out;
    },
    readLocalAsset: (space, id, filename) => (space === "lake" ? device.readAsset(id, filename) : Promise.resolve(null)),
    writeLocalAsset: (space, id, filename, bytes) => (space === "lake" ? device.writeAsset(id, filename, bytes) : Promise.resolve()),
  };
  const assets = await applyAssets(plan, { declarations: applied.declarations }, assetPorts);
  const next = buildPublishIndex(plan, { lake: input.local.lake, quickNotes: input.local.quickNotes }, { failedUploads: applied.failedUploads, assetsHashes: assets.assetsHashes });
  const committed = await commitPlan({ plan, next, base: basePointer, deviceId: "pipeline" }, remote, { lockWaitMs: 0, lockSettleMs: 0, sleep: async () => {}, createdAt: ISO });
  const pointer = JSON.parse(dec(remote.objects.get("meta/pointer.json")!)) as S3v3Pointer;
  return { remote, pointer, committed, plan, next, assets, device, applied };
}

/**
 * 金标准快照（旧路径删除后的回归保护）：不依赖旧引擎，期望值直接用协议序列化函数算出来。
 * 覆盖：本地更新 / 零变更 / 资产 / 彻底删除 / 冲突。
 */
describe("E2 端到端金标准：四相产出的云端状态", () => {
  it("本地更新：发布 gen2，索引字节 = 本地索引序列化，正文对象存在", async () => {
    const base = world([doc("a", "v1")]);
    const local = world([doc("a", "v2", { updatedAt: "2026-10-28T01:00:00.000Z" })]);
    const bodies = new Map([["a", enc("v2")]]);
    const pipe = await runPipeline({ local, base, deviceBodies: bodies });
    expect(pipe.pointer.generation).toBe(2);
    const expected = serializeLakeIndex(local.lake);
    expect(pipe.pointer.lake.commit).toBe(indexHashOf(expected));
    expect(dec(pipe.remote.objects.get(indexKey("lake", pipe.pointer.lake.commit))!)).toBe(expected);
    expect(dec(pipe.remote.objects.get(lakeBodyKey("a", H("v2")))!)).toBe("v2");
  });

  it("零变更：不发布、不加对象，pointer 停在同一代", async () => {
    const base = world([doc("a", "v1")]);
    const pipe = await runPipeline({ local: base, base, deviceBodies: new Map([["a", enc("v1")]]) });
    expect(pipe.committed.status === "unchanged" || pipe.committed.status === "skipped").toBe(true);
    expect(pipe.pointer.generation).toBe(1);
    expect(pipe.pointer.lake.commit).toBe(indexHashOf(serializeLakeIndex(base.lake)));
  });

  it("本地更新 + 新增附件：声明全量、资产对象与 assetsHash 正确", async () => {
    const base = world([doc("a", "v1")]);
    const local = world([doc("a", "v2", { updatedAt: "2026-10-28T01:00:00.000Z" })]);
    const bodies = new Map([["a", enc("v2")]]);
    const assetsIn = [{ id: "a", filename: "p.png", body: "PPP" }];
    const pipe = await runPipeline({ local, base, deviceBodies: bodies, assets: assetsIn });
    const asset = { filename: "p.png", size: 3, hash: H("PPP") };
    const built = buildAssetDeclaration([asset]);
    expect(pipe.assets.uploaded.files).toBe(1);
    expect(pipe.remote.objects.has(assetKey("a", "p.png"))).toBe(true);
    expect(pipe.remote.objects.has(declarationKey("lake", "a", built.declHash))).toBe(true);
    // 索引条目带上新声明 hash（金标准：直接用序列化算期望）
    const expectedIndex = { ...local.lake, notes: local.lake.notes.map((n) => ({ ...n, assetsHash: built.declHash })) };
    expect(pipe.pointer.lake.commit).toBe(indexHashOf(serializeLakeIndex(expectedIndex)));
    expect(dec(pipe.remote.objects.get(indexKey("lake", pipe.pointer.lake.commit))!)).toBe(serializeLakeIndex(expectedIndex));
  });

  it("本地彻底删除：发布「已删」索引 gen2，正文/资产对象消失（旧索引对象留给 deepCleanup）", async () => {
    const base = world([doc("a", "v1")]);
    const pipe = await runPipeline({ local: world([]), base, purgeIntents: ["a"] });
    expect(pipe.pointer.generation).toBe(2);
    const expectedIndex = serializeLakeIndex({ v: 3, space: "lake", notes: [], folders: [] });
    expect(pipe.pointer.lake.commit).toBe(indexHashOf(expectedIndex));
    expect([...pipe.remote.objects.keys()].filter((k) => k.startsWith("objects/a-"))).toEqual([]);
    const oldIndexKey = indexKey("lake", indexHashOf(serializeLakeIndex(base.lake)));
    expect(pipe.remote.objects.has(oldIndexKey)).toBe(true);
  });

  it("冲突（远端已发布）：不发布、pointer 留原代、远端索引不被覆盖", async () => {
    const base = world([doc("a", "v1")]);
    const local = world([doc("a", "v2", { updatedAt: "2026-10-28T01:00:00.000Z" })]);
    const remote = world([doc("a", "v3", { updatedAt: "2026-10-28T02:00:00.000Z" })]);
    const bodies = new Map([["a", enc("v2")]]);
    const pipe = await runPipeline({ local, base, remote, deviceBodies: bodies, remoteGeneration: 2 });
    expect(pipe.pointer.generation).toBe(2);
    expect(pipe.pointer.lake.commit).toBe(indexHashOf(serializeLakeIndex(remote.lake)));
  });
});
