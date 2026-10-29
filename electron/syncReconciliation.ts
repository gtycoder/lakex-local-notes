import fs from "node:fs";
import crypto from "node:crypto";
import type { DbLike } from "./dbLike.js";
import { sqlParameterBatches } from "../src/core/sqlParameterBatch.js";
import { parseS3v3DiagnosticReports, pushS3v3DiagnosticReport, type S3v3DiagnosticReport } from "../src/core/s3v3Report.js";
import type { SyncNote } from "./noteQueries.js";
import type { HistoryCleanupResult } from "./storeTypes.js";

function nowIso(): string {
  return new Date().toISOString();
}

/** 同步对账上下文：DB + 路径 + 跨域回调（由 Store 装配）。 */
export interface SyncReconciliationContext {
  db: DbLike;
  trashNotebookId: string;
  /** .lake 正文文件绝对路径（contentHash 读盘） */
  notePathFor: (noteId: string) => string;
  /** 读取笔记缓存（applyRemoteRestore 重建 FTS 用） */
  readNoteCaches: (noteId: string) => { markdown: string | null; plain: string | null };
  /** FTS 上行 */
  upsertSearch: (noteId: string, title: string, body: string | null) => void;
  /** FTS 下行（回收站/彻底删/文件夹删除） */
  removeSearch: (noteIds: readonly string[]) => void;
  /** 同步清单读（getSyncPendingSummary 口径对齐 listFoldersForSync） */
  listNotesForSync: () => SyncNote[];
}

/**
 * S3 同步对账域（hash 账本 / 同步标记 / 远端应用 / 墓碑 / 游标 / GC pending / 同步状态记录）。
 * 从事务语义到 SQL 全部原样迁移自 Store（REFACTOR：只搬家不改行为）。
 * 红线：本地是真相、S3 只是镜像；删除必须传播（墓碑权威）；
 * 先提交者为真——冲突时本地编辑强制写历史快照归档（由 syncEngine 驱动）。
 */
export class SyncReconciliation {
  private readonly ctx: SyncReconciliationContext;

  constructor(ctx: SyncReconciliationContext) {
    this.ctx = ctx;
  }

  // ===== 正文 hash（只读工具） =====
  // Del-6（261029）：v2 的 hash 账本 sync_base 已删除——v3 的基线在 sync-v3/baseline.json.gz，
  // 这里只留「读盘算正文 sha256」这一纯工具（markSyncedIfUnchanged 的 I2 守卫用）。

