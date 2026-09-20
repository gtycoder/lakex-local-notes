import { buildMatchExpression, buildSnippet, escapeLike, segmentToIndexText } from "../core/search/index.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { normalizeNoteKind } from "../core/noteKind.js";
import { searchTextForKind } from "../core/noteSearchText.js";
import type { SearchResult } from "../core/searchTypes.js";
import type { MobileDb } from "./sqliteDb.js";

function hashText(text: string): string {
  return sha256Sync(new TextEncoder().encode(text));
}

/** FTS5 虚拟表是否存在（测试环境 sql.js 无 FTS5 → 搜索/索引整体降级为 no-op）。 */
async function hasSearchIndex(d: MobileDb): Promise<boolean> {
  const row = await d.prepare("SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name='notes_fts'").get();
  return !!row;
}

interface NoteRow {
  id: string;
  title: string;
  content: string;
  content_hash: string | null;
  text_cache: string | null;
  /** v6/v7 文档类型：非 doc 的正文是内部 JSON，不能喂 Lake 解析器（见 noteSearchText）。 */
  doc_kind?: string | null;
}

interface LedgerRow {
  fts_rowid: number;
  title_hash: string;
  body_hash: string;
}

async function writeIndexRow(d: MobileDb, row: NoteRow, prev: LedgerRow | undefined): Promise<void> {
  const title = row.title ?? "";
  // 优先编辑器写入的纯文本缓存（与桌面同源）；缺失时**按 kind 派生**（sheet/bitable/board 是 JSON 正文，
  // 直接 lakeHtmlToPlain 会把 JSON 碎片塞进索引 —— 与桌面 Store.searchTextFor 口径统一）。
  const plain = row.text_cache ?? searchTextForKind(normalizeNoteKind(row.doc_kind), row.content ?? "").plain ?? "";
  const titleHash = hashText(title);
  const bodyHash = hashText(plain);
  if (prev && prev.title_hash === titleHash && prev.body_hash === bodyHash) {
    // 纯样式变化：FTS 不动，但 raw_hash/title 账本要跟上，避免每轮 reconcile 重复命中。
    await d.prepare("UPDATE search_index SET title=?, raw_hash=? WHERE note_id=?").run(title, row.content_hash, row.id);
    return;
  }
  await d.transaction(async () => {
    let rowid: number;
    if (prev) {
      rowid = prev.fts_rowid;
      await d.prepare("DELETE FROM notes_fts WHERE rowid=?").run(rowid);
    } else {
      const max = await d.prepare("SELECT IFNULL(MAX(fts_rowid), 0) AS m FROM search_index").get() as { m: number } | undefined;
      rowid = Number(max?.m ?? 0) + 1;
    }
    await d.prepare("INSERT INTO notes_fts(rowid, title, body) VALUES(?,?,?)").run(rowid, segmentToIndexText(title), segmentToIndexText(plain));
    await d.prepare(
      "INSERT INTO search_index(note_id, fts_rowid, title, raw_hash, title_hash, body_hash, indexed_at) VALUES(?,?,?,?,?,?,?) " +
      "ON CONFLICT(note_id) DO UPDATE SET fts_rowid=excluded.fts_rowid, title=excluded.title, raw_hash=excluded.raw_hash, title_hash=excluded.title_hash, body_hash=excluded.body_hash, indexed_at=excluded.indexed_at"
    ).run(row.id, rowid, title, row.content_hash, titleHash, bodyHash, new Date().toISOString());
  });
}

/** 单条索引（保存后调用）：按内容 hash 短路，未变不写。 */
export async function indexNote(d: MobileDb, noteId: string): Promise<void> {
  if (!(await hasSearchIndex(d))) return;
  const row = await d.prepare("SELECT id, title, content, content_hash, text_cache, doc_kind FROM notes WHERE id=?").get(noteId) as NoteRow | undefined;
  if (!row) return;
  const prev = await d.prepare("SELECT fts_rowid, title_hash, body_hash FROM search_index WHERE note_id=?").get(noteId) as LedgerRow | undefined;
  await writeIndexRow(d, row, prev);
}

