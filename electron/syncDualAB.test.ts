/**
 * Step 5 双端 A/B：桌面 Controller（syncNowViaEngine）↔ 移动端（MemDb + syncEngine）共享同一 S3，
 * 模拟真实跨端同步（建笔记→A 同步→B 拉到→B 编辑→A 拉到→删除传播）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { syncNowViaEngine } from "./syncEngineController.js";
import type { ObjectStore, S3Settings } from "./sync.js";
import { syncNow as engineSync, type S3Store, type SyncConfig, type SyncDbPort, type LocalNoteRow } from "../src/core/syncEngine.js";
import { sha256Sync } from "../src/core/sha256Sync.js";
import { isGzip } from "../src/core/syncUtils.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));

const S3_CFG: S3Settings = { endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "ab", prefix: "ab-test", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false };
const CFG: SyncConfig = { endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "ab", accessKeyId: "ak", secretAccessKey: "sk", prefix: "ab-test" };

/** 共享内存 S3（真 S3 语义：map 存含 prefix 的 key）。
 * ObjectStore 侧接口（桌面 adapter 转发）收到无 prefix key，内部加 prefix；S3Store 侧（syncEngine）收到含 prefix key 直接用。 */
class SharedS3 {
  map = new Map<string, Buffer>();
  private full(k: string): string { return k.startsWith("ab-test/") ? k : "ab-test/" + k; }
  async test() {}
  async getOptional(key: string, opts?: { maxBytes?: number }) {
    let b = this.map.get(this.full(key));
    if (!b) return null;
    if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
    if (opts?.maxBytes && b.length > opts.maxBytes) return null;
    return b;
  }
  async put(key: string, bytes: Buffer, _ct: string, opts?: { gzip?: boolean }) {
    this.map.set(this.full(key), opts?.gzip ? zlib.gzipSync(bytes) : bytes);
  }
  async list(prefix: string) {
    const p = this.full(prefix);
    return [...this.map.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key, lastModified: "" }));
  }
  async delete(key: string) { this.map.delete(this.full(key)); }
  async deleteMany(keys: string[]) { for (const k of keys) this.map.delete(this.full(k)); }
  async deletePrefix(prefix: string) {
    const p = this.full(prefix);
    const ks = [...this.map.keys()].filter((k) => k.startsWith(p));
    for (const k of ks) this.map.delete(k);
    return ks.length;
  }
  // S3Store 侧（syncEngine 端口）：key 已含 prefix，直接用
  async getObject(key: string, opts?: { maxBytes?: number }) {
    const b = this.map.get(key);
    if (!b) return null;
    const bytes = isGzip(b) ? zlib.gunzipSync(b) : b;
    if (opts?.maxBytes && bytes.length > opts.maxBytes) return null;
    return new Uint8Array(bytes);
  }
  async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }) {
    const b = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
    this.map.set(key, opts?.gzip ? zlib.gzipSync(b) : b);
  }
}

