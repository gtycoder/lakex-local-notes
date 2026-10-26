import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine, type S3v3Progress } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { Store } from "../store.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

const enc = (s: string) => new TextEncoder().encode(s);
class CountingRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  getInflight = 0; maxGetInflight = 0; getCalls = 0;
  delayMs = 0;
  async get(key: string): Promise<Uint8Array | null> {
    this.getInflight++; this.getCalls++;
    this.maxGetInflight = Math.max(this.maxGetInflight, this.getInflight);
    try {
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
      const o = this.objects.get(key);
      if (!o) return null;
      return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
    } finally { this.getInflight--; }
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, lastModified: 0 })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string): Promise<number> { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
}

const tmp = async (name: string) => fs.mkdtemp(path.join(os.tmpdir(), "s3v3-perf3-" + name + "-"));
async function device(name: string) { const root = await tmp(name); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
const NOTES = 120, ASSETS = 2;
async function seedA(store: FileDeviceStore) {
  const state = (await store.loadState()) ?? emptyState();
  for (let i = 0; i < NOTES; i++) {
    const id = "n" + String(i).padStart(4, "0");
    const body = enc("body-" + id + "-" + "x".repeat(200));
    await store.writeBody(id, body);
    for (let a = 0; a < ASSETS; a++) await store.writeAsset(id, "a" + a + ".png", enc("asset-" + id + "-" + a + "-" + "y".repeat(100)));
    state.lake.notes.push({ id, title: id, parentId: null, sortOrder: i, updatedAt: new Date().toISOString(), contentHash: sha256Hex(body) });
  }
  await store.saveState(state);
}
const engineOf = (remote: S3v3Remote, device: FileDeviceStore, progress?: (p: S3v3Progress) => void) =>
  new S3v3SyncEngine({ remote, device, deviceId: "dev", ...(progress ? { onProgress: progress } : {}) });

describe("P0-1 全局有界流水线（正文/声明/资产统一调度）", () => {
  it("首拉下载并发打满配置上限（不再按篇 barrier），进度事件含计数与字节", async () => {
    const remote = new CountingRemote();
    const a = await device("a"); const b = await device("b");
    await seedA(a.store);
    await engineOf(remote, a.store).sync({ onEmptyCloud: "upload" });
    remote.getCalls = 0; remote.delayMs = 5;
    const events: S3v3Progress[] = [];
    const report = await engineOf(remote, b.store, (p) => events.push(p)).sync();
    expect(report.downloadedNotes).toBe(NOTES);
    // 全局并发：正文/声明/资产在同一个 20 并发调度里，观测到的峰值应明显高于旧实现「每篇 2 资产」的 ~10。
    expect(remote.maxGetInflight).toBeGreaterThanOrEqual(12);
    expect(remote.maxGetInflight).toBeLessThanOrEqual(20);
    // 进度：bodies/assets 都有 done/total，且最终都到齐
    const bodies = events.filter((e) => e.phase === "bodies");
    const assets = events.filter((e) => e.phase === "assets");
    expect(bodies.length).toBeGreaterThan(0);
    expect(assets.length).toBeGreaterThan(0);
    expect(bodies.at(-1)?.total).toBe(NOTES);
    expect(bodies.at(-1)?.done).toBe(NOTES);
    expect(assets.at(-1)?.total).toBe(NOTES * ASSETS);
    expect(assets.at(-1)?.done).toBe(NOTES * ASSETS);
    expect((assets.at(-1)?.bytesDone ?? 0)).toBeGreaterThan(0);
    expect(events.some((e) => e.phase === "metadata")).toBe(true);
    expect(events.some((e) => e.phase === "apply")).toBe(true);
    expect(events.some((e) => e.phase === "finalize")).toBe(true);
  }, 120_000);

  it("P0-2 文档先出来：正文分块先落库，资产在应用之后才开始写", async () => {
    const remote = new CountingRemote();
    const a = await device("a");
    const b = await device("b");
    await seedA(a.store);
    await engineOf(remote, a.store).sync({ onEmptyCloud: "upload" });
    const order: string[] = [];
    class Recorder extends FileDeviceStore {
      override async saveState(state: DeviceState): Promise<void> {
        await super.saveState(state);
        order.push("save");
      }
      override async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
        await super.writeAsset(id, filename, bytes);
        order.push("asset");
      }
    }
    const recorder = new Recorder(b.root);
    await recorder.init();
    await engineOf(remote, recorder).sync();
    const firstAsset = order.indexOf("asset");
    expect(firstAsset).toBeGreaterThan(0);
    // 至少一次「正文落库」发生在首个资产写入之前（= 文档可以先打开）
    expect(order.slice(0, firstAsset)).toContain("save");
    const notes = (await recorder.loadState())!.lake.notes;
    expect(notes.length).toBe(NOTES);
  }, 120_000);
});

describe("P0-3 桌面资产下载即落盘（不在内存 stage 整轮）", () => {
  it("writeAsset 立即写盘，且 saveState 不依赖内存暂存", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-perf3-desktop-"));
    const store = new Store(root); store.bootstrap();
    const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
    await device.init();
    const bytes = enc("streamed-asset-bytes");
    await device.writeAsset("n-stream", "a.png", bytes);
    const file = path.join(store.noteAssetsPathFor("n-stream"), "a.png");
    expect(await fs.readFile(file, "utf8")).toBe("streamed-asset-bytes");
    expect(await device.readAsset("n-stream", "a.png")).toEqual(bytes);
    expect(await device.listAssets("n-stream")).toContain("a.png");
  }, 60_000);
});
