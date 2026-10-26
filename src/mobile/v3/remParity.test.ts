import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
const assetStore = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (k: string, b: Uint8Array) => { assetStore.set(k, new Uint8Array(b)); },
  loadAssetBytesFs: async (k: string) => assetStore.get(k) ?? null,
  removeAssetBytesFs: async (k: string) => { assetStore.delete(k); },
  listNoteAssetKeysFs: async (id: string) => [...assetStore.keys()].filter((k) => k.startsWith(id + "/")),
  listQuickNoteAssetKeysFs: async (id: string) => [...assetStore.keys()].filter((k) => k.startsWith("quick-notes/" + id + "/")),
  listAssetKeysFs: async () => [...assetStore.keys()],
}));
import { gunzipSync, gzipSync } from "node:zlib";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote } from "../data/noteRepository.js";
import { saveQuickNote } from "../data/quickNotesRepository.js";
import { readQuickNoteBody, writeQuickNoteBody } from "../data/noteBodies.js";
import { loadV3State, saveV3State } from "../data/v3StateRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { runMobileV3DeepCleanup, runMobileV3Sync } from "./sync.js";
import type { DeviceState } from "../../core/s3v3DeviceStore.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";

const enc = (s: string) => new TextEncoder().encode(s);
class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean; mtime?: number }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, { bytes: opts?.gzip ? new Uint8Array(gzipSync(Buffer.from(bytes))) : new Uint8Array(bytes), gzip: !!opts?.gzip, mtime: Date.now() }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, ...(o.mtime !== undefined ? { lastModified: o.mtime } : {}) })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of keys) this.objects.delete(k); return keys.length; }
  add(key: string, text: string, mtime?: number) { this.objects.set(key, { bytes: enc(text), gzip: false, ...(mtime !== undefined ? { mtime } : {}) }); }
}
const SETTINGS = { endpoint: "https://s3.example.com", region: "r", bucket: "b", accessKeyId: "k", secretAccessKey: "s", prefix: "p" };
async function fresh() { const db = new SqlJsAsyncDb(await SqlJsDb.open()); await applyMobileSchema(db); const store = new MobileDeviceStore(db); await store.init(); return { db, store }; }

