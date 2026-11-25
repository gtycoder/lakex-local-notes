/**
 * 同步账本（Store 协作类，C-06 从 store.ts 原样抽出，零行为变化）：markSynced 族归位 / cloud_deleted
 * 标记 / 恢复标记与断点续传 / 墓碑水线·签名 / 同步状态记录 —— 设备本地账本，不进 S3。
 * 边界：合并判定在 core/s3v3Decision|s3v3Merge、传输在 core/s3v3Engine；远端应用 applyRemote* 族
 * 仍在 store→syncReconciliation。本文件 = 账本「真逻辑」（批量 SQL/标记位）+ 账本读写门面；
 * 合并语义的写入委托同层的 SyncReconciliation（共用 db，注释见 syncReconciliation.ts 头）。
 * 契约：AGENTS §3#4（restore_pending_at 在 markSynced 清除，残留⇒墓碑永胜失效）、§7#4（归位同改
 * tree_nodes）、docs/SYNC-PROTOCOL.md §9.6（markSynced 族 = S 同步专用镜像写路径）。
 * 护栏：electron/syncStateBookkeeping.test.ts（表驱动，搬移前钉语义）。
 */
import type { DbLike } from "./dbLike.js";
import type { SyncReconciliation } from "./syncReconciliation.js";
import { isSafePathSegment } from "../src/core/storeUtils.js";
import type { S3v3DiagnosticReport } from "../src/core/s3v3Report.js";
import type { HistoryCleanupResult } from "./storeTypes.js";

/** 同步账本上下文：db + 合并语义实现（由 Store 装配；与 SyncReconciliation 同层、复用同一 db）。 */
export interface SyncStateBookkeepingContext {
  db: DbLike;
  reconciliation: SyncReconciliation;
}

export class SyncStateBookkeeping {
  private readonly ctx: SyncStateBookkeepingContext;
  /** v3 同步成功后回填的「云端有副本」文档集合（缺正文可云恢复判据；内存态，每轮覆盖）。 */
  private remoteNoteIds = new Set<string>();

  constructor(ctx: SyncStateBookkeepingContext) {
    this.ctx = ctx;
  }

  /** v3 发布成功后批量标记已同步（只改同步账本/UI dirty，不碰正文）。 */
  /**
   * 261107（数据安全）：saveBaseline 的**守卫式**归位。只清「本地 updated_at 仍等于基线快照」的行；
   * 同步窗口内被改名/移动/恢复的行保持 dirty / restore_pending_at，留给下一轮重传。
   * 对比旧的 markNotesSynced（无条件清）——那是「窗口内编辑被标 synced 后永远不传」的根因。
   */
  markNotesSyncedIfUnchanged(entries: readonly { id: string; updatedAt: string }[]): { cleared: number; kept: number } {
    const expected = new Map<string, string>();
    for (const entry of entries) expected.set(entry.id, entry.updatedAt);
    const ids = [...expected.keys()];
    let cleared = 0;
    let kept = 0;
    for (let i = 0; i < ids.length; i += 400) {
      const batch = ids.slice(i, i + 400);
      const ph = batch.map(() => "?").join(",");
      const current = new Map(
        (this.ctx.db.prepare("SELECT id, updated_at FROM notes WHERE id IN (" + ph + ") AND is_purged=0").all(...batch) as Array<{ id: string; updated_at: string }>)
          .map((row) => [row.id, row.updated_at] as const),
      );
      const good: string[] = [];
      for (const id of batch) {
        const now = current.get(id);
        if (now === undefined) continue; // 已彻底删除：无需清 UI 标记
        if (now === expected.get(id)) good.push(id);
        else kept++;
      }
      cleared += good.length;
      if (good.length === 0) continue;
      const goodPh = good.map(() => "?").join(",");
      this.ctx.db.prepare("UPDATE notes SET is_dirty=0, restore_pending_at=NULL WHERE id IN (" + goodPh + ") AND is_purged=0").run(...good);
      this.ctx.db.prepare("UPDATE tree_nodes SET is_dirty=0 WHERE note_file_id IN (" + goodPh + ") AND is_purged=0").run(...good);
    }
    return { cleared, kept };
  }