/** 移动端 MemDb（与 syncEngine.test.ts 同构） */
class MemDb implements SyncDbPort {
  notes = new Map<string, LocalNoteRow>();
  bases = new Map<string, { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null }>();
  folders = new Map<string, any>();
  deletedNotes = new Set<string>();
  history: Array<{ noteId: string; content: string }> = [];
  assets = new Map<string, Uint8Array>();
  lastSeenCommitId: string | null = null;
  lastTombstoneSig = "";
  logs: string[] = [];
  log(m: string) { this.logs.push(m); }
  getNote(id: string) { return this.notes.get(id) ?? null; }
  getAllNotes() { return [...this.notes.values()]; }
  getSyncBase(id: string) { return this.bases.get(id) ?? null; }
  applyRemoteNote(note: any, content: string) {
    this.notes.set(note.id, { id: note.id, title: note.title, content, updatedAt: note.updatedAt, syncState: "synced", trashedAt: note.trashedAt ?? null, restorePendingAt: null, parentId: note.parentId ?? null, sortOrder: note.sortOrder ?? 0, isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, isConflict: !!note.isConflict });
  }
  applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, _dfp: string | null, pid: string | null, _so: number) {
    this.notes.set(id, { id, title, content, updatedAt: trashedAt, syncState: "synced", trashedAt, restorePendingAt: null, parentId: pid, sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false });
  }
  localTrashNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = new Date().toISOString(); n.syncState = "local"; } }
  localRestoreNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = null; n.restorePendingAt = new Date().toISOString(); n.syncState = "local"; } }
  applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) { n.syncState = "purged"; n.parentId = TRASH_NOTEBOOK_ID; n.trashedAt = new Date().toISOString(); } }
  rememberDeleted(note: any, _deletedAt: string) { this.deletedNotes.add(note.id); }
  applyRemoteNoteMeta(note: any) {
    const n = this.notes.get(note.id);
    if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = !!note.isConflict; n.icon = note.icon ?? null; n.isLocked = !!note.isLocked; n.lockedAt = note.lockedAt ?? null; }
  }
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null) { const n = this.notes.get(id); if (n) { n.isLocked = locked; n.lockedAt = lockedAt; } }
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null) {
    const n = this.notes.get(id); if (n) n.syncState = "synced";
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string) {
    const n = this.notes.get(id); if (!n) return;
    if (sha256Sync(new TextEncoder().encode(n.content)) !== expectedContentHash) return;
    n.syncState = "synced";
    this.bases.set(id, { contentHash: expectedContentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null) {
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  defaultNotebookId() { return "notebook-personal"; }
  importRemoteFolder(folder: any) { this.folders.set(folder.id, folder); }
  listFoldersForSync() {
    return [...this.folders.values()].filter((f: any) => f.id !== TRASH_NOTEBOOK_ID).map((f: any) => ({ id: f.id, title: f.title, parentId: f.parentId ?? null, sortOrder: f.sortOrder ?? 0, nodeType: f.nodeType ?? "group", icon: f.icon ?? null, updatedAt: f.updatedAt ?? "2026-01-01T00:00:00.000Z" }));
  }
  createHistorySnapshot(noteId: string, content: string) { this.history.push({ noteId, content }); }
  async saveAsset(noteId: string, filename: string, bytes: Uint8Array) { this.assets.set(noteId + "/" + filename, bytes); }
  async listLocalAssets(noteId: string) {
    const out: Array<{ filename: string; size: number; hash: string }> = [];
    const p = noteId + "/";
    for (const [k, b] of this.assets) { if (!k.startsWith(p)) continue; out.push({ filename: k.slice(p.length), size: b.length, hash: sha256Sync(b) }); }
    return out;
  }
  async readLocalAsset(noteId: string, filename: string) { return this.assets.get(noteId + "/" + filename) ?? null; }
  getLastSeenCommitId() { return this.lastSeenCommitId; }
  setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
  getLastTombstoneSig() { return this.lastTombstoneSig; }
  setLastTombstoneSig(sig: string) { this.lastTombstoneSig = sig; }
  tombstoneSignature() { return `${this.deletedNotes.size}:${[...this.deletedNotes].sort().at(-1) ?? ""}`; }
  hasLocalPendingNotes() { return [...this.notes.values()].some((n) => n.syncState !== "synced"); }
}

describe("Step 5 双端 A/B（桌面 Controller ↔ 移动端 syncEngine 同 S3）", () => {
  it("A 建笔记同步 → B 拉到 → B 编辑同步 → A 拉到 → 两端收敛", async () => {
    const s3 = new SharedS3();
    const dirA = mkdtempSync(path.join(tmpdir(), "lake-ab-a-"));
    const dbB = new MemDb();
    dbB.folders.set("notebook-personal", { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    try {
      const storeA = new Store(dirA);
      storeA.saveS3Settings(S3_CFG);
      const noteA = storeA.createNote("A端建的笔记");
      await syncNowViaEngine(storeA, undefined, (s: S3Settings, l: any) => s3 as unknown as ObjectStore);
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      const bGot = dbB.getNote(noteA.id);
      expect(bGot).not.toBeNull();
      expect(bGot!.title).toBe("A端建的笔记");
      const bRow = dbB.getNote(noteA.id)!;
      dbB.notes.set(noteA.id, { ...bRow, title: "B端改名", content: "<p>B编辑</p>", syncState: "local" });
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      await syncNowViaEngine(storeA, undefined, (s: S3Settings, l: any) => s3 as unknown as ObjectStore);
      const aGot = storeA.readNote(noteA.id);
      expect(aGot.title).toBe("B端改名");
      expect(aGot.content).toContain("B编辑");
      const r = await syncNowViaEngine(storeA, undefined, (s: S3Settings, l: any) => s3 as unknown as ObjectStore);
      expect(r.uploaded).toBe(0);
    } finally { rmSync(dirA, { recursive: true, force: true }); }
  });

  it("A 删除同步 → B 跟随删除（墓碑传播）", async () => {
    const s3 = new SharedS3();
    const dirA = mkdtempSync(path.join(tmpdir(), "lake-ab-del-"));
    const dbB = new MemDb();
    dbB.folders.set("notebook-personal", { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    try {
      const storeA = new Store(dirA);
      storeA.saveS3Settings(S3_CFG);
      const noteA = storeA.createNote("将被删除");
      await syncNowViaEngine(storeA, undefined, (s: S3Settings, l: any) => s3 as unknown as ObjectStore);
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      expect(dbB.getNote(noteA.id)).not.toBeNull();
      storeA.deleteTreeNode(noteA.id);
      await syncNowViaEngine(storeA, undefined, (s: S3Settings, l: any) => s3 as unknown as ObjectStore);
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      const bAfter = dbB.getNote(noteA.id);
      expect(bAfter).not.toBeNull();
      expect(bAfter!.trashedAt).not.toBeNull();
    } finally { rmSync(dirA, { recursive: true, force: true }); }
  });
  it("A 方案：桌面 store declared_assets 经引擎上传→正文引用保留/删除引用不再挂回", async () => {
    const s3 = new SharedS3();
    const dirA = mkdtempSync(path.join(tmpdir(), "lake-ab-declared-"));
    const assetName = "1234567890123_a1b2c3d4.png";
    const validHash = "ab".repeat(32);
    const readManifest = async () => {
      const bytes = await s3.getObject("ab-test/manifests/latest.json");
      return JSON.parse(decode(bytes!));
    };
    try {
      const storeA = new Store(dirA);
      storeA.saveS3Settings(S3_CFG);
      const noteA = storeA.createNote("资源笔记");
      storeA.saveNote(noteA.id, "资源笔记", `<p>see ${assetName}</p>`);
      // 模拟「本地文件缺失，但 manifest 曾声明过该资源元数据」
      storeA.recordDeclaredAssets(noteA.id, [{ filename: assetName, size: 200, hash: validHash }]);

      await syncNowViaEngine(storeA, undefined, (s: S3Settings, l: any) => s3 as unknown as ObjectStore);
      let entry = (await readManifest()).notes.find((n: any) => n.id === noteA.id);
      expect((entry.assets ?? []).some((x: any) => x.filename === assetName)).toBe(true);

      // 编辑删除该引用 → 再同步，manifest 不应再挂回
      storeA.saveNote(noteA.id, "资源笔记", "<p>removed ref</p>");
      await syncNowViaEngine(storeA, undefined, (s: S3Settings, l: any) => s3 as unknown as ObjectStore);
      entry = (await readManifest()).notes.find((n: any) => n.id === noteA.id);
      expect((entry.assets ?? []).some((x: any) => x.filename === assetName)).toBe(false);
    } finally { rmSync(dirA, { recursive: true, force: true }); }
  });

});