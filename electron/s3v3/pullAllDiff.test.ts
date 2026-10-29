import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import type { LakeNoteEntry } from "../../src/core/s3v3/protocol/s3v3Index.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class CountingRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  gets: string[] = [];
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; this.gets.push(key); return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
  reset() { this.gets = []; }
}
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });

describe("P1 崩溃追赶放大：pullAll 复用本地正文/附件（不重下已持内容）", () => {
  it("baseline 丢失（模拟初始上传 pointer 后 kill -9）⇒ 全量重拉只读元数据，不 GET 正文/附件", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-pulldiff-"));
    const store = new FileDeviceStore(root); await store.init();
    const remote = new CountingRemote();
    const state = emptyState();
    const now = new Date().toISOString();
    for (const [id, assets] of [["n1", { "a.png": "A", "b.png": "B" }], ["n2", { "c.png": "C" }]] as const) {
      const bytes = new TextEncoder().encode("body-" + id);
      await store.writeBody(id, bytes);
      for (const [fn, c] of Object.entries(assets)) await store.writeAsset(id, fn, new TextEncoder().encode(c));
      state.lake.notes.push({ id, title: id, parentId: null, sortOrder: 0, updatedAt: now, contentHash: sha256Hex(bytes) } as LakeNoteEntry);
    }
    const qbytes = new TextEncoder().encode("quick-body");
    await store.writeQuickBody("q1", qbytes);
    await store.writeQuickAsset("q1", "i.png", new TextEncoder().encode("IMG"));
    state.quickNotes.items.push({ id: "q1", createdAt: now, updatedAt: now, contentHash: sha256Hex(qbytes) });
    await store.saveState(state);
    const engine = new S3v3SyncEngine({ remote, device: store, deviceId: "A" });
    await engine.sync({ onEmptyCloud: "upload" });
    expect(remote.objects.size).toBeGreaterThan(0);

    await fs.rm(path.join(root, "baseline.json.gz"));
    remote.reset();
    const r = await engine.sync();
    expect(r.published).toBe(false);
    expect(r.downloadedNotes).toBe(0);
    const bodyOrAssetGets = remote.gets.filter((k) => k.startsWith("objects/") || k.startsWith("assets/") || k.startsWith("quick-notes/objects/") || k.startsWith("quick-notes/assets/"));
    expect(bodyOrAssetGets).toEqual([]);
    expect(remote.gets.some((k) => k.startsWith("meta/index/"))).toBe(true);
  }, 60_000);
});
