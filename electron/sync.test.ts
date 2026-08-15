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
  trashedAt?: string | null; deletedFromParentId?: string | null;
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
  notes = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; syncState: string; isConflict: boolean; isLocked?: boolean; lockedAt?: string | null; trashedAt?: string | null; deletedFromParentId?: string | null }>();
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
  applyRemoteNoteMeta(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean; trashedAt?: string | null; deletedFromParentId?: string | null }) {
    const n = this.notes.get(note.id);
    if (n) {
      n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = note.isConflict;
      if (note.parentId === "notebook-trash") {
        n.trashedAt = note.trashedAt ?? n.trashedAt ?? new Date().toISOString();
        n.deletedFromParentId = note.deletedFromParentId ?? n.deletedFromParentId ?? null;
      } else {
        n.trashedAt = null; n.deletedFromParentId = null;
      }
    }
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
  importRemoteNote(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean; trashedAt?: string | null; deletedFromParentId?: string | null }, content: Buffer, assets: { filename: string; bytes: Buffer }[]) {
    fs.writeFileSync(this.notePath(note.id), content, "utf8");
    if (assets.length > 0) {
      const dir = path.join(this.dir, "note-assets", note.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const asset of assets) fs.writeFileSync(path.join(dir, asset.filename), asset.bytes);
    }
    this.notes.set(note.id, { ...note, syncState: "synced", trashedAt: note.trashedAt ?? null, deletedFromParentId: note.deletedFromParentId ?? null });
  }
  rememberDeleted(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string }, deletedAt: string) {
    this.deleted.set(note.id, { id: note.id, title: note.title, parentId: note.parentId, sortOrder: note.sortOrder, updatedAt: note.updatedAt, deletedAt });
  }
  /** 软删 = 移入回收站笔记本（真实 Store 的 deleteTreeNode 同语义：不写墓碑、保留文件）。 */
  deleteTreeNode(id: string) {
    const n = this.notes.get(id);
    if (n) {
      n.deletedFromParentId = n.parentId;
      n.parentId = "notebook-trash";
      n.trashedAt = new Date().toISOString();
      n.syncState = "local";
    }
  }
  /** purge = 彻底删除 + 写墓碑（deleted_notes 带 purged_at）。 */
  purgeTrashItem(id: string) {
    const n = this.notes.get(id);
    if (n) {
      this.deleted.set(id, { id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt, deletedAt: new Date().toISOString() });
      this.purgedNotes.set(id, new Date().toISOString());
      this.notes.delete(id);
    }
  }
  /** 收到他端 purge 墓碑：保留副本并标 purged（不上传、可恢复）。 */
  applyRemotePurge(id: string) {
    const n = this.notes.get(id);
    if (n) {
      n.deletedFromParentId = n.deletedFromParentId ?? n.parentId;
      n.parentId = "notebook-trash";
      n.trashedAt = n.trashedAt ?? new Date().toISOString();
      n.syncState = "purged";
    }
  }
  /** 远端软删传播（删除压编辑）：移入回收站，标 local 待下载分支核对。 */
  applyRemoteMoveToTrash(id: string, trashedAt: string | null, deletedFromParentId: string | null) {
    const n = this.notes.get(id);
    if (n) {
      n.deletedFromParentId = n.deletedFromParentId ?? deletedFromParentId ?? n.parentId;
      n.parentId = "notebook-trash";
      n.trashedAt = n.trashedAt ?? trashedAt ?? new Date().toISOString();
      n.syncState = "local";
    }
  }
  /** 远端恢复传播：移出回收站，标 local。 */
  applyRemoteRestore(id: string, parentId: string | null, updatedAt: string) {
    const n = this.notes.get(id);
    if (n) {
      n.parentId = parentId;
      n.trashedAt = null;
      n.deletedFromParentId = null;
      n.updatedAt = updatedAt;
      n.syncState = "local";
    }
  }
  /** 模拟真实 restoreTrashItem：从回收站移回原位置 + 写回内容 + 清回收站字段 + 显式恢复标记 + 标 local。 */
  restoreTrashItem(id: string, content?: string) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`回收站节点不存在: ${id}`);
    if (content !== undefined) fs.writeFileSync(this.notePath(id), content, "utf8");
    n.parentId = n.deletedFromParentId ?? null;
    n.trashedAt = null;
    n.deletedFromParentId = null;
    n.updatedAt = new Date().toISOString();
    n.syncState = "local";
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

  it("本地删除后 manifest 条目移入回收站笔记本（parentId=trash），跨次同步持续", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    store.createNote("n2", "笔记B", "<p>b</p>");
    await syncNow(store as unknown as Store);

    store.deleteTreeNode("n2");
    expect(store.listDeletedNotesForSync()).toHaveLength(0); // 软删不写墓碑

    const r = await syncNow(store as unknown as Store);
    expect(r.downloaded).toBe(0);
    const manifest = readManifest();
    const n2 = manifest.notes.find((n) => n.id === "n2")!;
    expect(n2.deleted).not.toBe(true);          // 不是墓碑
    expect(n2.parentId).toBe("notebook-trash"); // 移入回收站笔记本
    expect(n2.trashedAt).toBeTruthy();
    // 跨次同步持续（回收站条目常驻 manifest，离线设备上线不会复活为普通笔记）
    await syncNow(store as unknown as Store);
    const manifest2 = readManifest();
    expect(manifest2.notes.find((n) => n.id === "n2")?.parentId).toBe("notebook-trash");
    expect(store.notes.has("n2")).toBe(true);   // 回收站条目仍在本地
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

  it("审计#2：设备A删除并多次同步后，离线设备C上线不把已删笔记当普通文档复活", async () => {
    // 设备 A：创建并同步
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    // 设备 B：同步到 n1
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    // 设备 A：删除（移入回收站）+ 同步两次（回收站条目持续存在）
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    // 设备 C（离线后上线）：n1 进入 C 的回收站（不是普通文档复活）
    const storeC = newStore();
    await syncNow(storeC as unknown as Store);
    expect(storeC.notes.has("n1")).toBe(true);
    expect(storeC.listNotesForSync().find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    // manifest 持续保留 trash 条目（不复活为普通笔记）
    expect(readManifest().notes.find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    // A 设备清空（模拟重装）：C 重新同步后仍保持回收站条目
    const storeA2 = newStore();
    await syncNow(storeA2 as unknown as Store);
    expect(storeA2.listNotesForSync().find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
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

  it("云端 deleted（purge 墓碑）不强制删除本地：保留副本标 purged（可恢复、不上传）", async () => {
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
    // n2 不被删除：保留本地副本，移入回收站并标 purged
    expect(store.notes.has("n2")).toBe(true);
    expect(store.notes.get("n2")!.syncState).toBe("purged");
    expect(store.notes.get("n2")!.parentId).toBe("notebook-trash");
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


describe("S3 GC v4 语义（M0/M2）— 回收站笔记本", () => {
  beforeEach(() => s3.reset());

  it("回收站上云 + 情况3：A 删除后，从未持有的 B 同步到回收站全文+资源并可恢复", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    storeA.addAsset("n1", "1786735000000_a1b2c3d4.png", Buffer.from("img-bytes", "utf8"));
    await syncNow(storeA as unknown as Store);
    // 从未持有 n1 的全新设备 B（离线期间 A 删除）
    const storeB = newStore();
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    const trashEntry = readManifest().notes.find((n) => n.id === "n1")!;
    expect(trashEntry.deleted).not.toBe(true);
    expect(trashEntry.parentId).toBe("notebook-trash");
    expect(trashEntry.assets).toHaveLength(1);   // 回收站条目携带资源清单
    // B 同步：回收站条目（非墓碑）→ 全文+资源下载到 B 回收站
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    expect(fs.existsSync(path.join(storeB.noteAssetsPathFor("n1"), "1786735000000_a1b2c3d4.png"))).toBe(true);
    // B 恢复 = 删除方版本（含图）
    storeB.restoreTrashItem("n1");
    expect(storeB.contentHash("n1")).toBe(storeA.contentHash("n1"));
    await syncNow(storeB as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.parentId).not.toBe("notebook-trash");
  });

  it("删除压编辑（墓碑权威）：A 删 B 编辑 → B 跟随删除 + 编辑留档 + 云端保持回收站", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    // A 删除并同步（回收站条目）
    const base = Date.now();
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    // B 在删除后编辑（普通编辑，无恢复标记）——时间晚于删除也不抵抗删除
    storeB.modifyNote("n1", "<p>b-edit</p>");
    storeB.notes.get("n1")!.updatedAt = new Date(base + 2000).toISOString();
    storeB.markLocal("n1");
    const histBefore = storeB.historySnapshots.length;
    const rb = await syncNow(storeB as unknown as Store);
    // B 跟随删除：n1 进回收站（不复活为普通笔记）
    expect(storeB.notes.has("n1")).toBe(true);
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    // B 编辑强制留档 + superseded 提示
    expect(storeB.historySnapshots.length).toBeGreaterThan(histBefore);
    expect(storeB.historySnapshots).toContain("n1");
    expect(rb.supersededNotes.some((n) => n.id === "n1")).toBe(true);
    // 云端保持回收站条目（B 的编辑不复活删除）
    expect(readManifest().notes.find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
  });

  it("显式恢复例外：B 恢复 → 上传 active 覆盖回收站条目 → A 跟随恢复（多端恢复 LWW）", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    const base = Date.now();
    storeA.deleteTreeNode("n1");
    storeA.notes.get("n1")!.trashedAt = new Date(base + 1000).toISOString();
    await syncNow(storeA as unknown as Store);
    // B 同步：n1 进 B 回收站
    await syncNow(storeB as unknown as Store);
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    // B 显式恢复（写恢复标记）并同步 → 云端恢复为 active
    storeB.restoreTrashItem("n1", "<p>a</p>");
    expect(storeB.isRestorePending("n1")).toBe(true);
    storeB.notes.get("n1")!.updatedAt = new Date(base + 2000).toISOString();
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    expect(readManifest().notes.find((n) => n.id === "n1")?.parentId).not.toBe("notebook-trash");
    expect(storeB.isRestorePending("n1")).toBe(false);
    // A 再同步：跟随恢复（本地回收站条目被移出），B 不被再次删除
    await syncNow(storeA as unknown as Store);
    expect(storeA.listNotesForSync().find((n) => n.id === "n1")?.parentId).not.toBe("notebook-trash");
    await syncNow(storeB as unknown as Store);
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")?.parentId).not.toBe("notebook-trash");
    expect(readManifest().notes.find((n) => n.id === "n1")?.parentId).not.toBe("notebook-trash");
  });

  it("purge 不广播：A purge → B 保留副本标 purged（可恢复、不上传）；B 恢复 → 云端复活", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    // A 删除（回收站）→ B 同步到回收站
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    // A purge + 同步：manifest 移除条目 + 推 deleted 墓碑 + M4 删前缀
    const base = Date.now();
    storeA.purgeTrashItem("n1");
    storeA.deleted.get("n1")!.deletedAt = new Date(base + 1000).toISOString();
    await syncNow(storeA as unknown as Store);
    expect(storeA.notes.has("n1")).toBe(false);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    // B 同步：purge 不广播强制删除——保留副本标 purged（可恢复、不上传）
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    expect(storeB.notes.get("n1")!.syncState).toBe("purged");
    // B 恢复（显式）→ 上传 active → 云端复活（恢复路子存在）
    storeB.restoreTrashItem("n1", "<p>v1</p>");
    storeB.notes.get("n1")!.updatedAt = new Date(base + 2000).toISOString();
    await syncNow(storeB as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).not.toBe(true);
    // A 再同步：墓碑让位（远端恢复较新），跟随恢复
    await expect(syncNow(storeA as unknown as Store)).resolves.toBeTruthy();
    expect(storeA.notes.has("n1")).toBe(true);
    expect(storeA.listDeletedNotesForSync()).toHaveLength(0);
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
    store.purgeTrashItem("n1");
    await syncNow(store as unknown as Store);

    expect(readManifest().notes.find((n) => n.id === "n1")?.deleted).toBe(true);
    expect(s3.bucket.has(key(`objects/n1-${h1}.lake`))).toBe(false);
    expect(s3.bucket.has(key("assets/n1/img.png"))).toBe(false);
  });

  it("GC：回收站条目 assets 在 manifest keep 集，深度清理不删（无需前缀保护 hack）", async () => {
    const storeA = newStore();
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    storeA.addAsset("n1", "1786735000000_a1b2c3d4.png", Buffer.from("img-bytes", "utf8"));
    await syncNow(storeA as unknown as Store);
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    const trashEntry = readManifest().notes.find((n) => n.id === "n1")!;
    expect(trashEntry.parentId).toBe("notebook-trash");
    expect(trashEntry.assets).toHaveLength(1); // 回收站条目携带资源清单 → 自然 keep
    const dc = await runDeepCleanup(storeA as unknown as Store, { dryRun: true });
    expect(dc.keys).not.toContain("assets/n1/1786735000000_a1b2c3d4.png");
  });

  it("恢复位置跨端一致：deletedFromParentId 上云，B 恢复回到原目录", async () => {
    const storeA = newStore();
    storeA.folders.set("nb-1", { id: "nb-1", title: "笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: new Date().toISOString() });
    storeA.createNote("n1", "笔记A", "<p>a</p>");
    storeA.notes.get("n1")!.parentId = "nb-1";
    await syncNow(storeA as unknown as Store);
    const storeB = newStore();
    await syncNow(storeB as unknown as Store);
    // A 删除 n1（deletedFromParentId=nb-1）→ 同步 → B 同步
    storeA.deleteTreeNode("n1");
    await syncNow(storeA as unknown as Store);
    const trashEntry = readManifest().notes.find((n) => n.id === "n1")!;
    expect(trashEntry.parentId).toBe("notebook-trash");
    expect(trashEntry.deletedFromParentId).toBe("nb-1");
    await syncNow(storeB as unknown as Store);
    const bTrash = storeB.listNotesForSync().find((n) => n.id === "n1")!;
    expect(bTrash.parentId).toBe("notebook-trash");
    expect(bTrash.deletedFromParentId).toBe("nb-1");
    // B 恢复 → 回到 nb-1（不是根）
    storeB.restoreTrashItem("n1");
    expect(storeB.notes.get("n1")!.parentId).toBe("nb-1");
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
