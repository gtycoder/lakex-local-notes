/**
 * 小记库**门面**（261112 拆分，05 报告 S-3）：装配 + 对外方法名**逐字不变**（IPC 不改）。
 *
 * 模块分工（依赖方向单向，index 在顶层）：
 *   schema.ts        DDL 与一次性迁移（顺序写死）
 *   searchIndex.ts   独立 FTS + 搜索账本（被 save/trash/missing/tags 调用，自己不回调上层）
 *   staging.ts       暂存空间（图片/附件落盘、sidecar、校验、丢弃）
 *   savePipeline.ts  保存/导入落盘（staging→db.transaction→promote 三步在同一函数；启动恢复）
 *   trashLifecycle.ts 删除/回收站/恢复/purge/冲突归档/转换墓碑
 *   tagLinks.ts      标签关系 + 目录合并（关系版本 LWW）
 *   missingBody.ts   缺正文清单与两条恢复路径
 *   context.ts       共享路径/原子写/校验（无状态）
 *
 * 装配顺序（**不要改**，与拆分前构造函数逐行等价）：
 *   db 打开/pragma → migrate → tags/links → 水线自检 → tagService → queries → recoverStagedSaves
 *   → recoverImports → （首次升级）reindexAllSearchTags → ensureSearchIndex
 */
import Database from "better-sqlite3";
import { createSilentLoggerScopes, type LoggerScopes } from "../../src/core/logger.js";
import fs from "node:fs";
import path from "node:path";
import type { DbLike } from "../dbLike.js";
import type { QuickNoteDocument, QuickNoteImage, QuickNoteImageInput, SaveQuickNoteInput, QuickNoteDeleted } from "../quickNoteTypes.js";
import type { QuickNoteTag } from "../../src/core/quickNoteTags.js";
import { QuickNoteTagsStore } from "../quickNoteTagsStore.js";
import { QuickNoteTagLinksStore } from "../quickNoteTagLinksStore.js";
import { QuickNoteTagService } from "../quickNoteTagService.js";
import { QuickNotesQueries } from "../quickNotesQueries.js";
import type { QuickNoteListSummary } from "../../src/lib/types.js";
import type { MissingQuickNoteDoc } from "../../src/core/missingBody.js";
import { advanceWaterline, normalizeWaterline } from "../../src/core/syncWaterline.js";
import type { SearchResult } from "../../src/core/searchTypes.js";

import { assetDirOf, itemPathOf, nowIso, quickImageUrlOf, type QuickNotePaths } from "./context.js";
import { migrateQuickNotesSchema } from "./schema.js";
import {
  ensureQuickNoteSearchIndex,
  rebuildQuickNoteSearchIndex,
  reindexAllQuickNoteSearchTags,
  reindexQuickNoteSearchTagsForTags,
  searchQuickNotes,
  type QuickNoteSearchDeps,
} from "./searchIndex.js";
import { discardDraft, discardStagedImage, stageFile, stageImage } from "./staging.js";
import { createQuickNote, importRemoteQuickNote, recoverImports, recoverStagedSaves, updateQuickNote, type QuickNoteSaveDeps } from "./savePipeline.js";
import {
  archiveLocalToTrash,
  beginConversion,
  deleteQuickNote,
  deletedRecord,
  finalizeConversion,
  hasDeleted,
  listAllDeleted,
  listCloudDeletedQuickNoteIds,
  listDeferredDeletedForSync,
  listDeletedForSync,
  listQuickNoteTrash,
  listRestorePendingQuickNoteIds,
  markConversionTargetCreated,
  markQuickNoteTrashCloudDeleted,
  markTargetNotesSynced,
  purgeOrphanQuickNote,
  purgeQuickNote,
  recoverConversions,
  rememberDeleted,
  restoreQuickNote,
  revokeLocalDeletion,
  type QuickNoteTrashDeps,
} from "./trashLifecycle.js";
import {
  applyRemoteQuickNoteTagLinks,
  listQuickNoteTagIds,
  mergeQuickTags,
  reindexSearchForNoteIds,
  setQuickNoteTags,
  type QuickNoteTagLinkDeps,
} from "./tagLinks.js";
import {
  applyRecoveredQuickNoteFromCloud,
  listMissingQuickNotes,
  purgeMissingQuickNote,
  recoverQuickNoteFromText,
  type QuickNoteMissingBodyDeps,
} from "./missingBody.js";

