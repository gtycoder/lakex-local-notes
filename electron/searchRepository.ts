import type { SearchResult } from "../src/core/searchTypes.js";
import type { DbLike } from "./dbLike.js";
import { buildMatchExpression, buildSnippet, escapeLike, segmentToIndexText } from "../src/core/search/index.js";
import { sha256Sync } from "../src/core/sha256Sync.js";
import { sqlParameterBatches } from "../src/core/sqlParameterBatch.js";

export type { SearchResult } from "../src/core/searchTypes.js";

interface SearchRepositoryDeps {
  db: DbLike;
  trashNotebookId: string;
  /** 从磁盘 .lake 派生纯文本（仅写缓存列、不触发索引），供全量重建兜底。 */
  derivePlainText(noteId: string): string | null;
}

interface LedgerRow {
  fts_rowid: number;
  title_hash: string;
  body_hash: string;
}

interface IndexableRow {
  id: string | null;
  title: string;
  text_cache: string | null;
}

interface SearchRow {
  note_id: string;
  title: string;
  body_plain: string | null;
  updated_at: string;
  parent_title: string | null;
  title_match: number;
}

function hashText(text: string): string {
  return sha256Sync(new TextEncoder().encode(text));
}

/**
 * 全文搜索索引（FTS5 + unicode61）。
 * - 索引文本 = 中文按单字、拉丁按整词（src/core/search/segment），查询端同一分词；
 * - `search_index` 账本按内容 hash 短路、持有稳定 rowid，删除 O(1)；
 * - 摘要由 src/core/search/snippet 从原始纯文本生成（不依赖 FTS snippet/highlight）。
 */
export class SearchRepository {
  private readonly db: DbLike;
  private readonly trashNotebookId: string;
  private readonly derivePlainText: SearchRepositoryDeps["derivePlainText"];

  constructor({ db, trashNotebookId, derivePlainText }: SearchRepositoryDeps) {
    this.db = db;
    this.trashNotebookId = trashNotebookId;
    this.derivePlainText = derivePlainText;
  }

