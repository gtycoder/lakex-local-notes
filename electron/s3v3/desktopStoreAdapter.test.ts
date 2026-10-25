import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function fileDevice() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-b-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
async function addB(store: FileDeviceStore, id: string, body: string, parentId: string | null) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  state.lake.notes.push({ id, title: id, parentId, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) });
  await store.saveState(state);
}

describe("DesktopStoreDevice（真实 Store）", () => {
  it("loadState 映射 + 引擎初始化上传 + 双端增量 + 远端新文档落库", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-a-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    // 带附件的文档：先写临时源文件再导入
    const assetSrc = path.join(root, "asset-src.png");
    await fs.writeFile(assetSrc, "PNG-DATA");
    store.createNoteInAtTopWithContent(nb.id, "Doc1", "hello", [{ filename: "a.png", sourcePath: assetSrc }], "n1");
    store.createNoteInAtTopWithContent(nb.id, "Doc2", "second", [], "n2");

    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const loaded = (await adapter.loadState())!;
    expect(loaded.lake.notes.map((n) => n.id)).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(loaded.lake.folders.map((f) => f.id)).toEqual(expect.arrayContaining([nb.id]));
    expect(loaded.lake.notes.find((n) => n.id === "n1")!.contentHash).toBe(sha256Hex(new TextEncoder().encode("hello")));

    const remote = new MemoryRemote();
    const engineA = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });
    const r1 = await engineA.sync({ onEmptyCloud: "upload" });
    expect(r1.published).toBe(true);
    const b = await fileDevice();
    await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("hello");
    expect(new TextDecoder().decode((await b.store.readAsset("n1", "a.png"))!)).toBe("PNG-DATA");

    // 本机改正文 → 上传 → 对端拉取
    store.saveNote("n1", "Doc1", "hello-v2");
    await engineA.sync();
    await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("hello-v2");

    // 远端新文档 → 本机同步后应创建到 Store
    await addB(b.store, "n3", "from-b", nb.id);
    await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
    await engineA.sync();
    expect(store.hasNote("n3")).toBe(true);
    expect(store.readNote("n3").content).toBe("from-b");
  }, 60_000);

  it("检测到 quick-notes 库时拒绝（不静默丢小记）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-q-"));
    const store = new Store(root);
    store.bootstrap();
    await fs.mkdir(path.join(root, "quick-notes"), { recursive: true });
    await fs.writeFile(path.join(root, "quick-notes", "metadata.sqlite3"), "");
    const adapter = new DesktopStoreDevice(store, root);
    await expect(adapter.init()).rejects.toThrow(/quick notes adapter not implemented/);
  });
});
