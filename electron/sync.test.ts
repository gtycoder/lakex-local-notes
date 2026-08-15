import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncNow, testConnection, ObjectStore, runGcReconcile, runDeepCleanup } from "./sync.js";
import type { Store } from "./store.js";

// ===== 内存 S3 mock（ObjectStore 依赖的 @aws-sdk/client-s3 命令子集） =====
const s3 = vi.hoisted(() => ({
  bucket: new Map<string, Buffer>(),
  puts: [] as string[],
  reset() { this.bucket.clear(); this.puts.length = 0; },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Command {
    constructor(public input: Record<string, unknown>) {}
  }
  class HeadBucketCommand extends S3Command {}
  class GetObjectCommand extends S3Command {}
  class PutObjectCommand extends S3Command {}
  class ListObjectsV2Command extends S3Command {}
  class DeleteObjectCommand extends S3Command {}
  class DeleteObjectsCommand extends S3Command {}
  class S3Client {
    async send(command: S3Command) {
      if (command instanceof HeadBucketCommand) return {};
      if (command instanceof GetObjectCommand) {
        const key = command.input.Key as string;
        const bytes = s3.bucket.get(key);
        if (!bytes) {
          const err = new Error(`NoSuchKey: ${key}`);
          (err as { name: string }).name = "NoSuchKey";
          throw err;
        }
        return { Body: { transformToByteArray: async () => bytes } };
      }
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key as string;
        s3.bucket.set(key, Buffer.from(command.input.Body as Buffer));
        s3.puts.push(key);
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix as string;
        const contents = [...s3.bucket.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort()
          .map((k) => ({ Key: k, LastModified: new Date(0) }));
        return { Contents: contents };
      }
      if (command instanceof DeleteObjectCommand) {
        const key = command.input.Key as string;
        if (!s3.bucket.has(key)) {
          const err = new Error(`NoSuchKey: ${key}`);
          (err as { name: string }).name = "NoSuchKey";
          throw err;
        }
        s3.bucket.delete(key);
        return {};
      }
      if (command instanceof DeleteObjectsCommand) {
        const objects = (command.input.Delete as { Objects?: Array<{ Key: string }> }).Objects ?? [];
        for (const obj of objects) s3.bucket.delete(obj.Key);
        return { Deleted: objects.map((obj) => ({ Key: obj.Key })), Errors: [] };
      }
      throw new Error(`未知命令: ${command.constructor.name}`);
    }
  }
  return { S3Client, HeadBucketCommand, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteObjectsCommand };
});

// ===== 本地类型（与 sync.ts 内部结构一致，避免引入 Electron/原生依赖） =====
interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}
interface ManifestNote {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; contentHash: string; isConflict: boolean;
  assets: { filename: string; size: number; hash: string }[];
  deleted?: boolean; deletedAt?: string;
  isLocked?: boolean; lockedAt?: string | null;
}
interface Manifest {
  version: number; workspaceId: string; commitId: string; createdAt: string; notes: ManifestNote[];
}

const SETTINGS: S3Settings = {
  endpoint: "https://s3.cn-north-1.example.com", region: "cn-north-1", bucket: "test-bucket",
  prefix: "lake-notes", accessKeyId: "test-ak", secretAccessKey: "test-sk", forcePathStyle: true,
};
const key = (suffix: string) => `lake-notes/${suffix}`;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function maybeGunzip(bytes: Buffer): Buffer {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes;
}
function readManifest(): Manifest {
  const raw = s3.bucket.get(key("manifests/latest.json"));
  if (!raw) throw new Error("测试前置失败：远端清单不存在");
  return JSON.parse(maybeGunzip(raw).toString("utf8"));
}
function writeManifest(manifest: Manifest): void {
  s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify(manifest), "utf8"));
}

