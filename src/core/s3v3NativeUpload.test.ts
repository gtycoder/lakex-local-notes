import { describe, expect, it } from "vitest";
import { sha256Hex } from "./syncUtils.js";
import { buildAssetDeclaration, indexHashOf, serializeDeclaration, serializeLakeIndex, serializeQuickNotesIndex, type LakeIndex, type QuickNotesIndex } from "./s3v3Index.js";

import { S3v3SyncEngine } from "./s3v3Engine.js";
import type { S3v3Remote, RemoteObjectInfo } from "./s3v3Ports.js";
import type { DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";

const enc = (s: string) => new TextEncoder().encode(s);
const H = (s: string) => sha256Hex(enc(s));
const ISO = "2026-10-27T00:00:00.000Z";
const ASSET_BODY = "hello-asset";
const ASSET_HASH = H(ASSET_BODY);

class MemRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  puts: string[] = [];
  fromFileCalls: Array<{ key: string; localPath: string }> = [];
  getToFile?: (key: string, localPath: string, expected: { size: number; sha256: string }) => Promise<"ok" | "missing" | "corrupt" | "unsupported">;
  async get(key: string): Promise<Uint8Array | null> { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array): Promise<void> { this.puts.push(key); this.objects.set(key, new Uint8Array(bytes)); }
  async putFromFile(key: string, localPath: string): Promise<boolean> {
    this.fromFileCalls.push({ key, localPath });
    this.objects.set(key, enc(ASSET_BODY));
    return true;
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

class NativeDevice implements S3v3DeviceStore {
  readAssetCalls: string[] = [];
  state: DeviceState = {
    lake: { v: 3, space: "lake", notes: [
      { id: "n1", title: "N", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: H("body-1") },
    ], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [
      { id: "q1", createdAt: ISO, updatedAt: ISO, contentHash: H("quick-body") },
    ] },
    folders: [], intents: [], pending: [], remotePurged: [], restorePending: [], quickPurges: [], quickPurgeTimes: {}, quickDeletes: [], archived: [],
  };
  private bodies = new Map<string, Uint8Array>([["n1", enc("body-1")], ["q1", enc("quick-body")]]);
  async init(): Promise<void> {}
  async loadState(): Promise<DeviceState | null> { return this.state; }
  async saveState(s: DeviceState): Promise<void> { this.state = s; }
  async loadBaseline(): Promise<null> { return null; }
  async saveBaseline(): Promise<void> {}
  async readBody(id: string): Promise<Uint8Array | null> { return this.bodies.get(id) ?? null; }
  async writeBody(): Promise<void> {}
  async deleteBody(): Promise<void> {}
  async writeHistory(): Promise<string> { return "skip"; }
  async archiveBody(): Promise<void> {}
  async listAssets(): Promise<string[]> { return ["a.png"]; }
  async listAssetStats() { return [{ filename: "a.png", size: ASSET_BODY.length, hash: ASSET_HASH }]; }
  async listQuickAssets(): Promise<string[]> { return ["b.png"]; }
  async listQuickAssetStats() { return [{ filename: "b.png", size: ASSET_BODY.length, hash: ASSET_HASH }]; }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> { this.readAssetCalls.push(id + "/" + filename); return null; }
  async writeAsset(): Promise<void> {}
  async deleteAssetsDir(): Promise<void> {}
  async readQuickBody(id: string): Promise<Uint8Array | null> { return this.bodies.get(id) ?? null; }
  async writeQuickBody(): Promise<void> {}
  async deleteQuickBody(): Promise<void> {}
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> { this.readAssetCalls.push("quick:" + id + "/" + filename); return null; }
  async writeQuickAsset(): Promise<void> {}
  async deleteQuickAssetsDir(): Promise<void> {}
  async assetNativePathFor(space: "lake" | "quickNotes", id: string, filename: string): Promise<string | null> {
    return space === "lake" ? "note-assets/" + id + "/" + filename : "quick-notes/assets/" + id + "/" + filename;
  }
}

describe("原生资产上传（261027 Phase1）：声明用原生 hash，上传走 fromFile，不读字节", () => {
  it("lake 资产：size/hash 来自 listAssetStats，PUT 走 putFromFile，readAsset 零调用", async () => {
    const remote = new MemRemote();
    const device = new NativeDevice();
    const progress: Array<{ phase: string; done?: number; total?: number; bytesDone?: number; bytesTotal?: number }> = [];
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev-native", onProgress: (p) => progress.push(p) });
    const report = await engine.sync({ onEmptyCloud: "upload" });
    expect(report.published).toBe(true);
    // 261027：上传也报进度（文件粒度 + 字节累计）。
    const uploads = progress.filter((p) => p.phase === "uploads");
    expect(uploads.length).toBeGreaterThan(0);
    expect(uploads[uploads.length - 1].bytesDone).toBeGreaterThan(0);
    expect(device.readAssetCalls).toEqual([]); // 关键：字节没有过桥
    expect(remote.puts).not.toContain("assets/n1/a.png");
    expect(remote.fromFileCalls.some((c) => c.key === "assets/n1/a.png" && c.localPath === "note-assets/n1/a.png")).toBe(true);

    // 云端声明里的 size/hash 必须等于原生清单（同一份文件不重复算）
    const declKeys = [...remote.objects.keys()].filter((k) => k.startsWith("meta/assets/n1/"));
    expect(declKeys).toHaveLength(1);
    const decl = JSON.parse(new TextDecoder().decode(remote.objects.get(declKeys[0])!)) as { assets: Array<{ filename: string; size: number; hash: string }> };
    expect(decl.assets).toEqual([{ filename: "a.png", size: ASSET_BODY.length, hash: ASSET_HASH }]);
  });

  it("小记图片：同样走原生 fromFile（quick-notes/assets 路径）", async () => {
    const remote = new MemRemote();
    const device = new NativeDevice();
    // 只留小记，避免 lake 侧干扰断言
    device.state = { ...device.state, lake: { v: 3, space: "lake", notes: [], folders: [] } };
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev-native-q" });
    await engine.sync({ onEmptyCloud: "upload" });
    expect(device.readAssetCalls).toEqual([]);
    const call = remote.fromFileCalls.find((c) => c.key === "quick-notes/assets/q1/b.png");
    expect(call?.localPath).toBe("quick-notes/assets/q1/b.png");
    expect(remote.puts).not.toContain("quick-notes/assets/q1/b.png");
  });

  it("小记图片下载：原生 getToFile（quick-notes/assets 路径），不产生字节 GET", async () => {
    const remote = new MemRemote();
    const device = new NativeDevice();
    device.state = { ...device.state, lake: { v: 3, space: "lake", notes: [], folders: [] } };
    const quickBody = "quick-body";
    const quickHash = H(quickBody);
    const decl = { filename: "b.png", size: ASSET_BODY.length, hash: ASSET_HASH };
    const built = buildAssetDeclaration([decl]);
    const quickIndex: QuickNotesIndex = {
      v: 3, space: "quickNotes",
      items: [{ id: "q1", createdAt: ISO, updatedAt: ISO, contentHash: quickHash, assetsHash: built.declHash }],
    };
    const quickSer = serializeQuickNotesIndex(quickIndex);
    const quickCommit = indexHashOf(quickSer);
    const lakeIndex: LakeIndex = { v: 3, space: "lake", folders: [], notes: [] };
    const lakeSer = serializeLakeIndex(lakeIndex);
    const lakeCommit = indexHashOf(lakeSer);
    remote.put("quick-notes/meta/index/" + quickCommit + ".json", enc(quickSer));
    remote.put("meta/index/" + lakeCommit + ".json", enc(lakeSer));
    remote.put("quick-notes/objects/" + quickHash + ".qnote", enc(quickBody));
    remote.put("quick-notes/meta/assets/q1/" + built.declHash + ".json", enc(serializeDeclaration(built.declaration)));
    remote.put("meta/pointer.json", enc(JSON.stringify({ v: 3, epoch: "11111111-1111-4111-8111-111111111111", generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: ISO })));
    // 本地没有该图片：清掉 fake 设备的「已有同内容」清单，确保真的走下载差集。
    device.listQuickAssetStats = async () => [];
    device.listQuickAssets = async () => [];
    const downloads: Array<{ key: string; localPath: string }> = [];
    remote.getToFile = async (key: string, localPath: string) => { downloads.push({ key, localPath }); return "ok"; };

    const engine = new S3v3SyncEngine({ remote, device, deviceId: "dev-native-dl" });
    await engine.sync({ onEmptyCloud: "stay" });
    expect(downloads).toEqual([{ key: "quick-notes/assets/q1/b.png", localPath: "quick-notes/assets/q1/b.png" }]);
    expect(remote.objects.get("quick-notes/assets/q1/b.png")).toBeUndefined(); // 没有走字节路径落盘
  });
});