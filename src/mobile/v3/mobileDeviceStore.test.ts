import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { gunzipSync, gzipSync } from "node:zlib";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, saveNote } from "../data/noteRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { S3v3SyncEngine } from "../../core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

async function freshDevice() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const store = new MobileDeviceStore(db);
  await store.init();
  return { db, store };
}

describe("MobileDeviceStore ↔ core v3 引擎（双移动端，假 S3）", () => {
  it("初始化上传 / 对端拉取 / 增量 / 远端墓碑→本机回收站", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    await createNote(a.db, "m1", "Mobile Doc", "hello-mobile", null, new Map());
    const engineA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    const r1 = await engineA.sync({ onEmptyCloud: "upload" });
    expect(r1.uploadedNotes).toBeGreaterThanOrEqual(1);
    const r2 = await engineB.sync();
    expect(r2.downloadedNotes).toBe(1);
    const bodyB = await b.store.readBody("m1");
    expect(new TextDecoder().decode(bodyB!)).toBe("hello-mobile");

    await saveNote(a.db, "m1", "Mobile Doc", "hello-mobile-v2", null, new Map());
    await engineA.sync();
    await engineB.sync();
    expect(new TextDecoder().decode((await b.store.readBody("m1"))!)).toBe("hello-mobile-v2");

    // B 删除 → 远端墓碑 → A 应用后进入回收站
    await b.db.prepare("UPDATE notes SET trashed_at=?, updated_at=?, sync_state='local' WHERE id=?").run(new Date().toISOString(), new Date(Date.now() + 2000).toISOString(), "m1");
    await engineB.sync();
    await engineA.sync();
    const row = await a.db.prepare("SELECT trashed_at FROM notes WHERE id=?").get("m1") as { trashed_at: string | null };
    expect(row.trashed_at).toBeTruthy();
    await a.db.close(); await b.db.close();
  }, 60_000);
});