/** 单条移除（进回收站）。 */
export async function removeNoteFromIndex(d: MobileDb, noteId: string): Promise<void> {
  if (!(await hasSearchIndex(d))) return;
  const prev = await d.prepare("SELECT fts_rowid FROM search_index WHERE note_id=?").get(noteId) as { fts_rowid: number } | undefined;
  if (!prev) return;
  await d.transaction(async () => {
    await d.prepare("DELETE FROM notes_fts WHERE rowid=?").run(prev.fts_rowid);
    await d.prepare("DELETE FROM search_index WHERE note_id=?").run(noteId);
  });
}

/** 全量对账：删除已消失/进回收站的账本；为缺失或标题/原始 hash 变化的活跃文档（重）建索引。 */
export async function reconcileIndex(d: MobileDb): Promise<void> {
  if (!(await hasSearchIndex(d))) return;
  const stale = await d.prepare(
    "SELECT si.note_id AS note_id, si.fts_rowid AS fts_rowid FROM search_index si " +
    "LEFT JOIN notes n ON n.id = si.note_id " +
    "WHERE n.id IS NULL OR n.trashed_at IS NOT NULL"
  ).all() as Array<{ note_id: string; fts_rowid: number }>;
  if (stale.length > 0) {
    await d.transaction(async () => {
      for (const row of stale) {
        await d.prepare("DELETE FROM notes_fts WHERE rowid=?").run(row.fts_rowid);
        await d.prepare("DELETE FROM search_index WHERE note_id=?").run(row.note_id);
      }
    });
  }
  const changed = await d.prepare(
    "SELECT n.id AS id, n.title AS title, n.content AS content, n.content_hash AS content_hash, n.text_cache AS text_cache, n.doc_kind AS doc_kind " +
    "FROM notes n LEFT JOIN search_index si ON si.note_id = n.id " +
    "WHERE n.trashed_at IS NULL AND (si.note_id IS NULL OR si.title != n.title OR si.raw_hash IS NULL OR si.raw_hash != n.content_hash)"
  ).all() as unknown as NoteRow[];
  for (const row of changed) {
    const prev = await d.prepare("SELECT fts_rowid, title_hash, body_hash FROM search_index WHERE note_id=?").get(row.id) as LedgerRow | undefined;
    await writeIndexRow(d, row, prev);
  }
}

/** 搜索：与桌面同一分词/查询/摘要核心；1/2/3+ 字统一。 */
export async function searchNotes(d: MobileDb, query: string, limit = 50): Promise<SearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (!(await hasSearchIndex(d))) return [];
  const match = buildMatchExpression(normalized);
  if (!match) return [];
  const titlePrefix = escapeLike(normalized) + "%";
  const titleContains = "%" + escapeLike(normalized) + "%";
  const rows = await d.prepare(
    "SELECT si.note_id AS note_id, n.title AS title, n.content AS content, n.text_cache AS text_cache, n.doc_kind AS doc_kind, n.updated_at AS updated_at, f.title AS parent_title, " +
    "CASE WHEN n.title = ? THEN 0 WHEN n.title LIKE ? ESCAPE '\\' THEN 1 WHEN n.title LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END AS title_match " +
    "FROM notes_fts " +
    "JOIN search_index si ON si.fts_rowid = notes_fts.rowid " +
    "JOIN notes n ON n.id = si.note_id " +
    "LEFT JOIN folders f ON n.parent_id = f.id " +
    "WHERE notes_fts MATCH ? AND n.trashed_at IS NULL " +
    "ORDER BY title_match, bm25(notes_fts, 10.0, 1.0), n.updated_at DESC LIMIT ?"
  ).all(normalized, titlePrefix, titleContains, match, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const title = String(row.title ?? "");
    const plain = row.text_cache != null
      ? String(row.text_cache)
      : searchTextForKind(normalizeNoteKind(row.doc_kind), String(row.content ?? "")).plain ?? "";
    const fromTitle = Number(row.title_match ?? 3) < 3;
    const titleSnippet = fromTitle ? buildSnippet(title, normalized) : "";
    const bodySnippet = buildSnippet(plain, normalized);
    return {
      id: String(row.note_id),
      title,
      snippet: fromTitle ? (titleSnippet || bodySnippet) : (bodySnippet || titleSnippet),
      matchType: fromTitle ? "title" : "body",
      updatedAt: String(row.updated_at ?? ""),
      parentTitle: row.parent_title ? String(row.parent_title) : null,
    } as SearchResult;
  });
}