describe("移动端 v3 云清理（parity：旧 manifest 路径恒 0）", () => {
  it("按 pointer/索引/声明算 keep 集：窗口内保留、窗口外删、历史引用保留", async () => {
    const remote = new MemoryRemote();
    const { db } = await fresh();
    await createNote(db, "n1", "Doc", "hello", null, new Map());
    assetStore.set("n1/a.png", enc("PNG-A"));
    await runMobileV3Sync(db, SETTINGS, { remote, emptyCloud: "upload" });
    const now = Date.now();
    remote.add("objects/orphan-" + "a".repeat(64) + ".lake", "old", now - 10 * 86400000);
    remote.add("objects/recent-" + "b".repeat(64) + ".lake", "recent", now);
    // 本机历史快照引用的附件（即使窗口=0 也必须保留）
    await db.prepare(
      "INSERT INTO note_history (note_id,file_path,content_hash,title,created_at,size,refs_json,ref_count) VALUES (?,?,?,?,?,?,?,?)"
    ).run("n1", "history/n1/x.body.gz", "c".repeat(64), "Doc", new Date().toISOString(), 1, JSON.stringify(["hist.png"]), 1);
    remote.add("assets/n1/hist.png", "HIST", now - 10 * 86400000);

    const manual = await runMobileV3DeepCleanup(db, SETTINGS, { remote, retentionDays: 0 });
    expect(manual.deleted).toContain("objects/orphan-" + "a".repeat(64) + ".lake");
    expect(manual.deleted).toContain("objects/recent-" + "b".repeat(64) + ".lake");
    expect(manual.deleted).not.toContain("assets/n1/hist.png");
    expect(manual.deleted).not.toContain("assets/n1/a.png");
    expect(remote.objects.has("assets/n1/hist.png")).toBe(true);
    expect(remote.objects.has("assets/n1/a.png")).toBe(true);
  }, 60_000);

  it("默认 7 天窗口：窗口内未引用对象不删", async () => {
    const remote = new MemoryRemote();
    const { db } = await fresh();
    await createNote(db, "n1", "Doc", "hello", null, new Map());
    await runMobileV3Sync(db, SETTINGS, { remote, emptyCloud: "upload" });
    remote.add("objects/recent-" + "d".repeat(64) + ".lake", "recent", Date.now());
    const r = await runMobileV3DeepCleanup(db, SETTINGS, { remote });
    expect(r.deleted).not.toContain("objects/recent-" + "d".repeat(64) + ".lake");
    expect(r.skippedRecent).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("移动端父目录兜底（C5）", () => {
  it("远端 parent 指向本机不存在的目录：落库时回落兜底笔记本，不写非法 parent", async () => {
    const { db, store } = await fresh();
    const state: DeviceState = {
      lake: { v: 3, space: "lake", notes: [{ id: "n1", title: "N", parentId: "missing-parent", sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: "a".repeat(64) }], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
      folders: [], intents: [], pending: [],
    };
    await store.saveState(state);
    const row = await db.prepare("SELECT parent_id FROM notes WHERE id=?").get("n1") as { parent_id: string | null };
    expect(row.parent_id).not.toBe("missing-parent");
    const parent = await db.prepare("SELECT id,node_type FROM folders WHERE id=?").get(row.parent_id) as { id: string; node_type: string } | undefined;
    expect(parent?.node_type).toBe("notebook");
  }, 60_000);
});

describe("移动端同步标记落盘（parity item 2：persistSyncMarkers）", () => {
  it("轻量落盘：v3_state 的 remotePurged/restorePending 与 DB cloud_deleted 同步清空", async () => {
    const { db, store } = await fresh();
    await createNote(db, "n1", "Doc", "hello", null, new Map());
    const side = await loadV3State(db);
    await saveV3State(db, { ...side, remotePurged: ["n1"], restorePending: ["n1"] });
    await db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id='n1'").run();
    await store.persistSyncMarkers({ remotePurged: [], restorePending: [] });
    const after = await loadV3State(db);
    expect(after.remotePurged).toEqual([]);
    expect(after.restorePending).toEqual([]);
    const row = await db.prepare("SELECT cloud_deleted FROM notes WHERE id='n1'").get() as { cloud_deleted: number };
    expect(row.cloud_deleted).toBe(0);
  }, 60_000);
});

describe("移动端小记冲突副本（C8）", () => {
  it("双端同改：远端胜出，本地版本归档为 quick 回收站新条目（正文可找回）", async () => {
    const remote = new MemoryRemote();
    const a = await fresh(); const b = await fresh();
    await saveQuickNote(a.db, "q1", "v1", []);
    await runMobileV3Sync(a.db, SETTINGS, { remote, emptyCloud: "upload" });
    await runMobileV3Sync(b.db, SETTINGS, { remote });
    // A 改并发布
    await writeQuickNoteBody("q1", "v2-from-a");
    await a.db.prepare("UPDATE quick_notes SET content_hash=?, updated_at=? WHERE id='q1'").run(
      (await import("../../core/sha256Sync.js")).sha256Sync(enc("v2-from-a")), new Date(Date.now() + 5000).toISOString());
    await runMobileV3Sync(a.db, SETTINGS, { remote });
    // B 本地也改（不发布）+ 更新行 hash/updatedAt
    await writeQuickNoteBody("q1", "v2-from-b");
    await b.db.prepare("UPDATE quick_notes SET content_hash=?, updated_at=? WHERE id='q1'").run(
      (await import("../../core/sha256Sync.js")).sha256Sync(enc("v2-from-b")), new Date(Date.now() + 6000).toISOString());
    await runMobileV3Sync(b.db, SETTINGS, { remote });
    // 归档副本：deleted_at 非空的新行，正文是 B 的本地版本
    const archived = await b.db.prepare("SELECT id,content_hash FROM quick_notes WHERE deleted_at IS NOT NULL").all() as Array<{ id: string; content_hash: string }>;
    expect(archived.length).toBeGreaterThanOrEqual(1);
    const archivedBody = await readQuickNoteBody(archived[0].id);
    expect(archivedBody ?? "").toContain("v2-from-b"); // 归档副本 = B 的本地版本
    const headBody = await readQuickNoteBody("q1");
    expect(headBody ?? "").toContain("v2-from-a"); // 原条目 = 远端胜出版本（先留档后覆盖）
  }, 60_000);
});

describe("移动端同步回执（结构化进度，item 6）", () => {
  it("runMobileV3Sync 暴露阶段回调（load-state/total）", async () => {
    const remote = new MemoryRemote();
    const { db } = await fresh();
    await createNote(db, "n1", "Doc", "hello", null, new Map());
    const phases: string[] = [];
    await runMobileV3Sync(db, SETTINGS, { remote, emptyCloud: "upload", onPhase: (phase) => phases.push(phase) });
    expect(phases).toContain("load-state");
    expect(phases).toContain("total");
  }, 60_000);
});