export { QUICK_NOTE_VERSION, MAX_QUICK_NOTE_TEXT_LENGTH } from "../quickNoteModel.js";
export type { QuickNoteContent, QuickNoteConversion, QuickNoteDeleted, QuickNoteDocument, QuickNoteImage, QuickNoteImageInput, QuickNoteSummary, SaveQuickNoteInput } from "../quickNoteTypes.js";
export type { StoredQuickNoteContent } from "../quickNoteModel.js";
export { MAX_IMAGE_BYTES as MAX_QUICK_NOTE_IMAGE_BYTES } from "../../src/core/storeLimits.js";
export { MAX_ATTACHMENT_BYTES as MAX_QUICK_NOTE_ATTACHMENT_BYTES } from "../../src/core/storeLimits.js";

/**
 * 小记的本地数据空间。它不读取或写入既有 metadata.sqlite3 / notes / note-assets，
 * 唯一跨空间动作由 main.ts 的转换协调器通过 conversion journal 显式编排。
 */
export class QuickNotesStore {
  private db: DbLike;
  /** 261107：供标签存储迁移/接线使用；不要用于绕过 store 的领域方法。 */
  get databaseHandle(): Database.Database { return this.db as Database.Database; }
  private paths: QuickNotePaths;
  private queries: QuickNotesQueries;
  /** 标签目录子系统（独立表；不认识小记）。 */
  readonly tags: QuickNoteTagsStore;
  /** 小记 ↔ 标签关联（唯一关系真相）。 */
  readonly links: QuickNoteTagLinksStore;
  /** 唯一同时接触两个子系统的协调层。 */
  readonly tagService: QuickNoteTagService;
  /** V5 Phase 2：日志注入点（桌面默认 = electron-log，由 main.ts 装配；v3 适配器经此读取） */
  readonly logScopes: LoggerScopes;

  // 拆分后的窄依赖（构造一次、只读复用；不要在方法里临时 new）
  private readonly searchDeps!: QuickNoteSearchDeps;
  private readonly tagLinkDeps!: QuickNoteTagLinkDeps;
  private readonly saveDeps!: QuickNoteSaveDeps;
  private readonly trashDeps!: QuickNoteTrashDeps;
  private readonly missingDeps!: QuickNoteMissingBodyDeps;

