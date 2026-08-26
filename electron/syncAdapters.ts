/**
 * 桌面同步 adapter（SHARED-SYNC-PLAN Step 3/5）：把桌面 Store + ObjectStore 包装成
 * 共享 syncEngine 的端口（SyncDbPort / S3Store），使桌面可调 syncEngine.syncNow。
 */
import fs from "node:fs";
import path from "node:path";
import type { Store } from "./store.js";
import type { ObjectStore } from "./sync.js";
import type { S3Store, SyncDbPort, LocalNoteRow, SyncConfig } from "../src/core/syncEngine.js";
import type { ManifestFolder, ManifestNote } from "../src/core/manifestTypes.js";
import { sha256Hex } from "../src/core/syncUtils.js";

export function createS3StoreAdapter(remote: ObjectStore, prefix: string): S3Store {
  // key 语义：syncEngine 传**含 prefix** 的完整对象键（S3Store 契约），桌面 ObjectStore 的 key
  // **不含 prefix**（ObjectStore 内部 this.key() 加）。adapter 剥离 prefix 再转发，避免双写前缀。
  const strip = (key: string): string => (prefix && key.startsWith(prefix + "/") ? key.slice(prefix.length + 1) : key);
  return {
    async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
      const buf = await remote.getOptional(strip(key), opts);
      return buf ? new Uint8Array(buf) : null;
    },
    async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
      const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
      await remote.put(strip(key), bytes, "application/octet-stream", { gzip: opts?.gzip });
    },
  };
}

/** 本地 hash：synced 笔记信任缓存基线（baseHash，不读文件——对齐桌面 cachedBase 优化，10k 条省 ~2 万次 IO）；
 * local/异常状态读文件核对（out-of-band 外部改文件不在本期覆盖）。 */
function localHashOf(store: Store, n: ReturnType<Store["listNotesForSync"]>[number]): string | null {
  if (n.syncState === "synced") return store.baseHash(n.id);
  try { return store.contentHash(n.id); } catch { return null; }
}

