/**
 * 桌面同步 adapter（SHARED-SYNC-PLAN Step 3/5）：把桌面 Store + ObjectStore 包装成
 * 共享 syncEngine 的端口（SyncDbPort / S3Store），使桌面可调 syncEngine.syncNow。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "./store.js";
import type { ObjectStore } from "./sync.js";
import type { S3Store, SyncDbPort, LocalNoteRow, SyncConfig } from "../src/core/syncEngine.js";
import type { ManifestFolder, ManifestNote } from "../src/core/manifestTypes.js";
import { sha256Hex } from "../src/core/syncUtils.js";
import { setSha256HexImpl } from "../src/core/sha256Sync.js";

// P3-2：桌面端注入 node:crypto 的 SHA-256（比纯 JS 快 10-20 倍），经 core 注入点生效。
// 本文件仅桌面主进程加载；移动端（bridge.ts）不加载此注入，保持共享层纯 JS 实现。
setSha256HexImpl((input) => createHash("sha256").update(input).digest("hex"));

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
    // 流式上传：Node Readable + 显式 Content-Length（aws-sdk v3 对 stream body + 已知长度
    // 走普通签名请求，不触发 aws-chunked；七牛 Kodo 实测兼容）
    async putObjectStream(key: string, size: number, open: () => Promise<unknown | null>): Promise<void> {
      await remote.putStream(strip(key), size, open as () => Promise<import("node:stream").Readable | null>);
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
    // P3-1：显式取正文入口——engine 只在留历史快照/上传入队时调用（单行查询 + 读文件）。
    async getNote(id: string): Promise<LocalNoteRow | null> {
      const n = store.getNoteForSync(id);
      if (!n) return null;
      const row = rowFromSync(n);
      row.contentHash = localHashOf(store, n) ?? undefined;
      try { row.content = fs.readFileSync(store.notePathFor(id), "utf8"); } catch { /* 文件缺失 */ }
      return row;
    },
    // P3-1：元数据 + contentHash（synced 走 baseHash 缓存零 IO；仅待同步笔记读文件算 hash），
    // 不再无条件读全文——engine 在需要正文的分支显式调 getNote。
    async getAllNotes(): Promise<LocalNoteRow[]> {
      return store.listNotesForSync().map((n) => {
        const row = rowFromSync(n);
        row.contentHash = localHashOf(store, n) ?? undefined;
        return row;
      });
    },
    async getSyncBase(id: string) {
      const base = store.baseHash(id);
      if (base === null) return null;
      const out = { contentHash: base, lastUploadedHash: store.lastUploadedHash(id), lastSyncedMetaAt: store.lastSyncedMetaAt(id) ?? null };
      return out;
    },
    async recordDeclaredAssets(noteId: string, assets: Array<{ filename: string; size: number; hash: string }>): Promise<void> {
      if (typeof (store as any).recordDeclaredAssets === "function") store.recordDeclaredAssets(noteId, assets);
    },
    async listDeclaredAssets(noteId: string): Promise<Array<{ filename: string; size: number; hash: string }>> {
      return typeof (store as any).listDeclaredAssets === "function" ? store.listDeclaredAssets(noteId) : [];
    },
    async applyRemoteNote(note: ManifestNote, content: string): Promise<void> {
      store.importRemoteNote(note as never, Buffer.from(content, "utf8"), []);
    },
    async applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, deletedFromParentId: string | null, parentId: string | null, sortOrder: number): Promise<void> {
      // 先写删除方最新内容（墓碑携带内容，删除压编辑——B 的离线编辑不得溜进回收站，对齐桌面原 trash-cross）
      try { fs.writeFileSync(store.notePathFor(id), content, "utf8"); } catch { /* 内容写失败不阻断移入回收站 */ }
      store.applyRemoteMoveToTrash(id, trashedAt, deletedFromParentId);
    },
    async localTrashNote(id: string): Promise<void> { store.deleteTreeNode(id); },
    async localRestoreNote(id: string): Promise<void> { store.restoreTrashItem(id); },
    async applyRemotePurge(id: string): Promise<void> { store.applyRemotePurge(id); },
    async rememberDeleted(note: ManifestNote, deletedAt: string): Promise<void> { store.rememberDeleted(note as never, deletedAt); },
    async applyRemoteNoteMeta(note: ManifestNote): Promise<void> { store.applyRemoteNoteMeta(note as never); },
    async applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): Promise<void> { store.applyRemoteLock(id, locked, lockedAt); },
    async markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null): Promise<void> {
      store.setBaseHash(id, contentHash);
      // 无条件写：string = 本机上传版本；null = 两端一致 skip（清除误标，SQL 写 NULL）
      store.setLastUploadedHash(id, lastUploadedHash);
      const n = store.getNoteForSync(id);
      if (n) store.markSyncedIfUnchanged(id, {
        contentHash, updatedAt: metaAt, title: n.title, parentId: n.parentId ?? null,
        sortOrder: n.sortOrder, isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
      });
    },
    async markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string): Promise<void> {
      const n = store.getNoteForSync(id);
      if (!n) return;
      // 记账三元组：baseHash（基线）+ lastUploadedHash（已发布 hash，null=下载对账不写）+ lastSyncedMetaAt
      store.setBaseHash(id, expectedContentHash);
      if (lastUploadedHash) store.setLastUploadedHash(id, lastUploadedHash);
      store.markSyncedIfUnchanged(id, {
        contentHash: expectedContentHash, updatedAt: metaAt, title: n.title, parentId: n.parentId ?? null,
        sortOrder: n.sortOrder, isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
      });
    },
    async setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null): Promise<void> {
      store.setBaseHash(id, contentHash);
      if (lastUploadedHash) store.setLastUploadedHash(id, lastUploadedHash);
      // 下载对账也记录已确认版本（lastSyncedMetaAt）——否则 lma=null 使 decideMetaApply 恒 true，
      // 本地移动/改名会被远端旧 meta 撤销（循环移动收敛依赖 lma）。
      if (metaAt) {
        const n = store.getNoteForSync(id);
        if (n) store.markSyncedIfUnchanged(id, {
          contentHash, updatedAt: metaAt, title: n.title, parentId: n.parentId ?? null,
          sortOrder: n.sortOrder, isLocked: !!n.isLocked, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
        });
      }
    },
    async defaultNotebookId(): Promise<string> { return store.defaultNotebookId(); },
    async importRemoteFolder(folder: ManifestFolder): Promise<void> { store.importRemoteFolder(folder as never); },
    async listFoldersForSync() {
      return store.listFoldersForSync().map((f) => ({
        id: f.id, title: f.title, parentId: f.parentId ?? null, sortOrder: f.sortOrder, nodeType: f.nodeType,
        icon: f.icon ?? null, updatedAt: f.updatedAt, trashedAt: f.trashedAt ?? null, deletedFromParentId: f.deletedFromParentId ?? null,
      }));
    },
    async createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number; protectedDays?: number }): Promise<void> {
      // 留档是「被远端覆盖的本地编辑」的唯一副本（AGENTS §3 #1/#3）：失败必须抛出、让整轮同步中止，
      // 绝不静默覆盖后再提示「已存历史」（审计 260918 D1/F1；移动端 syncDbPort 一直是抛出语义）。
      // 空正文 = 正文文件缺失或读取失败（getNote 的 readFileSync 被 catch 成 ""）——应用永不产出空 .lake
      //（新建文档是 emptyLakeBody 的 `<p><br></p>`），所以拒空不会误伤（审计 260918 D2）。
      // 24h 同 hash 去重返回 null 不算失败：等价快照已在。
      if (content.trim() === "") throw new Error(`留档内容为空（正文缺失或读取失败）: ${noteId}`);
      store.createHistorySnapshot(noteId, content, false, meta.protectedDays);
    },
    async saveAsset(noteId: string, filename: string, bytes: Uint8Array): Promise<void> {
      const dir = store.noteAssetsPathFor(noteId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), Buffer.from(bytes));
    },
    async listLocalAssets(noteId: string) {
      const dir = store.noteAssetsPathFor(noteId);
      if (!fs.existsSync(dir)) return [];
      // P1（对齐思源“未引用资源不上传”）：跳过本笔记孤儿登记的文件——从文档删除的图片
      // 在本地清理前不再上传/声明，云端由回收机制收回；仍被当前正文或历史快照引用的
      // 文件不会是孤儿（store.detectOrphans 已剔除），不会误跳过。
      const orphans = store.orphanFilenamesForNote?.(noteId) ?? new Set<string>();
      const out: Array<{ filename: string; size: number; hash: string }> = [];
      for (const filename of fs.readdirSync(dir)) {
        if (orphans.has(filename)) continue;
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
    // 流式上传：打开本地资产文件流（syncEngine 探测到存在才走流式路径）
    async openLocalAssetStream(noteId: string, filename: string): Promise<import("node:stream").Readable | null> {
      const full = path.join(store.noteAssetsPathFor(noteId), filename);
      return fs.existsSync(full) ? fs.createReadStream(full) : null;
    },
    async listDeletedNotesForSync() {
      return store.listDeletedNotesForSync().map((d) => ({ id: d.id, deletedAt: d.deletedAt, title: d.title, nodeType: d.nodeType }));
    },
    // 可选：sync.test FakeStore 等旧桩可能无此方法（发布方向标记缺失时计数降级，不影响同步正确性）
    async markTombstonesPublished(ids: string[]): Promise<void> {
      store.markTombstonesPublished?.(ids);
    },
    async readDeletedContent(id: string): Promise<string | null> {
      try { return fs.readFileSync(store.notePathFor(id), "utf8"); } catch { return null; }
    },
    async forceHashRead(id: string): Promise<string | null> {
      try { return store.contentHash(id); } catch { return null; }
    },
    async revokeLocalDeletion(id: string): Promise<void> { store.revokeLocalDeletion(id); },
    async markFolderSynced(id: string, expectedUpdatedAt: string): Promise<boolean> { return store.markFolderSynced(id, expectedUpdatedAt); },
    // 可选调用：测试 FakeStore/旧实现可能无此方法（文件夹级 purge 墓碑是新能力），无则 false
    async isFolderPurged(id: string): Promise<boolean> { return store.isFolderPurged?.(id) ?? false; },
    // v5：folder 墓碑（删除传播）——学习端应用 / 从未持有记墓碑
    async applyRemoteFolderDelete(id: string, deletedAt: string): Promise<void> { store.applyRemoteFolderDelete?.(id, deletedAt); },
    async rememberFolderDeleted(folder: ManifestFolder, deletedAt: string): Promise<void> { store.rememberFolderDeleted?.(folder, deletedAt); },
    async getLastSeenCommitId(): Promise<string | null> { return store.getLastSeenCommitId(); },
    async setLastSeenCommitId(commitId: string): Promise<void> { store.setLastSeenCommitId(commitId); },
    async getLastTombstoneSig(): Promise<string> { return store.getLastTombstoneSig(); },
    async setLastTombstoneSig(sig: string): Promise<void> { store.setLastTombstoneSig(sig); },
    async tombstoneSignature(): Promise<string> { return store.tombstoneSignature(); },
    async hasLocalPendingNotes(): Promise<boolean> { return store.hasLocalPendingNotes(); },
    async log(msg: string): Promise<void> { store.logScopes.sync.info(msg); },
  };
}

export function syncConfigFromStore(store: Store): SyncConfig {
  const s = store.getS3Settings();
  if (!s) throw new Error("请先保存 S3 配置");
  return { endpoint: s.endpoint, region: s.region, bucket: s.bucket, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, prefix: s.prefix ?? "lake-notes" };
}
