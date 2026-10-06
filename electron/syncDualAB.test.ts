/**
 * Step 5 双端 A/B：桌面 Controller（syncNowViaEngine）↔ 移动端（MemDb + syncEngine）共享同一 S3，
 * 模拟真实跨端同步（建笔记→A 同步→B 拉到→B 编辑→A 拉到→删除传播）。
 */
import { describe, expect, it } from "vitest";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Store } from "./store.js";
import { syncNowViaEngine, ensureTrashNoteAssets } from "./syncEngineController.js";
import type { ObjectStore } from "./s3Store.js";
import type { S3Settings } from "../src/core/syncUtils.js";
import { syncNow as engineSync, type S3Store, type SyncConfig, type SyncDbPort, type LocalNoteRow } from "../src/core/syncEngine.js";
import { sha256Sync } from "../src/core/sha256Sync.js";
import { isGzip } from "../src/core/syncUtils.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
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
  async putStream(key: string, _size: number, open: () => Promise<any>) {
    const stream = await open();
    if (!stream) return;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    this.map.set(this.full(key), Buffer.concat(chunks));
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
async log(m: string) { this.logs.push(m); }
async getNote(id: string) { return this.notes.get(id) ?? null; }
async getAllNotes() { return [...this.notes.values()]; }
async getSyncBase(id: string) { return this.bases.get(id) ?? null; }
async applyRemoteNote(note: any, content: string) {
    this.notes.set(note.id, { id: note.id, title: note.title, content, updatedAt: note.updatedAt, syncState: "synced", trashedAt: note.trashedAt ?? null, restorePendingAt: null, parentId: note.parentId ?? null, sortOrder: note.sortOrder ?? 0, isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, isConflict: !!note.isConflict });
  }
async applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, _dfp: string | null, pid: string | null, _so: number) {
    this.notes.set(id, { id, title, content, updatedAt: trashedAt, syncState: "synced", trashedAt, restorePendingAt: null, parentId: pid, sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false });
  }
async localTrashNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = new Date().toISOString(); n.syncState = "local"; } }
async localRestoreNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = null; n.restorePendingAt = new Date().toISOString(); n.syncState = "local"; } }
async applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) { n.syncState = "purged"; n.parentId = TRASH_NOTEBOOK_ID; n.trashedAt = new Date().toISOString(); } }
async rememberDeleted(note: any, _deletedAt: string) { this.deletedNotes.add(note.id); }
async applyRemoteNoteMeta(note: any) {
    const n = this.notes.get(note.id);
    if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = !!note.isConflict; n.icon = note.icon ?? null; n.isLocked = !!note.isLocked; n.lockedAt = note.lockedAt ?? null; }
  }