export function createStoreSyncPort(store: Store): SyncDbPort {
  const rowFromSync = (n: ReturnType<Store["listNotesForSync"]>[number]): LocalNoteRow => ({
    id: n.id, title: n.title, parentId: n.parentId ?? null, sortOrder: n.sortOrder, updatedAt: n.updatedAt,
    syncState: n.syncState ?? "local",
    trashedAt: n.trashedAt ?? null,
    restorePendingAt: store.isRestorePending(n.id) ? n.updatedAt : null,
    isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null, isConflict: n.isConflict,
    deletedFromParentId: n.deletedFromParentId ?? null,
    content: "",
  });

  return {
    getNote(id: string): LocalNoteRow | null {
      const n = store.listNotesForSync().find((x) => x.id === id);
      if (!n) return null;
      const row = rowFromSync(n);
      row.contentHash = localHashOf(store, n) ?? undefined;
      try { row.content = fs.readFileSync(store.notePathFor(id), "utf8"); } catch { /* 文件缺失 */ }
      return row;
    },
    getAllNotes(): LocalNoteRow[] {
      return store.listNotesForSync().map((n) => {
        const row = rowFromSync(n);
        row.contentHash = localHashOf(store, n) ?? undefined;
        try { row.content = fs.readFileSync(store.notePathFor(n.id), "utf8"); } catch { /* 文件缺失 */ }
        return row;
      });
    },
    getSyncBase(id: string) {
      const base = store.baseHash(id);
      if (base === null) return null;
      const out = { contentHash: base, lastUploadedHash: store.lastUploadedHash(id), lastSyncedMetaAt: store.lastSyncedMetaAt(id) ?? null };
      return out;
    },
    applyRemoteNote(note: ManifestNote, content: string): void {
      store.importRemoteNote(note as never, Buffer.from(content, "utf8"), []);
    },
    applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, deletedFromParentId: string | null, parentId: string | null, sortOrder: number): void {
      // 先写删除方最新内容（墓碑携带内容，删除压编辑——B 的离线编辑不得溜进回收站，对齐桌面原 trash-cross）
      try { fs.writeFileSync(store.notePathFor(id), content, "utf8"); } catch { /* 内容写失败不阻断移入回收站 */ }
      store.applyRemoteMoveToTrash(id, trashedAt, deletedFromParentId);
    },
    localTrashNote(id: string): void { store.deleteTreeNode(id); },
    localRestoreNote(id: string): void { store.restoreTrashItem(id); },
    applyRemotePurge(id: string): void { store.applyRemotePurge(id); },
    rememberDeleted(note: ManifestNote, deletedAt: string): void { store.rememberDeleted(note as never, deletedAt); },
    applyRemoteNoteMeta(note: ManifestNote): void { store.applyRemoteNoteMeta(note as never); },
    applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): void { store.applyRemoteLock(id, locked, lockedAt); },
    markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null): void {
      store.setBaseHash(id, contentHash);
      // 无条件写：string = 本机上传版本；null = 两端一致 skip（清除误标，SQL 写 NULL）
      store.setLastUploadedHash(id, lastUploadedHash);
      const n = store.listNotesForSync().find((x) => x.id === id);
      if (n) store.markSyncedIfUnchanged(id, {
        contentHash, updatedAt: metaAt, title: n.title, parentId: n.parentId ?? null,
        sortOrder: n.sortOrder, isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
      });
    },
    markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string): void {
      const n = store.listNotesForSync().find((x) => x.id === id);
      if (!n) return;
      // 记账三元组：baseHash（基线）+ lastUploadedHash（已发布 hash，null=下载对账不写）+ lastSyncedMetaAt
      store.setBaseHash(id, expectedContentHash);
      if (lastUploadedHash) store.setLastUploadedHash(id, lastUploadedHash);
      store.markSyncedIfUnchanged(id, {
        contentHash: expectedContentHash, updatedAt: metaAt, title: n.title, parentId: n.parentId ?? null,
        sortOrder: n.sortOrder, isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
      });
    },
    setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null): void {
      store.setBaseHash(id, contentHash);
      if (lastUploadedHash) store.setLastUploadedHash(id, lastUploadedHash);
      // 下载对账也记录已确认版本（lastSyncedMetaAt）——否则 lma=null 使 decideMetaApply 恒 true，
      // 本地移动/改名会被远端旧 meta 撤销（循环移动收敛依赖 lma）。
      if (metaAt) {
        const n = store.listNotesForSync().find((x) => x.id === id);
        if (n) store.markSyncedIfUnchanged(id, {
          contentHash, updatedAt: metaAt, title: n.title, parentId: n.parentId ?? null,
          sortOrder: n.sortOrder, isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
        });
      }
    },
    defaultNotebookId(): string { return store.defaultNotebookId(); },
    importRemoteFolder(folder: ManifestFolder): void { store.importRemoteFolder(folder as never); },
    listFoldersForSync() {
      return store.listFoldersForSync().map((f) => ({
        id: f.id, title: f.title, parentId: f.parentId ?? null, sortOrder: f.sortOrder, nodeType: f.nodeType,
        icon: f.icon ?? null, updatedAt: f.updatedAt, trashedAt: f.trashedAt ?? null, deletedFromParentId: f.deletedFromParentId ?? null,
      }));
    },
    createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number }): void {
      try { store.createHistorySnapshot(noteId, content, false); } catch { /* 留档失败不阻断 */ }
    },
    async saveAsset(noteId: string, filename: string, bytes: Uint8Array): Promise<void> {
      const dir = store.noteAssetsPathFor(noteId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), Buffer.from(bytes));
    },
    async listLocalAssets(noteId: string) {
      const dir = store.noteAssetsPathFor(noteId);
      if (!fs.existsSync(dir)) return [];
      const out: Array<{ filename: string; size: number; hash: string }> = [];
      for (const filename of fs.readdirSync(dir)) {
        const full = path.join(dir, filename);
        if (!fs.statSync(full).isFile()) continue;
        const bytes = fs.readFileSync(full);
        out.push({ filename, size: bytes.length, hash: sha256Hex(bytes) });
      }
      return out;
    },
    async readLocalAsset(noteId: string, filename: string): Promise<Uint8Array | null> {
      const full = path.join(store.noteAssetsPathFor(noteId), filename);
      return fs.existsSync(full) ? new Uint8Array(fs.readFileSync(full)) : null;
    },
    listDeletedNotesForSync() {
      return store.listDeletedNotesForSync().map((d) => ({ id: d.id, deletedAt: d.deletedAt, title: d.title }));
    },
    async readDeletedContent(id: string): Promise<string | null> {
      try { return fs.readFileSync(store.notePathFor(id), "utf8"); } catch { return null; }
    },
    forceHashRead(id: string): string | null {
      try { return store.contentHash(id); } catch { return null; }
    },
    revokeLocalDeletion(id: string): void { store.revokeLocalDeletion(id); },
    markFolderSynced(id: string, expectedUpdatedAt: string): boolean { return store.markFolderSynced(id, expectedUpdatedAt); },
    // 可选调用：测试 FakeStore/旧实现可能无此方法（文件夹级 purge 墓碑是新能力），无则 false
    isFolderPurged(id: string): boolean { return store.isFolderPurged?.(id) ?? false; },
    getLastSeenCommitId(): string | null { return store.getLastSeenCommitId(); },
    setLastSeenCommitId(commitId: string): void { store.setLastSeenCommitId(commitId); },
    getLastTombstoneSig(): string { return store.getLastTombstoneSig(); },
    setLastTombstoneSig(sig: string): void { store.setLastTombstoneSig(sig); },
    tombstoneSignature(): string { return store.tombstoneSignature(); },
    hasLocalPendingNotes(): boolean { return store.hasLocalPendingNotes(); },
    log(msg: string): void { store.logScopes.sync.info(msg); },
  };
}

export function syncConfigFromStore(store: Store): SyncConfig {
  const s = store.getS3Settings();
  if (!s) throw new Error("请先保存 S3 配置");
  return { endpoint: s.endpoint, region: s.region, bucket: s.bucket, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, prefix: s.prefix ?? "lake-notes" };
}