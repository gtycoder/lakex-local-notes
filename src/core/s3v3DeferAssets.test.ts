import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, indexHashOf, serializeDeclaration, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { assetKey, declarationKey, indexKey, lakeBodyKey } from "./s3v3/protocol/s3v3Keys.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-26T00:00:00.000Z";

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  gets: string[] = [];
  async get(key: string): Promise<Uint8Array | null> { this.gets.push(key); return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

class RecDevice implements S3v3DeviceStore {
  writtenAssets: string[] = [];
  state: DeviceState = {
    lake: { v: 3, space: "lake", notes: [], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [] }, folders: [], intents: [], pending: [],
    remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
  };
  async init(): Promise<void> {}
  async loadState(): Promise<DeviceState | null> { return this.state; }
  async saveState(s: DeviceState): Promise<void> { this.state = s; }
  async loadBaseline(): Promise<null> { return null; }
  async saveBaseline(): Promise<void> {}
  async readBody(): Promise<Uint8Array | null> { return null; }
  async writeBody(): Promise<void> {}
  async deleteBody(): Promise<void> {}
  async writeHistory(): Promise<string> { return "skip"; }
  async archiveBody(): Promise<void> {}
  async listAssets(): Promise<string[]> { return []; }
  async readAsset(): Promise<Uint8Array | null> { return null; }
  async writeAsset(id: string, filename: string): Promise<void> { this.writtenAssets.push(id + "/" + filename); }
  async deleteAssetsDir(): Promise<void> {}
  async readQuickBody(): Promise<Uint8Array | null> { return null; }
  async writeQuickBody(): Promise<void> {}
  async deleteQuickBody(): Promise<void> {}
  async listQuickAssets(): Promise<string[]> { return []; }
  async readQuickAsset(): Promise<Uint8Array | null> { return null; }
  async writeQuickAsset(): Promise<void> {}
  async deleteQuickAssetsDir(): Promise<void> {}
}

function cloud() {
  const remote = new MemRemote();
  const body = "body-a";
  const decl = buildAssetDeclaration([{ filename: "a.png", size: 3, hash: H("img") }]);
  const lake: LakeIndex = {
    v: 3, space: "lake", folders: [],
    notes: [{ id: "n1", title: "N", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H(body), assetsHash: decl.declHash }],
  };
  const lakeSer = serializeLakeIndex(lake);
  const commit = indexHashOf(lakeSer);
  const quick: QuickNotesIndex = { v: 3, space: "quickNotes", items: [] };
  const quickCommit = indexHashOf(serializeQuickNotesIndex(quick));
  remote.put(indexKey("lake", commit), enc(lakeSer));
  remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(serializeQuickNotesIndex(quick)));
  remote.put(declarationKey("lake", "n1", decl.declHash), enc(serializeDeclaration(decl.declaration)));
  remote.put(assetKey("n1", "a.png"), enc("img"));
  remote.put(lakeBodyKey("n1", H(body)), enc(body));
  remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));
  return { remote };
}

describe("按需资产（P0-4，261026）", () => {
  it("deferAssets=true：首拉只拉正文，声明与附件字节都不请求", async () => {
    const { remote } = cloud();
    const device = new RecDevice();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev" });
    const report = await engine.sync({ onEmptyCloud: "stay", deferAssets: true });
    expect(report.downloadedNotes).toBe(1);
    expect(device.writtenAssets).toEqual([]);
    expect(remote.gets.filter((k) => k.startsWith("assets/")).length).toBe(0);
    expect(remote.gets.filter((k) => k.startsWith("meta/assets/")).length).toBe(0);
  });

  it("deferAssets=false（默认）：首拉会补声明与附件字节", async () => {
    const { remote } = cloud();
    const device = new RecDevice();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev" });
    await engine.sync({ onEmptyCloud: "stay" });
    expect(device.writtenAssets).toEqual(["n1/a.png"]);
    expect(remote.gets.some((k) => k.startsWith("meta/assets/"))).toBe(true);
  });
});
