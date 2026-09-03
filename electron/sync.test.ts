import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncNow, testConnection, ObjectStore, runGcReconcile, runDeepCleanup, parseLakeManifest, validateS3Settings } from "./sync.js";
import { createSilentLoggerScopes, type LoggerScopes } from "../src/core/logger.js";
import type { Store } from "./store.js";

// ===== 内存 S3 mock（ObjectStore 依赖的 @aws-sdk/client-s3 命令子集） =====
const s3 = vi.hoisted(() => ({
  bucket: new Map<string, Buffer>(),
  puts: [] as string[],
  failCommand: "" as string,
  /** 覆盖某个键 list 返回的 LastModified：Date=指定时间；null=不返回（模拟云端未给时间戳） */
  lastModifiedOverrides: new Map<string, Date | null>(),
  reset() { this.bucket.clear(); this.puts.length = 0; this.failCommand = ""; this.lastModifiedOverrides.clear(); },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Command {
    constructor(public input: Record<string, unknown>) {}
  }
  class HeadBucketCommand extends S3Command {}
  class HeadObjectCommand extends S3Command {}
  class GetObjectCommand extends S3Command {}
  class PutObjectCommand extends S3Command {}
  class ListObjectsV2Command extends S3Command {}
  class DeleteObjectCommand extends S3Command {}
  class DeleteObjectsCommand extends S3Command {}
  class S3Client {
    async send(command: S3Command) {
      if (s3.failCommand && command.constructor.name === s3.failCommand) {
        throw new Error(`injected S3 failure: ${s3.failCommand}`);
      }
      if (command instanceof HeadBucketCommand) return {};
      if (command instanceof HeadObjectCommand) {
        const key = command.input.Key as string;
        if (!s3.bucket.has(key)) {
          const err = new Error(`NoSuchKey: ${key}`);
          (err as { name: string }).name = "NoSuchKey";
          throw err;
        }
        return {};
      }
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
        const body = command.input.Body as unknown;
        s3.bucket.set(key, Buffer.isBuffer(body) ? body : await collectStream(body as import("stream").Readable));
        s3.puts.push(key);
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix as string;
        const contents = [...s3.bucket.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort()
          .map((k) => ({ Key: k, LastModified: s3.lastModifiedOverrides.has(k) ? s3.lastModifiedOverrides.get(k) : new Date(0) }));
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
  return { S3Client, HeadBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteObjectsCommand };
});

/** 测试辅助：把 Node Readable 收成 Buffer（流式上传 mock 用）。 */
async function collectStream(stream: import("stream").Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

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
  icon?: string | null;
  trashedAt?: string | null; deletedFromParentId?: string | null;
}
interface Manifest {
  version: number; workspaceId: string; commitId: string; prevCommitId: string | null; createdAt: string; notes: ManifestNote[];
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
  // 模拟"其他设备写入"：真实远端变更必然带新 commitId（零变更早退据此判定）
  manifest.commitId = crypto.randomUUID();
  s3.bucket.set(key("manifests/latest.json"), Buffer.from(JSON.stringify(manifest), "utf8"));
}

// ===== FakeStore：实现 sync.ts 用到的 Store 子集（内存态 + 临时文件） =====
class FakeStore {
  /** V5 Phase 2：日志注入点（测试用静默实现） */
  logScopes: LoggerScopes = createSilentLoggerScopes();
  settings: S3Settings | null = null;
  notes = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; syncState: string; isConflict: boolean; isLocked?: boolean; lockedAt?: string | null; trashedAt?: string | null; deletedFromParentId?: string | null; icon?: string | null }>();
  /** 测试探针：contentHash（读 .lake）被调用的次数，用于断言"跳过扫描"生效。 */
  hashReads = 0;
  deleted = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string }>();
  baseHashes = new Map<string, string>();
  lastUploadedHashes = new Map<string, string>();
  lastSyncedMetaAtMap = new Map<string, string>();
  lastSeenCommitId: string | null = null;
  lastTombstoneSig = "";
  pendingSync = new Set<string>();
  gcPending = new Map<string, string>();
  purgedNotes = new Map<string, string>();
  currentRefs = new Map<string, Set<string>>();
  historySnapshots: string[] = [];
  orphans = new Set<string>();
  syncedAt: string | null = null;
  lastResult: unknown = null;
  private dir: string;
  /** 单调时钟：保证同毫秒内多次 new Date() 产生严格递增的时间戳
   * （reconcile 时间判据 remoteUpdatedAt vs lastSyncedMetaAt 依赖严格时序；
   *  vitest 执行极快，真实用户操作间隔不会触发同毫秒，但测试必须确定）。 */
  private monotonicMs = 0;
  private nowIso(): string {
    const now = Date.now();
    this.monotonicMs = Math.max(now, this.monotonicMs + 1);
    return new Date(this.monotonicMs).toISOString();
  }

  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-sync-test-"));
    fs.mkdirSync(path.join(this.dir, "notes"), { recursive: true });
  }
  private notePath(id: string) { return path.join(this.dir, "notes", `${id}.lake`); }

  // ---- 测试辅助 ----
  createNote(id: string, title: string, content: string) {
    const updatedAt = this.nowIso();
    this.notes.set(id, { id, title, parentId: null, sortOrder: this.notes.size, updatedAt, syncState: "local", isConflict: false, icon: null });
    fs.writeFileSync(this.notePath(id), content, "utf8");
  }
  modifyNote(id: string, content: string) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`笔记不存在: ${id}`);
    n.updatedAt = this.nowIso();
    n.syncState = "local";
    fs.writeFileSync(this.notePath(id), content, "utf8");
  }
  setIcon(id: string, icon: string | null, updatedAt = this.nowIso()) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`笔记不存在: ${id}`);
    n.icon = icon;
    n.updatedAt = updatedAt;
    n.syncState = "local";
  }
  /** 模拟真实 restoreHistory：写回快照正文 + 标 local，保持 base/lastUploaded 不动（P0-1 §5.2） */
  restoreHistoryVersion(id: string, content: string) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`笔记不存在: ${id}`);
    fs.writeFileSync(this.notePath(id), content, "utf8");
    n.updatedAt = this.nowIso();
    n.syncState = "local";
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
  // P3-1：adapter getNote/记账路径的单行查询（真实 Store 由 noteQueries.getNoteForSync 提供）
  getNoteForSync(id: string) { const n = this.notes.get(id); return n ? { ...n } : null; }
  listDeletedNotesForSync() { return [...this.deleted.values()].map((d) => ({ ...d })); }
  folders = new Map<string, { id: string; title: string; parentId: string | null; sortOrder: number; nodeType: "notebook" | "group"; icon: string | null; updatedAt: string }>();
  listFoldersForSync() { return [...this.folders.values()]; }
  importRemoteFolder(folder: { id: string; title: string; parentId: string | null; sortOrder: number; nodeType: "notebook" | "group"; icon: string | null; updatedAt: string }) { this.folders.set(folder.id, folder); }
  markFolderSynced(id: string, expectedUpdatedAt: string) {
    const f = this.folders.get(id);
    if (!f || f.updatedAt !== expectedUpdatedAt) return false;
    return true;
  }
  defaultNotebookId() { return "notebook-personal"; }
  hasTreeNode(id: string) { return id === "notebook-personal" || this.folders.has(id) || this.notes.has(id); }
  applyRemoteNoteMeta(note: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean; trashedAt?: string | null; deletedFromParentId?: string | null; icon?: string | null }) {
    const n = this.notes.get(note.id);
    if (n) {
      n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = note.isConflict;
      if (note.icon !== undefined) n.icon = note.icon ?? null;
      if (note.parentId === "notebook-trash") {
        n.trashedAt = note.trashedAt ?? n.trashedAt ?? this.nowIso();
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
  lastSyncedMetaAt(id: string) { return this.lastSyncedMetaAtMap.get(id) ?? null; }
  getLastSeenCommitId() { return this.lastSeenCommitId; }
  setLastSeenCommitId(v: string) { this.lastSeenCommitId = v; }
  getLastTombstoneSig() { return this.lastTombstoneSig; }
  setLastTombstoneSig(v: string) { this.lastTombstoneSig = v; }
  tombstoneSignature() {
    let count = 0; let max = "";
    for (const d of this.deleted.values()) { count += 1; if (d.deletedAt > max) max = d.deletedAt; }
    return `${count}:${max}`;
  }
  hasLocalPendingNotes() {
    for (const n of this.notes.values()) if (n.syncState !== "synced") return true;
    return false;
  }
  allSyncBaseInfo() {
    const out = new Map<string, { syncState: string; updatedAt: string; baseHash: string | null; lastSyncedMetaAt: string | null; lastUploadedHash: string | null }>();
    for (const n of this.notes.values()) {
      out.set(n.id, {
        syncState: n.syncState, updatedAt: n.updatedAt,
        baseHash: this.baseHashes.get(n.id) ?? null,
        lastSyncedMetaAt: this.lastSyncedMetaAtMap.get(n.id) ?? null,
        lastUploadedHash: this.lastUploadedHashes.get(n.id) ?? null,
      });
    }
    return out;
  }
  // 历史快照（sync 接受远端时强制留档；FakeStore 用内存记录）
  createHistorySnapshot(noteId: string, _content?: string, _force?: boolean) {
    this.historySnapshots = this.historySnapshots || [];
    this.historySnapshots.push(noteId);
    return this.historySnapshots.length;
  }
  markSynced(id?: string) {
    if (id) {
      this.pendingSync.delete(id); this.restorePending.delete(id);
      const n = this.notes.get(id); if (n) { n.syncState = "synced"; this.lastSyncedMetaAtMap.set(id, n.updatedAt); }
    }
  }
  /** V5 §5.2 简化模拟：仅以 updatedAt 为条件（FakeStore 无真实磁盘正文/元数据一致性，够覆盖同步测试场景） */
  markSyncedIfUnchanged(id: string, expected: { contentHash: string; updatedAt: string; title: string; parentId: string | null; sortOrder: number; isLocked: boolean; lockedAt: string | null; icon: string | null }) {
    const n = this.notes.get(id);
    if (!n || n.updatedAt !== expected.updatedAt) return false;
    n.syncState = "synced";
    this.pendingSync.delete(id); this.restorePending.delete(id);
    this.lastSyncedMetaAtMap.set(id, n.updatedAt);
    return true;
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
  addS3GcPending(key: string, markedAt = this.nowIso()) { if (!this.gcPending.has(key)) this.gcPending.set(key, markedAt); }
  removeS3GcPending(keys: string[]) { for (const key of keys) this.gcPending.delete(key); }
  listS3GcPending() { return [...this.gcPending.entries()].map(([key, markedAt]) => ({ key, markedAt })); }
  getS3GcSettings() { return { gcRetentionDays: 7, gcIntervalHours: 24, trashAutoPurgeDays: 0 }; }
  listNoteIdsWithHistory() { return [...new Set(this.historySnapshots ?? [])]; }
  gcLog: Array<Record<string, unknown>> = [];
  recordS3GcLog(action: string, key: string, reason: string, commitId: string | null, deviceId: string | null, ok: boolean) {
    this.gcLog.push({ action, key, reason, commitId, deviceId, ok });
  }
  markPurged(id: string) { this.purgedNotes.set(id, this.nowIso()); }
  markPurgeSynced(id: string) { this.purgedNotes.delete(id); }
  listPurgedNotesForSync() {
    return [...this.purgedNotes.entries()].map(([id, purgedAt]) => ({ id, title: id, parentId: null, sortOrder: 0, updatedAt: purgedAt, deletedAt: purgedAt, purgedAt }));
  }
  setNoteLocked(id: string, locked: boolean) {
    const n = this.notes.get(id);
    if (!n) throw new Error(`笔记不存在: ${id}`);
    n.isLocked = locked;
    n.lockedAt = this.nowIso();
    n.syncState = "local";
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
      n.trashedAt = this.nowIso();
      n.syncState = "local";
    }
  }
  /** purge = 彻底删除 + 写墓碑（deleted_notes 带 purged_at）。 */
  purgeTrashItem(id: string) {
    const n = this.notes.get(id);
    if (n) {
      this.deleted.set(id, { id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt, deletedAt: this.nowIso() });
      this.purgedNotes.set(id, this.nowIso());
      this.notes.delete(id);
    }
  }
  /** 收到他端 purge 墓碑：保留副本并标 purged（不上传、可恢复）。 */
  applyRemotePurge(id: string) {
    const n = this.notes.get(id);
    if (n) {
      n.deletedFromParentId = n.deletedFromParentId ?? n.parentId;
      n.parentId = "notebook-trash";
      n.trashedAt = n.trashedAt ?? this.nowIso();
      n.syncState = "purged";
    }
  }
  /** 远端软删传播（删除压编辑）：移入回收站，标 local 待下载分支核对。 */
  applyRemoteMoveToTrash(id: string, trashedAt: string | null, deletedFromParentId: string | null) {
    const n = this.notes.get(id);
    if (n) {
      n.deletedFromParentId = n.deletedFromParentId ?? deletedFromParentId ?? n.parentId;
      n.parentId = "notebook-trash";
      n.trashedAt = n.trashedAt ?? trashedAt ?? this.nowIso();
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
    n.updatedAt = this.nowIso();
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

  it("故障注入：manifest 上传中断时同步失败，不把本地笔记误标为 synced", async () => {
    const store = new FakeStore();
    store.settings = SETTINGS;
    store.createNote("fault-manifest", "故障注入", "<p>本地内容</p>");
    s3.failCommand = "PutObjectCommand";
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/injected S3 failure/);
    expect(store.notes.get("fault-manifest")?.syncState).toBe("local");
    expect(s3.bucket.has(key("manifests/latest.json"))).toBe(false);
  });

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

  it("验收（性能）：零变更早退——二次同步不写新 manifest、不逐条记账", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    await syncNow(store as unknown as Store);
    const manifestsBefore = [...s3.bucket.keys()].filter((k) => k.startsWith(key("manifests/"))).length;
    const r = await syncNow(store as unknown as Store);
    expect(r.uploaded).toBe(0);
    expect(r.downloaded).toBe(0);
    // 早退：未写任何新 manifest（commit/latest 均未变）
    const manifestsAfter = [...s3.bucket.keys()].filter((k) => k.startsWith(key("manifests/"))).length;
    expect(manifestsAfter).toBe(manifestsBefore);
    // 本地有变更 → 不早退，正常写入
    store.modifyNote("n1", "<p>v2</p>");
    const r3 = await syncNow(store as unknown as Store);
    expect(r3.uploaded).toBeGreaterThan(0);
    expect(readManifest().notes.find((n) => n.id === "n1")!.contentHash).toBe(store.contentHash("n1"));
  });

  it("验收#3（修订·滞后裁剪）：manifest 稳定有界 + prevCommitId 链连通（O(3)）+ 无游离保留", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    await syncNow(store as unknown as Store);
    // 15 次"有变更"的同步（零变更早退不写 manifest，故用真实变更驱动裁剪）
    for (let i = 1; i <= 15; i += 1) {
      store.modifyNote("n1", `<p>v${i}</p>`);
      await syncNow(store as unknown as Store);
    }
    const manifests = [...s3.bucket.keys()].filter((k) => k.startsWith(key("manifests/")));
    expect(manifests).toContain(key("manifests/latest.json"));
    // 目标 5 份（latest + 本 commit + 链 3 prev），水位 target+SLACK(6)=11；滞后裁剪后必显著低于全量
    expect(manifests.length).toBeLessThanOrEqual(12);
    expect(manifests.length).toBeLessThan(15);
    const commits = manifests.filter((k) => k !== key("manifests/latest.json"));
    const latest = readManifest();
    // 滞后裁剪期允许链比 KEEP(3) 略长（下次水位触发才裁回），但保留的 commit 必须连成**一条完整 prevCommitId 链**：
    // 沿链遍历直到某个 link 不在云端（链尾已被裁）为止，途中不得断链，且不得有游离在链外的保留。
    const chainKeys = new Set<string>([key("manifests/latest.json")]);
    let prev = latest.prevCommitId;
    let links = 0;
    while (prev) {
      const commitKey = key(`manifests/${prev}.json`);
      if (!s3.bucket.has(commitKey)) break;                 // 到达链尾（老 commit 已裁剪）——正常
      chainKeys.add(commitKey);
      prev = JSON.parse(maybeGunzip(s3.bucket.get(commitKey)!).toString("utf8")).prevCommitId as string | null;
      links += 1;
    }
    // GC/对账引用可达性下限：latest 之前至少 3 层 commit 仍在云端
    expect(links).toBeGreaterThanOrEqual(3);
    // 无游离保留：每个 commit 文件要么在这条链上，要么就是刚写入的 latest.commitId（链头，walk 从 prev 起故不含）
    for (const k of commits) {
      const commitId = k.slice(key("manifests/").length, -".json".length);
      expect(chainKeys.has(k) || commitId === latest.commitId).toBe(true);
    }
  });

  it("验收#1（统一先同步者胜）：先同步者的图标胜出、后同步者跟随；已确认后续编则本地胜", async () => {
    const storeA = new FakeStore(); storeA.saveS3Settings(SETTINGS);
    const storeB = new FakeStore(); storeB.saveS3Settings(SETTINGS);
    storeA.createNote("n1", "测试11", "<p>x</p>");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);

    // 场景1：A 先改先同步 → A 的图标胜出，B 后同步跟随（不再用编辑时间让 B 覆盖 A）
    storeA.setIcon("n1", "🍇", "2030-01-01T00:00:01.000Z");
    storeB.setIcon("n1", "🥔", "2030-01-01T00:00:02.000Z");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")!.icon).toBe("🍇");
    expect(storeA.listNotesForSync().find((n) => n.id === "n1")!.icon).toBe("🍇");
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")!.icon).toBe("🍇");

    // 场景2：B 先改先同步 → B 的图标胜出，A 后同步跟随
    storeA.setIcon("n1", "🚗", "2030-01-01T00:00:03.000Z");
    storeB.setIcon("n1", "🚌", "2030-01-01T00:00:04.000Z");
    await syncNow(storeB as unknown as Store);
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")!.icon).toBe("🚌");
    expect(storeA.listNotesForSync().find((n) => n.id === "n1")!.icon).toBe("🚌");
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")!.icon).toBe("🚌");

    // 场景3：B 已确认 A 的图标后再主动改 → B 胜（在已确认版本上续编，不被回滚）
    storeA.setIcon("n1", "💎", "2030-01-01T00:00:05.000Z");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store); // B 确认 💎
    storeB.setIcon("n1", "💣", "2030-01-01T00:00:06.000Z");
    await syncNow(storeB as unknown as Store);
    await syncNow(storeA as unknown as Store);
    expect(readManifest().notes.find((n) => n.id === "n1")!.icon).toBe("💣");
    expect(storeA.listNotesForSync().find((n) => n.id === "n1")!.icon).toBe("💣");
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")!.icon).toBe("💣");
  });

  it("验收#1（统一先同步者胜·正文）：B 已同步 A 的版本后续编 → B 的编辑胜出，不被远端覆盖", async () => {
    const storeA = new FakeStore(); storeA.saveS3Settings(SETTINGS);
    const storeB = new FakeStore(); storeB.saveS3Settings(SETTINGS);
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);
    // A 编辑 v2 并提交；B 同步确认 v2（base=v2）
    storeA.modifyNote("n1", "<p>v2</p>");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);
    expect(storeB.baseHash("n1")).toBe(storeA.contentHash("n1"));
    // B 在 v2 基础上续编 v3 并同步：远端==已确认基线 → 本地胜（此前会被 superseded 覆盖丢编辑）
    const histBefore = storeB.historySnapshots.length;
    storeB.modifyNote("n1", "<p>v3-b-continue</p>");
    const rb = await syncNow(storeB as unknown as Store);
    expect(rb.supersededNotes.some((n) => n.id === "n1")).toBe(false);
    expect(storeB.historySnapshots.length).toBe(histBefore); // 未留档（本地没被覆盖）
    expect(readManifest().notes.find((n) => n.id === "n1")!.contentHash).toBe(storeB.contentHash("n1"));
    // A 再同步 → 跟随 B 的 v3
    await syncNow(storeA as unknown as Store);
    expect(storeA.contentHash("n1")).toBe(storeB.contentHash("n1"));
  });

  it("验收：历史回滚后同步 → 回滚版上传并跨端传播（本地胜，不被覆盖）", async () => {
    const storeA = new FakeStore(); storeA.saveS3Settings(SETTINGS);
    const storeB = new FakeStore(); storeB.saveS3Settings(SETTINGS);
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);
    // B 编辑 v2 并提交；A 同步确认 v2
    storeB.modifyNote("n1", "<p>v2</p>");
    await syncNow(storeB as unknown as Store);
    await syncNow(storeA as unknown as Store);
    expect(storeB.baseHash("n1")).toBe(storeB.contentHash("n1"));
    // B 回滚历史到 v1 并同步：恢复版上传覆盖云端（不 superseded）
    storeB.restoreHistoryVersion("n1", "<p>v1</p>");
    const rb = await syncNow(storeB as unknown as Store);
    expect(rb.supersededNotes.some((n) => n.id === "n1")).toBe(false);
    expect(readManifest().notes.find((n) => n.id === "n1")!.contentHash).toBe(sha256("<p>v1</p>"));
    // A 再同步 → 跟随回滚版 v1
    await syncNow(storeA as unknown as Store);
    expect(storeA.contentHash("n1")).toBe(sha256("<p>v1</p>"));
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
    // V5 Phase 1：conflicts 死账已改为 supersededNotes.length 别名（本场景 1 条 superseded）
    expect(r.conflicts).toBe(r.supersededNotes.length); // 不产生冲突副本（isConflict=false）
    // 接受远端最新：本地文件被 v2 remote 覆盖
    expect(fs.readFileSync(store.notePathFor("n1"), "utf8")).toBe("<p>v2 remote</p>");
    // 同步基线更新到远端
    expect(store.baseHash("n1")).toBe(remoteHash);
    // 本地被覆盖前强制留档 + supersededNotes 记录（UI 提醒用）
    expect(store.historySnapshots).toContain("n1");
    expect(r.supersededNotes.some((n) => n.id === "n1")).toBe(true);
  });

  it("本地已同步但本机上传过该版本（本机是作者）被其他设备覆盖 → 接受远端 + 强制留档（superseded）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    // 本机上传 v1：last_uploaded_hash=v1、base=v1；本地此后没有任何编辑（localChanged=false）
    // 但 v1 是本机编辑成果（lastUploadedHash==localHash）→ 被远端覆盖必须留档（§4.2）

    // 远端被其他设备改成 v2 remote（≠ last_uploaded_hash v1 → 非本机传的）
    const remoteHash = sha256("<p>v2 remote</p>");
    s3.bucket.set(key(`objects/n1-${remoteHash}.lake`), Buffer.from("<p>v2 remote</p>", "utf8"));
    const manifest = readManifest();
    manifest.notes[0].contentHash = remoteHash;
    writeManifest(manifest);

    const r = await syncNow(store as unknown as Store);
    expect(r.conflicts).toBe(r.supersededNotes.length); // V5 Phase 1：conflicts = supersededNotes.length 别名
    // 接受远端最新：本地文件被 v2 remote 覆盖
    expect(fs.readFileSync(store.notePathFor("n1"), "utf8")).toBe("<p>v2 remote</p>");
    expect(store.baseHash("n1")).toBe(remoteHash);
    // 2026-08-22 二修（用户验收发现）：本机上传过该版本（lastUploadedHash==localHash）说明本机是作者，
    // 被其他设备版本覆盖时必须留档——否则本机历史丢失自己的编辑（A 上传 A1 后 B 恢复历史续编覆盖 A1 的场景）。
    // 仅"本机从未上传/从未编辑（lastUploadedHash=null）"的纯跟随场景才不留档。
    expect(store.historySnapshots).toContain("n1");
    expect(r.supersededNotes.some((n) => n.id === "n1")).toBe(true);
  });

  it("本地已同步且本机从未上传过该笔记（纯跟随他端更新）→ 接受远端，不留档（superseded=false）", async () => {
    // A 创建并上传 v1；B 仅下载（从未上传，last_uploaded_hash=null）
    const storeA = new FakeStore(); storeA.saveS3Settings(SETTINGS);
    const storeB = new FakeStore(); storeB.saveS3Settings(SETTINGS);
    storeA.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(storeA as unknown as Store);
    await syncNow(storeB as unknown as Store);
    expect(storeB.lastUploadedHash("n1")).toBeNull(); // B 从未上传

    // A 更新为 v2 remote（非 B 上传的）
    storeA.modifyNote("n1", "<p>v2 remote</p>");
    await syncNow(storeA as unknown as Store);

    const r = await syncNow(storeB as unknown as Store);
    expect(r.conflicts).toBe(r.supersededNotes.length);
    // B 接受远端最新
    expect(fs.readFileSync(storeB.notePathFor("n1"), "utf8")).toBe("<p>v2 remote</p>");
    expect(storeB.baseHash("n1")).toBe(storeA.contentHash("n1"));
    // B 从未上传（无本机编辑成果）→ 正常跟随更新，不留档
    expect(storeB.historySnapshots).not.toContain("n1");
    expect(r.supersededNotes.some((n) => n.id === "n1")).toBe(false);
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

  it("V5 §5.5 审计#4：资源缺失 → B 方案跳过+warnings；损坏 → 仍中止；正文缺失 → remote_incomplete", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>a</p>");
    await syncNow(store as unknown as Store);

    // 声明资源但对象缺失 → B 方案：跳过该条目 + warnings（asset_missing），不导入、不覆盖
    let manifest = readManifest();
    manifest.notes[0] = {
      id: "n2", title: "远端", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>remote</p>"), isConflict: false,
      assets: [{ filename: "img.png", size: 3, hash: sha256("img") }],
    };
    writeManifest(manifest);
    s3.bucket.set(key(`objects/n2-${sha256("<p>remote</p>")}.lake`), Buffer.from("<p>remote</p>", "utf8"));
    const r1 = await syncNow(store as unknown as Store);
    expect(r1.warnings).toEqual([{ kind: "asset_missing", noteId: "n2" }]);
    expect(store.notes.has("n2")).toBe(false); // 未导入半成品

    // 基线：第一轮 syncNow 已重建 manifest（跳过 n2），无缺失时 warnings 应为 undefined
    const rBase = await syncNow(store as unknown as Store);
    expect(rBase.warnings).toBeUndefined();

    // 声明资源但内容损坏（hash 不符）→ 仍中止（损坏拒绝，不静默接受）
    // 注：第一轮 syncNow 上传阶段会重建 manifest（未导入的 n2 不在其中），需重新构造条目
    manifest = readManifest();
    manifest.notes.push({
      id: "n2", title: "远端", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>remote</p>"), isConflict: false,
      assets: [{ filename: "img.png", size: 3, hash: sha256("img") }],
    });
    writeManifest(manifest);
    s3.bucket.set(key("assets/n2/img.png"), Buffer.from("xxx", "utf8")); // size 3 但 hash 不符
    await expect(syncNow(store as unknown as Store)).rejects.toThrow(/哈希不符/);
    expect(store.notes.has("n2")).toBe(false);

    // 正文对象缺失 → B 方案：跳过 + warnings（remote_incomplete），不覆盖本地
    //（损坏场景 reject 未重建 manifest，先清掉残留的 n2 条目）
    manifest = readManifest();
    manifest.notes = manifest.notes.filter((n) => n.id !== "n2");
    manifest.notes.push({
      id: "n3", title: "缺失正文", parentId: null, sortOrder: 1,
      updatedAt: new Date().toISOString(), contentHash: sha256("<p>gone</p>"), isConflict: false, assets: [],
    });
    writeManifest(manifest);
    // 不写 objects/n3-...lake（对象缺失）
    const r3 = await syncNow(store as unknown as Store);
    expect(r3.warnings).toEqual([{ kind: "remote_incomplete", noteId: "n3" }]);
    expect(store.notes.has("n3")).toBe(false); // 未导入
  });

  it("v3 锁同步：仅锁变更（正文哈希相同）也能下载合并；LWW 新者胜", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>hello</p>");
    await syncNow(store as unknown as Store);

    // 远端只改锁（正文哈希不变）：手工改写 manifest
    const manifest = readManifest();
    manifest.notes[0] = { ...manifest.notes[0], isLocked: true, lockedAt: "2030-01-01T00:00:00.000Z" };
    writeManifest(manifest);
    const r = await syncNow(store as unknown as Store);
    expect(r.downloaded).toBe(0); // 正文未下载
    expect(store.notes.get("n1")?.isLocked).toBe(true); // 锁已合并下来

    // 本地更新解锁（时间戳新）→ 远端旧锁不覆盖本地
    store.setNoteLocked("n1", false);
    const localAt = store.notes.get("n1")!.lockedAt!;
    manifest.notes[0] = { ...manifest.notes[0], isLocked: true, lockedAt: "2020-01-01T00:00:00.000Z" };
    writeManifest(manifest);
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

    await syncNow(store as unknown as Store);
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
    // B 同步：回收站条目（非墓碑）→ 全文下载到 B 回收站；资源惰性不下载（恢复时强拉全量）
    await syncNow(storeB as unknown as Store);
    expect(storeB.notes.has("n1")).toBe(true);
    expect(storeB.listNotesForSync().find((n) => n.id === "n1")?.parentId).toBe("notebook-trash");
    expect(fs.existsSync(path.join(storeB.noteAssetsPathFor("n1"), "1786735000000_a1b2c3d4.png"))).toBe(false);
    // B 恢复 = 删除方版本（正文；资源在恢复前强拉，本 FakeStore 无 listDeclaredAssets 降级为空）
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
    // 删除压编辑：回收站内容以 A 删除的那版为准（B 的离线编辑不得溜进回收站内容）
    const aHash = storeA.contentHash("n1");
    expect(readManifest().notes.find((n) => n.id === "n1")!.contentHash).toBe(aHash);
    expect(storeB.contentHash("n1")).toBe(aHash);
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


describe("S3 GC 语义修正（2026-09-03）", () => {
  beforeEach(() => s3.reset());

  it("对账：已过窗口但仍被引用的 pending 行 → 清表不动对象（表只反映真冗余）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    const h1 = store.contentHash("n1");
    // 模拟脏数据/他端恢复：对象其实仍被 latest 引用，但本地残留一条超窗待回收行
    store.gcPending.set(`objects/n1-${h1}.lake`, "2020-01-01T00:00:00.000Z");

    const r = await runGcReconcile(store as unknown as Store);
    expect(r.deleted).toBe(0);                                  // 不删仍在引用的对象
    expect(r.clearedReferenced).toBe(1);                        // 清掉表内冗余行
    expect(store.gcPending.has(`objects/n1-${h1}.lake`)).toBe(false);
    expect(s3.bucket.has(key(`objects/n1-${h1}.lake`))).toBe(true); // 云端对象完好
  });

  it("对账：窗口内行保留；超窗未引用行删除（口径与深度清理一致）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    store.createNote("n2", "笔记B", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    // 窗口内：刚标记的孤儿（保留）
    store.addS3GcPending("objects/in-window-orphan.lake");
    // 超窗未引用：删
    store.addS3GcPending("objects/dead-orphan.lake", "2020-01-01T00:00:00.000Z");
    const r = await runGcReconcile(store as unknown as Store);
    expect(r.deleted).toBe(1);
    expect(r.kept).toBeGreaterThanOrEqual(1);
    expect(store.gcPending.has("objects/in-window-orphan.lake")).toBe(true);
    expect(store.gcPending.has("objects/dead-orphan.lake")).toBe(false);
  });

  it("深度清理尊重本机待回收窗口：刚被移除的旧对象不被创建年龄提前清掉", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    const orphan = "objects/recently-removed.lake";
    s3.bucket.set(key(orphan), Buffer.from("x", "utf8"));   // FakeS3 lastModified=1970 → 已超创建窗
    store.addS3GcPending(orphan);                            // 但标记为刚移除（窗口内）
    const dry = await runDeepCleanup(store as unknown as Store, { dryRun: true });
    expect(dry.keys).not.toContain(orphan);                  // 移除窗口保护生效
    // 窗口过后（标记改超窗）→ 可回收
    store.gcPending.set(orphan, "2020-01-01T00:00:00.000Z");
    const dry2 = await runDeepCleanup(store as unknown as Store, { dryRun: true });
    expect(dry2.keys).toContain(orphan);
    await runDeepCleanup(store as unknown as Store);
    expect(s3.bucket.has(key(orphan))).toBe(false);
  });

  it("手动对账 ignoreRetention：窗口内标记的未引用键也立即删除（手动=显式清云端）", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    store.addS3GcPending("objects/fresh-dead.lake");   // 刚标记（窗口内）
    const r = await runGcReconcile(store as unknown as Store, { ignoreRetention: true });
    expect(r.deleted).toBe(1);
    expect(store.gcPending.has("objects/fresh-dead.lake")).toBe(false);
  });

  it("手动深度清理 ignoreRetention：年龄未知的未引用键也立即删；自动模式保留", async () => {
    const store = newStore();
    store.createNote("n1", "笔记A", "<p>v1</p>");
    await syncNow(store as unknown as Store);
    const orphan = "objects/age-unknown.lake";
    s3.bucket.set(key(orphan), Buffer.from("x", "utf8"));
    s3.lastModifiedOverrides.set(key(orphan), null);   // 云端未给 LastModified（年龄未知）
    // 自动（默认）：年龄未知 → 保守不删
    const auto = await runDeepCleanup(store as unknown as Store, { dryRun: true });
    expect(auto.keys).not.toContain(orphan);
    // 手动（ignoreRetention）：显式清理 → 删全部未引用
    const manual = await runDeepCleanup(store as unknown as Store, { dryRun: true, ignoreRetention: true });
    expect(manual.keys).toContain(orphan);
    await runDeepCleanup(store as unknown as Store, { ignoreRetention: true });
    expect(s3.bucket.has(key(orphan))).toBe(false);
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

// ===== W-13：清单加载护栏（字节/条目上限） =====
describe("parseLakeManifest 清单护栏", () => {
  function validManifest(notesCount: number, foldersCount: number): Record<string, unknown> {
    const notes: Array<Record<string, unknown>> = [];
    for (let i = 0; i < notesCount; i++) {
      notes.push({
        id: `n${i}`, title: `note${i}`, parentId: "notebook-default", sortOrder: i,
        updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "a".repeat(64), isConflict: false, assets: [],
      });
    }
    const folders: Array<Record<string, unknown>> = [];
    for (let i = 0; i < foldersCount; i++) {
      folders.push({
        id: `f${i}`, title: `folder${i}`, parentId: null, sortOrder: i,
        nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    return {
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null,
      createdAt: "2026-01-01T00:00:00.000Z", notes, folders,
    };
  }

  it("合法清单正常解析", () => {
    const m = parseLakeManifest(Buffer.from(JSON.stringify(validManifest(2, 1)), "utf8"));
    expect(m.notes.length).toBe(2);
    expect(m.folders.length).toBe(1);
  });

  it("字节超限（gzip 炸弹/异常膨胀）在解析前被拒", () => {
    const bytes = Buffer.from(JSON.stringify(validManifest(1, 0)), "utf8");
    expect(() => parseLakeManifest(bytes, { maxBytes: 10 })).toThrow(/清单过大/);
  });

  it("notes 条目超限被拒", () => {
    const bytes = Buffer.from(JSON.stringify(validManifest(5, 0)), "utf8");
    expect(() => parseLakeManifest(bytes, { maxNotes: 3 })).toThrow(/清单条目过多/);
  });

  it("folders 条目超限被拒", () => {
    const bytes = Buffer.from(JSON.stringify(validManifest(0, 5)), "utf8");
    expect(() => parseLakeManifest(bytes, { maxFolders: 3 })).toThrow(/清单目录条目过多/);
  });
});

describe("validateS3Settings endpoint 校验（V5 §5.6）", () => {
  const base: S3Settings = { endpoint: "https://s3.example.com", region: "test", bucket: "b", prefix: "p", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: true };
  it("https endpoint 通过", () => {
    expect(() => validateS3Settings({ ...base })).not.toThrow();
  });
  it("http 非 local → 拒绝（签名重放防护）", () => {
    expect(() => validateS3Settings({ ...base, endpoint: "http://s3.example.com" })).toThrow(/HTTPS/);
  });
  it("http://localhost 开发例外通过", () => {
    expect(() => validateS3Settings({ ...base, endpoint: "http://localhost:9000" })).not.toThrow();
  });
  it("非法 URL → 拒绝", () => {
    expect(() => validateS3Settings({ ...base, endpoint: "://bad" })).toThrow();
  });
});
