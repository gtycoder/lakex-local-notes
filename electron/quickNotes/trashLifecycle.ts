/**
 * 小记**删除 / 回收站 / 恢复 / 彻底删除 / 转换墓碑**——261112 从 electron/quickNotes.ts 拆出。
 *
 * 语义（AGENTS §3#4/#5，**不要重新争论**）：
 *  - 软删 = 行离开 quick_notes，落 quick_note_deleted 墓碑（ready_to_sync 由调用点决定）；
 *    内容文件默认保留（回收站可恢复）。
 *  - 彻底删除（purge）= 墓碑记 purged_at + 删内容/资源 + 清关系与搜索索引；删除靠墓碑传播。
 *  - 恢复 = 写 restore_pending_at（唯一的 local-wins 例外），由 markSynced 清除。
 *  - 转换墓碑（conversion_target_note_id 非空）在 Lake 侧同步成功前不进同步列表。
 * 事务纪律：多表写一律 `db.transaction`；本模块不嵌套调用别的模块的事务。
 */
import fs from "node:fs";
import path from "node:path";
import { isSafePathSegment as isSafeSegment } from "../../src/core/storeUtils.js";
import { AppError } from "../../src/core/storeErrors.js";
import { previewQuickNote } from "../quickNoteModel.js";
import type { QuickNoteDeleted, QuickNoteDocument } from "../quickNoteTypes.js";
import type { QuickNoteConversionRow, QuickNoteDeletedRow, QuickNoteRow, QuickNotesQueries } from "../quickNotesQueries.js";
import type { DbLike } from "../dbLike.js";
import type { QuickNoteTagLinksStore } from "../quickNoteTagLinksStore.js";
import {
  assetDirOf,
  itemPathOf,
  nowIso,
  sha256Hex,
  uuid,
  validateStoredContent,
  type QuickNotePaths,
} from "./context.js";
import { reindexQuickNoteFromDisk, removeQuickNoteSearchIndex, type QuickNoteSearchDeps } from "./searchIndex.js";

export interface QuickNoteTrashDeps {
  readonly db: DbLike;
  readonly paths: QuickNotePaths;
  readonly queries: QuickNotesQueries;
  readonly links: QuickNoteTagLinksStore;
  readonly search: QuickNoteSearchDeps;
}

/**
 * 删除（软删）：小记已不存在时静默返回，不抛 NotFound。
 * UI「乐观删除 + 5 秒撤销窗口」内，若同步先应用了远端删除（或本端已被其它路径删除），
 * 窗口到期提交时不应误报"删除失败"并把卡片塞回列表。
 */
export function deleteQuickNote(deps: QuickNoteTrashDeps, id: string): void {
  let row: QuickNoteRow;
  try {
    row = deps.queries.readRow(id);
  } catch (reason) {
    if (reason instanceof AppError && reason.kind === "NotFound") return;
    throw reason;
  }
  deleteSourceAndRemember(deps, row, null, true, true);
}

/** 小记回收站只读查询（含「云端已删除 · 仅本地」标记）。 */
export function listQuickNoteTrash(deps: QuickNoteTrashDeps): Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string; cloudDeleted?: boolean }> {
  return deps.queries.listTrash();
}

/**
 * v3 remotePurged → 小记回收站副本的「云端已删除 · 仅本地」标记（sticky）。
 * 只置位、不自动清除：远端删除进回收站后要一直可读；恢复（墓碑行删除）或本地 purge（显式清 0）才消失。
 */
export function markQuickNoteTrashCloudDeleted(deps: QuickNoteTrashDeps, ids: readonly string[]): void {
  const stmt = deps.db.prepare("UPDATE quick_note_deleted SET cloud_deleted=1 WHERE id=? AND purged_at IS NULL AND cloud_deleted=0");
  const tx = deps.db.transaction(() => { for (const id of ids) if (isSafeSegment(id)) stmt.run(id); });
  tx();
}

