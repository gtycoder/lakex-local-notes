import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class LatencyRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { await this.delay(); const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { await this.delay(); this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { await this.delay(); return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { await this.delay(); for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { await this.delay(); const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
  private async delay() { await new Promise((r) => setTimeout(r, 1 + Math.random() * 5)); }
}
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function device(name: string) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-corr-" + name + "-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
async function putDoc(store: FileDeviceStore, id: string, body: string) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), { id, title: id, parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) }];
  await store.saveState(state);
}

describe("数据准确性：多轮并发编辑/新建不丢数据", () => {
  it("4 端 × 3 轮：并发改共享文档 + 各端新建；最终全量收敛", async () => {
    const remote = new LatencyRemote();
    const devices = await Promise.all([0, 1, 2, 3].map((i) => device("d" + i)));
    for (let i = 0; i < 10; i++) await putDoc(devices[0].store, "seed-" + i, "seed-body-" + i);
    const engines = devices.map((d, i) => new S3v3SyncEngine({ remote, device: d.store, deviceId: "corr-" + i }));
    await engines[0].sync({ onEmptyCloud: "upload" });
    for (let i = 1; i < 4; i++) await engines[i].sync();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) {
        await putDoc(devices[i].store, "shared-" + round, "round-" + round + "-from-" + i);
        await putDoc(devices[i].store, "new-" + round + "-" + i, "created-" + round + "-" + i);
      }
      const results = await Promise.allSettled(engines.map((e) => e.sync()));
      const errors = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
      expect(errors).toEqual([]);
    }
    for (let syncRound = 0; syncRound < 2; syncRound++) {
      for (const e of engines) await e.sync();
    }
    const allIds = new Set<string>();
    for (const d of devices) for (const n of (await d.store.loadState())!.lake.notes) allIds.add(n.id);
    expect(allIds.size).toBe(10 + 3 + 12); // 10 seed + 3 shared + 12 新建
    for (const id of allIds) {
      const hashes = new Set<string>();
      for (const d of devices) {
        const note = (await d.store.loadState())!.lake.notes.find((n) => n.id === id);
        expect(note, d.root + " 缺 " + id).toBeTruthy();
        hashes.add(note!.contentHash);
        expect(await d.store.readBody(id)).not.toBeNull();
      }
      expect(hashes.size, id + " 内容未收敛").toBe(1);
    }
    // 云端索引与本地一致
    const pointer = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { lake: { commit: string } };
    const idx = JSON.parse(new TextDecoder().decode((await remote.get("meta/index/" + pointer.lake.commit + ".json"))!)) as { notes: Array<{ id: string }> };
    expect(new Set(idx.notes.map((n) => n.id))).toEqual(allIds);
  }, 120_000);
});
