/**
 * 移动端云清理编排（261113 D3）：预览（dryRun）与真删必须同源，且清理字节不额外发请求。
 *
 * 判据：
 *  - dryRun：引擎不调 deleteMany、不写 device state，云端对象一个不少（预览可反复点）；
 *  - 预览的 bytes 来自引擎 deepCleanup 内部 list 回包（0 额外请求），= 将删对象体积和；
 *  - 保留窗口内的对象不删（默认 MOBILE_GC_RETENTION_DAYS 天）；
 *  - 真删只删预览里那份候选，删完对象消失、窗口内对象保留。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));
import { gunzipSync, gzipSync } from "node:zlib";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote } from "../data/noteRepository.js";
import { runMobileV3Sync, runMobileV3DeepCleanup } from "./sync.js";
import { MOBILE_GC_RETENTION_DAYS } from "../sync/gcPolicy.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";

const DAY = 86_400_000;
/** remote 对象的年龄可注入（引擎按 lastModified 判保留窗口）；写操作记调用次数以便断言「预览不删」。 */
class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean; lastModified: number }>();
  deleteManyCalls: string[][] = [];
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes;
  }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) {
    this.objects.set(key, {
      bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes),
      gzip: !!opts?.gzip,
      lastModified: Date.now(),
    });
  }
  async list(prefix: string): Promise<RemoteObjectInfo[]> {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, o]) => ({ key, size: o.bytes.length, lastModified: o.lastModified }));
  }
  async deleteMany(keys: string[]) {
    this.deleteManyCalls.push([...keys]);
    for (const key of keys) this.objects.delete(key);
  }
  async deleteByPrefix(prefix: string) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    for (const key of keys) this.objects.delete(key);
    return keys.length;
  }
  /** 造一个「云端已不可达」的对象（不在任何索引/声明里），并指定它有多旧。 */
  putUnreachable(key: string, size: number, ageDays: number): void {
    this.objects.set(key, { bytes: new Uint8Array(size), gzip: false, lastModified: Date.now() - ageDays * DAY });
  }
}

const settings = { endpoint: "https://example.com", region: "cn-north-1", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "p" };

describe("移动端云清理：预览（dryRun）与真删同源", () => {
  it("dryRun 不删（可反复预览）、字节取 list 回包；真删只删预览候选，窗口内保留", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    await createNote(db, "n1", "Doc", "hello", null, new Map());
    const remote = new MemoryRemote();
    await runMobileV3Sync(db, settings, { remote, deviceId: "M", emptyCloud: "upload" });
    // 整轮同步自身会 deleteMany（发布后摘锁）；从这里开始只记清理动作的删除。
    remote.deleteManyCalls = [];

    // 一个超出保留窗口的孤儿 + 一个窗口内孤儿（后者必须保留）
    remote.putUnreachable("objects/orphan-aaaa.lake", 1234, MOBILE_GC_RETENTION_DAYS + 1);
    remote.putUnreachable("objects/recent-bbbb.lake", 99, 1);
    const objectsBefore = remote.objects.size;

    const preview = await runMobileV3DeepCleanup(db, settings, { remote, dryRun: true, deviceId: "M" });
    expect(preview.dryRun).toBe(true);
    expect(preview.deleted).toEqual(["objects/orphan-aaaa.lake"]);
    expect(preview.bytes).toBe(1234);
    expect(preview.skippedRecent).toBeGreaterThanOrEqual(1);
    expect(remote.deleteManyCalls).toEqual([]);
    expect(remote.objects.size).toBe(objectsBefore);
    expect(remote.objects.has("objects/orphan-aaaa.lake")).toBe(true);
    expect(remote.objects.has("objects/recent-bbbb.lake")).toBe(true);

    // 预览可重复（只统计不删 ⇒ 第二次数字不变）
    const again = await runMobileV3DeepCleanup(db, settings, { remote, dryRun: true, deviceId: "M" });
    expect(again.deleted).toEqual(preview.deleted);
    expect(again.bytes).toBe(preview.bytes);

    const real = await runMobileV3DeepCleanup(db, settings, { remote, dryRun: false, deviceId: "M" });
    expect(real.dryRun).toBe(false);
    expect(real.deleted).toEqual(["objects/orphan-aaaa.lake"]);
    expect(real.bytes).toBe(1234);
    expect(remote.deleteManyCalls.flat()).toContain("objects/orphan-aaaa.lake");
    expect(remote.objects.has("objects/orphan-aaaa.lake")).toBe(false);
    expect(remote.objects.has("objects/recent-bbbb.lake")).toBe(true);
    await db.close();
  }, 60_000);
});
