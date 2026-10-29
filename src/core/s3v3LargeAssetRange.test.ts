import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, indexHashOf, serializeDeclaration, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import { assetKey, declarationKey, indexKey, lakeBodyKey } from "./s3v3/protocol/s3v3Keys.js";
import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (bytes: Uint8Array) => sha256Hex(bytes);
const ISO = "2026-10-27T00:00:00.000Z";

class MemRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  gets = 0;
  rangeCalls = 0;
  async get(key: string): Promise<Uint8Array | null> {
    this.gets += 1;
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length }));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
  async getRange(key: string, start: number, end: number): Promise<Uint8Array | null> {
    this.rangeCalls += 1;
    const o = this.objects.get(key);
    if (!o) return null;
    const raw = o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
    return raw.slice(start, end);
  }
}

class RecDevice implements S3v3DeviceStore {
  state: DeviceState = {
    lake: { v: 3, space: "lake", notes: [], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [] }, folders: [], intents: [], pending: [],
    remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
  };
  writtenAssets: string[] = [];
  assetBytes = new Map<string, Uint8Array>();
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
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> { this.writtenAssets.push(id + "/" + filename); this.assetBytes.set(id + "/" + filename, new Uint8Array(bytes)); }
  async deleteAssetsDir(): Promise<void> {}
  async readQuickBody(): Promise<Uint8Array | null> { return null; }
  async writeQuickBody(): Promise<void> {}
  async deleteQuickBody(): Promise<void> {}
  async listQuickAssets(): Promise<string[]> { return []; }
  async readQuickAsset(): Promise<Uint8Array | null> { return null; }
  async writeQuickAsset(): Promise<void> {}
  async deleteQuickAssetsDir(): Promise<void> {}
}

function cloudWithAsset(assetBytes: Uint8Array, withRange: boolean) {
  const remote = new MemRemote();
  // 4KB 伪随机字节（避免 gzip 魔数误判）
  const decl = buildAssetDeclaration([{ filename: "big.bin", size: assetBytes.length, hash: H(assetBytes) }]);
  const body = enc("body");
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
  remote.put(assetKey("n1", "big.bin"), assetBytes);
  remote.put(lakeBodyKey("n1", H(body)), body);
  remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));
  if (!withRange) {
    // 模拟「不支持 Range」的远端：删除 getRange 方法
    Object.defineProperty(remote, "getRange", { value: undefined, configurable: true });
  }
  return remote;
}

describe("大对象 Range 分片下载（261027）", () => {
  it("超过阈值且远端支持 Range：分片并发下载并拼回同一份字节", async () => {
    const asset = new Uint8Array(4096);
    for (let i = 0; i < asset.length; i++) asset[i] = (i * 37 + 11) & 0xff;
    const remote = cloudWithAsset(asset, true);
    const device = new RecDevice();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev", largeAssetChunkBytes: 1024 });
    await engine.sync({ onEmptyCloud: "stay" });
    expect(device.writtenAssets).toEqual(["n1/big.bin"]);
    expect(Array.from(device.assetBytes.get("n1/big.bin")!)).toEqual(Array.from(asset));
    expect(remote.rangeCalls).toBeGreaterThanOrEqual(2);
  });

  it("远端不支持 Range 时回退整对象 GET（不破坏旧行为）", async () => {
    const asset = new Uint8Array(4096);
    for (let i = 0; i < asset.length; i++) asset[i] = (i * 13 + 7) & 0xff;
    const remote = cloudWithAsset(asset, false);
    const device = new RecDevice();
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev", largeAssetChunkBytes: 1024 });
    await engine.sync({ onEmptyCloud: "stay" });
    expect(device.writtenAssets).toEqual(["n1/big.bin"]);
    expect(Array.from(device.assetBytes.get("n1/big.bin")!)).toEqual(Array.from(asset));
    expect(remote.rangeCalls).toBe(0);
  });
});
