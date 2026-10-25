import { describe, expect, it, vi } from "vitest";
import path from "node:path";
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { gunzipSync, gzipSync } from "node:zlib";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote } from "../data/noteRepository.js";
import { runMobileV3Sync } from "./sync.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

const settings = { endpoint: "https://example.com", region: "cn-north-1", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "p" };

describe("移动端 v3 同步编排", () => {
  it("MobileDb → 引擎 → 假 S3：初始化上传", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    await createNote(db, "s1", "Doc", "hello", null, new Map());
    const remote = new MemoryRemote();
    const report = await runMobileV3Sync(db, settings, { remote, deviceId: "M", emptyCloud: "upload" });
    expect(report.published).toBe(true);
    expect(report.uploadedNotes).toBeGreaterThanOrEqual(1);
    expect(await remote.get("meta/pointer.json")).not.toBeNull();
    await db.close();
  }, 30_000);
});
