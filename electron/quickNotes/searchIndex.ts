/**
 * 小记**独立全文索引**（FTS + 搜索账本）—— 261112 从 electron/quickNotes.ts 拆出。
 *
 * 与桌面文档的 notes_fts 完全分开（避免跨库 / tree_nodes join）；body/tags 都由
 * src/core/search 的分词器预分词，账本保留 text_cache 供 buildSnippet。
 *
 * 依赖方向：本模块**只读** db/queries/tags/links，不回调任何上层（save/trash 调进来，反过来不成立）。
 * 失败语义保持原样：索引维护失败只影响搜索（console.warn），绝不阻断保存/删除 —— 启动对账可修。
 */
import type { DbLike } from "../dbLike.js";
import type { QuickNotesQueries } from "../quickNotesQueries.js";
import type { QuickNoteTagsStore } from "../quickNoteTagsStore.js";
import type { QuickNoteTagLinksStore } from "../quickNoteTagLinksStore.js";
import { QUICK_NOTES_SEARCH_LEDGER_TABLE } from "../../src/core/search/schema.js";
import { buildMatchExpression, buildSnippet, segmentToIndexText } from "../../src/core/search/index.js";
import type { SearchResult } from "../../src/core/searchTypes.js";
import type { QuickNoteDocument } from "../quickNoteTypes.js";
import { nowIso, sha256Hex } from "./context.js";

export interface QuickNoteSearchDeps {
  readonly db: DbLike;
  readonly queries: QuickNotesQueries;
  readonly tags: QuickNoteTagsStore;
  readonly links: QuickNoteTagLinksStore;
}

/** 小记没有 title 字段：搜索标题取纯文本首行（截断防超长）。 */
function firstSearchLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 120) ?? "";
}

/**
 * 搜索账本的 `tags` 列用 JSON 数组存（标签名允许内部空格，空格拼接无法还原）。
 * FTS 的 tags 列仍是空格拼接的分词文本，只服务检索、不承担还原。
 */
export function encodeIndexTags(tags: readonly string[]): string {
  return JSON.stringify(tags);
}
export function decodeIndexTags(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    // 旧账本用空格拼接（派生缓存，只能按原规则降级读取；新写入一律 JSON）。
  }
  return raw.split(" ").filter(Boolean);
}

/** 小记全文搜索（独立 FTS，不混入文档 notes_fts）。 */
export function searchQuickNotes(deps: QuickNoteSearchDeps, query: string, limit = 20): Array<SearchResult & { kind: "quick-note" }> {
  const normalized = query.trim();
  if (!normalized) return [];
  const match = buildMatchExpression(normalized);
  if (!match) return [];
  const rows = deps.db.prepare(
    "SELECT q.id AS id, q.preview_text AS preview_text, q.updated_at AS updated_at, i.text_cache AS text_cache, i.tags AS tags " +
    "FROM quick_notes_fts f " +
    "JOIN quick_notes_search_index i ON i.fts_rowid = f.rowid " +
    "JOIN quick_notes q ON q.id = i.quick_note_id " +
    "WHERE quick_notes_fts MATCH ? " +
    "ORDER BY bm25(quick_notes_fts, 1.0, 0.5), q.updated_at DESC LIMIT ?"
  ).all(match, Math.max(1, limit)) as Array<{ id: string; preview_text: string; updated_at: string; text_cache: string; tags: string }>;
  return rows.map((row) => {
    const title = row.preview_text.trim() || firstSearchLine(row.text_cache) || "小记";
    const snippet = buildSnippet(row.text_cache, normalized) || buildSnippet(decodeIndexTags(row.tags).join(" "), normalized) || firstSearchLine(row.text_cache);
    return {
      id: row.id,
      title,
      snippet,
      matchType: "body" as const,
      updatedAt: row.updated_at,
      parentTitle: null,
      kind: "quick-note" as const,
    };
  });
}

/** 设置页「重建索引」/启动对账用：只重建小记自己的 FTS。 */
export function rebuildQuickNoteSearchIndex(deps: QuickNoteSearchDeps): void {
  const docs: QuickNoteDocument[] = deps.queries.list();
  const tx = deps.db.transaction(() => {
    deps.db.exec("DELETE FROM quick_notes_fts");
    deps.db.exec("DELETE FROM quick_notes_search_index");
    const insertFts = deps.db.prepare("INSERT INTO quick_notes_fts(rowid, body, tags) VALUES(?,?,?)");
    const insertLedger = deps.db.prepare(
      "INSERT INTO quick_notes_search_index(quick_note_id, fts_rowid, text_hash, text_cache, tags, indexed_at) VALUES(?,?,?,?,?,?)"
    );
    const now = nowIso();
    let rowid = 0;
    for (const doc of docs) {
      rowid += 1;
      const text = doc.content.text ?? "";
      const tags = doc.content.tags;
      const tagsJson = encodeIndexTags(tags);
      insertFts.run(rowid, segmentToIndexText(text), segmentToIndexText(tags.join(" ")));
      insertLedger.run(doc.id, rowid, sha256Hex(text + "\0" + tagsJson), text, tagsJson, now);
    }
  });
  tx();
}