/** 当前标记为「云端已删除 · 仅本地」的小记 id（诊断/测试用）。 */
export function listCloudDeletedQuickNoteIds(deps: QuickNoteTrashDeps): string[] {
  return (deps.db.prepare("SELECT id FROM quick_note_deleted WHERE cloud_deleted=1 AND purged_at IS NULL ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
}

/** 显式恢复标记（restore_pending_at）的小记 id：v3 adapter 用它填 state.restorePending。 */
export function listRestorePendingQuickNoteIds(deps: QuickNoteTrashDeps): string[] {
  return (deps.db.prepare("SELECT id FROM quick_notes WHERE restore_pending_at IS NOT NULL ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
}

/** M6 小记回收站恢复：从保留的本地内容文件读回，清墓碑并置 local 待上传。 */
export function restoreQuickNote(deps: QuickNoteTrashDeps, id: string): QuickNoteDocument {
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
  const tomb = deps.db.prepare(
    "SELECT * FROM quick_note_deleted WHERE id=? AND conversion_target_note_id IS NULL AND purged_at IS NULL"
  ).get(id) as QuickNoteDeletedRow | undefined;
  if (!tomb) throw new AppError("NotFound", "小记不在回收站");
  const itemPath = itemPathOf(deps.paths, id);
  if (!fs.existsSync(itemPath)) throw new AppError("NotFound", "小记内容文件已丢失，无法恢复");
  const content = validateStoredContent(JSON.parse(fs.readFileSync(itemPath, "utf8")));
  const encoded = Buffer.from(`${JSON.stringify(content, null, 2)}\n`, "utf8");
  const contentHash = sha256Hex(encoded);
  const restoredAt = nowIso();
  // 恢复 = 本地重新拥有这条小记：若关系还在（软删保留 / 冲突归档副本），把关系版本推进到当前，
  // 否则 tagsUpdatedAt 为空，标签只在本机可见、不会随清单同步出去。
  const tagsUpdatedAt = deps.links.listFor(id).length > 0 ? restoredAt : "";
  const tx = deps.db.transaction(() => {
    deps.db.prepare("INSERT OR REPLACE INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at,cloud_deleted) VALUES(?,?,?,?,?,?, 1, 0, ?, 0)")
      .run(id, tomb.created_at, restoredAt, previewQuickNote(content.text, content.images.length), content.images.length, contentHash, restoredAt);
    deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
    const insert = deps.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
    for (const image of content.images) insert.run(image.id, id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
    deps.db.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
  });
  tx();
  if (tagsUpdatedAt) deps.links.setVersion(id, tagsUpdatedAt);
  reindexQuickNoteFromDisk(deps.search, id);
  return deps.queries.read(id);
}

/**
 * 撤销本地删除（sync 下载分支在"远端恢复较新"时调用）：移除普通删除墓碑。
 * 小记软删保留内容文件；恢复以远端为准（随后走下载/对账并 markSynced）。
 * 转换墓碑（conversion_target_note_id 非空）与已 purge 的不在此列。
 */
export function revokeLocalDeletion(deps: QuickNoteTrashDeps, id: string): void {
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
  deps.db.prepare(
    "DELETE FROM quick_note_deleted WHERE id=? AND conversion_target_note_id IS NULL AND purged_at IS NULL"
  ).run(id);
}

/** M6 小记彻底删除：删除保留的本地文件并标记 purged_at（tombstone 保留供同步传播删除）。 */
export function purgeQuickNote(deps: QuickNoteTrashDeps, id: string): void {
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
  const tomb = deps.db.prepare("SELECT * FROM quick_note_deleted WHERE id=?").get(id) as QuickNoteDeletedRow | undefined;
  if (!tomb) throw new AppError("NotFound", "小记不在回收站");
  // 本地主动彻底删除：标记位随之清掉（墓碑接管一切，"云端已删除 · 仅本地"不再成立）。
  deps.db.prepare("UPDATE quick_note_deleted SET purged_at=?,ready_to_sync=1,cloud_deleted=0 WHERE id=?").run(nowIso(), id);
  deps.links.removeNote(id);
  removeQuickNoteSearchIndex(deps.search, [id]);
  try { fs.rmSync(itemPathOf(deps.paths, id), { force: true }); } catch { /* best effort */ }
  try { fs.rmSync(assetDirOf(deps.paths, id), { force: true, recursive: true }); } catch { /* best effort */ }
}

/** 软删共用：写墓碑 + 清同步基线/资源行/活动行（单事务），事务后清搜索索引；keepFiles 控制内容文件。 */
function deleteSourceAndRemember(deps: QuickNoteTrashDeps, row: QuickNoteRow, conversionTargetNoteId: string | null, readyToSync: boolean, keepFiles: boolean): void {
  const content = deps.queries.readStoredContent(row.id);
  const deletedAt = nowIso();
  const tx = deps.db.transaction(() => {
    deps.db.prepare("INSERT OR REPLACE INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync) VALUES(?,?,?,?,?,?)")
      .run(row.id, row.created_at, row.updated_at, deletedAt, conversionTargetNoteId, readyToSync ? 1 : 0);
    deps.db.prepare("DELETE FROM quick_note_sync_base WHERE quick_note_id=?").run(row.id);
    deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(row.id);
    deps.db.prepare("DELETE FROM quick_notes WHERE id=?").run(row.id);
    // 普通软删保留关系（回收站恢复要还原标签）；转换成功后源小记不再可恢复 ⇒ 关系随之清掉。
    if (conversionTargetNoteId) deps.links.removeNote(row.id);
  });
  tx();
  removeQuickNoteSearchIndex(deps.search, [row.id]);
  if (!keepFiles) {
    try { fs.rmSync(itemPathOf(deps.paths, row.id), { force: true }); } catch { /* tombstone remains authoritative */ }
    try { fs.rmSync(assetDirOf(deps.paths, row.id), { force: true, recursive: true }); } catch { /* tombstone remains authoritative */ }
  }
  // keep a reference so TypeScript and reviewers see content has been intentionally loaded before source removal.
  void content;
}

/** 直接清掉「正文文件已丢失」的孤儿行（不读正文）：供同步侧按墓碑语义收尸。 */
export function purgeOrphanQuickNote(deps: QuickNoteTrashDeps, id: string): void {
  if (!isSafeSegment(id)) return;
  const now = nowIso();
  try {
    deps.db.prepare("INSERT INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync,purged_at,cloud_deleted) VALUES(?,?,?,?,NULL,1,?,0) ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at, ready_to_sync=1, purged_at=excluded.purged_at, cloud_deleted=0").run(id, now, now, now, now);
    deps.db.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
    deps.db.prepare("DELETE FROM quick_note_sync_base WHERE quick_note_id=?").run(id);
    deps.links.removeNote(id);
    removeQuickNoteSearchIndex(deps.search, [id]);
    try { fs.rmSync(itemPathOf(deps.paths, id), { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(assetDirOf(deps.paths, id), { force: true, recursive: true }); } catch { /* best effort */ }
  } catch { /* 收尸失败不阻断同步 */ }
}

/** 学习到的墓碑（他端删除、本端从未持有）：只记账，不进回收站（没有内容文件可恢复）。 */
export function rememberDeleted(deps: QuickNoteTrashDeps, item: { id: string; createdAt: string; updatedAt: string; deletedAt: string }): void {
  if (!isSafeSegment(item.id)) throw new AppError("InvalidInput", "无效的小记删除记录");
  deps.db.prepare("INSERT OR IGNORE INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync) VALUES(?,?,?,?,NULL,1)")
    .run(item.id, item.createdAt, item.updatedAt, item.deletedAt);
}

/**
 * 冲突归档（验收 #4 定稿：B 方案——远端覆盖本地，本地版本进小记回收站，恢复后作为一条新小记）。
 * 把本地小记复制为一条「新 id」的回收站条目：内容文件 + 资源文件保留，写墓碑（ready_to_sync=0，
 * 纯本地归档，不向云端发布删除记录——其他端从未持有该 id，避免幽灵回收站条目）；
 * 恢复 = restoreQuickNote(newId) → 一条全新小记。返回新 id。
 * 调用方（sync 下载冲突分支）随后用远端内容覆盖原条目。
 */
export function archiveLocalToTrash(deps: QuickNoteTrashDeps, id: string): string {
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
  const row = deps.queries.readRow(id);
  const newId = uuid();
  const now = nowIso();
  // 内容复制到新 id：图片 id 重映射为新 uuid（原条目在冲突覆盖后仍持有相同 image id，
  // 直接复用会在恢复/同步时撞 quick_note_assets.id 全局 UNIQUE；图片字节不变）。
  const content = deps.queries.readStoredContent(id);
  const tagIds = deps.links.listFor(id);
  let body: Buffer;
  if (content.images.length > 0) {
    const remap = new Map(content.images.map((image) => [image.id, uuid()] as const));
    const rewritten = { ...content, images: content.images.map((image) => ({ ...image, id: remap.get(image.id)! })) };
    body = Buffer.from(`${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
  } else {
    body = fs.readFileSync(itemPathOf(deps.paths, id));
  }
  fs.writeFileSync(itemPathOf(deps.paths, newId), body);
  const srcAssets = assetDirOf(deps.paths, id);
  const dstAssets = assetDirOf(deps.paths, newId);
  if (fs.existsSync(srcAssets)) {
    fs.mkdirSync(dstAssets, { recursive: true });
    for (const filename of fs.readdirSync(srcAssets)) {
      const src = path.join(srcAssets, filename);
      if (!fs.statSync(src).isFile()) continue;
      fs.copyFileSync(src, path.join(dstAssets, filename));
    }
  }
  deps.db.transaction(() => {
    deps.db.prepare("INSERT OR REPLACE INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync) VALUES(?,?,?,?,NULL,0)")
      .run(newId, row.created_at, row.updated_at, now);
    // 归档副本是「本地版本」的快照：标签关系一并复制，恢复后标签不丢。
    const insertLink = deps.db.prepare("INSERT OR IGNORE INTO tag_links(target_kind, target_id, tag_id, position) VALUES('quickNote',?,?,?)");
    tagIds.forEach((tagId, index) => insertLink.run(newId, tagId, index));
    if (tagIds.length > 0) {
      deps.db.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES('quickNote',?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(newId, now);
    }
  })();
  return newId;
}

// ===== 小记 → 文档转换（V5 §4 journal 驱动的三态） =====

export function beginConversion(deps: QuickNoteTrashDeps, sourceQuickNoteId: string, targetNoteId: string, targetNotebookId: string): QuickNoteDocument {
  if (!isSafeSegment(targetNoteId) || !isSafeSegment(targetNotebookId)) throw new AppError("InvalidInput", "转换目标无效");
  const source = deps.queries.read(sourceQuickNoteId);
  const now = nowIso();
  deps.db.prepare("INSERT OR REPLACE INTO quick_note_conversions(source_quick_note_id,target_note_id,target_notebook_id,state,created_at,updated_at) VALUES(?,?,?,?,COALESCE((SELECT created_at FROM quick_note_conversions WHERE source_quick_note_id=?),?),?)")
    .run(sourceQuickNoteId, targetNoteId, targetNotebookId, "prepared", sourceQuickNoteId, now, now);
  return source;
}

export function markConversionTargetCreated(deps: QuickNoteTrashDeps, sourceQuickNoteId: string): void {
  const changed = deps.db.prepare("UPDATE quick_note_conversions SET state='target_created',updated_at=? WHERE source_quick_note_id=? AND state='prepared'")
    .run(nowIso(), sourceQuickNoteId).changes;
  if (!changed) throw new AppError("Internal", "小记转换状态异常");
}

export function finalizeConversion(deps: QuickNoteTrashDeps, sourceQuickNoteId: string): void {
  const conversion = deps.db.prepare("SELECT * FROM quick_note_conversions WHERE source_quick_note_id=?").get(sourceQuickNoteId) as QuickNoteConversionRow | undefined;
  if (!conversion) throw new AppError("NotFound", "小记转换记录不存在");
  if (conversion.state === "complete" || conversion.state === "source_deleted_waiting_sync") return;
  if (conversion.state !== "target_created") throw new AppError("Internal", "转换目标尚未验证");
  const source = deps.queries.readRow(sourceQuickNoteId);
  deleteSourceAndRemember(deps, source, conversion.target_note_id, false, false);
  deps.db.prepare("UPDATE quick_note_conversions SET state='source_deleted_waiting_sync',updated_at=? WHERE source_quick_note_id=?")
    .run(nowIso(), sourceQuickNoteId);
}

export function recoverConversions(deps: QuickNoteTrashDeps, noteExists: (noteId: string) => boolean, cleanupUntrackedTarget: (noteId: string) => void): void {
  const rows = deps.db.prepare("SELECT * FROM quick_note_conversions WHERE state IN ('prepared','target_created')").all() as QuickNoteConversionRow[];
  for (const row of rows) {
    if (noteExists(row.target_note_id)) {
      if (row.state === "prepared") {
        deps.db.prepare("UPDATE quick_note_conversions SET state='target_created',updated_at=? WHERE source_quick_note_id=?").run(nowIso(), row.source_quick_note_id);
      }
      try { finalizeConversion(deps, row.source_quick_note_id); }
      catch (error) { console.warn("[quick-notes] 转换恢复未完成:", error); }
    } else if (row.state === "prepared") {
      cleanupUntrackedTarget(row.target_note_id);
      deps.db.prepare("DELETE FROM quick_note_conversions WHERE source_quick_note_id=?").run(row.source_quick_note_id);
    }
  }
}

export function markTargetNotesSynced(deps: QuickNoteTrashDeps, noteIds?: Set<string>): void {
  const conversions = deps.db.prepare("SELECT * FROM quick_note_conversions WHERE state='source_deleted_waiting_sync'").all() as QuickNoteConversionRow[];
  const tx = deps.db.transaction(() => {
    for (const conversion of conversions) {
      if (noteIds && !noteIds.has(conversion.target_note_id)) continue;
      deps.db.prepare("UPDATE quick_note_deleted SET ready_to_sync=1 WHERE id=? AND conversion_target_note_id=?")
        .run(conversion.source_quick_note_id, conversion.target_note_id);
      deps.db.prepare("UPDATE quick_note_conversions SET state='complete',updated_at=? WHERE source_quick_note_id=?")
        .run(nowIso(), conversion.source_quick_note_id);
    }
  });
  tx();
}

/** 同步端口：墓碑列表（水线判据由调用方传，保持"哪条算待发布"仍由 index.ts 的水线方法决定）。 */
export function listDeletedForSync(deps: QuickNoteTrashDeps, waterline: string): QuickNoteDeleted[] {
  return deps.queries.listDeletedForSync(waterline);
}
export function listAllDeleted(deps: QuickNoteTrashDeps): QuickNoteDeleted[] {
  return deps.queries.listAllDeleted();
}
export function listDeferredDeletedForSync(deps: QuickNoteTrashDeps): QuickNoteDeleted[] {
  return deps.queries.listDeferredDeletedForSync();
}
export function hasDeleted(deps: QuickNoteTrashDeps, id: string): boolean { return deps.queries.hasDeleted(id); }
export function deletedRecord(deps: QuickNoteTrashDeps, id: string): QuickNoteDeleted | null { return deps.queries.deletedRecord(id); }