// ===== FakeStore：实现 sync.ts 用到的 Store 子集（内存态 + 临时文件） =====
class FakeStore {
  settings: S3Settings | null = null;
  notes = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; syncState: string; isConflict: boolean; isLocked?: boolean; lockedAt?: string | null }>();
  /** 测试探针：contentHash（读 .lake）被调用的次数，用于断言"跳过扫描"生效。 */
  hashReads = 0;
  deleted = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string }>();
  baseHashes = new Map<string, string>();
  lastUploadedHashes = new Map<string, string>();
  pendingSync = new Set<string>();
  gcPending = new Map<string, string>();
  purgedNotes = new Map<string, string>();
  currentRefs = new Map<string, Set<string>>();
  historySnapshots: string[] = [];
  orphans = new Set<string>();
  syncedAt: string | null = null;
  lastResult: unknown = null;
  private dir: string;

  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-sync-test-"));
    fs.mkdirSync(path.join(this.dir, "notes"), { recursive: true });
  }
  private notePath(id: string) { return path.join(this.dir, "notes", `${id}.lake`); }

  // ---- 测试辅助 ----
  createNote(id: string, title: string, content: string) {
    const updatedAt = new Date().toISOString();
    this.notes.set(id, { id, title, parentId: null, sortOrder: this.notes.size, updatedAt, syncState: "local", isConflict: false });
    fs.writeFileSync(this.notePath(id), content, "utf8");
  }
  modifyNote(id: string, content: string) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`笔记不存在: ${id}`);
    n.updatedAt = new Date().toISOString();
    n.syncState = "local";
    fs.writeFileSync(this.notePath(id), content, "utf8");
  }
  addAsset(noteId: string, filename: string, bytes: Buffer) {
    const dir = path.join(this.dir, "note-assets", noteId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), bytes);
  }

  // ---- Store 接口子集 ----
  getS3Settings() { return this.settings; }
  saveS3Settings(settings: S3Settings) { this.settings = settings; }
  listNotesForSync() { return [...this.notes.values()].map((n) => ({ ...n })); }
  listDeletedNotesForSync() { return [...this.deleted.values()].map((d) => ({ ...d })); }
  folders = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; nodeType: "notebook" | "group"; icon: string | null; updatedAt: string }>();
  listFoldersForSync() { return [...this.folders.values()]; }
  importRemoteFolder(folder: { id: string; title: string; parentId: string | null; sortOrder: number; nodeType: "notebook" | "group"; icon: string | null; updatedAt: string }) { this.folders.set(folder.id, folder); }
  defaultNotebookId() { return "notebook-personal"; }
  hasTreeNode(id: string) { return id === "notebook-personal" || this.folders.has(id) || this.notes.has(id); }
  applyRemoteNoteMeta(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean }) {
    const n = this.notes.get(note.id);
    if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = note.isConflict; }
  }
  contentHash(id: string) { this.hashReads += 1; return crypto.createHash("sha256").update(fs.readFileSync(this.notePath(id))).digest("hex"); }
  notePathFor(id: string) { return this.notePath(id); }
  noteAssetsPathFor(id: string) { return path.join(this.dir, "note-assets", id); }
  listOrphanAssets() {
    return [...this.orphans].map((fileKey) => {
      const [noteId, filename] = fileKey.split("/");
      return { id: 0, noteId, filename, filePath: "", size: 0, mimeType: "", detectedAt: "" };
    });
  }
  baseHash(id: string) { return this.baseHashes.get(id) ?? null; }
  setBaseHash(id: string, hash: string) { this.baseHashes.set(id, hash); }
  // P0-1：last_uploaded_hash（本机最后一次上传的 hash）
  lastUploadedHash(id: string) { return this.lastUploadedHashes.get(id) ?? null; }
  setLastUploadedHash(id: string, hash: string) { this.lastUploadedHashes.set(id, hash); }
  // 历史快照（sync 接受远端时强制留档；FakeStore 用内存记录）
  createHistorySnapshot(noteId: string, _content?: string, _force?: boolean) {
    this.historySnapshots = this.historySnapshots || [];
    this.historySnapshots.push(noteId);
    return this.historySnapshots.length;
  }
  markSynced(id?: string) {
    if (id) {
      this.pendingSync.delete(id); this.restorePending.delete(id);
      const n = this.notes.get(id); if (n) n.syncState = "synced";
    }
  }
  isSyncPending(id: string) { return this.pendingSync.has(id); }
  markLocal(id: string) { this.pendingSync.add(id); }
  restorePending = new Set<string>();
  /** 模拟真实 restoreTrashItem 的显式恢复标记（墓碑权威的唯一例外）。 */
  markRestorePending(id: string) { this.restorePending.add(id); this.markLocal(id); }
  isRestorePending(id: string) { return this.restorePending.has(id); }
  getProtectedRefs(noteId: string) { return new Set(this.currentRefs.get(noteId) ?? []); }
  getCurrentContentRefs(noteId: string) {
    if (this.currentRefs.has(noteId)) return new Set(this.currentRefs.get(noteId)!);
    const dir = this.noteAssetsPathFor(noteId);
    return new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : []);
  }
  setCurrentRefs(noteId: string, refs: string[]) { this.currentRefs.set(noteId, new Set(refs)); }
  addS3GcPending(key: string, markedAt = new Date().toISOString()) { if (!this.gcPending.has(key)) this.gcPending.set(key, markedAt); }
  removeS3GcPending(keys: string[]) { for (const key of keys) this.gcPending.delete(key); }
  listS3GcPending() { return [...this.gcPending.entries()].map(([key, markedAt]) => ({ key, markedAt })); }
  getS3GcSettings() { return { gcRetentionDays: 7, gcIntervalHours: 24, trashAutoPurgeDays: 0 }; }
  listNoteIdsWithHistory() { return [...new Set(this.historySnapshots ?? [])]; }
  gcLog: Array<Record<string, unknown>> = [];
  recordS3GcLog(action: string, key: string, reason: string, commitId: string | null, deviceId: string | null, ok: boolean) {
    this.gcLog.push({ action, key, reason, commitId, deviceId, ok });
  }
  markPurged(id: string) { this.purgedNotes.set(id, new Date().toISOString()); }
  markPurgeSynced(id: string) { this.purgedNotes.delete(id); }
  listPurgedNotesForSync() {
    return [...this.purgedNotes.entries()].map(([id, purgedAt]) => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: purgedAt, deletedAt: purgedAt, purgedAt }));
  }
  setNoteLocked(id: string, locked: boolean) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`笔记不存在: ${id}`);
    n.isLocked = locked;
    n.lockedAt = new Date().toISOString();
  }
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null) {
    const n = this.notes.get(id);
    if (!n) return;
    n.isLocked = locked;
    n.lockedAt = lockedAt;
  }
  importRemoteNote(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean }, content: Buffer, assets: { filename: string; bytes: Buffer }[]) {
    fs.writeFileSync(this.notePath(note.id), content, "utf8");
    if (assets.length > 0) {
      const dir = path.join(this.dir, "note-assets", note.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const asset of assets) fs.writeFileSync(path.join(dir, asset.filename), asset.bytes);
    }
    this.notes.set(note.id, { ...note, syncState: "synced" });
  }
  rememberDeleted(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string }, deletedAt: string) {
    this.deleted.set(note.id, { id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder, updatedAt: note.updatedAt, deletedAt });
  }
  deleteTreeNode(id: string) {
    const n = this.notes.get(id);
    if (n) {
      // 与真实 Store 一致：删除时记录墓碑
      this.deleted.set(id, { id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt, deletedAt: new Date().toISOString() });
      this.notes.delete(id);
    }
    // 真实 Store 软删保留 .lake / 资源文件（回收站可恢复 + 墓碑回写可读内容算真实 hash），
    // 因此这里不再物理删除文件。
  }
  /** 模拟真实 restoreTrashItem：从墓碑读回 + 写回内容 + 清墓碑 + 标 local 待上传。
   * FakeStore 的 deleteTreeNode 会物理删除文件，因此需要显式提供恢复后的内容。 */
  restoreTrashItem(id: string, content?: string) {
    const d = this.deleted.get(id);
    if (!d) throw new Error(`无墓碑: ${id}`);
    // 优先读软删保留的 .lake（真实 Store 行为：恢复 = 回收站保留版本）；
    // 无文件时才用调用方传入的 content 兜底。
    let body = content;
    if (body === undefined) {
      try { body = fs.readFileSync(this.notePath(id), "utf8"); }
      catch { body = `<p>${d.title}</p>`; }
    }
    this.notes.set(id, { id, title: d.title, parentId: d.parentId, sortOrder: d.sortOrder, updatedAt: new Date().toISOString(), syncState: "local", isConflict: false });
    fs.writeFileSync(this.notePath(id), body, "utf8");
    this.deleted.delete(id);
    this.markRestorePending(id);
  }
  /** 模拟真实 revokeLocalDeletion：撤销本地删除墓碑（远端恢复较新，下载分支调用）。 */
  revokeLocalDeletion(id: string) {
    this.deleted.delete(id);
  }
  pruneTombstones(ids: string[]) { for (const id of ids) this.deleted.delete(id); }
  markSyncComplete(at: string) { this.syncedAt = at; }
  recordSyncResult(json: string) { this.lastResult = JSON.parse(json); }
}

