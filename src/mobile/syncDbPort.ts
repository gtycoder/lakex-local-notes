import type { SyncDbPort } from "../core/syncEngine.js";
import { TRASH_NOTEBOOK_ID } from "../core/syncDecisions.js";
import { nextSortOrder } from "../core/treeRules.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { sqlParameterBatches } from "../core/sqlParameterBatch.js";
import { stageAssetWrites } from "./assetWrites.js";
import { orphanFilenamesForNote } from "./noteRepository.js";
import { createHistorySnapshot as insertHistorySnapshot } from "./historyRepository.js";
import { NativeAssetSync, nativeAssetSyncSupported } from "./nativeAssetSync";
import type { MobileDb } from "./sqliteDb.js";

export interface MobileSyncDbPortDeps {
  assets: Map<string, Uint8Array>;
  saveAssetFile: (key: string, bytes: Uint8Array) => Promise<void>;
  loadAssetFile: (key: string) => Promise<Uint8Array | null>;
  removeAssetFile: (key: string) => Promise<void>;
  listNoteAssetKeys: (noteId: string) => Promise<string[]>;
}

function rowToLocal(r: Record<string, unknown>) {
  return {
    id: String(r.id), title: String(r.title), content: String(r.content),
    updatedAt: String(r.updated_at), syncState: String(r.sync_state),
    trashedAt: r.trashed_at ? String(r.trashed_at) : null,
    restorePendingAt: r.restore_pending_at ? String(r.restore_pending_at) : null,
    parentId: r.parent_id ? String(r.parent_id) : null,
    sortOrder: Number(r.sort_order ?? 0),
    isLocked: !!r.is_locked,
    lockedAt: r.locked_at ? String(r.locked_at) : null,
    icon: r.icon ? String(r.icon) : null,
    isConflict: !!r.is_conflict,
    // TS 会在推断的返回类型里放宽字面量 → 显式标注联合类型（否则外层 SyncDbPort 不兼容）
    kind: (r.doc_kind === "usheet" ? "usheet" : r.doc_kind === "bitable" ? "bitable" : r.doc_kind === "board" ? "board" : "doc") as "doc" | "usheet" | "bitable" | "board",
  };
}

function rowToLocalMetadata(r: Record<string, unknown>) {
  return {
    ...rowToLocal({ ...r, content: "" }),
    contentHash: r.content_hash ? String(r.content_hash) : undefined,
  };
}