  markNotesSynced(ids: readonly string[]): void {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 200) {
      const batch = unique.slice(i, i + 200);
      const ph = batch.map(() => "?").join(",");
      // restore_pending_at 一并清：本批 = 已发布基线里的条目，代表「恢复已生效/已重新上传成功」。
      // 不清会让恢复标记残留 ⇒ v3 每轮都判 restore-upload 重传（cloud_deleted 也永远等不到清除）。
      this.ctx.db.prepare("UPDATE notes SET is_dirty=0, restore_pending_at=NULL WHERE id IN (" + ph + ") AND is_purged=0").run(...batch);
      this.ctx.db.prepare("UPDATE tree_nodes SET is_dirty=0 WHERE note_file_id IN (" + ph + ") AND is_purged=0").run(...batch);
    }
  }

  /**
   * v3：把「远端已彻底删除、本机保留回收站副本」的 remotePurged 全集落到本地标记位。
   * - 传进来的 id → cloud_deleted=1（notes + tree_nodes 同步打标，UI/属性/回收站列表都读它）；
   * - 不在集合里的已标记行 → 清 0（恢复并重新上传成功、或他端恢复后跟随，徽标消失）。
   * 只写有变化的行 ⇒ 稳态同步零 INSERT/UPDATE；独立于 is_purged（后者是抑制位，不是展示位）。
   */
  applyNotesCloudDeleted(ids: readonly string[]): void {
    const next = new Set(ids.filter((id) => isSafePathSegment(id)));
    const flagged = new Set(
      (this.ctx.db.prepare("SELECT id FROM notes WHERE cloud_deleted=1").all() as Array<{ id: string }>).map((r) => r.id),
    );
    // 261124 B8（审计④F6）：**目录行按节点 id 置位/清除**（tree_nodes.note_file_id=NULL）——
    // 旧实现树行只按 note_file_id 匹配、flagged 只扫 notes ⇒ folder 徽标既立不上也清不掉
    //（settleCloudDeleted 永不失效）。树行业务 id 归一 = note_file_id ?? id。
    for (const row of this.ctx.db.prepare("SELECT id, note_file_id FROM tree_nodes WHERE cloud_deleted=1").all() as Array<{ id: string; note_file_id: string | null }>) {
      flagged.add(row.note_file_id ?? row.id);
    }
    const setNote = this.ctx.db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id=? AND cloud_deleted=0");
    const clearNote = this.ctx.db.prepare("UPDATE notes SET cloud_deleted=0 WHERE id=? AND cloud_deleted=1");
    const setNode = this.ctx.db.prepare("UPDATE tree_nodes SET cloud_deleted=1 WHERE (note_file_id=? OR id=?) AND cloud_deleted=0");
    const clearNode = this.ctx.db.prepare("UPDATE tree_nodes SET cloud_deleted=0 WHERE (note_file_id=? OR id=?) AND cloud_deleted=1");
    const tx = this.ctx.db.transaction(() => {
      for (const id of next) if (!flagged.has(id)) { setNote.run(id); setNode.run(id, id); }
      for (const id of flagged) if (!next.has(id)) { clearNote.run(id); clearNode.run(id, id); }
    });
    tx();
  }

  /** 当前「云端已删除 · 仅本地」标记的文档 id（诊断/测试用；UI 走 listNoteSummaries/listTreeNodes）。 */
  listCloudDeletedNoteIds(): string[] {
    return (this.ctx.db.prepare("SELECT id FROM notes WHERE cloud_deleted=1 ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
  }

  /** 显式恢复标记（restore_pending_at）的本地文档 id：v3 adapter 用它填 state.restorePending。 */
  listRestorePendingNoteIds(): string[] {
    return (this.ctx.db.prepare("SELECT id FROM notes WHERE deleted_at IS NULL AND restore_pending_at IS NOT NULL ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
  }

  /** v3 删除意图来源：已彻底删除（purged_at 非空）的墓碑；用于把本地 purge 传播到云端。 */
  listPurgedTombstones(): Array<{ id: string; purgedAt: string | null }> {
    return (this.ctx.db.prepare("SELECT id, purged_at FROM deleted_notes WHERE purged_at IS NOT NULL").all() as Array<{ id: string; purged_at: string | null }>)
      .map((r) => ({ id: r.id, purgedAt: r.purged_at }));
  }

  /** v3 同步成功后回填：这批文档在云端有副本（缺正文时可尝试从云端拉回）。 */
  markRemoteNoteIds(ids: string[]): void {
    this.remoteNoteIds = new Set(ids);
  }

  /** 「云端有副本」事实查询（缺正文服务的可云恢复判据输入；C-06 拆分后的读取口）。 */
  hasRemoteNoteId(id: string): boolean {
    return this.remoteNoteIds.has(id);
  }

  /**
   * 断点续传标记（261026）：一轮同步开始即置位，**成功结束才清除**。
   * 进程被杀/崩溃/断网中断时标记残留 ⇒ 下次启动自动续传（不管 autoMode 是 interval/onOpenClose/manual）。
   */
  markSyncInterrupted(at: string): void {
    this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('sync_interrupted_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(at);
  }
  clearSyncInterrupted(): void {
    this.ctx.db.prepare("DELETE FROM device_state WHERE key='sync_interrupted_at'").run();
  }
  getSyncInterruptedAt(): string | null {
    const row = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='sync_interrupted_at'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  // ===== 以下 = 同步对账（SyncReconciliation）的账本门面：实现见 syncReconciliation.ts，这里只转递 =====

  /** 本地同步快照保护（V5 §5.2）：仅当本地状态与快照一致才标记 synced（语义详见 syncReconciliation）。 */
  markSyncedIfUnchanged(noteId: string, expected: {
    contentHash: string; updatedAt: string; title: string; parentId: string | null;
    sortOrder: number; isEditLocked: boolean; editLockedAt: string | null; icon: string | null;
  }): boolean {
    return this.ctx.reconciliation.markSyncedIfUnchanged(noteId, expected);
  }

  markSynced(id: string): void {
    this.ctx.reconciliation.markSynced(id);
  }

  /** 目录/分组归位（V5 §5.1）：按构建 manifest 时的 updatedAt 快照条件归位。 */
  markFolderSynced(id: string, expectedUpdatedAt: string): boolean {
    return this.ctx.reconciliation.markFolderSynced(id, expectedUpdatedAt);
  }

  /** 是否处于"回收站恢复后待同步"状态（墓碑权威下唯一 local-wins 例外）。 */
  isRestorePending(id: string): boolean {
    return this.ctx.reconciliation.isRestorePending(id);
  }

  /** 是否处于待上传/本地未对齐状态（sync_state != synced）。 */
  isSyncPending(id: string): boolean {
    return this.ctx.reconciliation.isSyncPending(id);
  }

  recordS3GcLog(action: string, key: string, reason: string, commitId: string | null, deviceId: string | null, ok: boolean): void {
    this.ctx.reconciliation.recordS3GcLog(action, key, reason, commitId, deviceId, ok);
  }

  listS3GcLog(): Array<{ id: number; ts: string; action: string; key: string; reason: string; commitId: string | null; deviceId: string | null; ok: boolean }> {
    return this.ctx.reconciliation.listS3GcLog();
  }

  markSyncComplete(at: string): void {
    this.ctx.reconciliation.markSyncComplete(at);
  }

  recordSyncResult(json: string): void {
    this.ctx.reconciliation.recordSyncResult(json);
  }

  /** SD-13：最近 3 轮 v3 同步诊断（device_state.sync_v3_reports；设置页「同步诊断」一键复制）。 */
  recordV3SyncReport(report: S3v3DiagnosticReport): void {
    this.ctx.reconciliation.recordV3SyncReport(report);
  }

  listV3SyncReports(): S3v3DiagnosticReport[] {
    return this.ctx.reconciliation.listV3SyncReports();
  }

  /** P4：记录最近一次历史清理结果（自动/手动），供设置面板展示与排查 */
  recordHistoryCleanup(result: HistoryCleanupResult): void {
    this.ctx.reconciliation.recordHistoryCleanup(result);
  }

  getLastHistoryCleanup(): { at: string; deletedSnapshots: number; freedBytes: number } | null {
    return this.ctx.reconciliation.getLastHistoryCleanup();
  }

  /** 已写入同步清单的删除标记可安全剪除，避免 deleted_notes 无限累积 */
  pruneTombstones(ids: string[]): void {
    this.ctx.reconciliation.pruneTombstones(ids);
  }

  getSyncStatus(): { lastSyncedAt: string | null; lastResult: Record<string, unknown> | null } {
    return this.ctx.reconciliation.getSyncStatus();
  }

  /** Del-6（261029）：墓碑发布**水线**（替代逐行 published_at；desktopSync 成功后写入）。
   * 待同步判据 = deleted_at > 水线（见 syncReconciliation）。 */
  markTombstonesWaterline(at?: string): void {
    this.ctx.reconciliation.markTombstonesWaterline(at);
  }
  getTombstonesWaterline(): string {
    return this.ctx.reconciliation.getTombstonesWaterline();
  }

  /** P1-3 启动自检：历史库若已写入未来水线（时钟前跳），归一后回写一次（幂等）。 */
  repairTombstonesWaterline(): void {
    this.ctx.reconciliation.repairTombstonesWaterline();
  }

  /** 零变更早退：本设备上次成功读/写的 manifest commitId（device_state）。 */
  getLastSeenCommitId(): string | null {
    return this.ctx.reconciliation.getLastSeenCommitId();
  }
  setLastSeenCommitId(commitId: string): void {
    this.ctx.reconciliation.setLastSeenCommitId(commitId);
  }

  /** 本地上次同步时的墓碑签名（COUNT:MAX(deleted_at)），早退判定"是否新增了 purge"。 */
  getLastTombstoneSig(): string {
    return this.ctx.reconciliation.getLastTombstoneSig();
  }
  setLastTombstoneSig(sig: string): void {
    this.ctx.reconciliation.setLastTombstoneSig(sig);
  }
  tombstoneSignature(): string {
    return this.ctx.reconciliation.tombstoneSignature();
  }

  /** 廉价 pending 指纹（三个索引级 COUNT，微秒级）：IPC 层每次调用后 diff，变化才广播完整摘要。 */
  pendingSignature(): string {
    return this.ctx.reconciliation.pendingSignature();
  }

  getSyncPendingSummary(): { documents: number; folders: number; resources: number; generatedAt: string } {
    return this.ctx.reconciliation.getSyncPendingSummary();
  }

  /** 是否有本地待上传变更（早退判定；详见 syncReconciliation）。 */
  hasLocalPendingNotes(): boolean {
    return this.ctx.reconciliation.hasLocalPendingNotes();
  }

  /** 本地已彻底删除（purge）过的 folder/group（永久判定，node_type='folder' 墓碑；详见 syncReconciliation）。 */
  isFolderPurged(id: string): boolean {
    return this.ctx.reconciliation.isFolderPurged(id);
  }

  /** 已彻底删除（purge）的墓碑：下次同步需立即删 S3 前缀。 */
  listPurgedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; purgedAt: string }> {
    return this.ctx.reconciliation.listPurgedNotesForSync();
  }
}