function newStore(): FakeStore {
  const store = new FakeStore();
  store.saveS3Settings(SETTINGS);
  return store;
}

describe("syncNow 增量同步", () => {
  beforeEach(() => s3.reset());

  it("首次同步上传本地笔记并写入清单；二次同步幂等（0/0）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    const r1 = await syncNow(store as unknown as Store);
    expect(r1.uploaded).toBe(1);
    expect(r1.downloaded).toBe(0);
    expect(r1.conflicts).toBe(0);
    expect(s3.bucket.has(key(`objects/n1-${store.contentHash("n1")}.lake`))).toBe(true);
    const manifest = readManifest();
    expect(manifest.version).toBe(4);
    expect(manifest.notes).toHaveLength(1);
    expect(manifest.notes[0].contentHash).toBe(store.contentHash("n1"));

    const r2 = await syncNow(store as unknown as Store);
    expect(r2.uploaded).toBe(0);
    expect(r2.downloaded).toBe(0);
    expect(r2.conflicts).toBe(0);
  });

  it("远端新增笔记时下载到本地（含 .lake 与资源）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    await syncNow(store as unknown as Store);

    // 模拟另一台设备新增 n2：上传对象 + 更新清单
    const n2Content = "<p>remote content</p>";
    const n2Hash = sha256(n2Content);
    s3.bucket.set(key(`objects/n2-${n2Hash}.lake`), Buffer.from(n2Content, "utf8"));
    const manifest = readManifest();
    manifest.notes.push({
      id: "n2", title: "远端笔记", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: n2Hash, isConflict: false,
      assets: [{ filename: "img.png", size: 3, hash: sha256("img") }],
    });
    writeManifest(manifest);
    s3.bucket.set(key("assets/n2/img.png"), Buffer.from("img", "utf8"));

    const r = await syncNow(store as unknown as Store);
    expect(r.downloaded).toBe(1);
    expect(store.notes.has("n2")).toBe(true);
    expect(fs.readFileSync(store.notePathFor("n2"), "utf8")).toBe(n2Content);
    expect(fs.readFileSync(path.join(store.noteAssetsPathFor("n2"), "img.png"), "utf8")).toBe("img");
  });

  it("远端是其他设备改的 → 接受远端最新，不产生冲突副本（历史兜底，P0-1 既定方案）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    // 本机最后上传 = v1（last_uploaded_hash=v1）

    // 本地改 v2 local（未上传）
    store.modifyNote("n1", "<p>v2 local</p>");
    // 远端被其他设备改成 v2 remote（≠ last_uploaded_hash v1 → 非本机传的）
    const remoteHash = sha256("<p>v2 remote</p>");
    s3.bucket.set(key(`objects/n1-${remoteHash}.lake`), Buffer.from("<p>v2 remote</p>", "utf8"));
    const manifest = readManifest();
    manifest.notes[0].contentHash = remoteHash;
    writeManifest(manifest);

    const r = await syncNow(store as unknown as Store);
    expect(r.conflicts).toBe(0); // 不产生冲突副本
    // 接受远端最新：本地文件被 v2 remote 覆盖
    expect(fs.readFileSync(store.notePathFor("n1"), "utf8")).toBe("<p>v2 remote</p>");
    // 同步基线更新到远端
    expect(store.baseHash("n1")).toBe(remoteHash);
    // 本地被覆盖前强制留档 + supersededNotes 记录（UI 提醒用）
    expect(store.historySnapshots).toContain("n1");
    expect(r.supersededNotes.some((n) => n.id === "n1")).toBe(true);
  });

  it("本地已同步（相对基线无改动）但远端被其他设备改 → 接受远端，当前版本也强制留档 + superseded", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    // 本机上传 v1：last_uploaded_hash=v1、base=v1；本地此后没有任何编辑（localChanged=false）

    // 远端被其他设备改成 v2 remote（≠ last_uploaded_hash v1 → 非本机传的）
    const remoteHash = sha256("<p>v2 remote</p>");
    s3.bucket.set(key(`objects/n1-${remoteHash}.lake`), Buffer.from("<p>v2 remote</p>", "utf8"));
    const manifest = readManifest();
    manifest.notes[0].contentHash = remoteHash;
    writeManifest(manifest);

    const r = await syncNow(store as unknown as Store);
    expect(r.conflicts).toBe(0);
    // 接受远端最新：本地文件被 v2 remote 覆盖
    expect(fs.readFileSync(store.notePathFor("n1"), "utf8")).toBe("<p>v2 remote</p>");
    expect(store.baseHash("n1")).toBe(remoteHash);
    // 关键：即使本地相对基线无改动（A 上传后未再编辑），被覆盖前也必须留档 + 提示 superseded，
    // 否则 A 的当前版本（v1）被静默丢弃（A/B 联调发现：恢复快照→他端同步覆盖→本地丢改动）
    expect(store.historySnapshots).toContain("n1");
    expect(r.supersededNotes.some((n) => n.id === "n1")).toBe(true);
  });

  it("远端是本机传的 → 本地为准，上传覆盖（P0-1 既定方案）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    // 本机上传 v1 → last_uploaded_hash=v1

    // 本机改 v2 local（未上传）
    store.modifyNote("n1", "<p>v2 local</p>");
    // 远端仍 = v1（== last_uploaded_hash → 本机传的），但 base 已更新为 v1（一致）
    // 模拟"本地改了但远端还是本机最后上传的"：直接改远端 manifest 为 v1 对应旧状态
    // （实际上 syncNow 上传阶段会把 v2 local 传上去；这里验证冲突判定分支）
    const r = await syncNow(store as unknown as Store);
    // 本地为准：上传 v2 local，远端 manifest 更新为 v2 local hash
    const finalManifest = readManifest();
    expect(finalManifest.notes.find((n) => n.id === "n1")!.contentHash).toBe(store.contentHash("n1"));
    expect(r.conflicts).toBe(0);
    expect(store.lastUploadedHash("n1")).toBe(store.contentHash("n1"));
  });

  it("本地删除后云端标记 deleted；墓碑保留且标记跨次同步持续（防复活）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.createNote("n2", "笔记B", "<p>b</p>");
    await syncNow(store as unknown as Store);

    store.deleteTreeNode("n2");
    expect(store.listDeletedNotesForSync()).toHaveLength(1);

    const r = await syncNow(store as unknown as Store);
    expect(r.downloaded).toBe(0);
    const manifest = readManifest();
    expect(manifest.notes.find((n) => n.id === "n2")?.deleted).toBe(true);
    // 墓碑不剪除：再同步一次，deleted 标记仍必须存在（离线设备上线时才能正确删除）
    await syncNow(store as unknown as Store);
    const manifest2 = readManifest();
    expect(manifest2.notes.find((n) => n.id === "n2")?.deleted).toBe(true);
    expect(store.listDeletedNotesForSync()).toHaveLength(1); // 墓碑保留
    expect(store.notes.has("n2")).toBe(false);
  });

  it("审计#1：正文未变化时连续同步，manifest 资源清单不丢失（修复 assets 清空）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.addAsset("n1", "img1.png", Buffer.from("png-bytes", "utf8"));
    await syncNow(store as unknown as Store);
    expect(readManifest().notes[0].assets).toHaveLength(1);

    // 正文不变，第二次同步：assets 必须仍在 manifest 中（旧实现会变 [])
    await syncNow(store as unknown as Store);
    const manifest = readManifest();
    expect(manifest.notes[0].assets).toHaveLength(1);
    expect(manifest.notes[0].assets[0]).toMatchObject({ filename: "img1.png", size: 9, hash: sha256("png-bytes") });
  });

  it("审计#2：设备A删除并多次同步后，离线设备C上线不复活已删笔记", async () => {
    // 设备 A：创建并同步
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    // 设备 B：同步到 n1
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    // 设备 A：删除 + 同步两次（墓碑保留策略下 deleted 标记持续存在）
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // 设备 C（离线后上线）：不得恢复 n1
    const storeC = newStore();
    await syncNow(storeC as unknown as Store);
    expect(storeC.notes.has("n1")).toBe(false);
    // C 同步后本地留存学到的墓碑，且 manifest 仍保留 deleted 标记（不复活）
    expect(storeC.listDeletedNotesForSync()).toHaveLength(1);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // A 设备清空（模拟重装）：C 仍持有墓碑，标记不丢
    const storeA2 = newStore();
    await syncNow(storeA2 as unknown as Store);
    expect(storeA2.notes.has("n1")).toBe(false);
  });

  it("审计#3：恶意 manifest 的 note.id / asset.filename 目录穿越被拒绝", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);

    // 恶意 note.id（../ 逃逸）
    const manifest = readManifest();
    manifest.notes.push({
      id: "../../evil", title: "evil", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>evil</p>"), isConflict: false,
      assets: [],
    });
    writeManifest(manifest);
    s3.bucket.set(key(`objects/../../evil-${sha256("<p>evil</p>")}.lake`), Buffer.from("<p>evil</p>", "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/无效的笔记 ID|无效的资源文件名|无效/);

    // 恶意 asset.filename（../ 逃逸）
    const manifest2 = readManifest();
    manifest2.notes[0] = {
      id: "evil2", title: "evil2", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>evil2</p>"), isConflict: false,
      assets: [{ filename: "../../escape.png", size: 3, hash: sha256("abc") }],
    };
    writeManifest(manifest2);
    s3.bucket.set(key(`objects/evil2-${sha256("<p>evil2</p>")}.lake`), Buffer.from("<p>evil2</p>", "utf8"));
    s3.bucket.set(key("assets/evil2/../../escape.png"), Buffer.from("abc", "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/无效的资源文件名/);
  });

  it("审计#4：清单声明的资源缺失/损坏时中止导入（不静默跳过）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);

    // 声明资源但对象缺失
    let manifest = readManifest();
    manifest.notes[0] = {
      id: "n2", title: "远端", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>remote</p>"), isConflict: false,
      assets: [{ filename: "img.png", size: 3, hash: sha256("img") }],
    };
    writeManifest(manifest);
    s3.bucket.set(key(`objects/n2-${sha256("<p>remote</p>")}.lake`), Buffer.from("<p>remote</p>", "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/资源不存在/);
    expect(store.notes.has("n2")).toBe(false); // 未导入半成品

    // 声明资源但内容损坏（hash 不符）
    manifest = readManifest();
    writeManifest(manifest);
    s3.bucket.set(key("assets/n2/img.png"), Buffer.from("xxx", "utf8")); // size 3 但 hash 不符
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/哈希不符/);
    expect(store.notes.has("n2")).toBe(false);
  });

  it("v3 锁同步：仅锁变更（正文哈希相同）也能下载合并；LWW 新者胜", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    await syncNow(store as unknown as Store);

    // 远端只改锁（正文哈希不变）：手工改写 manifest
    const manifest = readManifest();
    manifest.notes[0] = { ...manifest.notes[0], isLocked: true, lockedAt: "2030-01-01T00:00:00.000Z" };
    s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify(manifest), "utf8"));
    const r = await syncNow(store as unknown as Store);
    expect(r.downloaded).toBe(0); // 正文未下载
    expect(store.notes.get("n1")?.isLocked).toBe(true); // 锁已合并下来

    // 本地更新解锁（时间戳新）→ 远端旧锁不覆盖本地
    store.setNoteLocked("n1", false);
    const localAt = store.notes.get("n1")!.lockedAt!;
    manifest.notes[0] = { ...manifest.notes[0], isLocked: true, lockedAt: "2020-01-01T00:00:00.000Z" };
    s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify(manifest), "utf8"));
    await syncNow(store as unknown as Store);
    expect(store.notes.get("n1")?.isLocked).toBe(false);
    expect(store.notes.get("n1")?.lockedAt).toBe(localAt);
  });

  it("审计#19：远程 manifest 结构非法时同步报错（不按任意 JSON 导入）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);

    s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify({ version: 4, notes: "not-an-array" }), "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/清单格式无效/);

    s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify({ version: 99, workspaceId: "default", commitId: "c", createdAt: "t", notes: [] }), "utf8"));
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/清单版本不兼容/);
  });

  it("云端标记 deleted 时本地删除该笔记", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.createNote("n2", "笔记B", "<p>b</p>");
    await syncNow(store as unknown as Store);

    const manifest = readManifest();
    const n2 = manifest.notes.find((n) => n.id === "n2")!;
    n2.deleted = true;
    n2.deletedAt = new Date().toISOString();
    writeManifest(manifest);

    const r = await syncNow(store as unknown as Store);
    expect(store.notes.has("n2")).toBe(false);
    expect(store.notes.has("n1")).toBe(true);
  });

  it("笔记内容变更时，云端同 hash 资源不重复上传（增量优化）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.addAsset("n1", "img1.png", Buffer.from("png-bytes", "utf8"));
    await syncNow(store as unknown as Store);
    expect(s3.bucket.has(key("assets/n1/img1.png"))).toBe(true);

    store.modifyNote("n1", "<p>b</p>"); // 只改内容，资源不变
    const assetPutsBefore = s3.puts.filter((k) => k.startsWith(key("assets/"))).length;
    await syncNow(store as unknown as Store);
    const assetPutsAfter = s3.puts.filter((k) => k.startsWith(key("assets/"))).length;
    expect(assetPutsAfter - assetPutsBefore).toBe(0); // 资源零重传
    const manifest = readManifest();
    expect(manifest.notes[0].assets).toHaveLength(1);
  });

  it("未配置 S3 时直接报错", async () => {
    const store = new FakeStore();
    await expect(syncNow(store as unknown as Store)).rejects.toThrow("请先保存 S3 配置");
  });
});

