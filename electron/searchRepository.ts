import type Database from "better-sqlite3";

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  matchType: "title" | "body";
  updatedAt: string;
  parentTitle: string | null;
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
  title_snippet: string | null;
  body_snippet: string | null;
  updated_at: string;
  parent_title: string | null;
  title_match: number;
}

interface ShortSearchResultRow {
  id: string;
  title: string;
  updated_at: string;
  parent_title: string | null;
}

interface LikeSearchResultRow extends ShortSearchResultRow {
  body: string;
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
    const queryLength = [...normalizedQuery].length;
    if (queryLength === 1) {
      const escapedLike = escapeLikeQuery(normalizedQuery);
      const rows = this.db.prepare(
        `WITH RECURSIVE trash_ids(id) AS (
           SELECT ? FROM tree_nodes WHERE id=?
           UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
         )
         SELECT t.id, t.title, t.updated_at, parent.title AS parent_title
         FROM tree_nodes t LEFT JOIN tree_nodes parent ON parent.id=t.parent_id
         WHERE t.node_type='note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids) AND t.title LIKE ?
         ORDER BY CASE WHEN t.title = ? THEN 0 WHEN t.title LIKE ? THEN 1 ELSE 2 END, t.updated_at DESC LIMIT ?`
      ).all(this.trashNotebookId, this.trashNotebookId, `%${escapedLike}%`, normalizedQuery, `${escapedLike}%`, limit) as ShortSearchResultRow[];
      return rows.map((row) => ({ id: row.id, title: row.title, snippet: "", matchType: "title", updatedAt: row.updated_at, parentTitle: row.parent_title }));
    }

    if (queryLength === 2) {
      const escapedLike = escapeLikeQuery(normalizedQuery);
      const rows = this.db.prepare(
        `WITH RECURSIVE trash_ids(id) AS (
           SELECT ? FROM tree_nodes WHERE id=?
           UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
         )
         SELECT t.id, t.title, COALESCE(f.body, '') AS body, t.updated_at, parent.title AS parent_title
         FROM tree_nodes t
         LEFT JOIN notes_fts f ON f.note_id=t.note_file_id
         LEFT JOIN tree_nodes parent ON parent.id=t.parent_id
         WHERE t.node_type='note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)
           AND (t.title LIKE ? ESCAPE '\\' OR COALESCE(f.body, '') LIKE ? ESCAPE '\\')
         ORDER BY CASE WHEN t.title = ? THEN 0 WHEN t.title LIKE ? ESCAPE '\\' THEN 1 WHEN t.title LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT ?`
      ).all(this.trashNotebookId, this.trashNotebookId, `%${escapedLike}%`, `%${escapedLike}%`, normalizedQuery, `${escapedLike}%`, `%${escapedLike}%`, limit) as LikeSearchResultRow[];
      return rows.map((row) => {
        const titleMatch = row.title.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase());
        return { id: row.id, title: row.title, snippet: titleMatch ? highlightSnippet(row.title, normalizedQuery) : highlightSnippet(row.body, normalizedQuery), matchType: titleMatch ? "title" : "body", updatedAt: row.updated_at, parentTitle: row.parent_title };
      });
    }

    const match = escapeFtsQuery(normalizedQuery);
    const titleContains = `%${normalizedQuery}%`;
    const titlePrefix = `${normalizedQuery}%`;
    const rows = this.db.prepare(
      `WITH RECURSIVE trash_ids(id) AS (
         SELECT ? FROM tree_nodes WHERE id=?
         UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
       )
       SELECT f.note_id, t.title,
              highlight(notes_fts, 0, '<mark>', '</mark>') AS title_snippet,
              highlight(notes_fts, 1, '<mark>', '</mark>') AS body_snippet,
              t.updated_at,
              parent.title AS parent_title,
              CASE WHEN t.title = ? THEN 0 WHEN t.title LIKE ? THEN 1 WHEN t.title LIKE ? THEN 2 ELSE 3 END AS title_match
       FROM notes_fts f
       JOIN tree_nodes t ON t.note_file_id=f.note_id
       LEFT JOIN tree_nodes parent ON parent.id=t.parent_id
       WHERE notes_fts MATCH ? AND t.node_type='note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)
       ORDER BY title_match, rank, t.updated_at DESC LIMIT ?`
    ).all(this.trashNotebookId, this.trashNotebookId, normalizedQuery, titlePrefix, titleContains, match, limit) as SearchResultRow[];
    return rows.map((row) => {
      const fromTitle = row.title_match < 3;
      return {
        id: row.note_id,
        title: row.title,
        snippet: fromTitle ? (row.title_snippet ?? row.body_snippet ?? "") : (row.body_snippet ?? row.title_snippet ?? ""),
        matchType: fromTitle ? "title" : "body",
        updatedAt: row.updated_at,
        parentTitle: row.parent_title,
      };
    });
  }
}

/** Escape FTS5 syntax while preserving whitespace-separated search terms. */
function escapeFtsQuery(query: string): string {
  return query.split(/\s+/).filter(Boolean).map((word) => `"${word.replace(/"/g, '""')}"`).join(" ");
}

function escapeLikeQuery(query: string): string {
  return query.replace(/[\\%_]/g, "\\$&");
}

function highlightSnippet(text: string, query: string): string {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, 160);
  const start = Math.max(0, index - 64);
  const end = Math.min(text.length, index + query.length + 96);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, index)}<mark>${text.slice(index, index + query.length)}</mark>${text.slice(index + query.length, end)}${suffix}`;
}
