import { buildMatchExpression, buildSnippet, escapeLike, segmentToIndexText } from "../../core/search/index.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { normalizeNoteKind } from "../../core/noteKind.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import type { SearchResult } from "../../core/searchTypes.js";
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

interface PrevRow extends LedgerRow {
  note_id: string;
}

interface IndexStatement {
  statement: string;
  values: unknown[];
}

/** reconcile 每次桥往返处理的文档数：一次 SELECT prev + 一次 SELECT MAX + 一批 executeSet。 */
export const RECONCILE_BATCH_SIZE = 200;

const SEARCH_INDEX_UPSERT_SQL =
  "INSERT INTO search_index(note_id, fts_rowid, title, raw_hash, title_hash, body_hash, indexed_at) VALUES(?,?,?,?,?,?,?) " +
  "ON CONFLICT(note_id) DO UPDATE SET fts_rowid=excluded.fts_rowid, title=excluded.title, raw_hash=excluded.raw_hash, title_hash=excluded.title_hash, body_hash=excluded.body_hash, indexed_at=excluded.indexed_at";

/**
 * 下发一批索引语句：优先 executeSet（原生一次桥往返 + 单事务），无 executeSet 退回单事务逐条；
 * 批量失败逐条重放——reconcile 幂等，跑漏/半成功下次自愈，不整批丢弃。
 * 调用方负责控制批大小（每块 ≈ RECONCILE_BATCH_SIZE 篇文档）。
 */
async function flushIndexStatements(d: MobileDb, statements: IndexStatement[]): Promise<void> {
  if (statements.length === 0) return;
  try {
    if (typeof d.executeSet === "function") {
      await d.executeSet(statements);
    } else {
      await d.transaction(async () => {
        for (const s of statements) await d.prepare(s.statement).run(...s.values);
      });
    }
  } catch {
    for (const s of statements) await d.prepare(s.statement).run(...s.values);
  }
}

async function writeIndexRow(d: MobileDb, row: NoteRow, prev: LedgerRow | undefined): Promise<void> {
  const title = row.title ?? "";
  // 优先编辑器写入的纯文本缓存（与桌面同源）；缺失时**按 kind 派生**（usheet/bitable/board 是 JSON 正文，
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
    await d.prepare(SEARCH_INDEX_UPSERT_SQL).run(row.id, rowid, title, row.content_hash, titleHash, bodyHash, new Date().toISOString());
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
  for (let i = 0; i < stale.length; i += RECONCILE_BATCH_SIZE) {
    // 批量删除：一条 DELETE 语句/账本行，每块 executeSet 一次下发。
    const deletes: IndexStatement[] = [];
    for (const row of stale.slice(i, i + RECONCILE_BATCH_SIZE)) {
      deletes.push({ statement: "DELETE FROM notes_fts WHERE rowid=?", values: [row.fts_rowid] });
      deletes.push({ statement: "DELETE FROM search_index WHERE note_id=?", values: [row.note_id] });
    }
    await flushIndexStatements(d, deletes);
  }
  const changed = await d.prepare(
    "SELECT n.id AS id, n.title AS title, n.content AS content, n.content_hash AS content_hash, n.text_cache AS text_cache, n.doc_kind AS doc_kind " +
    "FROM notes n LEFT JOIN search_index si ON si.note_id = n.id " +
    "WHERE n.trashed_at IS NULL AND (si.note_id IS NULL OR si.title != n.title OR si.raw_hash IS NULL OR si.raw_hash != n.content_hash)"
  ).all() as unknown as NoteRow[];
  // 分块：每块一次 SELECT prev（IN (...)）+ 一次 SELECT MAX(fts_rowid)，JS 内顺序分配新 rowid，
  // 语句入队后 executeSet 一次下发。块与块之间顺序执行，后一块的 MAX 已包含前一块的写入。
  for (let i = 0; i < changed.length; i += RECONCILE_BATCH_SIZE) {
    const chunk = changed.slice(i, i + RECONCILE_BATCH_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const prevRows = await d.prepare(
      "SELECT note_id, fts_rowid, title_hash, body_hash FROM search_index WHERE note_id IN (" + placeholders + ")"
    ).all(...chunk.map((row) => row.id)) as unknown as PrevRow[];
    const prevByNote = new Map(prevRows.map((row) => [String(row.note_id), row]));
    const maxRow = await d.prepare("SELECT IFNULL(MAX(fts_rowid), 0) AS m FROM search_index").get() as { m: number } | undefined;
    let nextRowid = Number(maxRow?.m ?? 0) + 1;
    const statements: IndexStatement[] = [];
    const indexedAt = new Date().toISOString();
    for (const row of chunk) {
      const prev = prevByNote.get(row.id);
      const title = row.title ?? "";
      // 与单条路径同口径：优先 text_cache，缺失则按 kind 派生（见 writeIndexRow）。
      const plain = row.text_cache ?? searchTextForKind(normalizeNoteKind(row.doc_kind), row.content ?? "").plain ?? "";
      const titleHash = hashText(title);
      const bodyHash = hashText(plain);
      if (prev && prev.title_hash === titleHash && prev.body_hash === bodyHash) {
        // 纯样式变化：FTS 不动，但 raw_hash/title 账本要跟上，避免每轮 reconcile 重复命中。
        statements.push({ statement: "UPDATE search_index SET title=?, raw_hash=? WHERE note_id=?", values: [title, row.content_hash, row.id] });
        continue;
      }
      let rowid: number;
      if (prev) {
        rowid = prev.fts_rowid;
        statements.push({ statement: "DELETE FROM notes_fts WHERE rowid=?", values: [rowid] });
      } else {
        rowid = nextRowid++;
      }
      statements.push({ statement: "INSERT INTO notes_fts(rowid, title, body) VALUES(?,?,?)", values: [rowid, segmentToIndexText(title), segmentToIndexText(plain)] });
      statements.push({ statement: SEARCH_INDEX_UPSERT_SQL, values: [row.id, rowid, title, row.content_hash, titleHash, bodyHash, indexedAt] });
    }
    await flushIndexStatements(d, statements);
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
