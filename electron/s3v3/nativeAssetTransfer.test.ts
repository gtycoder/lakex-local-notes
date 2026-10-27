import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

const enc = (s: string) => new TextEncoder().encode(s);
class NativeRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  assetRoot = "";
  nativeGets: string[] = [];
  byteGets: string[] = [];
  nativePuts: string[] = [];
  bytePuts: string[] = [];
  getToFileMode: "ok" | "unsupported" = "ok";
  async get(key: string): Promise<Uint8Array | null> {
    if (key.startsWith("assets/")) this.byteGets.push(key);
    const o = this.objects.get(key);
    return o ? (o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes) : null;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    if (key.startsWith("assets/")) this.bytePuts.push(key);
    this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip });
  }
  async getToFile(key: string, destPath: string, expected: { size: number; sha256: string }): Promise<"ok" | "missing" | "corrupt" | "unsupported"> {
    if (this.getToFileMode === "unsupported") return "unsupported";
    this.nativeGets.push(key);
    const o = this.objects.get(key);
    if (!o) return "missing";
    const dest = path.join(this.assetRoot, destPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, o.bytes);
    const bytes = await fs.readFile(dest);
    return bytes.length === expected.size && sha256Hex(new Uint8Array(bytes)) === expected.sha256 ? "ok" : "corrupt";
  }
  async putFromFile(key: string, localPath: string): Promise<boolean> {
    this.nativePuts.push(key);
    const bytes = new Uint8Array(await fs.readFile(path.join(this.assetRoot, localPath)));
    this.objects.set(key, { bytes, gzip: false });
    return true;
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, lastModified: 0 })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}
class NativeDevice extends FileDeviceStore {
  constructor(root: string) { super(root); }
  async assetNativePath(id: string, filename: string): Promise<string | null> { return id + "/" + filename; }
}
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function seed(store: FileDeviceStore, notes: number, assets: number) {
  const state = (await store.loadState()) ?? emptyState();
  for (let i = 0; i < notes; i++) {
    const id = "n" + i;
    const body = enc("body-" + id);
    await store.writeBody(id, body);
    for (let a = 0; a < assets; a++) await store.writeAsset(id, "a" + a + ".png", enc("asset-" + id + "-" + a));
    state.lake.notes.push({ id, title: id, parentId: null, sortOrder: i, updatedAt: new Date().toISOString(), contentHash: sha256Hex(body) });
  }
  await store.saveState(state);
}
const tmp = async (n: string) => fs.mkdtemp(path.join(os.tmpdir(), "s3v3-native-" + n + "-"));

describe("P0-4 原生流式资产传输（字节不过 JS 桥）", () => {
  it("下载：有 assetNativePath + getToFile 时走原生路径，资产不产生字节 GET，文件落盘可读", async () => {
    const remote = new NativeRemote();
    const aRoot = await tmp("a"); const a = new NativeDevice(aRoot); await a.init();
    remote.assetRoot = path.join(aRoot, "assets");
    await seed(a, 4, 3);
    await new S3v3SyncEngine({ remote, device: a, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
    expect(remote.nativePuts.length).toBeGreaterThan(0); // 上传也走原生（putFromFile）
    expect(remote.bytePuts.filter((k) => k.startsWith("assets/"))).toEqual([]);

    const bRoot = await tmp("b"); const b = new NativeDevice(bRoot); await b.init();
    remote.assetRoot = path.join(bRoot, "assets");
    remote.nativeGets = []; remote.byteGets = [];
    await new S3v3SyncEngine({ remote, device: b, deviceId: "B" }).sync();
    expect(remote.nativeGets.filter((k) => k.startsWith("assets/")).length).toBe(12);
    expect(remote.byteGets.filter((k) => k.startsWith("assets/"))).toEqual([]);
    expect(await b.readAsset("n0", "a0.png")).toEqual(enc("asset-n0-0"));
    expect((await b.listAssets("n3")).sort()).toEqual(["a0.png", "a1.png", "a2.png"]);
  }, 60_000);

  it("原生返回 unsupported 时回退字节路径（可用性优先）", async () => {
    const remote = new NativeRemote();
    const aRoot = await tmp("a2"); const a = new NativeDevice(aRoot); await a.init();
    remote.assetRoot = path.join(aRoot, "assets");
    await seed(a, 2, 2);
    await new S3v3SyncEngine({ remote, device: a, deviceId: "A" }).sync({ onEmptyCloud: "upload" });
    const bRoot = await tmp("b2"); const b = new NativeDevice(bRoot); await b.init();
    remote.assetRoot = path.join(bRoot, "assets");
    remote.byteGets = []; remote.getToFileMode = "unsupported";
    await new S3v3SyncEngine({ remote, device: b, deviceId: "B" }).sync();
    expect(remote.byteGets.filter((k) => k.startsWith("assets/")).length).toBe(4);
    expect(await b.readAsset("n1", "a1.png")).toEqual(enc("asset-n1-1"));
  }, 60_000);
});