describe("S3 配置校验", () => {
  it("testConnection 未保存配置时报错", async () => {
    const store = new FakeStore();
    await expect(testConnection(store as unknown as Store)).rejects.toThrow("请先保存 S3 配置");
  });

  it("endpoint/bucket/密钥任一为空都报同一错误", async () => {
    const cases: Array<Partial<S3Settings>> = [
      { ...SETTINGS, endpoint: "  " },
      { ...SETTINGS, bucket: "" },
      { ...SETTINGS, accessKeyId: " " },
      { ...SETTINGS, secretAccessKey: "" },
    ];
    for (const patch of cases) {
      const store = new FakeStore();
      store.settings = { ...SETTINGS, ...patch };
      await expect(testConnection(store as unknown as Store)).rejects.toThrow("Endpoint、Bucket 和访问密钥均不能为空");
    }
  });

  it("syncNow 配置不完整时同样校验失败", async () => {
    const store = new FakeStore();
    store.settings = { ...SETTINGS, bucket: "" };
    await expect(syncNow(store as unknown as Store)).rejects.toThrow("Endpoint、Bucket 和访问密钥均不能为空");
  });

  it("有效配置可通过校验并成功连接（mock S3）", async () => {
    const store = new FakeStore();
    store.settings = { ...SETTINGS };
    await expect(testConnection(store as unknown as Store)).resolves.toContain("连接成功");
  });
});

