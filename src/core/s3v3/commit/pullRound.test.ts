import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../syncUtils.js";
import { indexHashOf, indexKey, lakeBodyKey, serializeLakeIndex, serializeQuickNotesIndex, type LakeNoteEntry, type S3v3Pointer } from "../protocol/index.js";
import { S3v3SyncEngine } from "../../s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../s3v3Ports.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../../s3v3DeviceStore.js";
import { pullRound, type PullRoundState } from "./pullRound.js";
import type { RoundPorts } from "./runSyncRound.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-28T00:00:00.000Z";
const EPOCH = "11111111-1111-4111-8111-111111111111";

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
  archived: string[] = [];
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
  async archiveBody(id: string) { this.archived.push(id); }
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

function seed(remote: MemRemote, notes: LakeNoteEntry[]) {
  const lakeIdx = lake(notes);
  const quickIdx = quick();
  const lakeCommit = indexHashOf(serializeLakeIndex(lakeIdx));
  const quickCommit = indexHashOf(serializeQuickNotesIndex(quickIdx));
  remote.objects.set(indexKey("lake", lakeCommit), enc(serializeLakeIndex(lakeIdx)));
  remote.objects.set(indexKey("quickNotes", quickCommit), enc(serializeQuickNotesIndex(quickIdx)));
  for (const n of notes) remote.objects.set(lakeBodyKey(n.id, n.contentHash), enc("v2"));
  const pointer: S3v3Pointer = { v: 3, epoch: EPOCH, generation: 2, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO };
  remote.objects.set("meta/pointer.json", enc(JSON.stringify(pointer)));
  return { pointer, lakeIdx, quickIdx };
}
const roundPorts = (remote: MemRemote, device: MemDevice): RoundPorts => ({
  getRemote: (k) => remote.get(k), putRemote: (k, b) => remote.put(k, b),
  deleteRemoteKeys: (ks) => remote.deleteMany(ks), deleteRemotePrefix: (p) => remote.deleteByPrefix(p),
  readLocalBody: (space, id) => (space === "lake" ? device.readBody(id) : device.readQuickBody()),
  writeLocalBody: (space, id, b) => (space === "lake" ? device.writeBody(id, b) : device.writeQuickBody()),
  archiveLocal: async (space, id) => { if (space === "lake") device.archived.push(id); },
  deleteLocalBody: (space, id) => (space === "lake" ? device.deleteBody(id) : device.deleteQuickBody()),
  listLocalAssets: async () => [], readLocalAsset: async () => null, writeLocalAsset: async () => {},
  loadIntentLog: async () => ({ intents: [], restorePending: [] }), saveIntentLog: async () => {},
  loadPending: async () => [], savePending: async () => {},
});


/** 金标准：全量重拉的期望值直接写出（不依赖旧 pullAll）。 */
describe("E2-3 全量重拉金标准", () => {
  it("本地独有 → 回收站 + cloud-deleted；被覆盖版本归档；正文下载校验", async () => {
    const remoteNotes = [doc("a", "v2")];
    const localNotes = [doc("a", "v1"), doc("b", "local-only")];
    const remote = new MemRemote();
    const { lakeIdx, quickIdx } = seed(remote, remoteNotes);
    const dev = new MemDevice(stateOf(localNotes), null);
    dev.bodies.set("a", enc("v1"));
    dev.bodies.set("b", enc("local-only"));
    const ports = roundPorts(remote, dev);
    const out = await pullRound({ state: stateOf(localNotes) as PullRoundState, remote: { lake: lakeIdx, quickNotes: quickIdx }, now: () => ISO }, ports);
    expect(out.state.lake.notes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(out.state.remotePurged).toEqual(["b"]);
    const b = out.state.lake.notes.find((n) => n.id === "b")!;
    expect(b.parentId).toBe("notebook-trash");
    expect(b.trashedAt).toBe(ISO);
    expect(dev.archived).toContain("a");
    expect(dec(dev.bodies.get("a")!)).toBe("v2");
    expect(out.apply.downloaded.documents).toBe(1);
  });

  it("引擎全量重拉（内核）：收敛结果与基线写成 pointer 的世代", async () => {
    const remoteNotes = [doc("a", "v2")];
    const localNotes = [doc("a", "v1"), doc("b", "local-only")];
    const remote = new MemRemote();
    seed(remote, remoteNotes);
    const dev = new MemDevice(stateOf(localNotes), null);
    dev.bodies.set("a", enc("v1"));
    dev.bodies.set("b", enc("local-only"));
    const report = await new S3v3SyncEngine({ remote, device: dev, deviceId: "k" }).sync();
    expect(dev.state.lake.notes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(dev.state.remotePurged).toEqual(["b"]);
    expect(dev.baseline?.generation).toBe(2);
    expect(dec(dev.bodies.get("a")!)).toBe("v2");
    expect(report.downloadedDocuments).toBe(1);
  });
});