/** 启动对账：账本条数不等于活跃小记数就重建（正常启动 2 次 COUNT；坏文件/读失败不得阻断启动）。 */
export function ensureQuickNoteSearchIndex(deps: QuickNoteSearchDeps): void {
  try {
    const active = (deps.db.prepare("SELECT COUNT(*) AS c FROM quick_notes").get() as { c: number }).c;
    const indexed = (deps.db.prepare(`SELECT COUNT(*) AS c FROM ${QUICK_NOTES_SEARCH_LEDGER_TABLE}`).get() as { c: number }).c;
    if (active !== indexed) rebuildQuickNoteSearchIndex(deps);
  } catch (error) {
    console.warn("[quick][search] 启动对账失败（搜索索引暂不可用，可在设置重建）: " + String(error));
  }
}

/** 关联表 → 标签名（标签目录是唯一名称来源；未知 ID 给空串）。 */
function tagNamesFor(deps: QuickNoteSearchDeps, noteId: string): string[] {
  const names = deps.tags.nameById();
  return deps.links.listFor(noteId).map((id) => names.get(id) ?? "").filter(Boolean);
}

/** 单条：按落盘正文 + 当前标签重刷索引（失败只告警）。 */
export function reindexQuickNoteSearchTags(deps: QuickNoteSearchDeps, noteId: string): void {
  try {
    const content = deps.queries.readStoredContent(noteId);
    upsertQuickNoteSearchIndex(deps, noteId, content.text, tagNamesFor(deps, noteId));
  } catch (error) {
    console.warn("[quick][search] 标签索引更新失败（启动重建可修复）: " + noteId + " " + String(error));
  }
}

/** 标签改名/合并/删除/远端目录变化后，只刷新**关联到这些标签**的小记索引（不全量重建）。 */
export function reindexQuickNoteSearchTagsForTags(deps: QuickNoteSearchDeps, tagIds: readonly string[]): void {
  for (const noteId of deps.links.listNoteIdsForTags(tagIds)) reindexQuickNoteSearchTags(deps, noteId);
}

/** 迁移/首次升级用：全量刷新所有小记索引里的标签词（非标签目录变化的常规路径）。 */
export function reindexAllQuickNoteSearchTags(deps: QuickNoteSearchDeps): void {
  const rows = deps.db.prepare("SELECT id FROM quick_notes").all() as Array<{ id: string }>;
  for (const row of rows) reindexQuickNoteSearchTags(deps, row.id);
}

/** 内容落盘后增量更新；hash 未变直接短路。 */
export function upsertQuickNoteSearchIndex(deps: QuickNoteSearchDeps, id: string, text: string, tags: readonly string[]): void {
  const textCache = text ?? "";
  const tagsJson = encodeIndexTags(tags);
  const textHash = sha256Hex(textCache + "\0" + tagsJson);
  const prev = deps.db.prepare("SELECT fts_rowid, text_hash FROM quick_notes_search_index WHERE quick_note_id=?").get(id) as
    { fts_rowid: number; text_hash: string } | undefined;
  if (prev && prev.text_hash === textHash) return;
  const rowid = prev?.fts_rowid ?? ((deps.db.prepare("SELECT IFNULL(MAX(fts_rowid), 0) AS m FROM quick_notes_search_index").get() as { m: number }).m + 1);
  const tx = deps.db.transaction(() => {
    if (prev) deps.db.prepare("DELETE FROM quick_notes_fts WHERE rowid=?").run(rowid);
    deps.db.prepare("INSERT INTO quick_notes_fts(rowid, body, tags) VALUES(?,?,?)").run(rowid, segmentToIndexText(textCache), segmentToIndexText(tags.join(" ")));
    deps.db.prepare(
      "INSERT INTO quick_notes_search_index(quick_note_id, fts_rowid, text_hash, text_cache, tags, indexed_at) VALUES(?,?,?,?,?,?) " +
      "ON CONFLICT(quick_note_id) DO UPDATE SET fts_rowid=excluded.fts_rowid, text_hash=excluded.text_hash, text_cache=excluded.text_cache, tags=excluded.tags, indexed_at=excluded.indexed_at"
    ).run(id, rowid, textHash, textCache, tagsJson, nowIso());
  });
  tx();
}

/** 删除/彻底删除/转换后清索引。 */
export function removeQuickNoteSearchIndex(deps: QuickNoteSearchDeps, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const getRowid = deps.db.prepare("SELECT fts_rowid FROM quick_notes_search_index WHERE quick_note_id=?");
  const delFts = deps.db.prepare("DELETE FROM quick_notes_fts WHERE rowid=?");
  const delLedger = deps.db.prepare("DELETE FROM quick_notes_search_index WHERE quick_note_id=?");
  const tx = deps.db.transaction(() => {
    for (const id of ids) {
      const row = getRowid.get(id) as { fts_rowid: number } | undefined;
      if (row) delFts.run(row.fts_rowid);
      delLedger.run(id);
    }
  });
  tx();
}

/** promote 之后从落盘内容补索引（save / recovery / import 共用；失败只影响搜索，不阻断保存）。 */
export function reindexQuickNoteFromDisk(deps: QuickNoteSearchDeps, id: string): void {
  try {
    const content = deps.queries.readStoredContent(id);
    upsertQuickNoteSearchIndex(deps, id, content.text, tagNamesFor(deps, id));
  } catch (error) {
    console.warn("[quick][search] 索引更新失败（启动重建可修复）: " + id + " " + String(error));
  }
}

/** 关系已被删（删除标签/合并源标签）后用：按小记 id 重刷索引里的标签词（不能靠 tag_links 反查）。 */
export function reindexQuickNoteSearchForNoteIds(deps: QuickNoteSearchDeps, noteIds: readonly string[]): void {
  for (const id of noteIds) reindexQuickNoteSearchTags(deps, id);
}
