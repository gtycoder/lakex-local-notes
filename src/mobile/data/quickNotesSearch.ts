/** 移动端小记独立全文搜索（与文档 notes_fts 分开，避免 quick_notes 不在 notes 表里）。
 *
 * 索引按需对账：每次搜索先做一次「账本 vs quick_notes.content_hash」差集，只对新增/变更/删除行
 * 读 .qnote 文件建/删索引；正常一次搜索只有两条 SELECT，不读正文文件。
 * FTS5 在测试 sql.js 环境不可用时降级为内存过滤（生产原生 SQLite 有 FTS5）。
 */

import { buildMatchExpression, buildSnippet, segmentToIndexText } from "../../core/search/index.js";
import type { SearchResult } from "../../core/searchTypes.js";
import type { MobileDb } from "./sqliteDb.js";
import { readQuickNoteBody } from "./noteBodies.js";
import { resolveQuickNoteTagNames } from "./quickNotesRepository.js";

const QUICK_INDEX_UPSERT_SQL =
  "INSERT INTO quick_notes_search_index(quick_note_id, fts_rowid, content_hash, text_cache, tags, indexed_at) VALUES(?,?,?,?,?,?) " +
  "ON CONFLICT(quick_note_id) DO UPDATE SET fts_rowid=excluded.fts_rowid, content_hash=excluded.content_hash, text_cache=excluded.text_cache, tags=excluded.tags, indexed_at=excluded.indexed_at";

async function hasQuickFts(d: MobileDb): Promise<boolean> {
  const row = await d.prepare(
    "SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name IN ('quick_notes_fts','quick_notes') GROUP BY 1 HAVING COUNT(*)=2"
  ).get();
  return !!row;
}

interface QuickContent {
  text: string;
  tags: string[];
}

async function readQuickContent(d: MobileDb, id: string): Promise<QuickContent | null> {
  const raw = await readQuickNoteBody(id);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; tagIds?: unknown };
    const tagIds = Array.isArray(parsed.tagIds) ? parsed.tagIds.filter((tagId): tagId is string => typeof tagId === "string") : [];
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      tags: (await resolveQuickNoteTagNames(d, tagIds)).filter(Boolean),
    };
  } catch { return null; }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 120) ?? "";
}

/** 单条建/更新索引（FTS 不可用时 no-op；搜索走内存降级）。 */
export async function indexQuickNote(d: MobileDb, id: string): Promise<void> {
  if (!(await hasQuickFts(d))) return;
  const row = await d.prepare(
    "SELECT content_hash FROM quick_notes WHERE id=? AND deleted_at IS NULL AND restore_pending_at IS NULL"
  ).get(id) as { content_hash: string } | undefined;
  if (!row) { await removeQuickNoteFromIndex(d, id); return; }
  const prev = await d.prepare("SELECT content_hash FROM quick_notes_search_index WHERE quick_note_id=?").get(id) as { content_hash: string } | undefined;
  if (prev && prev.content_hash === row.content_hash) return;
  const content = await readQuickContent(d, id);
  if (!content) return;
  const tagsText = content.tags.join(" ");
  const rowid = prev
    ? ((await d.prepare("SELECT fts_rowid FROM quick_notes_search_index WHERE quick_note_id=?").get(id)) as { fts_rowid: number }).fts_rowid
    : Number(((await d.prepare("SELECT IFNULL(MAX(fts_rowid), 0) AS m FROM quick_notes_search_index").get()) as { m: number }).m) + 1;
  await d.transaction(async () => {
    if (prev) await d.prepare("DELETE FROM quick_notes_fts WHERE rowid=?").run(rowid);
    await d.prepare("INSERT INTO quick_notes_fts(rowid, body, tags) VALUES(?,?,?)").run(rowid, segmentToIndexText(content.text), segmentToIndexText(tagsText));
    await d.prepare(QUICK_INDEX_UPSERT_SQL).run(id, rowid, row.content_hash, content.text, tagsText, new Date().toISOString());
  });
}

/** 删除一条小记索引（不存在静默）。 */
export async function removeQuickNoteFromIndex(d: MobileDb, id: string): Promise<void> {
  const prev = await d.prepare("SELECT fts_rowid FROM quick_notes_search_index WHERE quick_note_id=?").get(id) as { fts_rowid: number } | undefined;
  if (!prev) return;
  await d.transaction(async () => {
    await d.prepare("DELETE FROM quick_notes_fts WHERE rowid=?").run(prev.fts_rowid);
    await d.prepare("DELETE FROM quick_notes_search_index WHERE quick_note_id=?").run(id);
  });
}

