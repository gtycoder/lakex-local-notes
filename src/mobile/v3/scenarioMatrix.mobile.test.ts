/**
 * task-46 阶段②：S3 场景矩阵 A 档（内存远程）——移动端侧。
 *
 * 覆盖矩阵中移动端可独立复现的双端场景：
 *   S21 两端同时编辑（冲突 → 远端胜，两端最终一致且稳定）
 *   S35 小记/文档删除传播（A trash → B 拉取进回收站）
 * 断言口径 = 两端最终一致 + 云端索引状态 + 无人卡死；真缺陷只登记（矩阵失败清单），不改生产代码。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
// 资产存储：每台设备经 setBodyStoreBackendForTest 切换（正文在文件后端；本文件不涉附件字节）。
const assetState = vi.hoisted(() => ({ current: new Map<string, Uint8Array>() }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetState.current.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetState.current.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetState.current.delete(key); },
  listNoteAssetKeysFs: async (noteId: string) => [...assetState.current.keys()].filter((k) => k.startsWith(noteId + "/")),
  listQuickNoteAssetKeysFs: async (id: string) => [...assetState.current.keys()].filter((k) => k.startsWith("quick-notes/" + id + "/")),
  listAssetKeysFs: async () => [...assetState.current.keys()],
  removeNoteAssetsDirFs: async (noteId: string) => { for (const key of [...assetState.current.keys()]) if (key.startsWith(noteId + "/")) assetState.current.delete(key); },
  removeQuickNoteAssetsDirFs: async (id: string) => { for (const key of [...assetState.current.keys()]) if (key.startsWith("quick-notes/" + id + "/")) assetState.current.delete(key); },
}));

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, listTrashed, readNote, saveNote, trashNote } from "../data/noteRepository.js";
import { setBodyStoreBackendForTest, type BodyStoreBackend } from "../native/bodyStore.js";
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

const settings = { endpoint: "https://example.com", region: "cn-north-1", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "scn" };

interface MobileDev { db: SqlJsAsyncDb; backend: BodyStoreBackend; deviceId: string }
function fsBackend(dir: string): BodyStoreBackend {
  const abs = (rel: string): string => path.join(dir, rel);
  const backend: BodyStoreBackend = {
    async readText(rel) { try { return await fs.readFile(abs(rel), "utf8"); } catch { return null; } },
    async writeText(rel, text) { await fs.mkdir(path.dirname(abs(rel)), { recursive: true }); await fs.writeFile(abs(rel), text, "utf8"); return Buffer.byteLength(text); },
    async writeTextMany(items) { let bytes = 0; for (const i of items) { await fs.mkdir(path.dirname(abs(i.path)), { recursive: true }); await fs.writeFile(abs(i.path), i.text, "utf8"); bytes += Buffer.byteLength(i.text); } return bytes; },
    async readTextMany(paths) { return Promise.all(paths.map((p) => backend.readText(p))); },
    async statTextMany(paths) { return Promise.all(paths.map((p) => backend.stat(p))); },
    async remove(rel) { await fs.rm(abs(rel), { force: true }); },
    async stat(rel) { try { const st = await fs.stat(abs(rel)); return { exists: true, size: st.size }; } catch { return { exists: false, size: 0 }; } },
    async readSnapshot(rel) { return backend.readText(rel); },
    async writeSnapshot(rel, text) { return backend.writeText(rel, text); },
  };
  return backend;
}
async function mobileDevice(label: string): Promise<MobileDev> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-scn-m-" + label + "-"));
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return { db, backend: fsBackend(dir), deviceId: label };
}
/** 移动端正文后端是模块级全局 ⇒ 每次操作前切到该设备的后端（与 deviceConformance.mobile 同姿势）。 */
async function use<T>(dev: MobileDev, fn: () => Promise<T>): Promise<T> {
  setBodyStoreBackendForTest(dev.backend);
  return await fn();
}

describe("S3 场景矩阵 A 档 · 移动（MemoryRemote）", () => {
  it("S21 双端同时编辑同一篇：远端胜、两端最终一致且反复同步稳定", async () => {
    const remote = new MemoryRemote();
    const a = await mobileDevice("A");
    const b = await mobileDevice("B");
    await use(a, () => createNote(a.db, "m1", "Doc", "<p>v1</p>", null, new Map()));
    await use(a, () => runMobileV3Sync(a.db, settings, { remote, deviceId: "A", emptyCloud: "upload" }));
    await use(b, () => runMobileV3Sync(b.db, settings, { remote, deviceId: "B" }));

    // 两端同时编辑同一篇（B 后提交 ⇒ B 胜）
    await use(a, () => saveNote(a.db, "m1", "Doc", "<p>from-A</p>", null, new Map()));
    await use(b, () => saveNote(b.db, "m1", "Doc", "<p>from-B</p>", null, new Map()));
    for (let round = 0; round < 2; round += 1) {
      await use(a, () => runMobileV3Sync(a.db, settings, { remote, deviceId: "A" }));
      await use(b, () => runMobileV3Sync(b.db, settings, { remote, deviceId: "B" }));
    }
    const bodyA = (await use(a, () => readNote(a.db, "m1")))!.content;
    const bodyB = (await use(b, () => readNote(b.db, "m1")))!.content;
    expect(bodyA).toBe(bodyB);
    // 收敛后再跑一轮不得抖动
    await use(a, () => runMobileV3Sync(a.db, settings, { remote, deviceId: "A" }));
    await use(b, () => runMobileV3Sync(b.db, settings, { remote, deviceId: "B" }));
    expect((await use(a, () => readNote(a.db, "m1")))!.content).toBe(bodyA);
    await a.db.close(); await b.db.close();
  }, 120_000);

  it("S35 删除传播：A 移入回收站 → B 同步后回收站可见、正文仍在", async () => {
    const remote = new MemoryRemote();
    const a = await mobileDevice("A");
    const b = await mobileDevice("B");
    await use(a, () => createNote(a.db, "m2", "Doc", "<p>trash me</p>", null, new Map()));
    await use(a, () => runMobileV3Sync(a.db, settings, { remote, deviceId: "A", emptyCloud: "upload" }));
    await use(b, () => runMobileV3Sync(b.db, settings, { remote, deviceId: "B" }));

    await use(a, () => trashNote(a.db, "m2"));
    await use(a, () => runMobileV3Sync(a.db, settings, { remote, deviceId: "A" }));
    await use(b, () => runMobileV3Sync(b.db, settings, { remote, deviceId: "B" }));

    const trashedB = await use(b, () => listTrashed(b.db));
    expect(trashedB.some((n) => n.id === "m2")).toBe(true);
    expect((await use(b, () => readNote(b.db, "m2")))!.content).toBe("<p>trash me</p>");
    await a.db.close(); await b.db.close();
  }, 120_000);
});
