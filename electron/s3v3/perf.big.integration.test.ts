import { promises as fs, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Database from "better-sqlite3";
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

const enabled = process.env.S3V3_PERF_BIG === "1";
const DOCS = Number(process.env.S3V3_PERF_BIG_DOCS || 20000);
const describeIt = enabled ? describe : describe.skip;

describeIt("2 万文档本地引擎/适配器基准（绕过 Store API 造数）", () => {
  it("loadState / 首次发布 / 空跑 / 改 10 篇", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-perf-big-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    const db2 = new Database(path.join(root, "metadata.sqlite3"));
    const wsId = (db2.prepare("SELECT workspace_id FROM tree_nodes WHERE id=?").get(nb.id) as { workspace_id: string }).workspace_id;
    const now = new Date().toISOString();
    const insertNote = db2.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,kind) VALUES(?,?,?,?,?,'local',0,'doc')");
    const insertTree = db2.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,'local',0)");
    db2.transaction(() => {
      for (let i = 0; i < DOCS; i++) {
        const id = "big" + String(i).padStart(6, "0");
        insertNote.run(id, "Doc " + i, nb.id, i, now);
        insertTree.run("t-" + id, wsId, nb.id, "Doc " + i, id, i, now, now);
      }
    })();
    db2.close();
    for (let i = 0; i < DOCS; i++) {
      const id = "big" + String(i).padStart(6, "0");
      writeFileSync(store.getNotePaths(id).lakePath, "<p>body-" + i + "-" + "x".repeat(400) + "</p>");
    }
    const remote = new MemoryRemote();
    const device = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
    await device.init();
    let phases: Record<string, number> = {};
    const engine = new S3v3SyncEngine({ remote, device, deviceId: "big", onPhase: (phase, ms) => { phases[phase] = (phases[phase] ?? 0) + ms; } });
    const tLoad = Date.now();
    await device.loadState();
    const loadMs = Date.now() - tLoad;
    let t = Date.now();
    await engine.sync({ onEmptyCloud: "upload" });
    const initMs = Date.now() - t;
    phases = {};
    t = Date.now();
    await engine.sync();
    const noopMs = Date.now() - t;
    const noopPhases = { ...phases };
    for (let i = 0; i < 10; i++) store.saveNote("big" + String(i).padStart(6, "0"), "Doc " + i, "<p>edited-" + i + "-" + "y".repeat(400) + "</p>");
    phases = {};
    t = Date.now();
    await engine.sync();
    const editMs = Date.now() - t;
    const editPhases = { ...phases };
    console.log("PERF-BIG " + JSON.stringify({ docs: DOCS, loadMs, initMs, noopMs, noopPhases, editMs, editPhases }));
    expect(noopPhases).toBeTruthy();
  }, 600_000);
});