/** 账本对账：删除已删/缺失/恢复中的行；为新增或 content_hash 变更的小记重建索引。 */
export async function reconcileQuickNotesIndex(d: MobileDb): Promise<void> {
  if (!(await hasQuickFts(d))) return;
  const stale = await d.prepare(
    "SELECT si.quick_note_id AS id, si.fts_rowid AS fts_rowid FROM quick_notes_search_index si " +
    "LEFT JOIN quick_notes q ON q.id = si.quick_note_id " +
    "WHERE q.id IS NULL OR q.deleted_at IS NOT NULL OR q.restore_pending_at IS NOT NULL"
  ).all() as Array<{ id: string; fts_rowid: number }>;
  for (const row of stale) {
    await d.transaction(async () => {
      await d.prepare("DELETE FROM quick_notes_fts WHERE rowid=?").run(row.fts_rowid);
      await d.prepare("DELETE FROM quick_notes_search_index WHERE quick_note_id=?").run(row.id);
    });
  }
  const changed = await d.prepare(
    "SELECT q.id AS id FROM quick_notes q LEFT JOIN quick_notes_search_index si ON si.quick_note_id = q.id " +
    "WHERE q.deleted_at IS NULL AND q.restore_pending_at IS NULL AND (si.quick_note_id IS NULL OR si.content_hash != q.content_hash)"
  ).all() as Array<{ id: string }>;
  for (const row of changed) await indexQuickNote(d, row.id);
}

/** 小记范围搜索；结果带 kind=quick-note（全局搜索合并时靠它分流）。 */
export async function searchQuickNotes(d: MobileDb, query: string, limit = 20): Promise<Array<SearchResult & { kind: "quick-note" }>> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (!(await hasQuickFts(d))) return searchQuickNotesFallback(d, normalized, limit);
  await reconcileQuickNotesIndex(d);
  const match = buildMatchExpression(normalized);
  if (!match) return [];
  const rows = await d.prepare(
    "SELECT q.id AS id, q.preview_text AS preview_text, q.updated_at AS updated_at, si.text_cache AS text_cache, si.tags AS tags " +
    "FROM quick_notes_fts f " +
    "JOIN quick_notes_search_index si ON si.fts_rowid = f.rowid " +
    "JOIN quick_notes q ON q.id = si.quick_note_id " +
    "WHERE quick_notes_fts MATCH ? AND q.deleted_at IS NULL AND q.restore_pending_at IS NULL " +
    "ORDER BY bm25(quick_notes_fts, 1.0, 0.5), q.updated_at DESC LIMIT ?"
  ).all(match, Math.max(1, limit)) as Array<{ id: string; preview_text: string; updated_at: string; text_cache: string; tags: string }>;
  return rows.map((row) => quickResult(row, normalized));
}

function quickResult(row: { id: string; preview_text: string; updated_at: string; text_cache: string; tags: string }, query: string): SearchResult & { kind: "quick-note" } {
  const title = String(row.preview_text ?? "").trim() || firstLine(String(row.text_cache ?? "")) || "小记";
  const text = String(row.text_cache ?? "");
  const tags = String(row.tags ?? "");
  return {
    id: String(row.id),
    title,
    snippet: buildSnippet(text, query) || buildSnippet(tags, query) || firstLine(text),
    matchType: "body" as const,
    updatedAt: String(row.updated_at),
    parentTitle: null,
    kind: "quick-note" as const,
  };
}

/** FTS 不可用（sql.js 测试环境）时的降级：读活跃小记正文内存过滤；生产不常走。 */
async function searchQuickNotesFallback(d: MobileDb, query: string, limit: number): Promise<Array<SearchResult & { kind: "quick-note" }>> {
  let rows: Array<{ id: string; preview_text: string; updated_at: string }> = [];
  try {
    rows = await d.prepare(
      "SELECT id, preview_text, updated_at FROM quick_notes WHERE deleted_at IS NULL AND restore_pending_at IS NULL ORDER BY updated_at DESC"
    ).all() as Array<{ id: string; preview_text: string; updated_at: string }>;
  } catch { return []; }
  const needle = query.toLocaleLowerCase();
  const out: Array<SearchResult & { kind: "quick-note" }> = [];
  for (const row of rows) {
    const content = await readQuickContent(d, String(row.id));
    if (!content) continue;
    const hay = [content.text, ...content.tags].join("\n").toLocaleLowerCase();
    if (!hay.includes(needle)) continue;
    out.push(quickResult({ id: String(row.id), preview_text: String(row.preview_text), updated_at: String(row.updated_at), text_cache: content.text, tags: content.tags.join(" ") }, query));
    if (out.length >= limit) break;
  }
  return out;
}