  constructor(workspaceRoot: string, logScopes: LoggerScopes = createSilentLoggerScopes()) {
    this.logScopes = logScopes;
    const root = path.join(workspaceRoot, "quick-notes");
    const itemsDir = path.join(root, "items");
    const assetsDir = path.join(root, "assets");
    const stagingDir = path.join(root, "staging");
    this.paths = { root, itemsDir, assetsDir, stagingDir };
    fs.mkdirSync(itemsDir, { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    this.db = new Database(path.join(root, "metadata.sqlite3"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    migrateQuickNotesSchema(this.db);
    this.tags = new QuickNoteTagsStore(this.db);
    this.links = new QuickNoteTagLinksStore(this.db);
    // P1-3 启动自检：历史库可能已写入未来水线（时钟前跳）⇒ 归一后回写一次。
    try { this.repairTombstonesWaterline(); } catch { /* 自检失败不阻断启动 */ }
    // tagService 的回调闭包捕获 this（不在此刻调用），所以可以先建；随后 queries 与各窄依赖就绪。
    this.tagService = new QuickNoteTagService(this.db, this.tags, this.links, (tagIds, noteIds) => {
      if (tagIds.length > 0) reindexQuickNoteSearchTagsForTags(this.searchDeps, tagIds);
      // 关联已被删掉（删除标签/合并源标签）的场景：按小记 id 重刷，否则 FTS 里会残留旧标签词。
      if (noteIds && noteIds.length > 0) reindexSearchForNoteIds(this.tagLinkDeps, noteIds);
    });
    this.queries = new QuickNotesQueries({
      db: this.db,
      itemPath: (id) => itemPathOf(this.paths, id),
      imageUrl: (noteId, filename) => quickImageUrlOf(noteId, filename),
      listTags: () => this.tags.list(),
      tagIds: (id) => this.links.listFor(id),
      allTagIds: () => this.links.listAll(),
    });
    this.searchDeps = { db: this.db, queries: this.queries, tags: this.tags, links: this.links };
    this.tagLinkDeps = { db: this.db, tags: this.tags, links: this.links, tagService: this.tagService, search: this.searchDeps };
    this.saveDeps = { db: this.db, paths: this.paths, queries: this.queries, search: this.searchDeps };
    this.trashDeps = { db: this.db, paths: this.paths, queries: this.queries, links: this.links, search: this.searchDeps };
    this.missingDeps = { db: this.db, paths: this.paths, queries: this.queries, tags: this.tags, tagService: this.tagService, search: this.searchDeps };
    recoverStagedSaves(this.saveDeps);
    recoverImports(this.saveDeps);
    // 261024(B) 首次升级：标签已移出正文，旧 FTS 账本里的标签词失去来源 ⇒ 重建一次小记索引。
    if (this.links.schemaCreated) this.reindexAllSearchTags();
    this.ensureSearchIndex();
  }

  /**
   * 261106 批量操作：把一批小记写动作放进**单个事务**（嵌套调用由 better-sqlite3 走 SAVEPOINT）。
   * 用途 = `batch_notes`（space=quickNotes）的"先全部校验、再一次性落地，异常整批回滚"。
   */
  batchTransaction<T>(fn: () => T): T {
    return this.db.transaction(() => fn())() as T;
  }

  /** A1 一致性 DB 快照：VACUUM INTO 单文件（无 WAL 依赖、可独立打开）。目标必须不存在。 */
  backupDatabaseTo(targetPath: string): void {
    const escaped = targetPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
  }

  // ===== 读（投影 / 文档 / 计数） =====

  /**
   * 单条小记的同步行（261110 单条推送提速）：只读 DB 行 + 标签关系，不读正文、不扫其它小记。
   */
  getQuickNoteSyncRow(id: string): {
    id: string; createdAt: string; updatedAt: string; contentHash: string; isConflict: boolean;
    tagIds: string[]; tagsUpdatedAt: string | null; cloudDeleted?: boolean; deletedAt?: string;
  } | null {
    const row = this.db.prepare("SELECT id,created_at,updated_at,content_hash,is_conflict,cloud_deleted,deleted_at FROM quick_notes WHERE id=?").get(id) as
      { id: string; created_at: string; updated_at: string; content_hash: string; is_conflict: number; cloud_deleted?: number; deleted_at?: string | null } | undefined;
    if (!row) return null;
    return {
      id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, contentHash: row.content_hash,
      isConflict: Number(row.is_conflict) === 1,
      tagIds: [...this.listQuickNoteTagIds(row.id)].sort(),
      tagsUpdatedAt: this.links.tagsUpdatedAt(row.id),
      ...(Number(row.cloud_deleted) === 1 ? { cloudDeleted: true } : {}),
      ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    };
  }

  /** 单条存在性（只读 DB 行，**不读正文**）：单条推送的 fail-fast，避免为"不存在"多读一次正文。 */
  hasQuickNote(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM quick_notes WHERE id=?").get(id);
  }

  /**
   * DT-05：列表只回投影（**不读 .qnote 正文**）——2 万小记时 body 是最大的一块 IPC payload。
   * 正文/资源在打开单条时走 readQuickNote；列表只读 DB 行 + 关联表 + 资源 mime。
   */
  listQuickNotes(): QuickNoteListSummary[] {
    const rows = this.db.prepare(
      "SELECT id, created_at, updated_at, preview_text, image_count, content_hash, is_dirty, is_conflict " +
      "FROM quick_notes ORDER BY created_at DESC"
    ).all() as Array<{ id: string; created_at: string; updated_at: string; preview_text: string; image_count: number; content_hash: string; is_dirty: number; is_conflict: number }>;
    const tagNames = this.tags.nameById();
    const links = this.links.listAll();
    const assetMimeTypes = new Map<string, string[]>();
    const assets = this.db.prepare("SELECT DISTINCT quick_note_id, mime_type FROM quick_note_assets").all() as Array<{ quick_note_id: string; mime_type: string }>;
    for (const asset of assets) {
      const list = assetMimeTypes.get(asset.quick_note_id);
      if (list) list.push(asset.mime_type);
      else assetMimeTypes.set(asset.quick_note_id, [asset.mime_type]);
    }
    return rows.map((row) => {
      const tagIds = links.get(row.id) ?? [];
      return {
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        previewText: row.preview_text,
        imageCount: row.image_count,
        contentHash: row.content_hash,
        syncState: row.is_dirty ? "local" as const : "synced" as const,
        isConflict: !!row.is_conflict,
        tagIds: [...tagIds],
        tags: tagIds.map((id) => tagNames.get(id) ?? ""),
        assetMimeTypes: assetMimeTypes.get(row.id) ?? [],
      };
    });
  }

  /** 同步/搜索索引重建需要完整文档（正文 + 资源 URL）；**不要**把它接回列表 IPC。 */
  listQuickNoteDocuments(): QuickNoteDocument[] {
    return this.queries.list();
  }

  /** 关于页概览用：小记条数（独立库；小记无软删列，删除走 quick_note_deleted）。 */
  countQuickNotes(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM quick_notes").get() as { c: number }).c;
  }

  readQuickNote(id: string): QuickNoteDocument {
    return this.queries.read(id);
  }

  // ===== 标签关系（委托 tagLinks） =====

  listQuickNoteTagIds(noteId: string): string[] { return listQuickNoteTagIds(this.tagLinkDeps, noteId); }
  setQuickNoteTags(noteId: string, tagIds: readonly string[]): string[] { return setQuickNoteTags(this.tagLinkDeps, noteId, tagIds); }
  applyRemoteQuickNoteTagLinks(noteId: string, tagIds: readonly string[], tagsUpdatedAt: string): boolean {
    return applyRemoteQuickNoteTagLinks(this.tagLinkDeps, noteId, tagIds, tagsUpdatedAt);
  }
  mergeQuickTags(tags: readonly QuickNoteTag[], removedIds: readonly string[] = []): void {
    mergeQuickTags(this.tagLinkDeps, tags, removedIds);
  }
  reindexSearchForNoteIds(noteIds: readonly string[]): void { reindexSearchForNoteIds(this.tagLinkDeps, noteIds); }

  // ===== 缺正文（委托 missingBody） =====

  listMissingQuickNotes(options: { cloudConfigured: boolean }): MissingQuickNoteDoc[] {
    return listMissingQuickNotes(this.missingDeps, options);
  }
  recoverQuickNoteFromText(id: string): QuickNoteDocument { return recoverQuickNoteFromText(this.missingDeps, id); }
  applyRecoveredQuickNoteFromCloud(id: string, rawContent: unknown, options: { updatedAt: string }): QuickNoteDocument {
    return applyRecoveredQuickNoteFromCloud(this.missingDeps, id, rawContent, options);
  }
  purgeMissingQuickNote(id: string): void { purgeMissingQuickNote(this.missingDeps, id); }

  // ===== 搜索（委托 searchIndex） =====

  search(query: string, limit = 20): Array<SearchResult & { kind: "quick-note" }> {
    return searchQuickNotes(this.searchDeps, query, limit);
  }
  rebuildSearchIndex(): void { rebuildQuickNoteSearchIndex(this.searchDeps); }
  ensureSearchIndex(): void { ensureQuickNoteSearchIndex(this.searchDeps); }
  reindexSearchTagsForTags(tagIds: readonly string[]): void { reindexQuickNoteSearchTagsForTags(this.searchDeps, tagIds); }
  reindexAllSearchTags(): void { reindexAllQuickNoteSearchTags(this.searchDeps); }

  // ===== 暂存（委托 staging） =====

  async stageImage(draftId: string, input: QuickNoteImageInput): Promise<QuickNoteImage> {
    return stageImage({ paths: this.paths }, draftId, input);
  }
  stageFile(draftId: string, input: QuickNoteImageInput): QuickNoteImage {
    return stageFile({ paths: this.paths }, draftId, input);
  }
  discardDraft(draftId: string): void { discardDraft({ paths: this.paths }, draftId); }
  discardStagedImage(draftId: string, assetId: string): void { discardStagedImage({ paths: this.paths }, draftId, assetId); }

  // ===== 保存/导入（委托 savePipeline） =====

  createQuickNote(input: SaveQuickNoteInput): QuickNoteDocument { return createQuickNote(this.saveDeps, input); }
  updateQuickNote(id: string, input: SaveQuickNoteInput): QuickNoteDocument { return updateQuickNote(this.saveDeps, id, input); }
  importRemoteQuickNote(
    item: { id: string; createdAt: string; updatedAt: string; contentHash: string; isConflict: boolean },
    contentBytes: Buffer,
    assets: { filename: string; bytes: Buffer }[],
  ): void {
    importRemoteQuickNote(this.saveDeps, item, contentBytes, assets);
  }

  // ===== 删除/回收站/转换（委托 trashLifecycle） =====

  deleteQuickNote(id: string): void { deleteQuickNote(this.trashDeps, id); }
  listQuickNoteTrash(): Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string; cloudDeleted?: boolean }> {
    return listQuickNoteTrash(this.trashDeps);
  }
  markQuickNoteTrashCloudDeleted(ids: readonly string[]): void { markQuickNoteTrashCloudDeleted(this.trashDeps, ids); }
  listCloudDeletedQuickNoteIds(): string[] { return listCloudDeletedQuickNoteIds(this.trashDeps); }
  listRestorePendingQuickNoteIds(): string[] { return listRestorePendingQuickNoteIds(this.trashDeps); }
  restoreQuickNote(id: string): QuickNoteDocument { return restoreQuickNote(this.trashDeps, id); }
  revokeLocalDeletion(id: string): void { revokeLocalDeletion(this.trashDeps, id); }
  purgeQuickNote(id: string): void { purgeQuickNote(this.trashDeps, id); }
  archiveLocalToTrash(id: string): string { return archiveLocalToTrash(this.trashDeps, id); }
  purgeOrphanQuickNote(id: string): void { purgeOrphanQuickNote(this.trashDeps, id); }
  rememberDeleted(item: { id: string; createdAt: string; updatedAt: string; deletedAt: string }): void {
    rememberDeleted(this.trashDeps, item);
  }
  beginConversion(sourceQuickNoteId: string, targetNoteId: string, targetNotebookId: string): QuickNoteDocument {
    return beginConversion(this.trashDeps, sourceQuickNoteId, targetNoteId, targetNotebookId);
  }
  markConversionTargetCreated(sourceQuickNoteId: string): void { markConversionTargetCreated(this.trashDeps, sourceQuickNoteId); }
  finalizeConversion(sourceQuickNoteId: string): void { finalizeConversion(this.trashDeps, sourceQuickNoteId); }
  recoverConversions(noteExists: (noteId: string) => boolean, cleanupUntrackedTarget: (noteId: string) => void): void {
    recoverConversions(this.trashDeps, noteExists, cleanupUntrackedTarget);
  }
  markTargetNotesSynced(noteIds?: Set<string>): void { markTargetNotesSynced(this.trashDeps, noteIds); }

  // ===== 同步适配（水线 / 基线 / 标记 / 列表）：薄 DB 封装留在这里 =====

  getPendingSyncSummary(): { items: number; resources: number } {
    const row = this.db.prepare("SELECT COUNT(*) AS items, COALESCE(SUM(image_count), 0) AS resources FROM quick_notes WHERE is_dirty=1").get() as { items: number; resources: number };
    // 墓碑计数只算「可发布且晚于成功同步水线」的（Del-6：deleted_at > waterline，替代逐行 published_at）
    const deleted = this.db.prepare("SELECT COUNT(*) AS items FROM quick_note_deleted WHERE ready_to_sync=1 AND deleted_at > ?").get(this.getTombstonesWaterline()) as { items: number };
    return { items: row.items + deleted.items, resources: row.resources };
  }

  /** 成功同步后推进小记墓碑水线（P1-3：单调 + 夹到 now，永不写未来值）。 */
  markTombstonesWaterline(at: string = nowIso()): void {
    const next = advanceWaterline(this.getTombstonesWaterline(), at);
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('quick_tombstones_published_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(next);
  }
  /** 小记墓碑水线读取（P1-3：非法/未来值回退 "0"，避免删除永不传播）。 */
  getTombstonesWaterline(): string {
    const row = this.db.prepare("SELECT value FROM device_state WHERE key='quick_tombstones_published_at'").get() as { value: string } | undefined;
    return normalizeWaterline(row?.value ?? "0");
  }
  /** 启动自检（P1-3）：历史库若已写入未来水线，归一后回写一次（幂等）。 */
  repairTombstonesWaterline(): void {
    const row = this.db.prepare("SELECT value FROM device_state WHERE key='quick_tombstones_published_at'").get() as { value: string } | undefined;
    const normalized = normalizeWaterline(row?.value ?? "0");
    if (!row || row.value === normalized) return;
    this.db.prepare("UPDATE device_state SET value=? WHERE key='quick_tombstones_published_at'").run(normalized);
  }
  listQuickNotesForSync(): QuickNoteDocument[] { return this.queries.listForSync(); }
  /** 正文文件缺失的行 id（同步侧自愈用）。 */
  listMissingQuickNoteIds(): string[] { return this.queries.listMissingItemIds(); }
  quickNotePathFor(id: string): string { return itemPathOf(this.paths, id); }
  quickNoteAssetsPathFor(id: string): string { return assetDirOf(this.paths, id); }
  baseHash(id: string): string | null {
    const row = this.db.prepare("SELECT content_hash FROM quick_note_sync_base WHERE quick_note_id=?").get(id) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }
  setBaseHash(id: string, contentHash: string): void {
    this.db.prepare("INSERT INTO quick_note_sync_base(quick_note_id,content_hash) VALUES(?,?) ON CONFLICT(quick_note_id) DO UPDATE SET content_hash=excluded.content_hash").run(id, contentHash);
  }
  markSynced(id: string): void {
    // restore_pending_at 一并清除：恢复已生效后残留标记会让本设备永远 local-wins（墓碑永胜被破坏）。
    this.db.prepare("UPDATE quick_notes SET is_dirty=0, restore_pending_at=NULL WHERE id=?").run(id);
  }

  /**
   * 记账快照保护（I2，见 src/core/maintenancePolicy）：仅当本地当前 content_hash 仍等于 expectedContentHash
   * （= 同步期间未被编辑）才标 synced；否则保持 local，下轮重传。
   * 对齐 Lake 侧的 markSyncedIfUnchanged 与移动端同名实现。
   */
  markSyncedIfUnchanged(id: string, expectedContentHash: string): void {
    const row = this.db.prepare("SELECT content_hash FROM quick_notes WHERE id=?").get(id) as { content_hash: string } | undefined;
    if (!row) return;
    if (row.content_hash !== expectedContentHash) return;
    this.markSynced(id);
  }

  /** 是否处于"小记回收站恢复后待同步"状态（显式恢复标记）。 */
  isRestorePending(id: string): boolean { return this.queries.isRestorePending(id); }
  markLocal(id: string): void { this.db.prepare("UPDATE quick_notes SET is_dirty=1 WHERE id=?").run(id); }
  listDeletedForSync(): QuickNoteDeleted[] { return listDeletedForSync(this.trashDeps, this.getTombstonesWaterline()); }
  /** 全部墓碑记录（含已发布）：下载方向 LWW 判定用。 */
  listAllDeleted(): QuickNoteDeleted[] { return listAllDeleted(this.trashDeps); }
  /** 已删除、但尚不能同步出去的转换 tombstone。 */
  listDeferredDeletedForSync(): QuickNoteDeleted[] { return listDeferredDeletedForSync(this.trashDeps); }
  hasDeleted(id: string): boolean { return hasDeleted(this.trashDeps, id); }
  deletedRecord(id: string): QuickNoteDeleted | null { return deletedRecord(this.trashDeps, id); }
}
