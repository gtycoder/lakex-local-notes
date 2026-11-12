/**
 * 小记**缺正文**（手工删除正文文件等）的清单与两条恢复路径 —— 261112 从 electron/quickNotes.ts 拆出。
 *
 * 判据单一来源：`src/core/missingBody.ts` 的 `missingQuickNoteRecovery`（可云恢复 / 仅历史缓存 / 无备份）。
 * 恢复只有两条：① 云端镜像（调用方已做 sha256 校验与基线记账）② 搜索索引全文缓存（纯文本，图片/格式丢失）。
 * 「解析失败/缺文件」路径**禁止写回**（AGENTS §4 容错契约）；恢复落盘顺序 = 正文先写、DB 后提交，
 * DB 失败回滚文件（避免「行里有 hash、文件不在」）。
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { isSafePathSegment as isSafeSegment } from "../../src/core/storeUtils.js";
import { AppError } from "../../src/core/storeErrors.js";
import { missingQuickNoteRecovery, type MissingQuickNoteDoc } from "../../src/core/missingBody.js";
import {
  normalizeQuickNoteContent,
  previewQuickNote,
  quickNoteBodyFromTextAndImages,
  serializeQuickNoteContent,
  type StoredQuickNoteContent,
} from "../quickNoteModel.js";
import type { QuickNoteDocument } from "../quickNoteTypes.js";
import type { QuickNotesQueries } from "../quickNotesQueries.js";
import type { DbLike } from "../dbLike.js";
import type { QuickNoteTagsStore } from "../quickNoteTagsStore.js";
import type { QuickNoteTagService } from "../quickNoteTagService.js";
import {
  assetDirOf,
  atomicWriteFile,
  itemPathOf,
  nowIso,
  sha256Hex,
  toStoreValidation,
  validateStoredContent,
  type QuickNotePaths,
} from "./context.js";
import {
  decodeIndexTags,
  ensureQuickNoteSearchIndex,
  removeQuickNoteSearchIndex,
  type QuickNoteSearchDeps,
} from "./searchIndex.js";

export interface QuickNoteMissingBodyDeps {
  readonly db: DbLike;
  readonly paths: QuickNotePaths;
  readonly queries: QuickNotesQueries;
  readonly tags: QuickNoteTagsStore;
  readonly tagService: QuickNoteTagService;
  readonly search: QuickNoteSearchDeps;
}

/** 资源页「缺小记」清单：只 stat 不读正文；带同步基线 / 搜索缓存 / 可恢复性。 */
export function listMissingQuickNotes(deps: QuickNoteMissingBodyDeps, options: { cloudConfigured: boolean }): MissingQuickNoteDoc[] {
  const rows = deps.db.prepare(
    "SELECT q.id AS id, q.created_at AS created_at, q.updated_at AS updated_at, q.preview_text AS preview_text, q.image_count AS image_count, " +
    "  (SELECT 1 FROM quick_note_sync_base b WHERE b.quick_note_id=q.id) AS has_sync_base, " +
    "  i.text_cache AS text_cache, i.tags AS tags " +
    "FROM quick_notes q LEFT JOIN quick_notes_search_index i ON i.quick_note_id=q.id"
  ).all() as Array<{ id: string; created_at: string; updated_at: string; preview_text: string; image_count: number; has_sync_base: number | null; text_cache: string | null; tags: string | null }>;
  const out: MissingQuickNoteDoc[] = [];
  for (const row of rows) {
    if (fs.existsSync(itemPathOf(deps.paths, row.id))) continue;
    const textCache = typeof row.text_cache === "string" ? row.text_cache : "";
    const hasTextCache = textCache.trim().length > 0;
    const hasSyncBase = row.has_sync_base === 1;
    out.push({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      previewText: row.preview_text,
      imageCount: Number(row.image_count) || 0,
      tags: typeof row.tags === "string" ? decodeIndexTags(row.tags).join(" ") : "",
      hasSyncBase,
      cloudConfigured: options.cloudConfigured,
      hasTextCache,
      recovery: missingQuickNoteRecovery({ cloudConfigured: options.cloudConfigured, hasSyncBase, hasTextCache }),
    });
  }
  out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return out;
}

