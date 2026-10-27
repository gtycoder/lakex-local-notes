import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { syncWithV3 } from "./desktopSync.js";
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

describe("桌面 v3 feature flag 入口", () => {
  it("真实 Store ↔ v3 引擎 ↔ 对端 FileDeviceStore", async () => {
    process.env.LAKE_S3V3_EMPTY_CLOUD = "upload";
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-dsync-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc1", "v3-hello", [], "n1");
    const remote = new MemoryRemote();
    const r1 = await syncWithV3(store, undefined, { remote, deviceId: "A" });
    expect(r1.uploaded).toBeGreaterThanOrEqual(1);
    const bRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-dsync-b-"));
    const b = new FileDeviceStore(bRoot); await b.init();
    await new S3v3SyncEngine({ remote, device: b, deviceId: "B" }).sync();
    expect(new TextDecoder().decode((await b.readBody("n1"))!)).toBe("v3-hello");

    store.saveNote("n1", "Doc1", "v3-hello-v2");
    await syncWithV3(store, undefined, { remote, deviceId: "A" });
    await new S3v3SyncEngine({ remote, device: b, deviceId: "B" }).sync();
    expect(new TextDecoder().decode((await b.readBody("n1"))!)).toBe("v3-hello-v2");

    // 对端新文档 → 本机 v3 同步应在 Store 建出
    const st = (await b.loadState()) ?? emptyState();
    const bytes = new TextEncoder().encode("from-b");
    await b.writeBody("n3", bytes);
    st.lake.notes.push({ id: "n3", title: "n3", parentId: nb.id, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) });
    await b.saveState(st);
    await new S3v3SyncEngine({ remote, device: b, deviceId: "B" }).sync();
    await syncWithV3(store, undefined, { remote, deviceId: "A" });
    expect(store.hasNote("n3")).toBe(true);
    expect(store.readNote("n3").content).toBe("from-b");
  }, 60_000);
});