describe("ObjectStore 扩展（M1）", () => {
  beforeEach(() => s3.reset());

  it("list 返回前缀下相对键；delete/deleteMany/deletePrefix 幂等删除", async () => {
    const remote = new ObjectStore(SETTINGS);
    await remote.put("objects/n1-h1.lake", Buffer.from("a"), "text/plain");
    await remote.put("objects/n1-h2.lake", Buffer.from("b"), "text/plain");
    await remote.put("assets/n1/img.png", Buffer.from("c"), "image/png");

    const list = await remote.list("objects/");
    expect(list.map((i) => i.key).sort()).toEqual(["objects/n1-h1.lake", "objects/n1-h2.lake"]);
    expect(list.every((i) => typeof i.lastModified === "string")).toBe(true);

    await remote.delete("objects/n1-h1.lake");
    expect(s3.bucket.has(key("objects/n1-h1.lake"))).toBe(false);

    await remote.deleteMany(["objects/n1-h2.lake", "assets/n1/img.png"]);
    expect(s3.bucket.has(key("objects/n1-h2.lake"))).toBe(false);
    expect(s3.bucket.has(key("assets/n1/img.png"))).toBe(false);
  });

  it("deletePrefix 删除指定前缀全部键", async () => {
    const remote = new ObjectStore(SETTINGS);
    await remote.put("objects/n1-h1.lake", Buffer.from("a"), "text/plain");
    await remote.put("objects/n1-h2.lake", Buffer.from("b"), "text/plain");
    await remote.put("objects/n2-h1.lake", Buffer.from("c"), "text/plain");
    const deleted = await remote.deletePrefix("objects/n1-");
    expect(deleted).toBe(2);
    expect(s3.bucket.has(key("objects/n1-h1.lake"))).toBe(false);
    expect(s3.bucket.has(key("objects/n1-h2.lake"))).toBe(false);
    expect(s3.bucket.has(key("objects/n2-h1.lake"))).toBe(true);
  });

  it("ASCII 键校验：非法键 fail fast", async () => {
    const remote = new ObjectStore(SETTINGS);
    await expect(remote.put("objects/bad key.lake", Buffer.from("x"), "text/plain")).rejects.toThrow(/非法字符/);
    await expect(remote.delete("objects/中文.lake")).rejects.toThrow(/非法字符/);
  });
});