/** 从搜索索引的全文缓存重建纯文本小记（图片/格式丢失；恢复后标 local 待同步）。 */
export function recoverQuickNoteFromText(deps: QuickNoteMissingBodyDeps, id: string): QuickNoteDocument {
  deps.queries.readRow(id);
  const cached = deps.db.prepare("SELECT text_cache,tags FROM quick_notes_search_index WHERE quick_note_id=?").get(id) as { text_cache: string; tags: string } | undefined;
  if (!cached || !cached.text_cache.trim()) throw new AppError("NotFound", "没有可用于恢复的搜索缓存文本");
  const tagNames = decodeIndexTags(cached.tags);
  const at = nowIso();
  // 恢复只复用**已存在**的同名标签（标签由标签子系统创建；小记流程绝不造标签）。
  const byName = new Map(deps.tags.list().map((tag) => [tag.name, tag.id] as const));
  const tagIds = tagNames.map((name) => byName.get(name)).filter((id): id is string => !!id);
  const body = quickNoteBodyFromTextAndImages(cached.text_cache, [], () => "", () => crypto.randomBytes(5).toString("hex"));
  const content = toStoreValidation(() => normalizeQuickNoteContent(cached.text_cache, body, []));
  const encoded = Buffer.from(serializeQuickNoteContent(content), "utf8");
  persistRecoveredContent(deps, id, content, encoded, { synced: false, updatedAt: at });
  if (tagIds.length > 0) deps.tagService.setNoteTags(id, tagIds);
  ensureQuickNoteSearchIndex(deps.search);
  return deps.queries.read(id);
}

/** 云端正文恢复后落盘（调用方已做 sha256 校验与记账 setBaseHash + markSynced）。 */
export function applyRecoveredQuickNoteFromCloud(deps: QuickNoteMissingBodyDeps, id: string, rawContent: unknown, options: { updatedAt: string }): QuickNoteDocument {
  deps.queries.readRow(id);
  const content = validateStoredContent(rawContent);
  const encoded = Buffer.from(serializeQuickNoteContent(content), "utf8");
  persistRecoveredContent(deps, id, content, encoded, { synced: true, updatedAt: options.updatedAt });
  ensureQuickNoteSearchIndex(deps.search);
  return deps.queries.read(id);
}

/** 缺正文小记的彻底删除：不读正文（读必失败），直接写 tombstone（含 purged_at）并清残留。 */
export function purgeMissingQuickNote(deps: QuickNoteMissingBodyDeps, id: string): void {
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
  const row = deps.queries.readRow(id);
  const deletedAt = nowIso();
  const tx = deps.db.transaction(() => {
    deps.db.prepare("INSERT OR REPLACE INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync,purged_at) VALUES(?,?,?,?,NULL,1,?)")
      .run(row.id, row.created_at, row.updated_at, deletedAt, deletedAt);
    deps.db.prepare("DELETE FROM quick_note_sync_base WHERE quick_note_id=?").run(row.id);
    deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(row.id);
    deps.db.prepare("DELETE FROM quick_notes WHERE id=?").run(row.id);
    deps.db.prepare("DELETE FROM tag_links WHERE target_kind='quickNote' AND target_id=?").run(row.id);
    deps.db.prepare("DELETE FROM tag_link_versions WHERE target_kind='quickNote' AND target_id=?").run(row.id);
  });
  tx();
  removeQuickNoteSearchIndex(deps.search, [row.id]);
  try { fs.rmSync(itemPathOf(deps.paths, id), { force: true }); } catch { /* best effort */ }
  try { fs.rmSync(assetDirOf(deps.paths, id), { force: true, recursive: true }); } catch { /* best effort */ }
}

/** 恢复落盘（正文先写，DB 后提交；DB 失败回滚文件，避免"行里有 hash、文件不在"）。 */
function persistRecoveredContent(
  deps: QuickNoteMissingBodyDeps,
  id: string,
  content: StoredQuickNoteContent,
  encoded: Buffer,
  options: { synced: boolean; updatedAt: string },
): void {
  const contentHash = sha256Hex(encoded);
  const itemPath = itemPathOf(deps.paths, id);
  atomicWriteFile(itemPath, encoded);
  try {
    const tx = deps.db.transaction(() => {
      deps.db.prepare("UPDATE quick_notes SET updated_at=?,preview_text=?,image_count=?,content_hash=?,is_dirty=?,is_conflict=0 WHERE id=?")
        .run(options.updatedAt, previewQuickNote(content.text, content.images.length), content.images.length, contentHash, options.synced ? 0 : 1, id);
      deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
      const insert = deps.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
      for (const image of content.images) insert.run(image.id, id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
    });
    tx();
  } catch (error) {
    try { fs.rmSync(itemPath, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}
