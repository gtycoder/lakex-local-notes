import type Database from "better-sqlite3";

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
}

interface SearchRepositoryDeps {
  db: Database.Database;
  trashNotebookId: string;
  ensureNoteCaches(noteId: string): boolean;
  readNoteCaches(noteId: string): { markdown: string | null; plain: string | null };
}

interface SearchIndexRow {
  id: string | null;
  title: string;
  text_cache: string | null;
}

interface SearchResultRow {
  note_id: string;
  title: string;
  snippet: string | null;
}

interface ShortSearchResultRow {
  id: string;
  title: string;
  snippet: string | null;
}

/** FTS5 ownership is isolated here; note persistence remains in Store. */
export class SearchRepository {
  private readonly db: Database.Database;
  private readonly trashNotebookId: string;
  private readonly ensureNoteCaches: SearchRepositoryDeps["ensureNoteCaches"];
  private readonly readNoteCaches: SearchRepositoryDeps["readNoteCaches"];

  constructor({ db, trashNotebookId, ensureNoteCaches, readNoteCaches }: SearchRepositoryDeps) {
    this.db = db;
    this.trashNotebookId = trashNotebookId;
    this.ensureNoteCaches = ensureNoteCaches;
    this.readNoteCaches = readNoteCaches;
  }

  upsert(noteId: string, title: string, body: string | null): void {
    this.db.prepare("DELETE FROM notes_fts WHERE note_id=?").run(noteId);
    this.db.prepare("INSERT INTO notes_fts(title, body, note_id) VALUES(?,?,?)").run(title, body ?? "", noteId);
  }

  rebuild(): void {
    this.db.exec("DELETE FROM notes_fts");
    const rows = this.db.prepare(`
      WITH RECURSIVE trash_ids(id) AS (
        SELECT ? FROM tree_nodes WHERE id=?
        UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
      )
      SELECT t.note_file_id AS id, t.title, n.text_cache
      FROM tree_nodes t LEFT JOIN notes n ON n.id = t.note_file_id
      WHERE t.node_type = 'note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)
    `).all(this.trashNotebookId, this.trashNotebookId) as SearchIndexRow[];
    const insert = this.db.prepare("INSERT INTO notes_fts(title, body, note_id) VALUES(?,?,?)");
    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        if (!row.id) continue;
        if (!row.text_cache) {
          try { this.ensureNoteCaches(row.id); } catch { /* 兜底失败不阻断重建 */ }
        }
        const caches = this.readNoteCaches(row.id);
        insert.run(row.title, caches.plain ?? "", row.id);
      }
    });
    transaction();
  }

  search(query: string, limit = 30): SearchResult[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];
    if (normalizedQuery.length >= 3) {
      const match = escapeFtsQuery(normalizedQuery);
      const rows = this.db.prepare(
        "SELECT note_id, title, highlight(notes_fts, 1, '<mark>', '</mark>') AS snippet FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?"
      ).all(match, limit) as SearchResultRow[];
      return rows.map((row) => ({ id: row.note_id, title: row.title, snippet: row.snippet ?? "" }));
    }

    const rows = this.db.prepare(
      `WITH RECURSIVE trash_ids(id) AS (
         SELECT ? FROM tree_nodes WHERE id=?
         UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
       )
       SELECT t.id, t.title, '' AS snippet FROM tree_nodes t
       WHERE t.node_type='note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids) AND t.title LIKE ?
       ORDER BY t.sort_order LIMIT ?`
    ).all(this.trashNotebookId, this.trashNotebookId, `%${normalizedQuery}%`, limit) as ShortSearchResultRow[];
    return rows.map((row) => ({ id: row.id, title: row.title, snippet: row.snippet ?? "" }));
  }
}

/** Escape FTS5 syntax while preserving whitespace-separated search terms. */
function escapeFtsQuery(query: string): string {
  return query.split(/\s+/).filter(Boolean).map((word) => `"${word.replace(/"/g, '""')}"`).join(" ");
}
