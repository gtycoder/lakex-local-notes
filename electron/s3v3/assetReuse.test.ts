import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "../../src/core/s3v3Engine.js";
import type { DeviceState } from "../../src/core/s3v3DeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../src/core/s3v3Ports.js";
import { FileDeviceStore } from "./fileDeviceStore.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });

describe("增量附件扫描：远端已声明附件不读本地字节", () => {
  it("改正文但附件不变时 readAsset 0 次；新增附件只读新增", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-assetreuse-"));
    const store = new FileDeviceStore(root);
    await store.init();
    let state = (await store.loadState()) ?? emptyState();
    const body1 = new TextEncoder().encode("<p>v1</p>");
    await store.writeBody("n1", body1);
    await store.writeAsset("n1", "a.png", new TextEncoder().encode("asset-a"));
    await store.writeAsset("n1", "b.png", new TextEncoder().encode("asset-b"));
    state.lake.notes = [{ id: "n1", title: "N", parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(body1) }];
    await store.saveState(state);
    const remote = new MemoryRemote();
    const engine = new S3v3SyncEngine({ remote, device: store, deviceId: "reuse" });
    await engine.sync({ onEmptyCloud: "upload" });

    const body2 = new TextEncoder().encode("<p>v2</p>");
    await store.writeBody("n1", body2);
    state = (await store.loadState())!;
    state.lake.notes[0].contentHash = sha256Hex(body2);
    await store.saveState(state);
    let calls = 0;
    const originalRead = store.readAsset.bind(store);
    store.readAsset = async (id: string, filename: string) => { calls++; return originalRead(id, filename); };
    await engine.sync();
    expect(calls).toBe(0);

    await store.writeAsset("n1", "c.png", new TextEncoder().encode("asset-c"));
    const body3 = new TextEncoder().encode("<p>v3</p>");
    await store.writeBody("n1", body3);
    state = (await store.loadState())!;
    state.lake.notes[0].contentHash = sha256Hex(body3);
    await store.saveState(state);
    calls = 0;
    await engine.sync();
    expect(calls).toBe(1);
  }, 60_000);
});
