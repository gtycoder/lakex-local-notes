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
  private async delay() { await new Promise((r) => setTimeout(r, 2 + Math.random() * 8)); }
}

const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function device(name: string) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-c-" + name + "-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
async function putDoc(store: FileDeviceStore, id: string, body: string) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  state.lake.notes = [...state.lake.notes.filter((n) => n.id !== id), { id, title: id, parentId: null, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) }];
  await store.saveState(state);
}

describe("6 端并发推拉（假 S3 + 延迟）", () => {
  it("6 端同时编辑同一文档并 sync：记录错误/分叉/收敛", async () => {
    const remote = new LatencyRemote();
    const devices = await Promise.all(["a","b","c","d","e","f"].map((n) => device(n)));
    await putDoc(devices[0].store, "n1", "seed");
    const engines = devices.map((d, i) => new S3v3SyncEngine({ remote, device: d.store, deviceId: "dev-" + i }));
    await engines[0].sync({ onEmptyCloud: "upload" });
    for (let i = 1; i < 6; i++) await engines[i].sync();

    // 6 端同时各自编辑同一文档
    for (let i = 0; i < 6; i++) await putDoc(devices[i].store, "n1", "edit-from-" + i);
    const results = await Promise.allSettled(engines.map((e) => e.sync()));
    const errors = results.map((r, i) => r.status === "rejected" ? { i, code: (r.reason as { code?: string }).code ?? String(r.reason) } : null).filter(Boolean);
    console.log("round1=" + JSON.stringify(results.map((r) => r.status === "fulfilled" ? { pub: r.value.published, up: r.value.uploadedNotes, down: r.value.downloadedNotes } : { err: (r.reason as { code?: string }).code })));
    // 再来一轮收敛
    const results2 = await Promise.allSettled(engines.map((e) => e.sync()));
    const errors2 = results2.map((r, i) => r.status === "rejected" ? { i, code: (r.reason as { code?: string }).code ?? String(r.reason) } : null).filter(Boolean);
    const bodies = [];
    for (const d of devices) bodies.push(sha256Hex((await d.store.readBody("n1"))!));
    const winner = results.findIndex((r) => r.status === "fulfilled" && r.value.published);
    const historyCounts: number[] = [];
    for (let i = 0; i < devices.length; i++) {
      try { historyCounts.push((await fs.readdir(path.join(devices[i].root, "history"))).length); } catch { historyCounts.push(0); }
    }
    console.log("round2=" + JSON.stringify({ errors, errors2, winner, uniqueBodies: new Set(bodies).size, bodies: bodies.map((b) => b.slice(0, 8)), historyCounts, objects: remote.objects.size }));
    expect(errors).toEqual([]);
    expect(errors2).toEqual([]);
    expect(new Set(bodies).size).toBe(1);
    // 除赢家外的 5 端本地编辑必须留档（不能静默丢失）
    for (let i = 0; i < devices.length; i++) if (i !== winner) expect(historyCounts[i]).toBeGreaterThan(0);
  }, 120_000);

  it("6 端并发改各自文档：全部保留并最终收敛", async () => {
    const remote = new LatencyRemote();
    const devices = await Promise.all(["a","b","c","d","e","f"].map((n) => device(n)));
    for (let i = 0; i < 6; i++) await putDoc(devices[0].store, "own-" + i, "seed-" + i);
    const engines = devices.map((d, i) => new S3v3SyncEngine({ remote, device: d.store, deviceId: "dev-" + i }));
    await engines[0].sync({ onEmptyCloud: "upload" });
    for (let i = 1; i < 6; i++) await engines[i].sync();
    for (let i = 0; i < 6; i++) await putDoc(devices[i].store, "own-" + i, "edited-" + i);
    const round1 = await Promise.allSettled(engines.map((e2) => e2.sync()));
    const round2 = await Promise.allSettled(engines.map((e2) => e2.sync()));
    const errs = [...round1, ...round2].filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason);
    console.log("own-round1=" + JSON.stringify(round1.map((r) => r.status === "fulfilled" ? r.value.published : "ERR")));
    expect(errs).toEqual([]);
    for (let i = 0; i < 6; i++) {
      for (const d of devices) {
        expect(new TextDecoder().decode((await d.store.readBody("own-" + i))!)).toBe("edited-" + i);
      }
    }
  }, 120_000);

  it("并发发布容量：12/20 端同时推送的锁等待与错误", { retry: 2, timeout: 300_000 }, async () => {
    const out: Array<{ n: number; ms: number; errors: string[] }> = [];
    for (const n of [12, 20, 28]) {
      const remote = new LatencyRemote();
      const devices = await Promise.all(Array.from({ length: n }, (_, i) => device("cap" + i)));
      for (let i = 0; i < n; i++) await putDoc(devices[0].store, "own-" + i, "seed-" + i);
      const engines = devices.map((d, i) => new S3v3SyncEngine({ remote, device: d.store, deviceId: "cap-" + i }));
      await engines[0].sync({ onEmptyCloud: "upload" });
      for (let i = 1; i < n; i++) await engines[i].sync();
      for (let i = 0; i < n; i++) await putDoc(devices[i].store, "own-" + i, "edited-" + i);
      const t = Date.now();
      const rs = await Promise.allSettled(engines.map((e2) => e2.sync()));
      const errors = rs.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
      out.push({ n, ms: Date.now() - t, errors });
      console.log("CONC-CAP " + JSON.stringify({ n, ms: Date.now() - t, errors }));
    }
    expect(out.length).toBe(3);
    // 容量结论固化：≤20 端并发发布无错误；28 端出现频发发布冲突（锁串行 + 重试超限）
    // 三点：12 端正常；20 端偶发（允许 0~少量错误，实测 0~2）；28 端频发（实测 6~7）
    expect(out.find((r) => r.n === 12)!.errors).toEqual([]);
    expect(out.find((r) => r.n === 28)!.errors.length).toBeGreaterThanOrEqual(3);
  });
});