export function createMobileSyncDbPort(getDb: () => MobileDb, deps: MobileSyncDbPortDeps): SyncDbPort {
  // 窗口级批量写（保守版）：批内 applyRemoteNote / setSyncBase / recordDeclaredAssets 的语句入队，
  // flushNoteBatch 用 executeSet 一次下发（原生一次桥往返 + 单事务）——移动端逐条写的桥开销是同步大头。
  // 批量失败回退逐条重放，保持与逐条写等价的提交/报错点。
  const NOTE_UPSERT_SQL = `INSERT INTO notes (id, title, content, parent_id, sort_order, updated_at, content_hash, sync_state, is_conflict, is_locked, locked_at, icon, trashed_at, deleted_from_parent_id, restore_pending_at, doc_kind)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, parent_id=excluded.parent_id,
       sort_order=excluded.sort_order, updated_at=excluded.updated_at, content_hash=excluded.content_hash,
       sync_state=excluded.sync_state, is_conflict=excluded.is_conflict, is_locked=excluded.is_locked, locked_at=excluded.locked_at, icon=excluded.icon, trashed_at=excluded.trashed_at, deleted_from_parent_id=excluded.deleted_from_parent_id, restore_pending_at=NULL, doc_kind=excluded.doc_kind`;
  const SYNCBASE_UPSERT_SQL = "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at) VALUES (?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at";
  const SYNCBASE_LAST_UPLOADED_SQL = "UPDATE sync_base SET last_uploaded_hash=? WHERE note_id=?";
  const DECLARED_ASSET_SQL = "INSERT INTO declared_assets(note_id,filename,size,hash) VALUES(?,?,?,?) ON CONFLICT(note_id,filename) DO UPDATE SET size=excluded.size, hash=excluded.hash";
  let batch: Array<{ statement: string; values: unknown[] }> | null = null;
  const queue = (statement: string, values: unknown[]): boolean => { if (!batch) return false; batch.push({ statement, values }); return true; };
  // deleted_from_parent_id 必须随条目保存（对齐桌面 remoteImport.importNote）：全新导入的回收站条目
  // （L339 分支）靠它恢复原父——硬编码 NULL 会让「安卓首次同步拉到他端已删笔记 → 恢复」后 parent 卡在
  // TRASH 容器，上传条目 parentId=TRASH 传染他端（260910 实测）。
  const noteUpsertValues = (note: Parameters<SyncDbPort["applyRemoteNote"]>[0], content: string): unknown[] => [note.id, note.title, content, note.parentId, note.sortOrder, note.updatedAt, note.contentHash, "synced", note.isConflict ? 1 : 0, note.isLocked ? 1 : 0, note.lockedAt ?? null, note.icon ?? null, note.trashedAt ?? null, note.deletedFromParentId ?? null, null, note.kind === "usheet" || note.kind === "bitable" || note.kind === "board" ? note.kind : "doc"];
  const applyRemoteNoteNow = async (note: Parameters<SyncDbPort["applyRemoteNote"]>[0], content: string): Promise<void> => {
    const d = getDb();
    await d.prepare(NOTE_UPSERT_SQL).run(...noteUpsertValues(note, content));
  };
  return {
    async getNote(id) {
      const d = getDb();
      const row = await d.prepare("SELECT id, title, content, updated_at, sync_state, trashed_at, restore_pending_at, parent_id, sort_order, is_locked, locked_at, icon, is_conflict, doc_kind FROM notes WHERE id = ?").get(id);
      return row ? rowToLocal(row) : null;
    },
    async getAllNotes() {
      const d = getDb();
      const rows = await d.prepare("SELECT id, title, updated_at, sync_state, trashed_at, restore_pending_at, parent_id, sort_order, is_locked, locked_at, icon, is_conflict, content_hash, doc_kind FROM notes").all();
      return rows.map(rowToLocalMetadata);
    },
    async getSyncBase(id) {
      const d = getDb();
      const row = await d.prepare("SELECT content_hash, last_uploaded_hash, last_synced_meta_at FROM sync_base WHERE note_id = ?").get(id);
      return row ? { contentHash: String(row.content_hash), lastUploadedHash: row.last_uploaded_hash ? String(row.last_uploaded_hash) : null, lastSyncedMetaAt: row.last_synced_meta_at ? String(row.last_synced_meta_at) : null } : null;
    },
    async getAllSyncBases() {
      const d = getDb();
      const rows = await d.prepare("SELECT note_id, content_hash, last_uploaded_hash, last_synced_meta_at FROM sync_base").all() as Array<Record<string, unknown>>;
      return new Map(rows.map((r) => [String(r.note_id), {
        contentHash: String(r.content_hash),
        lastUploadedHash: r.last_uploaded_hash ? String(r.last_uploaded_hash) : null,
        lastSyncedMetaAt: r.last_synced_meta_at ? String(r.last_synced_meta_at) : null,
      }]));
    },
    async recordDeclaredAssets(
      noteId: string,
      assets: Array<{ filename: string; size: number; hash: string }>,
    ): Promise<void> {
      const d = getDb();
      const stmt = d.prepare(DECLARED_ASSET_SQL);
      for (const a of assets) { if (!queue(DECLARED_ASSET_SQL, [noteId, a.filename, a.size, a.hash])) await stmt.run(noteId, a.filename, a.size, a.hash); }
    },
    async listDeclaredAssets(
      noteId: string,
    ): Promise<Array<{ filename: string; size: number; hash: string }>> {
      const d = getDb();
      const rows = await d.prepare("SELECT filename,size,hash FROM declared_assets WHERE note_id=?").all(noteId) as Array<{ filename: string; size: number; hash: string }>;
      return rows.map((r) => ({ filename: String(r.filename), size: Number(r.size), hash: String(r.hash) }));
    },
    async applyRemoteNote(note, content) {
      if (queue(NOTE_UPSERT_SQL, noteUpsertValues(note, content))) return;
      await applyRemoteNoteNow(note, content);
    },
    async beginNoteBatch() { batch = []; },
    async flushNoteBatch() {
      const items = batch; batch = null;
      if (!items || items.length === 0) return;
      const d = getDb();
      try {
        if (typeof d.executeSet === "function") {
          await d.executeSet(items);
        } else {
          await d.transaction(async () => { for (const s of items) await d.prepare(s.statement).run(...s.values); });
        }
      } catch {
        // 回退逐条：批量失败不整批丢弃，保持与逐条写等价的提交/报错点。
        for (const s of items) await d.prepare(s.statement).run(...s.values);
      }
    },
    async applyRemoteTrash(id, content, title, trashedAt, deletedFromParentId, parentId, sortOrder) {
      const d = getDb();
      await d.prepare(
        `INSERT INTO notes (id, title, content, parent_id, sort_order, updated_at, content_hash, sync_state, trashed_at, deleted_from_parent_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, parent_id=excluded.parent_id,
           sort_order=excluded.sort_order, updated_at=excluded.updated_at, sync_state=excluded.sync_state,
           trashed_at=excluded.trashed_at, deleted_from_parent_id=excluded.deleted_from_parent_id`
      ).run(id, title, content, parentId, sortOrder, trashedAt, "", "synced", trashedAt, deletedFromParentId);
    },
    async localTrashNote(id) {
      const d = getDb();
      await d.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL WHERE id=?").run(new Date().toISOString(), id);
    },
    async localRestoreNote(id) {
      const d = getDb();
      await d.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local' WHERE id=?").run(new Date().toISOString(), id);
    },
    async applyRemotePurge(id) {
      const d = getDb();
      const now = new Date().toISOString();
      // 收到他端 purge：本地条目移入回收站并标 purged（保留可恢复、不上传）。
      await d.prepare("UPDATE notes SET parent_id=?, trashed_at=COALESCE(trashed_at,?), deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id), updated_at=?, sync_state='purged', restore_pending_at=NULL WHERE id=?").run(TRASH_NOTEBOOK_ID, now, now, id);
    },
    async rememberDeleted(note, deletedAt) {
      const d = getDb();
      // published_at=deletedAt：学到即已在云端发布，不计入待上传（对齐桌面 rememberDeleted）。
      await d.prepare(
        "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,node_type,published_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, node_type=excluded.node_type, published_at=COALESCE(deleted_notes.published_at, excluded.published_at)"
      ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, deletedAt, "note", deletedAt);
    },
    async rememberFolderDeleted(folder, deletedAt) {
      const d = getDb();
      // v5：从云端学到的 folder 删除（本设备从未持有该目录）——node_type='folder' 墓碑防复活；
      // 不写 purged_at（S3 对象前缀由发起端清理）；published_at=deletedAt（墓碑来自 manifest，已发布）。
      await d.prepare(
        "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,node_type,published_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, node_type=excluded.node_type, published_at=COALESCE(deleted_notes.published_at, excluded.published_at)"
      ).run(folder.id, folder.title, folder.parentId, folder.sortOrder, folder.updatedAt, deletedAt, "folder", deletedAt);
    },
    async applyRemoteFolderDelete(id, deletedAt) {
      const d = getDb();
      // v5：收到他端 folder 墓碑且本地有活跃副本 → folder 子树移入回收站标 purged（行保留可恢复、不上传）。
      // folders/notes 分表：先递归取 folder 子树 id（分批 IN 防 SQL 参数上限），再各自批量标 purged。
      const now = deletedAt || new Date().toISOString();
      const folderIds: string[] = [];
      let frontier = [id];
      while (frontier.length > 0) {
        folderIds.push(...frontier);
        const placeholders = frontier.map(() => "?").join(",");
        const next = await d.prepare(`SELECT id FROM folders WHERE parent_id IN (${placeholders})`).all(...frontier) as Array<{ id: string }>;
        frontier = next.map((r) => r.id);
      }
      for (const batch of sqlParameterBatches(folderIds)) {
        const ph = batch.map(() => "?").join(",");
        await d.prepare(
          "UPDATE folders SET trashed_at=COALESCE(trashed_at,?), deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id), updated_at=?, sync_state='purged' WHERE id IN (" + ph + ")"
        ).run(now, now, ...batch);
      }
      // 子树内 notes：对齐 applyRemotePurge 语义（移入回收站标 purged、清恢复标记）
      for (const batch of sqlParameterBatches(folderIds)) {
        const ph = batch.map(() => "?").join(",");
        await d.prepare(
          "UPDATE notes SET parent_id=?, trashed_at=COALESCE(trashed_at,?), deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id), updated_at=?, sync_state='purged', restore_pending_at=NULL WHERE parent_id IN (" + ph + ")"
        ).run(TRASH_NOTEBOOK_ID, now, now, ...batch);
      }
    },
    async listDeletedNotesForSync() {
      const d = getDb();
      const rows = await d.prepare("SELECT id,title,parent_id,sort_order,updated_at,deleted_at,node_type FROM deleted_notes ORDER BY deleted_at").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string; deleted_at: string; node_type: string | null }>;
      return rows.map((r) => ({ id: String(r.id), title: String(r.title), parentId: r.parent_id, sortOrder: r.sort_order, updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at), nodeType: r.node_type ?? "note" }));
    },
    async readDeletedContent(id: string): Promise<string | null> {
      const d = getDb();
      const row = await d.prepare("SELECT content FROM notes WHERE id=?").get(id) as { content: string } | undefined;
      return row ? String(row.content) : null;
    },
    async markTombstonesPublished(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const d = getDb();
      const publishedAt = new Date().toISOString();
      // v5：放开旧版 node_type != 'folder' 过滤——folder 墓碑同样发布进 manifest.folders 参与记账。
      for (const batch of sqlParameterBatches(ids)) {
        const placeholders = batch.map(() => "?").join(",");
        await d.prepare("UPDATE deleted_notes SET published_at=COALESCE(published_at, ?) WHERE id IN (" + placeholders + ")").run(publishedAt, ...batch);
      }
    },
    async applyRemoteNoteMeta(note) {
      const d = getDb();
      // 回收站条目：同步 trashed_at + deleted_from_parent_id；移出回收站时清空。
      const inTrash = note.parentId === TRASH_NOTEBOOK_ID;
      const trashedAt = inTrash ? (note.trashedAt ?? new Date().toISOString()) : null;
      const deletedFrom = inTrash ? (note.deletedFromParentId ?? null) : null;
      await d.prepare("UPDATE notes SET title=?, parent_id=?, sort_order=?, updated_at=?, is_conflict=?, trashed_at=?, deleted_from_parent_id=?, icon=? WHERE id=?")
        .run(note.title, note.parentId, note.sortOrder, note.updatedAt, note.isConflict ? 1 : 0, trashedAt, deletedFrom, note.icon ?? null, note.id);
    },
    async applyRemoteLock(id, locked, lockedAt) {
      const d = getDb();
      await d.prepare("UPDATE notes SET is_locked=?, locked_at=? WHERE id=?").run(locked ? 1 : 0, lockedAt, id);
    },
    async markLocalNoteSynced(id, contentHash, metaAt, lastUploadedHash) {
      const d = getDb();
      await d.prepare("UPDATE notes SET sync_state='synced', content_hash=?, restore_pending_at=NULL WHERE id=?").run(contentHash, id);
      await d.prepare(
        "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at, last_uploaded_hash) VALUES (?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at, last_uploaded_hash=excluded.last_uploaded_hash"
      ).run(id, contentHash, metaAt, lastUploadedHash);
    },
    async markSyncedIfUnchanged(id, expectedContentHash, metaAt, lastUploadedHash) {
      const d = getDb();
      const row = await d.prepare("SELECT content FROM notes WHERE id=?").get(id);
      if (!row) return;
      // 同步期间内容被编辑则不标 synced，等下一轮重传。
      const currentHash = sha256Sync(new TextEncoder().encode(String(row.content)));
      if (currentHash !== expectedContentHash) return;
      await d.prepare("UPDATE notes SET sync_state='synced', content_hash=?, restore_pending_at=NULL WHERE id=?").run(expectedContentHash, id);
      await d.prepare(
        "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at) VALUES (?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at"
      ).run(id, expectedContentHash, metaAt);
      if (lastUploadedHash != null) {
        await d.prepare("UPDATE sync_base SET last_uploaded_hash=? WHERE note_id=?").run(lastUploadedHash, id);
      }
    },
    async setSyncBase(id, contentHash, metaAt, lastUploadedHash) {
      const d = getDb();
      // lastUploadedHash 为 null 时保留已有值，避免下载对账清掉本机上传标记。
      if (!queue(SYNCBASE_UPSERT_SQL, [id, contentHash, metaAt])) {
        await d.prepare(SYNCBASE_UPSERT_SQL).run(id, contentHash, metaAt);
      }
      if (lastUploadedHash != null && !queue(SYNCBASE_LAST_UPLOADED_SQL, [lastUploadedHash, id])) {
        await d.prepare(SYNCBASE_LAST_UPLOADED_SQL).run(lastUploadedHash, id);
      }
    },
    async defaultNotebookId() {
      const d = getDb();
      // 没有默认笔记本概念：优先复用任意未删除笔记本，否则兜底创建“未分类”。
      const row = await d.prepare("SELECT id FROM folders WHERE node_type='notebook' AND trashed_at IS NULL ORDER BY sort_order LIMIT 1").get() as { id: string } | undefined;
      if (row) return row.id;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const maxRow = await d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL").get() as { m: number | null } | undefined;
      await d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,NULL,?,?,?,?,'local')")
        .run(id, "未分类", nextSortOrder(maxRow?.m ?? null), "notebook", "X", now);
      return id;
    },
    async importRemoteFolder(folder) {
      const d = getDb();
      await d.prepare(
        "INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id, sync_state) VALUES (?,?,?,?,?,?,?,?,?,'synced') ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, node_type=excluded.node_type, icon=excluded.icon, updated_at=excluded.updated_at, trashed_at=excluded.trashed_at, deleted_from_parent_id=excluded.deleted_from_parent_id"
      ).run(folder.id, folder.title, folder.parentId, folder.sortOrder, folder.nodeType, folder.icon ?? null, folder.updatedAt, folder.trashedAt ?? null, folder.deletedFromParentId ?? null);
    },
    async listFoldersForSync() {
      const d = getDb();
      // v5：排除 purged（收到他端 folder 墓碑后保留的回收站副本）——学习端不回填，
      // 对齐 notes 上传环的 purged continue；否则每端把已删目录当活跃条目重新发布 → manifest 震荡。
      const rows = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id FROM folders WHERE sync_state != 'purged'").all() as Array<{
        id: string; title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order, nodeType: r.node_type,
        icon: r.icon, updatedAt: r.updated_at, trashedAt: r.trashed_at ?? undefined, deletedFromParentId: r.deleted_from_parent_id ?? undefined,
      }));
    },
    async createHistorySnapshot(
      noteId,
      content,
      meta: { title: string; parentId: string | null; sortOrder: number; protectedDays?: number },
    ) {
      return insertHistorySnapshot(getDb(), noteId, content, meta);
    },
    async saveAsset(noteId, filename, bytes) {
      const key = noteId + "/" + filename;
      // 文件写入失败必须向上抛并回滚内存层，避免本端 manifest 漏声明后触发跨端 GC。
      await stageAssetWrites(
        [{ key, bytes }],
        { memory: deps.assets, save: deps.saveAssetFile, remove: deps.removeAssetFile },
      );
    },
    async listLocalAssets(noteId) {
      const d = getDb();
      const out = [];
      const prefix = noteId + "/";
      // 孤儿不上传；持久化资产只在本方法内按需读取，避免启动全量加载。
      const orphans = await orphanFilenamesForNote(d, noteId);
      const diskFilenames = new Set((await deps.listNoteAssetKeys(noteId)).map((key) => key.slice(prefix.length)));
      // 原生扫描：size+sha256 在原生算完只回元数据，免去把每个资产 base64 读进 JS 再算 hash。
      let nativeMeta: Map<string, { size: number; hash: string }> | null = null;
      if (nativeAssetSyncSupported()) {
        try {
          const res = await NativeAssetSync.listAssets({ noteId });
          nativeMeta = new Map((res.assets ?? []).map((a) => [String(a.filename), { size: Number(a.size), hash: String(a.hash) }]));
        } catch {
          nativeMeta = null;
        }
      }
      for (const filename of diskFilenames) {
        if (orphans.has(filename)) continue;
        const meta = nativeMeta?.get(filename);
        if (meta) {
          out.push({ filename, size: meta.size, hash: meta.hash });
          continue;
        }
        const bytes = deps.assets.get(prefix + filename) ?? await deps.loadAssetFile(prefix + filename);
        if (!bytes) continue;
        out.push({ filename, size: bytes.length, hash: sha256Sync(bytes) });
      }
      for (const [key, bytes] of deps.assets) {
        if (!key.startsWith(prefix)) continue;
        const filename = key.slice(prefix.length);
        if (diskFilenames.has(filename)) continue;
        if (orphans.has(filename)) continue;
        out.push({ filename, size: bytes.length, hash: sha256Sync(bytes) });
      }
      return out;
    },
    async readLocalAsset(noteId, filename) {
      const key = noteId + "/" + filename;
      return deps.assets.get(key) ?? await deps.loadAssetFile(key);
    },
    /** 原生流式上传句柄：localKey 给原生定位文件；read 供原生失败时回退字节路径。 */
    async openLocalAssetStream(noteId, filename) {
      const key = noteId + "/" + filename;
      return {
        localKey: key,
        read: () => deps.assets.get(key) ?? deps.loadAssetFile(key),
      };
    },
    /** 原生下载目标：本地资产键 {noteId}/{filename}（与 openLocalAssetStream 同一约定）。 */
    assetFilePath(noteId, filename) {
      return noteId + "/" + filename;
    },
    async getLastSeenCommitId() {
      const d = getDb();
      const row = await d.prepare("SELECT value FROM device_state WHERE key='last_seen_commit_id'").get() as { value?: string } | undefined;
      return row?.value ?? null;
    },
    async markFolderSynced(id: string, expectedUpdatedAt: string): Promise<boolean> {
      // 目录记账（对齐桌面 syncReconciliation.markFolderSynced）：latest 发布成功后按 updatedAt 快照归位。
      // 缺失此实现 → folder 永远停在 local → hasLocalPendingNotes 恒真 → 零变更早退永不生效（每轮全量+重发布）。
      const d = getDb();
      const info = await d.prepare("UPDATE folders SET sync_state='synced' WHERE id=? AND updated_at=?").run(id, expectedUpdatedAt);
      const changes = (info as { changes?: number }).changes ?? 0;
      return changes > 0;
    },
    async setLastSeenCommitId(commitId) {
      const d = getDb();
      await d.prepare("INSERT INTO device_state(key,value) VALUES('last_seen_commit_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(commitId);
    },
    async getLastTombstoneSig() {
      const d = getDb();
      const row = await d.prepare("SELECT value FROM device_state WHERE key='last_tombstone_sig'").get() as { value?: string } | undefined;
      return row?.value ?? "";
    },
    async setLastTombstoneSig(sig) {
      const d = getDb();
      await d.prepare("INSERT INTO device_state(key,value) VALUES('last_tombstone_sig',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(sig);
    },
    async tombstoneSignature() {
      const d = getDb();
      const row = await d.prepare("SELECT COUNT(*) AS c, COALESCE(MAX(deleted_at),'') AS m FROM deleted_notes").get() as { c: number; m: string };
      return `${row.c}:${row.m}`;
    },
    async hasLocalPendingNotes() {
      const d = getDb();
      // purged 是收到他端删除后的本地保留副本（含 folder 行），不应阻塞早退——
      // 否则学习端收到 folder 墓碑后早退永不生效（每轮全量 + 重发布）。
      const noteRow = await d.prepare("SELECT 1 FROM notes WHERE sync_state NOT IN ('synced','purged') AND deleted_at IS NULL LIMIT 1").get();
      if (noteRow) return true;
      // 默认笔记本等已同步目录不算待上传，否则同步永远不会早退；v5 起排除 purged folder。
      const groupRow = await d.prepare("SELECT 1 FROM folders WHERE sync_state NOT IN ('synced','purged') AND id != ? LIMIT 1").get(TRASH_NOTEBOOK_ID);
      if (groupRow) return true;
      // 未发布的 purge 墓碑 = 待上传事实（对齐桌面 hasLocalPendingNotes）：否则墓碑与他端发布撞车时
      // 被零变更早退吞掉，markTombstonesPublished 永不执行 → pending documents 永久挂起（260910 实测）。
      const tombRow = await d.prepare("SELECT 1 FROM deleted_notes WHERE published_at IS NULL LIMIT 1").get();
      return !!tombRow;
    },
    async isFolderPurged(id: string): Promise<boolean> {
      const d = getDb();
      // 判定必须永久（对齐桌面）：node_type='folder' 墓碑只由 purge 写入，purged_at 会在 S3 前缀
      // 删除成功后被清空——旧实现看 purged_at ⇒ 保护失效，云端残留的活跃条目被重新导入复活。
      return !!(await d.prepare("SELECT 1 FROM deleted_notes WHERE id=? AND node_type='folder'").get(id));
    },
    async log(msg) {
      console.log("[mobile-sync]", msg);
    },
  };
}