  contentHash(id: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(this.ctx.notePathFor(id))).digest("hex");
  }

  // ===== 同步标记 =====

  /** 本地同步快照保护（V5 §5.2）：上传/对账结束后，仅当本地状态与快照一致才标记 synced。
   * - 事务外重读磁盘正文 hash（覆盖「上传全程的正文编辑」）；
   * - 事务内重读 metadata 比对（覆盖 title/parent/sort/lock/icon——锁变更不改 updated_at，必须比对字段）；
   * - 条件更新 updated_at（meta 编辑最后防线；changes=0 → 快照后又有编辑 → 不标）。
   * 任一不一致 → 保持 is_dirty=1，下次同步重传。
   * 这是单设备内快照比对，不是分布式 CAS；updated_at 无严格单调，同毫秒残留后果=延迟非丢失。 */
  markSyncedIfUnchanged(noteId: string, expected: {
    contentHash: string; updatedAt: string; title: string; parentId: string | null;
    sortOrder: number; isEditLocked: boolean; editLockedAt: string | null; icon: string | null;
  }): boolean {
    // 1) 事务外：重读磁盘正文 hash（正文在 .lake 文件，DB 事务管不到磁盘）
    if (this.contentHash(noteId) !== expected.contentHash) return false;
    return this.ctx.db.transaction(() => {
      // 2) metadata 比对（锁变更不改 updated_at，必须显式比对字段）
      const meta = this.ctx.db.prepare(
        "SELECT n.title,n.parent_id,n.sort_order,n.is_locked,n.locked_at,t.icon FROM notes n LEFT JOIN tree_nodes t ON t.note_file_id=n.id WHERE n.id=? AND n.deleted_at IS NULL"
      ).get(noteId) as { title: string; parent_id: string | null; sort_order: number; is_locked: number; locked_at: string | null; icon: string | null } | undefined;
      if (!meta) return false;
      if (meta.title !== expected.title || meta.parent_id !== expected.parentId || meta.sort_order !== expected.sortOrder ||
          !!meta.is_locked !== expected.isEditLocked || (meta.locked_at ?? null) !== expected.editLockedAt || (meta.icon ?? null) !== expected.icon) return false;
      // 3) 条件更新（快照后 meta 编辑的最后防线）
      const info = this.ctx.db.prepare(
        "UPDATE notes SET is_dirty=0, restore_pending_at=NULL WHERE id=? AND updated_at=?"
      ).run(noteId, expected.updatedAt);
      if (info.changes === 0) return false;
      // 4) 归位（Del-6：原「记录元数据已确认版本」写 sync_base，账本删除后由 v3 baseline 承担）
      this.ctx.db.prepare("UPDATE tree_nodes SET is_dirty=0 WHERE note_file_id=?").run(noteId);
      return true;
    })();
  }

  markSynced(id: string): void {
    const tx = this.ctx.db.transaction(() => {
      // restore_pending_at 一并清除：任何"变为 synced"的路径都代表恢复已生效或被远端采纳，
      // 残留标记会让本设备永远 local-wins、压住后续墓碑（墓碑永胜被破坏）。
      this.ctx.db.prepare("UPDATE notes SET is_dirty=0, restore_pending_at=NULL WHERE id=?").run(id);
      // 侧栏/状态栏读的是 tree_nodes.sync_state，必须同步置为 synced。
      // Del-6：原「记录元数据已确认版本」写 sync_base（v2 账本）；v3 的同一事实在 baseline.lake 条目里，
      // 由 saveBaseline 落盘，这里不再写第二份。
      this.ctx.db.prepare("UPDATE tree_nodes SET is_dirty=0 WHERE note_file_id=?").run(id);
    });
    tx();
  }

  /** 目录/分组归位（V5 §5.1）：folder 无独立对象上传（只进 manifest.folders），
   * latest 发布成功后按构建 manifest 时的 updatedAt 快照条件归位，
   * 防同步期间本地再改 group 被误标（与 markSyncedIfUnchanged 同构）。
   * 只作用于无 note_file_id 的 group/notebook 节点；返回是否归位成功。 */
  markFolderSynced(id: string, expectedUpdatedAt: string): boolean {
    const info = this.ctx.db.prepare(
      "UPDATE tree_nodes SET is_dirty=0 WHERE id=? AND updated_at=? AND note_file_id IS NULL"
    ).run(id, expectedUpdatedAt);
    return info.changes > 0;
  }

  /** 是否处于"回收站恢复后待同步"状态（显式恢复标记）。
   * 墓碑权威下这是唯一允许 local-wins 抵抗远端删除的例外。 */
  isRestorePending(id: string): boolean {
    return !!this.ctx.db.prepare("SELECT 1 FROM notes WHERE id=? AND restore_pending_at IS NOT NULL").get(id);
  }

  /** 是否处于待上传/本地未对齐状态（is_dirty=1）。用于远端墓碑与本地恢复的 P0-1 判定。 */
  isSyncPending(id: string): boolean {
    const row = this.ctx.db.prepare("SELECT is_dirty FROM notes WHERE id=?").get(id) as { is_dirty: number } | undefined;
    return row !== undefined && row.is_dirty === 1;
  }

  // ===== 应用远端（下载分支对账写） =====

  /** 正文 hash 相同、仅元数据变化（标题/父目录/排序/图标/回收站字段）时的对账。 */
  applyRemoteNoteMeta(note: SyncNote): void {
    const tx = this.ctx.db.transaction(() => {
      // 回收站条目：同步 trashed_at + deleted_from_parent_id；移出回收站（恢复传播）时清空。
      const inTrash = note.parentId === this.ctx.trashNotebookId;
      const trashedAt = inTrash ? (note.trashedAt ?? new Date().toISOString()) : null;
      const deletedFrom = inTrash ? (note.deletedFromParentId ?? null) : null;
      this.ctx.db.prepare(
        "UPDATE notes SET title=?, parent_id=?, sort_order=?, updated_at=?, is_conflict=?, trashed_at=?, deleted_from_parent_id=? WHERE id=?"
      ).run(note.title, note.parentId, note.sortOrder, note.updatedAt, note.isConflict ? 1 : 0, trashedAt, deletedFrom, note.id);
      // 旧清单无 icon 字段时保留本地图标（icon=undefined 是"未声明"，null 才是"显式清除"）；
      // 否则旧客户端写出的 manifest 会把新端本地图标静默清掉（验收 #1 健壮性）。
      if (note.icon !== undefined) {
        this.ctx.db.prepare(
          "UPDATE tree_nodes SET title=?, parent_id=?, sort_order=?, updated_at=?, icon=?, trashed_at=?, deleted_from_parent_id=? WHERE note_file_id=?"
        ).run(note.title, note.parentId, note.sortOrder, note.updatedAt, note.icon ?? null, trashedAt, deletedFrom, note.id);
      } else {
        this.ctx.db.prepare(
          "UPDATE tree_nodes SET title=?, parent_id=?, sort_order=?, updated_at=?, trashed_at=?, deleted_from_parent_id=? WHERE note_file_id=?"
        ).run(note.title, note.parentId, note.sortOrder, note.updatedAt, trashedAt, deletedFrom, note.id);
      }
    });
    tx();
  }

  /** 远端把该笔记移入回收站（软删传播，删除压编辑）：本地 active → 移入回收站 + 标 local（由下载分支重新核对内容后 markSynced）。
   * 与 applyRemotePurge 不同：这是正常回收站条目（上云），不抑制上传；本地编辑由调用方先留档。 */
  applyRemoteMoveToTrash(id: string, trashedAt: string | null, deletedFromParentId: string | null): void {
    const tx = this.ctx.db.transaction(() => {
      this.ctx.db.prepare(
        "UPDATE notes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,?),updated_at=?,is_dirty=1,is_purged=0,restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
      ).run(this.ctx.trashNotebookId, trashedAt, deletedFromParentId, trashedAt ?? nowIso(), id);
      this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,?),updated_at=?,is_dirty=1,is_purged=0 WHERE note_file_id=? AND deleted_at IS NULL"
      ).run(this.ctx.trashNotebookId, trashedAt, deletedFromParentId, trashedAt ?? nowIso(), id);
      this.ctx.removeSearch([id]);
    });
    tx();
  }

  /** 远端恢复该笔记（移出回收站传播）：本地 trash 条目 → 移回原位置 + 清回收站字段，标 local 待下载分支对齐。 */
  applyRemoteRestore(id: string, parentId: string | null, updatedAt: string): void {
    const tx = this.ctx.db.transaction(() => {
      this.ctx.db.prepare(
        "UPDATE notes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1,is_purged=0,cloud_deleted=0,restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
      ).run(parentId, updatedAt, id);
      this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1,is_purged=0,cloud_deleted=0 WHERE note_file_id=? AND deleted_at IS NULL"
      ).run(parentId, updatedAt, id);
      const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
      if (titleRow) {
        const caches = this.ctx.readNoteCaches(id);
        this.ctx.upsertSearch(id, titleRow.title, caches.plain ?? null);
      }
    });
    tx();
  }

  /** 收到他端 purge 墓碑：把本地条目移入回收站并标 purged（保留可恢复、不上传）。
   * 与软删不同——purge 不广播强制删除，其他端保留恢复路子。 */
  applyRemotePurge(id: string): void {
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      // restore_pending_at 一并清除（对齐移动端 bridge applyRemotePurge）：purge 后恢复标记无意义，
      // 残留会让 isRestorePending 误判。engine 的 decidePurge 已挡 restoring 场景，此处纯口径对齐。
      this.ctx.db.prepare(
        "UPDATE notes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,is_purged=1, is_dirty=0,is_purged=1,restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
      ).run(this.ctx.trashNotebookId, now, now, id);
      this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,is_purged=1, is_dirty=0,is_purged=1 WHERE note_file_id=? AND deleted_at IS NULL"
      ).run(this.ctx.trashNotebookId, now, now, id);
      this.ctx.removeSearch([id]);
    });
    tx();
  }

  // ===== 墓碑（deleted_notes） =====

  /** 记录"从云端学到的删除"（本设备从未持有该笔记）：与本地删除同语义，
   * 防止 deleted 标记因设备清空/换机而丢失（审计 #2）。
   * Del-6：已删「逐行 published_at」——学到即已发布；待同步判据是 deleted_at > 水线，
   * 本轮成功同步后水线推进到 now 即自然清零（学到的墓碑 deleted_at 是云端旧时间）。 */
  rememberDeleted(note: SyncNote, deletedAt: string): void {
    // 不用 INSERT OR REPLACE：purge 后该行已带 purged_at，若被远端墓碑重插会清空 purged_at，
    // 导致 listPurgedNotesForSync 漏掉、S3 对象前缀永远不删。
    // node_type=note（只有索引 notes 条目会触发 remember）。
    this.ctx.db.prepare(
      "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,node_type) VALUES(?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, node_type=excluded.node_type"
    ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, deletedAt, "note");
  }

  /** v5：记录"从云端学到的 folder 删除"（本设备从未持有该目录）——node_type='folder' 墓碑防复活。
   * 不写 purged_at（S3 对象前缀由发起端清理）；Del-6：不再写 published_at（水线判据，见上）。 */
  rememberFolderDeleted(folder: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt?: string }, deletedAt: string): void {
    this.ctx.db.prepare(
      "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,node_type) VALUES(?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, node_type=excluded.node_type"
    ).run(folder.id, folder.title, folder.parentId, folder.sortOrder, folder.updatedAt ?? deletedAt, deletedAt, "folder");
  }

  /** v5：收到他端 folder 墓碑（deleted:true）且本地有活跃副本 → folder 子树移入回收站标 purged
   * （行保留可恢复、不上传），子 notes 对齐 applyRemotePurge 语义（副本可从回收站恢复）。 */
  applyRemoteFolderDelete(id: string, deletedAt: string): void {
    const now = deletedAt || nowIso();
    const tx = this.ctx.db.transaction(() => {
      // 递归找 folder 子树（含自身）：tree_nodes parent 链向下（软删子节点也跟随）
      const subtree = this.ctx.db.prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT ? UNION ALL SELECT t.id FROM tree_nodes t JOIN sub s ON t.parent_id = s.id
         ) SELECT t.id, t.note_file_id, t.node_type FROM tree_nodes t WHERE t.id IN (SELECT id FROM sub) AND t.deleted_at IS NULL`
      ).all(id) as Array<{ id: string; note_file_id: string | null; node_type: string }>;
      const purgeNote = this.ctx.db.prepare(
        "UPDATE notes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,is_purged=1, is_dirty=0,is_purged=1,restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
      );
      const purgeNode = this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,is_purged=1, is_dirty=0,is_purged=1 WHERE id=? AND deleted_at IS NULL"
      );
      const removedNoteIds: string[] = [];
      for (const node of subtree) {
        if (node.note_file_id) {
          purgeNote.run(this.ctx.trashNotebookId, now, now, node.note_file_id);
          removedNoteIds.push(node.note_file_id);
        }
        purgeNode.run(this.ctx.trashNotebookId, now, now, node.id);
      }
      if (removedNoteIds.length > 0) this.ctx.removeSearch(removedNoteIds);
    });
    tx();
  }

  /** purge 前缀删除成功后，清除 purged_at（保留墓碑，避免下次同步重复删前缀）。 */
  markPurgeSynced(id: string): void {
    this.ctx.db.prepare("UPDATE deleted_notes SET purged_at=NULL WHERE id=?").run(id);
  }

  listDeletedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; nodeType: string }> {
    return this.ctx.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,deleted_at,node_type FROM deleted_notes ORDER BY deleted_at"
    ).all().map((value) => {
      const r = value as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string; deleted_at: string; node_type: string };
      return {
        id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
        updatedAt: r.updated_at, deletedAt: r.deleted_at, nodeType: r.node_type ?? "note",
      };
    });
  }

  // ===== 墓碑发布水线（Del-6：替代逐行 published_at） =====

  /** 上次成功同步完成时间（device_state.tombstones_published_at；缺省 "0" = 全部墓碑都算待同步）。
   * 待同步判据统一为 deleted_at > 水线（三种 pending 查询共用）。 */
  getTombstonesWaterline(): string {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='tombstones_published_at'").get() as { value: string } | undefined;
    return row?.value ?? "0";
  }

  /** 成功同步后推进水线（desktopSync 调用，替代旧 markTombstonesPublished 的逐行 UPDATE）。
   * 墓碑本体永久保留（防删除标记因他端移除而丢失 → 离线设备复活，审计 #2）。 */
  markTombstonesWaterline(at: string = nowIso()): void {
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('tombstones_published_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(at);
  }

  /** 已写入同步清单的删除标记可安全剪除，避免 deleted_notes 无限累积 */
  pruneTombstones(ids: string[]): void {
    if (ids.length === 0) return;
    for (const batch of sqlParameterBatches(ids)) {
      const placeholders = batch.map(() => "?").join(",");
      this.ctx.db.prepare(`DELETE FROM deleted_notes WHERE id IN (${placeholders})`).run(...batch);
    }
  }

  /** 本地已彻底删除（purge）过的 folder/group —— 同步下载过滤 / 发布强制清单重写用。
   * 判定必须**永久**：`node_type='folder'` 的墓碑只由 purgeTrashItem 写入（软删不写墓碑），
   * 而 purged_at 会在 S3 前缀删除成功后被 markPurgeSynced 清空（防重复删前缀）。
   * 旧实现看 purged_at ⇒ 前缀删完保护就失效，陈旧清单里的该目录会被重新导入、
   * 其子文档落到"本地不存在的父"下 → 变成 UI 看不见但仍在同步/占资源的孤儿（2026-09-04 实数据踩到）。 */
  isFolderPurged(id: string): boolean {
    return !!this.ctx.db.prepare("SELECT 1 FROM deleted_notes WHERE id=? AND node_type='folder'").get(id);
  }

  /** 已彻底删除（purge）的墓碑：下次同步需立即删 S3 前缀。 */
  listPurgedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; purgedAt: string }> {
    return this.ctx.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,deleted_at,purged_at FROM deleted_notes WHERE purged_at IS NOT NULL ORDER BY purged_at"
    ).all().map((value) => {
      const r = value as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string; deleted_at: string; purged_at: string };
      return {
        id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
        updatedAt: r.updated_at, deletedAt: r.deleted_at, purgedAt: r.purged_at,
      };
    });
  }

  // ===== 游标 / 签名（device_state） =====

  /** 零变更早退：本设备上次成功读/写的 manifest commitId（device_state）。 */
  getLastSeenCommitId(): string | null {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='last_seen_commit_id'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }
  setLastSeenCommitId(commitId: string): void {
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('last_seen_commit_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(commitId);
  }

  /** 本地上次同步时的墓碑签名（COUNT:MAX(deleted_at)），早退判定"是否新增了 purge"。 */
  getLastTombstoneSig(): string {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='last_tombstone_sig'").get() as { value: string } | undefined;
    return row?.value ?? "";
  }
  setLastTombstoneSig(sig: string): void {
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('last_tombstone_sig',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(sig);
  }
  tombstoneSignature(): string {
    const row = this.ctx.db.prepare("SELECT COUNT(*) AS c, COALESCE(MAX(deleted_at),'') AS m FROM deleted_notes").get() as { c: number; m: string };
    return `${row.c}:${row.m}`;
  }

  /** 廉价 pending 指纹（三个索引级 COUNT，微秒级）：IPC 层每次调用后 diff，变化才广播完整摘要。 */
  pendingSignature(): string {
    const docs = this.ctx.db.prepare("SELECT COUNT(*) AS c FROM notes WHERE is_dirty=1 AND deleted_at IS NULL").get() as { c: number };
    const tombs = this.ctx.db.prepare("SELECT COUNT(*) AS c FROM deleted_notes WHERE (node_type IS NULL OR node_type != 'folder') AND deleted_at > COALESCE((SELECT value FROM device_state WHERE key='tombstones_published_at'),'0')").get() as { c: number };
    const folders = this.ctx.db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE note_file_id IS NULL AND deleted_at IS NULL AND is_dirty=1 AND id != ?").get(this.ctx.trashNotebookId) as { c: number };
    return `${docs.c}:${folders.c}:${tombs.c}`;
  }

  getSyncPendingSummary(): { documents: number; folders: number; resources: number; generatedAt: string } {
    // 只统计可同步的本地事实：正文/文档元数据与目录元数据。
    // purged 保留副本永不上传，不计入（含收到他端 folder 墓碑后标 purged 的目录行——收敛后行停留 purged、
    // 不再触发发布，若计入则 pending folders 永久挂起；口径与 listFoldersForSync/hasLocalPendingNotes 一致）。
    // 被回收的目录仍会随 listFoldersForSync 发布（移动即同步传播），
    // 发布后 markFolderSynced 归位 synced，故这里不做 trashed_at 过滤。
    const pendingDocs = (this.ctx.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE is_dirty=1 AND deleted_at IS NULL AND is_purged=0").get() as { count: number }).count;
    const pendingFolders = (this.ctx.db.prepare(
      "SELECT COUNT(*) AS count FROM tree_nodes WHERE note_file_id IS NULL AND deleted_at IS NULL AND is_dirty=1 AND id != ?"
    ).get(this.ctx.trashNotebookId) as { count: number }).count;
    // 待同步墓碑 = 晚于「上次成功同步水线」（deleted_at > waterline）的 note 墓碑。
    // Del-6：不再有逐行 published_at；成功同步后水线推进 ⇒ 本轮之前发布的墓碑自然清零。
    // 资源不在本地维护上传 ledger，不能把正文引用数冒充为待上传数；真实资源 diff 在同步阶段完成。
    const tombstones = (this.ctx.db.prepare(
      "SELECT COUNT(*) AS count FROM deleted_notes WHERE (node_type IS NULL OR node_type != 'folder') AND deleted_at > COALESCE((SELECT value FROM device_state WHERE key='tombstones_published_at'),'0')"
    ).get() as { count: number }).count;
    return { documents: pendingDocs + tombstones, folders: pendingFolders, resources: 0, generatedAt: nowIso() };
  }

  /** 是否有本地待上传变更（早退判定）：notes 非 synced（含锁/元数据变更）或纯目录/分组改动（V5 §5.1）。
   * group/notebook 节点无 note_file_id，rename/icon/reorder 只写 tree_nodes；
   * 排除回收站笔记本：固定节点不进 manifest.folders（listFoldersForSync 排除），其 local 状态不应阻塞早退。
   * purged（收到他端删除的保留副本，含 folder 行）也排除：永不上传，不应阻塞早退——
   * 否则学习端收到 folder 墓碑后早退永不生效（每轮全量 + 重发布，260910 实测）。 */
  hasLocalPendingNotes(): boolean {
    const noteRow = this.ctx.db.prepare("SELECT 1 FROM notes WHERE is_dirty=1 AND deleted_at IS NULL LIMIT 1").get();
    if (noteRow) return true;
    const groupRow = this.ctx.db.prepare(
      "SELECT 1 FROM tree_nodes WHERE is_dirty=1 AND note_file_id IS NULL AND id != ? LIMIT 1"
    ).get(this.ctx.trashNotebookId);
    if (groupRow) return true;
    // 晚于成功同步水线的 purge 墓碑 = 待上传事实：墓碑环节要把它发布/对齐记账（desktopSync 成功后推进水线）。
    // 若不计入 → purge 与他端发布撞车（远端已带墓碑 → 收敛减枝无需发布）时早退吞掉整轮，
    // 墓碑永不上传/记账 → pending documents 永久挂起（260910 实测：B 端 122891ab/efbc6884）。
    const tombRow = this.ctx.db.prepare("SELECT 1 FROM deleted_notes WHERE deleted_at > COALESCE((SELECT value FROM device_state WHERE key='tombstones_published_at'),'0') LIMIT 1").get();
    return !!tombRow;
  }

  // ===== S3 GC log（261028：manifest 时代的 s3_gc_pending 待回收表已删，仅保留深清理真实写入的审计日志） =====

  recordS3GcLog(action: string, key: string, reason: string, commitId: string | null, deviceId: string | null, ok: boolean): void {
    this.ctx.db.prepare("INSERT INTO s3_gc_log(ts,action,key,reason,commit_id,device_id,ok) VALUES(?,?,?,?,?,?,?)")
      .run(nowIso(), action, key, reason, commitId, deviceId, ok ? 1 : 0);
  }

  listS3GcLog(): Array<{ id: number; ts: string; action: string; key: string; reason: string; commitId: string | null; deviceId: string | null; ok: boolean }> {
    return this.ctx.db.prepare("SELECT id,ts,action,key,reason,commit_id AS commitId,device_id AS deviceId,ok FROM s3_gc_log ORDER BY id DESC LIMIT 500")
      .all().map((value) => { const r = value as { id: number; ts: string; action: string; key: string; reason: string; commitId: string | null; deviceId: string | null; ok: unknown }; return { ...r, ok: !!r.ok }; });
  }

  // ===== 同步状态记录（device_state） =====

  markSyncComplete(at: string): void {
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(at);
  }

  recordSyncResult(json: string): void {
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('last_sync_result',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json);
  }

  /**
   * SD-13：最近 3 轮 v3 同步诊断（阶段耗时/对象数/字节/失败对象/warnings）落 `device_state`。
   * 单独一个键（不覆盖 `last_sync_result`）：后者是渲染层状态栏读的稳定摘要，结构不能随意扩张。
   */
  recordV3SyncReport(report: S3v3DiagnosticReport): void {
    const next = pushS3v3DiagnosticReport(this.listV3SyncReports(), report);
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('sync_v3_reports',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
  }

  /** 读取最近 3 轮 v3 同步诊断（坏数据一律当空，不抛错）。 */
  listV3SyncReports(): S3v3DiagnosticReport[] {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='sync_v3_reports'").get() as { value: string } | undefined;
    if (!row) return [];
    try { return parseS3v3DiagnosticReports(JSON.parse(row.value)); } catch { return []; }
  }

  /** P4：记录最近一次历史清理结果（自动/手动），供设置面板展示与排查 */
  recordHistoryCleanup(result: HistoryCleanupResult): void {
    const payload = { at: new Date().toISOString(), ...result };
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('last_history_cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(payload));
  }

  getLastHistoryCleanup(): { at: string; deletedSnapshots: number; freedBytes: number } | null {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='last_history_cleanup'").get() as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }

  getSyncStatus(): { lastSyncedAt: string | null; lastResult: Record<string, unknown> | null } {
    const at = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='last_synced_at'").get() as { value: string } | undefined;
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='last_sync_result'").get() as { value: string } | undefined;
    let lastResult: Record<string, unknown> | null = null;
    if (row) { try { lastResult = JSON.parse(row.value); } catch { lastResult = null; } }
    return { lastSyncedAt: at?.value ?? null, lastResult };
  }
}