describe("S3 GC v4 语义（M0/M2）", () => {
  beforeEach(() => s3.reset());

  it("远端墓碑不能删除本地已恢复且待上传的笔记（P0-1 回收站恢复）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);
    // 远端写入 deleted 墓碑
    const manifest = readManifest();
    manifest.notes[0] = { ...manifest.notes[0], deleted: true, deletedAt: new Date().toISOString() };
    writeManifest(manifest);

    // 本地恢复：同内容 + 显式恢复标记（真实 restoreTrashItem 置 local + restore_pending_at）
    store.markRestorePending("n1");
    await syncNow(store as unknown as Store);

    expect(store.notes.has("n1")).toBe(true);
    const after = readManifest();
    expect(after.notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
  });

  it("墓碑权威：B 有未上传编辑（无恢复标记，即使晚于删除）→ 被 A 删除压掉，B 版本强制留档", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    // A 删除并同步（deletedAt 设为较早）
    const base = Date.now();
    storeA.deleteTreeNode("n1");
    storeA.deleted.get("n1")!.deletedAt = new Date(base + 1000).toISOString();
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // B 在删除之后编辑（普通编辑，无恢复标记）——时间晚于删除也不抵抗墓碑
    storeB.modifyNote("n1", "<p>b-edit</p>");
    storeB.notes.get("n1")!.updatedAt = new Date(base + 2000).toISOString();
    storeB.markLocal("n1");
    const histBefore = storeB.historySnapshots.length;
    await syncNow(storeB as unknown as Store);
    // B 被删 + B 版本强制留档（历史可找回）
    expect(storeB.notes.has("n1")).toBe(false);
    expect(storeB.listDeletedNotesForSync()).toHaveLength(1);
    expect(storeB.historySnapshots.length).toBeGreaterThan(histBefore);
    expect(storeB.historySnapshots).toContain("n1");
    // 云端保持 deleted（B 的编辑不复活删除）
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
  });

  it("恢复标记：远端 deleted 不压本地显式恢复，B 上传 active 覆盖墓碑并清标记", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    // A 删除并同步
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // B 学到删除
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
    // B 显式恢复（写恢复标记）并同步
    storeB.restoreTrashItem("n1", "<p>restored</p>");
    expect(storeB.isRestorePending("n1")).toBe(true);
    await syncNow(storeB as unknown as Store);
    // B 保留 + 云端恢复为 active + 恢复标记已清除
    expect(storeB.notes.has("n1")).toBe(true);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
    expect(storeB.isRestorePending("n1")).toBe(false);
  });

  it("墓碑携带删除前内容：A 编辑（未同步）后删除，B 同步后回收站/恢复为 A 最新编辑版", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    // A 编辑（未同步）→ 删除 → 同步：墓碑应携带真实 hash + 上传对象
    storeA.modifyNote("n1", "<p>A-edited</p>");
    const aHash = storeA.contentHash("n1");
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    const tomb = readManifest().notes.find((n) => n.id === "n1")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.contentHash).toBe(aHash);
    expect(s3.bucket.has(key(`objects/n1-${aHash}.lake`))).toBe(true);
    // B 同步：先拉到 A 编辑版再软删 → 回收站 .lake = A 编辑版
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
    expect(storeB.deleted.has("n1")).toBe(true);
    expect(storeB.contentHash("n1")).toBe(aHash);
    // B 恢复 = A 编辑版
    storeB.restoreTrashItem("n1");
    expect(storeB.contentHash("n1")).toBe(aHash);
  });

  it("本端 purge 后远端恢复：本端同步不崩，跟随恢复（行被删时 revoke 容错重建）", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    // A 删除 + purge（墓碑保留 + 行彻底删除 + 标 purged）
    const base = Date.now();
    storeA.deleteTreeNode("n1");
    storeA.deleted.get("n1")!.deletedAt = new Date(base + 1000).toISOString();
    storeA.markPurged("n1");
    await syncNow(storeA as unknown as Store);
    expect(storeA.notes.has("n1")).toBe(false);
    // B 学删 → 恢复（时间晚于 A 墓碑）→ 上传 active
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
    storeB.restoreTrashItem("n1", "<p>restored</p>");
    storeB.notes.get("n1")!.updatedAt = new Date(base + 2000).toISOString();
    await syncNow(storeB as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
    // A 再同步：不应抛"笔记不存在"，跟随恢复（importRemoteNote 重建行）
    await expect(syncNow(storeA as unknown as Store)).resolves.toBeTruthy();
    expect(storeA.notes.has("n1")).toBe(true);
    expect(storeA.listDeletedNotesForSync()).toHaveLength(0);
  });

  it("墓碑携带删除前资源：软删资源被 GC keep 保护，深度清理不删，B 回收站为完整版", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    storeA.addAsset("n1", "1786735000000_a1b2c3d4.png", Buffer.from("img-bytes", "utf8"));
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(fs.existsSync(path.join(storeB.noteAssetsPathFor("n1"), "1786735000000_a1b2c3d4.png"))).toBe(true);
    // A 删除 → 同步：墓碑 assets 应携带删除前资源
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    const tomb = readManifest().notes.find((n) => n.id === "n1")!;
    expect(tomb.deleted).toBe(true);
    // 墓碑保持轻量：不携带资源列表（资源由 GC 软删前缀保护 + B 端 list 补全）
    expect(tomb.assets).toHaveLength(0);
    // B 同步：先下载删除前正文 + list 补全资源再软删 → B 回收站资源 = A 版（恢复不缺图）
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
    expect(fs.existsSync(path.join(storeB.noteAssetsPathFor("n1"), "1786735000000_a1b2c3d4.png"))).toBe(true);
    // GC 软删前缀保护：深度清理预览不应把软删资源列为候选（否则回收站恢复后缺图）
    const dc = await runDeepCleanup(storeA as unknown as Store, { dryRun: true });
    expect(dc.keys).not.toContain("assets/n1/1786735000000_a1b2c3d4.png");
  });

  it("墓碑携带删除前内容：B 有编辑被删后，历史留档 B 版，回收站内容为 A 版", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    // A 编辑 v2 → 删除 → 同步（墓碑带 v2 hash）
    storeA.modifyNote("n1", "<p>A-v2</p>");
    const aHash = storeA.contentHash("n1");
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    // B 本地编辑 vB（未同步）→ 同步：被删 + B 版留档 + 回收站内容为 A 版
    storeB.modifyNote("n1", "<p>B-edit</p>");
    const bHash = storeB.contentHash("n1");
    storeB.markLocal("n1");
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
    expect(storeB.historySnapshots).toContain("n1"); // B 版强制留档
    expect(storeB.contentHash("n1")).toBe(aHash);    // 回收站 .lake = A 版
    expect(bHash).not.toBe(aHash);
    // 恢复 = A 版（B 版在历史里可找回）
    storeB.restoreTrashItem("n1");
    expect(storeB.contentHash("n1")).toBe(aHash);
  });

  it("恢复标记清除后，后续删除可再次正常传播（不残留 local-wins）", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    // 第一轮：A 删 → B 学删 → B 恢复 → B 上传 active（标记清除）→ A 同步跟随恢复
    // 时间轴：n1 创建(base-ε) < A 删除(base+1s) < B 恢复(base+2s)，保证 A 侧 revoke 判定稳定
    const base = Date.now();
    storeA.deleteTreeNode("n1");
    storeA.deleted.get("n1")!.deletedAt = new Date(base + 1000).toISOString();
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);
    storeB.restoreTrashItem("n1", "<p>restored</p>");
    storeB.notes.get("n1")!.updatedAt = new Date(base + 2000).toISOString();
    await syncNow(storeB as unknown as Store);
    expect(storeB.isRestorePending("n1")).toBe(false);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
    await syncNow(storeA as unknown as Store);
    expect(storeA.notes.has("n1")).toBe(true);
    expect(storeA.listDeletedNotesForSync()).toHaveLength(0);
    // 第二轮：A 再次删除（墓碑时间 base+3s 晚于 B 恢复 base+2s）→ B 再同步被删
    //（恢复标记不残留，墓碑永胜仍生效）
    storeA.deleteTreeNode("n1");
    storeA.deleted.get("n1")!.deletedAt = new Date(base + 3000).toISOString();
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
  });

  it("A 删除 → B 学到删除 → B 恢复 → A 再同步应跟随恢复且墓碑让位 → B 不被再次删除（多端恢复 LWW）", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    // B 同步到 n1
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    // A 删除并同步（墓碑 → 远端 deleted）。时间轴：n1 创建(T0) < 删除(T0+1s) < B 恢复(T0+2s)
    const base = Date.now();
    storeA.deleteTreeNode("n1");
    storeA.deleted.get("n1")!.deletedAt = new Date(base + 1000).toISOString();
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // B 同步：学到删除
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
    expect(storeB.listDeletedNotesForSync()).toHaveLength(1);
    // B 恢复并同步（远端恢复为 active，updatedAt = T0+2s > 墓碑删除时间 T0+1s）
    storeB.restoreTrashItem("n1", "<p>a</p>");
    storeB.notes.get("n1")!.updatedAt = new Date(base + 2000).toISOString();
    await syncNow(storeB as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
    // A 再同步：应跟随恢复（不再"拉不到"），本地墓碑撤销
    await syncNow(storeA as unknown as Store);
    expect(storeA.notes.has("n1")).toBe(true);
    expect(storeA.listDeletedNotesForSync()).toHaveLength(0);
    // 云端保持 active：A 的墓碑让位，不回写覆盖恢复
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
    // B 再同步：不被再次删除
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
  });

  it("远端较旧的 active 不会误恢复本地较新的删除（删除 LWW 较新仍传播）", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    // 时间轴：n1 创建(T0) < 远端 active updatedAt(T0+1s) < A 本地删除(T0+2s)
    const base = Date.now();
    const m = readManifest();
    const note = m.notes.find((n) => n.id === "n1")!;
    note.updatedAt = new Date(base + 1000).toISOString();
    writeManifest(m);
    storeA.deleteTreeNode("n1");
    storeA.deleted.get("n1")!.deletedAt = new Date(base + 2000).toISOString();
    // A 同步：下载分支不跟随（远端 updatedAt 较旧）→ 上传回写墓碑（本地删除较新）
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // B 同步：被较新的删除覆盖
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(false);
  });

  it("编辑产生旧对象进 pending；恢复引用后 pending 撤销", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    const h1 = store.contentHash("n1");

    store.modifyNote("n1", "<p>v2</p>");
    await syncNow(store as unknown as Store);
    expect(store.gcPending.has(`objects/n1-${h1}.lake`)).toBe(true);

    const h2 = store.contentHash("n1");
    store.modifyNote("n1", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    // 旧 H1 重新被引用 → 撤销；H2 进入 pending
    expect(store.gcPending.has(`objects/n1-${h1}.lake`)).toBe(false);
    expect(store.gcPending.has(`objects/n1-${h2}.lake`)).toBe(true);
  });


  it("差集对账只删超窗且不在 keep 的 pending 键（M5）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    const h1 = store.contentHash("n1");
    store.modifyNote("n1", "<p>v2</p>");
    await syncNow(store as unknown as Store);
    expect(store.gcPending.has(`objects/n1-${h1}.lake`)).toBe(true);

    // 一个不在任何 keep 集的孤儿待回收键（模拟崩溃孤儿），超窗后应被删
    store.addS3GcPending("objects/n1-dead.lake", "2020-01-01T00:00:00.000Z");
    const r = await runGcReconcile(store as unknown as Store);
    expect(r.deleted).toBe(1);
    expect(store.gcPending.has("objects/n1-dead.lake")).toBe(false);
    // 仍被 prevCommitId 链保护的真实旧对象不删
    expect(s3.bucket.has(key(`objects/n1-${h1}.lake`))).toBe(true);
    expect(store.gcPending.has(`objects/n1-${h1}.lake`)).toBe(true);
  });


  it("深度清理 dry-run 列出候选但不删；执行后删除非 keep 键（M7）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    const h1 = store.contentHash("n1");

    // 放置一个旧孤儿对象（不在任何 manifest/keep）
    s3.bucket.set(key("objects/crash-orphan.lake"), Buffer.from("x", "utf8"));
    const dry = await runDeepCleanup(store as unknown as Store, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.keys).toContain("objects/crash-orphan.lake");
    expect(s3.bucket.has(key("objects/crash-orphan.lake"))).toBe(true); // dry-run 不删

    const run = await runDeepCleanup(store as unknown as Store);
    expect(run.deletedCount).toBeGreaterThanOrEqual(1);
    expect(s3.bucket.has(key("objects/crash-orphan.lake"))).toBe(false);
    // 当前 manifest 与 manifest 文件本身受保护
    expect(s3.bucket.has(key(`objects/n1-${h1}.lake`))).toBe(true);
    expect(s3.bucket.has(key("manifests/latest.json"))).toBe(true);
  });


  it("深度清理保持子空间隔离：不删除 quick-notes/ 下的小记对象（空间隔离）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);

    // 小记对象属于独立子空间，Lake 深度清理绝不能触碰（业务原则：空间完全隔离）
    s3.bucket.set(key("quick-notes/manifests/latest.json"), Buffer.from("{}", "utf8"));
    s3.bucket.set(key("quick-notes/objects/abc.qnote"), Buffer.from("x", "utf8"));
    s3.bucket.set(key("quick-notes/assets/qn/img.png"), Buffer.from("img", "utf8"));

    const dry = await runDeepCleanup(store as unknown as Store, { dryRun: true });
    expect(dry.keys).not.toContain("quick-notes/manifests/latest.json");
    expect(dry.keys).not.toContain("quick-notes/objects/abc.qnote");
    expect(dry.keys).not.toContain("quick-notes/assets/qn/img.png");

    await runDeepCleanup(store as unknown as Store);
    expect(s3.bucket.has(key("quick-notes/manifests/latest.json"))).toBe(true);
    expect(s3.bucket.has(key("quick-notes/objects/abc.qnote"))).toBe(true);
    expect(s3.bucket.has(key("quick-notes/assets/qn/img.png"))).toBe(true);
  });


  it("purge 后先写墓碑再前缀删除对象/资源（M4）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.addAsset("n1", "img.png", Buffer.from("img", "utf8"));
    await syncNow(store as unknown as Store);
    const h1 = store.contentHash("n1");
    expect(s3.bucket.has(key(`objects/n1-${h1}.lake`))).toBe(true);
    expect(s3.bucket.has(key("assets/n1/img.png"))).toBe(true);

    store.deleteTreeNode("n1");
    store.markPurged("n1");
    await syncNow(store as unknown as Store);

    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    expect(s3.bucket.has(key(`objects/n1-${h1}.lake`))).toBe(false);
    expect(s3.bucket.has(key("assets/n1/img.png"))).toBe(false);
  });
});

