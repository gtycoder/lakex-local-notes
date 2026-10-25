import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
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

const SIZES = (process.env.S3V3_PERF_SIZES || "500,2000,5000").split(",").map(Number);

describe("增量同步性能（桌面 Store 真实数据，假 S3）", () => {
  it("N 文档：初始/空跑/改 10 篇 的阶段耗时", async () => {
    const out: unknown[] = [];
    for (const n of SIZES) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-perf-" + n + "-"));
      const store = new Store(root);
      store.bootstrap();
      const nb = store.createNotebook("NB");
      for (let i = 0; i < n; i++) store.createNoteInAtTopWithContent(nb.id, "Doc " + i, "<p>body-" + i + "-" + "x".repeat(400) + "</p>", [], "perf" + i);
      const remote = new MemoryRemote();
      const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
      await device.init();
      let phases: Record<string, number> = {};
      const engine = new S3v3SyncEngine({ remote, device, deviceId: "perf", onPhase: (phase, ms) => { phases[phase] = (phases[phase] ?? 0) + ms; } });
      let t = Date.now();
      await engine.sync({ onEmptyCloud: "upload" });
      const initMs = Date.now() - t;
      phases = {};
      t = Date.now();
      await engine.sync();
      const noopMs = Date.now() - t;
      const noopPhases = { ...phases };
      for (let i = 0; i < 10; i++) store.saveNote("perf" + i, "Doc " + i, "<p>edited-" + i + "-" + "y".repeat(400) + "</p>");
      phases = {};
      t = Date.now();
      await engine.sync();
      const editMs = Date.now() - t;
      const editPhases = { ...phases };
      out.push({ docs: n, initMs, noopMs, noopPhases, editMs, editPhases });
      console.log("PERF " + JSON.stringify(out[out.length - 1]));
    }
    expect(out.length).toBe(SIZES.length);
  }, 600_000);
});
