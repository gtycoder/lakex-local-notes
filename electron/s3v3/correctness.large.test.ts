import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
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
async function device(name: string) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-largecorr-" + name + "-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
async function putDoc(store: FileDeviceStore, id: string, body: string) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), { id, title: id, parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) }];
  await store.saveState(state);
}

describe("中等数据量准确性：2,000 文档双端并发编辑/新建收敛", () => {
  it("A 初始 2,000 文档 → B 拉取 → 双端各改 10 篇+各建 10 篇 → 收敛无丢失", async () => {
    const remote = new MemoryRemote();
    const a = await device("a"); const b = await device("b");
    for (let i = 0; i < 2000; i++) await putDoc(a.store, "d" + i, "seed-" + i + "-" + "x".repeat(200));
    const engineA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineA.sync({ onEmptyCloud: "upload" });
    await engineB.sync();
    for (let i = 0; i < 10; i++) {
      await putDoc(a.store, "d" + i, "edited-a-" + i);
      await putDoc(b.store, "d" + (100 + i), "edited-b-" + i);
      await putDoc(a.store, "new-a-" + i, "created-a-" + i);
      await putDoc(b.store, "new-b-" + i, "created-b-" + i);
    }
    const r = await Promise.allSettled([engineA.sync(), engineB.sync()]);
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    await engineA.sync(); await engineB.sync();
    const sa = (await a.store.loadState())!;
    const sb = (await b.store.loadState())!;
    expect(sa.lake.notes.length).toBe(2020);
    expect(sb.lake.notes.length).toBe(2020);
    const ha = new Map(sa.lake.notes.map((n) => [n.id, n.contentHash]));
    for (const n of sb.lake.notes) {
      expect(ha.get(n.id), "B 有而 A 无: " + n.id).toBe(n.contentHash);
      expect(await b.store.readBody(n.id)).not.toBeNull();
    }
    console.log("LARGE-CORR " + JSON.stringify({ notes: sa.lake.notes.length, objects: remote.objects.size }));
  }, 180_000);
});
