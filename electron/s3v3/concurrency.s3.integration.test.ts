import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { S3v3S3Remote } from "./s3Remote.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function device(name: string) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-conc-s3-" + name + "-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
async function putDoc(store: FileDeviceStore, id: string, body: string) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), { id, title: id, parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) }];
  await store.saveState(state);
}

describeIt("6 端并发推拉（真实 S3）", () => {
  it("同一文档 6 端同时编辑 + 各自文档并发编辑：无错误、冲突留档、全部收敛", async () => {
    const prefix = (process.env.S3V3_PREFIX || "lake-notes-v3-dev1") + "/_conc/" + randomUUID();
    const remote = new S3v3S3Remote({ endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix, forcePathStyle: false });
    const devices = await Promise.all(["a","b","c","d","e","f"].map((n) => device(n)));
    try {
      for (let i = 0; i < 6; i++) await putDoc(devices[0].store, "own-" + i, "seed-" + i);
      await putDoc(devices[0].store, "shared", "shared-seed");
      const engines = devices.map((d, i) => new S3v3SyncEngine({ remote, device: d.store, deviceId: "dev-" + i }));
      const t0 = Date.now();
      await engines[0].sync({ onEmptyCloud: "upload" });
      for (let i = 1; i < 6; i++) await engines[i].sync();
      const seedMs = Date.now() - t0;
      // 6 端同时：改 shared + 改自己的 own-i
      for (let i = 0; i < 6; i++) { await putDoc(devices[i].store, "shared", "shared-from-" + i); await putDoc(devices[i].store, "own-" + i, "edited-" + i); }
      const t1 = Date.now();
      const r1 = await Promise.allSettled(engines.map((e) => e.sync()));
      const concurrentMs = Date.now() - t1;
      const r2 = await Promise.allSettled(engines.map((e) => e.sync()));
      const errs = [...r1, ...r2].filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
      const sharedBodies: string[] = [];
      for (const d of devices) sharedBodies.push(sha256Hex((await d.store.readBody("shared"))!));
      const ownOk: boolean[] = [];
      for (let i = 0; i < 6; i++) for (const d of devices) ownOk.push(new TextDecoder().decode((await d.store.readBody("own-" + i))!) === "edited-" + i);
      const history: number[] = [];
      for (const d of devices) { try { history.push((await fs.readdir(path.join(d.root, "history"))).length); } catch { history.push(0); } }
      console.log(JSON.stringify({ seedMs, concurrentMs, r1: r1.map((r) => r.status === "fulfilled" ? { pub: r.value.published, up: r.value.uploadedNotes, down: r.value.downloadedNotes } : "ERR"), r2: r2.map((r) => r.status === "fulfilled" ? { pub: r.value.published, up: r.value.uploadedNotes, down: r.value.downloadedNotes } : "ERR"), errs, sharedUnique: new Set(sharedBodies).size, ownAll: ownOk.every(Boolean), history }));
      expect(errs).toEqual([]);
      expect(new Set(sharedBodies).size).toBe(1);
      expect(ownOk.every(Boolean)).toBe(true);
    } finally {
      await remote.deleteByPrefix("").catch(() => {});
    }
  }, 600_000);
});