  /** 单条增量写入；内容 hash（标题+纯文本）未变直接短路，不重复分词。 */
  upsert(noteId: string, title: string, body: string | null): void {
    const nextTitle = title ?? "";
    const nextBody = body ?? "";
    const titleHash = hashText(nextTitle);
    const bodyHash = hashText(nextBody);
    const prev = this.db.prepare("SELECT fts_rowid, title_hash, body_hash FROM search_index WHERE note_id=?").get(noteId) as LedgerRow | undefined;
    if (prev && prev.title_hash === titleHash && prev.body_hash === bodyHash) return;

    const titleSeg = segmentToIndexText(nextTitle);
    const bodySeg = segmentToIndexText(nextBody);
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      let rowid: number;
      if (prev) {
        rowid = prev.fts_rowid;
        this.db.prepare("DELETE FROM notes_fts WHERE rowid=?").run(rowid);
      } else {
        const max = this.db.prepare("SELECT IFNULL(MAX(fts_rowid), 0) AS m FROM search_index").get() as { m: number };
        rowid = max.m + 1;
      }
      this.db.prepare("INSERT INTO notes_fts(rowid, title, body) VALUES(?,?,?)").run(rowid, titleSeg, bodySeg);
      this.db.prepare(
        "INSERT INTO search_index(note_id, fts_rowid, title_hash, body_hash, indexed_at) VALUES(?,?,?,?,?) " +
        "ON CONFLICT(note_id) DO UPDATE SET fts_rowid=excluded.fts_rowid, title_hash=excluded.title_hash, body_hash=excluded.body_hash, indexed_at=excluded.indexed_at"
      ).run(noteId, rowid, titleHash, bodyHash, now);
    });
    transaction();
  }

  /** 批量移除（回收站/彻底删/文件夹删除）：按 rowid 删 FTS，再删账本。 */
  remove(noteIds: readonly string[]): void {
    if (noteIds.length === 0) return;
    const transaction = this.db.transaction(() => {
      const delFts = this.db.prepare("DELETE FROM notes_fts WHERE rowid=?");
      for (const batch of sqlParameterBatches(noteIds)) {
        const placeholders = batch.map(() => "?").join(",");
        const rows = this.db.prepare("SELECT fts_rowid FROM search_index WHERE note_id IN (" + placeholders + ")").all(...batch) as Array<{ fts_rowid: number }>;
        for (const row of rows) delFts.run(row.fts_rowid);
        this.db.prepare("DELETE FROM search_index WHERE note_id IN (" + placeholders + ")").run(...batch);
      }
    });
    transaction();
  }

  /** 账本为空或与活跃文档数不符 → 全量重建。启动时调用（幂等，只在异常时付代价）。 */
  ensureIndex(): boolean {
    if (this.ledgerCount() === this.activeNoteCount()) return false;
    this.rebuild();
    return true;
  }

  /** 全量重建：清空后按活跃文档重插。开发期数据可重建（AGENTS §3 #7/#10）。 */
  rebuild(): void {
    const rows = this.listIndexableNotes();
    const transaction = this.db.transaction(() => {
      this.db.exec("DELETE FROM notes_fts");
      this.db.exec("DELETE FROM search_index");
      const insertFts = this.db.prepare("INSERT INTO notes_fts(rowid, title, body) VALUES(?,?,?)");
      const insertLedger = this.db.prepare("INSERT INTO search_index(note_id, fts_rowid, title_hash, body_hash, indexed_at) VALUES(?,?,?,?,?)");
      const now = new Date().toISOString();
      let rowid = 0;
      for (const row of rows) {
        if (!row.id) continue;
        let body = row.text_cache ?? "";
        if (row.text_cache == null) {
          try { body = this.derivePlainText(row.id) ?? ""; } catch { body = ""; }
        }
        const title = row.title ?? "";
        rowid += 1;
        insertFts.run(rowid, segmentToIndexText(title), segmentToIndexText(body));
        insertLedger.run(row.id, rowid, hashText(title), hashText(body), now);
      }
    });
    transaction();
  }

  search(query: string, limit = 30): SearchResult[] {
    const normalized = query.trim();
    if (!normalized) return [];
    const match = buildMatchExpression(normalized);
    if (!match) return [];
    const titlePrefix = escapeLike(normalized) + "%";
    const titleContains = "%" + escapeLike(normalized) + "%";
    const rows = this.db.prepare(
      "WITH RECURSIVE trash_ids(id) AS (" +
      " SELECT ? FROM tree_nodes WHERE id=?" +
      " UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id" +
      ") " +
      "SELECT si.note_id AS note_id, t.title AS title, n.text_cache AS body_plain, t.updated_at AS updated_at, parent.title AS parent_title, " +
      "CASE WHEN t.title = ? THEN 0 WHEN t.title LIKE ? ESCAPE '\\' THEN 1 WHEN t.title LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END AS title_match " +
      "FROM notes_fts " +
      "JOIN search_index si ON si.fts_rowid = notes_fts.rowid " +
      "JOIN tree_nodes t ON t.note_file_id = si.note_id " +
      "LEFT JOIN tree_nodes parent ON parent.id = t.parent_id " +
      "LEFT JOIN notes n ON n.id = si.note_id " +
      "WHERE notes_fts MATCH ? AND t.node_type = 'note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids) " +
      "ORDER BY title_match, bm25(notes_fts, 10.0, 1.0), t.updated_at DESC LIMIT ?"
    ).all(this.trashNotebookId, this.trashNotebookId, normalized, titlePrefix, titleContains, match, limit) as SearchRow[];
    return rows.map((row) => {
      const fromTitle = row.title_match < 3;
      const titleSnippet = fromTitle ? buildSnippet(row.title, normalized) : "";
      const bodySnippet = buildSnippet(row.body_plain ?? "", normalized);
      const snippet = fromTitle ? (titleSnippet || bodySnippet) : (bodySnippet || titleSnippet);
      return {
        id: row.note_id,
        title: row.title,
        snippet,
        matchType: fromTitle ? "title" : "body",
        updatedAt: row.updated_at,
        parentTitle: row.parent_title,
      };
    });
  }

  private ledgerCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM search_index").get() as { c: number }).c;
  }

  private activeNoteCount(): number {
    const row = this.db.prepare(
      "WITH RECURSIVE trash_ids(id) AS (" +
      " SELECT ? FROM tree_nodes WHERE id=?" +
      " UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id" +
      ") " +
      "SELECT COUNT(*) AS c FROM tree_nodes t WHERE t.node_type='note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)"
    ).get(this.trashNotebookId, this.trashNotebookId) as { c: number };
    return row.c;
  }

  private listIndexableNotes(): IndexableRow[] {
    return this.db.prepare(
      "WITH RECURSIVE trash_ids(id) AS (" +
      " SELECT ? FROM tree_nodes WHERE id=?" +
      " UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id" +
      ") " +
      "SELECT t.note_file_id AS id, t.title AS title, n.text_cache AS text_cache " +
      "FROM tree_nodes t LEFT JOIN notes n ON n.id = t.note_file_id " +
      "WHERE t.node_type='note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)"
    ).all(this.trashNotebookId, this.trashNotebookId) as IndexableRow[];
  }
}