describe("manifest gzip（实验/manifest-gzip）", () => {
  it("manifest 以 gzip 存储，体积小于原始，读取透明解压", async () => {
    const storeA = newStore();
    for (let i = 0; i < 50; i += 1) storeA.createNote(`n${i}`, `笔记${i}`, `<p>内容${i}</p>${i % 3 === 0 ? `<img src="assets/${i}.png">` : ""}`);
    await syncNow(storeA as unknown as Store);
    const stored = s3.bucket.get(key("manifests/latest.json"))!;
    expect(stored.length >= 2 && stored[0] === 0x1f && stored[1] === 0x8b).toBe(true); // gzip 魔数
    const raw = zlib.gunzipSync(stored);
    expect(stored.length).toBeLessThan(raw.length);                                   // 压缩后更小
    const manifest = readManifest();                                                  // 透明解压后可解析
    expect(manifest.notes.length).toBe(50);
    // commit 链同样 gzip
    const commit = s3.bucket.get(key(`manifests/${manifest.commitId}.json`))!;
    expect(commit[0] === 0x1f && commit[1] === 0x8b).toBe(true);
    // 二次同步幂等：读回 gzip manifest 不报错
    const r2 = await syncNow(storeA as unknown as Store);
    expect(r2.downloaded).toBe(0);
  });

  it("普通对象（笔记正文/资源）不 gzip，保持原样", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", '<p>v1</p><img src="assets/a.png">');
    await syncNow(storeA as unknown as Store);
    for (const k of s3.bucket.keys()) {
      if (k.includes("manifests/")) continue;
      const b = s3.bucket.get(k)!;
      expect(b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b).toBe(false);
    }
  });
});