async applyRemoteLock(id: string, locked: boolean, lockedAt: string | null) { const n = this.notes.get(id); if (n) { n.isLocked = locked; n.lockedAt = lockedAt; } }
async markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null) {
    const n = this.notes.get(id); if (n) n.syncState = "synced";
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string) {
    const n = this.notes.get(id); if (!n) return;
    if (sha256Sync(new TextEncoder().encode(n.content)) !== expectedContentHash) return;
    n.syncState = "synced";
    this.bases.set(id, { contentHash: expectedContentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null) {
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async defaultNotebookId() { return "notebook-personal"; }
async importRemoteFolder(folder: any) { this.folders.set(folder.id, folder); }
async listFoldersForSync() {
    return [...this.folders.values()].filter((f: any) => f.id !== TRASH_NOTEBOOK_ID).map((f: any) => ({ id: f.id, title: f.title, parentId: f.parentId ?? null, sortOrder: f.sortOrder ?? 0, nodeType: f.nodeType ?? "group", icon: f.icon ?? null, updatedAt: f.updatedAt ?? "2026-01-01T00:00:00.000Z" }));
  }
async createHistorySnapshot(noteId: string, content: string) { this.history.push({ noteId, content }); }
  async saveAsset(noteId: string, filename: string, bytes: Uint8Array) { this.assets.set(noteId + "/" + filename, bytes); }
  async listLocalAssets(noteId: string) {
    const out: Array<{ filename: string; size: number; hash: string }> = [];
    const p = noteId + "/";
    for (const [k, b] of this.assets) { if (!k.startsWith(p)) continue; out.push({ filename: k.slice(p.length), size: b.length, hash: sha256Sync(b) }); }
    return out;
  }
  async readLocalAsset(noteId: string, filename: string) { return this.assets.get(noteId + "/" + filename) ?? null; }
async getLastSeenCommitId() { return this.lastSeenCommitId; }
async setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
async getLastTombstoneSig() { return this.lastTombstoneSig; }
async setLastTombstoneSig(sig: string) { this.lastTombstoneSig = sig; }
async tombstoneSignature() { return `${this.deletedNotes.size}:${[...this.deletedNotes].sort().at(-1) ?? ""}`; }
async hasLocalPendingNotes() { return [...this.notes.values()].some((n) => n.syncState !== "synced"); }
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
      await syncNowViaEngine(storeA, undefined, () => s3 as unknown as ObjectStore);
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      const bGot = await dbB.getNote(noteA.id);
      expect(bGot).not.toBeNull();
      expect(bGot!.title).toBe("A端建的笔记");
      const bRow = (await dbB.getNote(noteA.id))!;
      dbB.notes.set(noteA.id, { ...bRow, title: "B端改名", content: "<p>B编辑</p>", syncState: "local" });
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      await syncNowViaEngine(storeA, undefined, () => s3 as unknown as ObjectStore);
      const aGot = storeA.readNote(noteA.id);
      expect(aGot.title).toBe("B端改名");
      expect(aGot.content).toContain("B编辑");
      const r = await syncNowViaEngine(storeA, undefined, () => s3 as unknown as ObjectStore);
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
      await syncNowViaEngine(storeA, undefined, () => s3 as unknown as ObjectStore);
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      expect(dbB.getNote(noteA.id)).not.toBeNull();
      storeA.deleteTreeNode(noteA.id);
      await syncNowViaEngine(storeA, undefined, () => s3 as unknown as ObjectStore);
      await engineSync(CFG, s3 as unknown as S3Store, dbB);
      const bAfter = await dbB.getNote(noteA.id);
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

      await syncNowViaEngine(storeA, undefined, () => s3 as unknown as ObjectStore);
      let entry = (await readManifest()).notes.find((n: any) => n.id === noteA.id);
      expect((entry.assets ?? []).some((x: any) => x.filename === assetName)).toBe(true);

      // 编辑删除该引用 → 再同步，manifest 不应再挂回
      storeA.saveNote(noteA.id, "资源笔记", "<p>removed ref</p>");
      await syncNowViaEngine(storeA, undefined, () => s3 as unknown as ObjectStore);
      entry = (await readManifest()).notes.find((n: any) => n.id === noteA.id);
      expect((entry.assets ?? []).some((x: any) => x.filename === assetName)).toBe(false);
    } finally { rmSync(dirA, { recursive: true, force: true }); }
  });

  it("回收站惰性下载 + 恢复前强拉全量（桌面 store 全链路）", async () => {
    const s3 = new SharedS3();
    const dirA = mkdtempSync(path.join(tmpdir(), "lake-ab-lazy-a-"));
    const dirB = mkdtempSync(path.join(tmpdir(), "lake-ab-lazy-b-"));
    const assetName = "1786735000000_a1b2c3d4.png";
    const imgBytes = Buffer.from("img-bytes", "utf8");
    const remote = () => s3 as unknown as ObjectStore;
    try {
      const storeA = new Store(dirA);
      storeA.saveS3Settings(S3_CFG);
      const noteA = storeA.createNote("带图笔记");
      storeA.saveNote(noteA.id, "带图笔记", `<p>see ${assetName}</p>`);
      const assetDir = storeA.noteAssetsPathFor(noteA.id);
      fs.mkdirSync(assetDir, { recursive: true });
      fs.writeFileSync(path.join(assetDir, assetName), imgBytes);
      await syncNowViaEngine(storeA, undefined, remote);

      // A 删除 → 同步：回收站条目携带资源清单
      storeA.deleteTreeNode(noteA.id);
      await syncNowViaEngine(storeA, undefined, remote);

      // B（全新设备）同步 → 惰性：正文进回收站、资源不下载、声明元数据已记录
    const storeB = new Store(dirB);
    storeB.saveS3Settings(S3_CFG);
    const assetHash = sha256Sync(new Uint8Array(imgBytes));
    await syncNowViaEngine(storeB, undefined, remote);
      expect(fs.existsSync(path.join(storeB.noteAssetsPathFor(noteA.id), assetName))).toBe(false);
      expect(storeB.listDeclaredAssets(noteA.id)).toEqual([{ filename: assetName, size: imgBytes.length, hash: assetHash }]);

      // B 恢复 → 261006 B 方案：恢复立刻生效（不等网络），随后按需补拉缺失资源
      storeB.restoreTrashItem(noteA.id);
      expect(storeB.listTrash().some((t) => t.id === noteA.id)).toBe(false);
      const { warnings } = await ensureTrashNoteAssets(storeB, noteA.id, remote);
      expect(warnings).toEqual([]);
      expect(fs.existsSync(path.join(storeB.noteAssetsPathFor(noteA.id), assetName))).toBe(true);
      expect(fs.readFileSync(path.join(storeB.noteAssetsPathFor(noteA.id), assetName))).toEqual(imgBytes);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  it("护栏：关闭云同步 / 未配置 ⇒ 补拉入口一个字节都不碰网络（注入会抛错的 fetch 工厂）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lake-ab-offline-"));
    let touched = 0;
    const forbidden = () => { touched += 1; throw new Error("离线状态不应创建远端连接"); };
    try {
      const store = new Store(dir);
      const note = store.createNote("离线笔记");
      store.saveNote(note.id, "离线笔记", "<p>see 1786735000000_a1b2c3d4.png</p>");

      // ① 未配置 S3
      const a = await ensureTrashNoteAssets(store, note.id, forbidden);
      expect(a.skipped).toBe("unconfigured");

      // ② 配置了但关闭云同步（用户 261006：等同未配置 / 离线本地空间）
      store.saveS3Settings(S3_CFG);
      store.saveSyncSettings({ enabled: false, autoMode: "manual", autoIntervalMinutes: 15 });
      const b = await ensureTrashNoteAssets(store, note.id, forbidden);
      expect(b.skipped).toBe("offline");
      expect(b.warnings).toEqual([]);

      expect(touched).toBe(0);   // ← 关键：离线时远端工厂从未被调用
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureTrashNoteAssets：预览按需补拉缺失资源（不恢复、仍在回收站）", async () => {
    const s3 = new SharedS3();
    const dirA = mkdtempSync(path.join(tmpdir(), "lake-ab-prev-a-"));
    const dirB = mkdtempSync(path.join(tmpdir(), "lake-ab-prev-b-"));
    const assetName = "1786735000000_a1b2c3d4.png";
    const imgBytes = Buffer.from("preview-img", "utf8");
    const remote = () => s3 as unknown as ObjectStore;
    try {
      const storeA = new Store(dirA);
      storeA.saveS3Settings(S3_CFG);
      const noteA = storeA.createNote("预览笔记");
      storeA.saveNote(noteA.id, "预览笔记", `<p>see ${assetName}</p>`);
      const assetDir = storeA.noteAssetsPathFor(noteA.id);
      fs.mkdirSync(assetDir, { recursive: true });
      fs.writeFileSync(path.join(assetDir, assetName), imgBytes);
      await syncNowViaEngine(storeA, undefined, remote);
      storeA.deleteTreeNode(noteA.id);
      await syncNowViaEngine(storeA, undefined, remote);

      // B 全新设备惰性拉到回收站：资源缺失
      const storeB = new Store(dirB);
      storeB.saveS3Settings(S3_CFG);
      await syncNowViaEngine(storeB, undefined, remote);
      expect(fs.existsSync(path.join(storeB.noteAssetsPathFor(noteA.id), assetName))).toBe(false);

      // 预览按需补拉：资源下载但笔记仍在回收站（不恢复）
      const { warnings } = await ensureTrashNoteAssets(storeB, noteA.id, remote);
      expect(warnings).toEqual([]);
      expect(fs.existsSync(path.join(storeB.noteAssetsPathFor(noteA.id), assetName))).toBe(true);
      const bRow = storeB.listNotesForSync().find((n) => n.id === noteA.id);
      expect(bRow!.parentId).toBe(TRASH_NOTEBOOK_ID); // 仍在回收站
      expect(bRow!.trashedAt).not.toBeNull();
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

});