describe("增量扫描优化（synced 跳过本地读文件）", () => {
  beforeEach(() => s3.reset());
  it("二次同步未编辑笔记：0 次 .lake 读取，assets 复用远端清单", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p><img src=\"assets/a.png\">");
    storeA.addAsset("n1", "a.png", Buffer.from("img", "utf8"));
    await syncNow(storeA as unknown as Store);
    const first = readManifest();
    expect(first.notes[0].assets).toHaveLength(1);

    storeA.hashReads = 0;
    const r2 = await syncNow(storeA as unknown as Store);
    expect(storeA.hashReads).toBe(0);            // 未编辑 → 不读 .lake
    expect(r2.uploaded).toBe(0);
    expect(r2.downloaded).toBe(0);
    const m2 = readManifest();
    expect(m2.notes[0].contentHash).toBe(storeA.baseHash("n1"));
    expect(m2.notes[0].assets).toHaveLength(1);  // assets 从远端复用，不丢
  });

  it("编辑后（local）照常全量扫描并上传新 hash", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    storeA.hashReads = 0;
    storeA.modifyNote("n1", "<p>v2-edited</p>");
    const r = await syncNow(storeA as unknown as Store);
    expect(storeA.hashReads).toBeGreaterThan(0); // 有编辑 → 必须读文件
    expect(r.uploaded).toBeGreaterThan(0);
    expect(readManifest().notes.find((n) => n.id === "n1")!.contentHash).toBe(storeA.contentHash("n1"));
  });

  it("synced 但远端条目缺失 → 回退全量扫描重传", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    storeA.hashReads = 0;
    // 模拟远端清单被清空（如桶被重置）
    const m = readManifest(); m.notes = [];
    writeManifest(m);
    await syncNow(storeA as unknown as Store);
    expect(storeA.hashReads).toBeGreaterThan(0); // 远端缺失 → 回退扫描
    expect(readManifest().notes.find((n) => n.id === "n1")).toBeTruthy();
  });

  it("跨设备：B 下载远端更新后同步，synced 笔记同样 0 读取", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    // B 首次同步：无本地笔记，导入即 synced + 基线对齐 → 0 读取
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.hashReads).toBe(0);
    // A 编辑提交 → B 再同步：下载远端新版本，synced 本地用缓存基线，不读文件
    storeA.modifyNote("n1", "<p>v2</p>");
    await syncNow(storeA as unknown as Store);
    storeB.hashReads = 0;
    const rb = await syncNow(storeB as unknown as Store);
    expect(rb.downloaded).toBe(1);
    expect(storeB.hashReads).toBe(0);
    expect(storeB.baseHash("n1")).toBe(storeA.contentHash("n1"));
  });
});
