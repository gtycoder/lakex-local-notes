import type Database from "better-sqlite3";

export interface TrashItem {
  id: string;
  title: string;
  nodeType: string;
  noteFileId: string | null;
  parentId: string | null;
  deletedAt: string | null;
  updatedAt: string;
  hasFile: boolean;
  purged: boolean;
}

export interface TrashReminderItem {
  id: string;
  title: string;
  deletedAt: string;
}

interface TrashRow {
  id: string;
  title: string;
  node_type: string;
  note_file_id: string | null;
  parent_id: string | null;
  trashed_at: string | null;
  updated_at: string;
  sync_state: string;
}

/** Read-only trash queries; restore/purge writes remain in Store for now. */
export class TrashRepository {
  constructor(private readonly db: Database.Database, private readonly trashNotebookId: string) {}

  list(): TrashItem[] {
    const rows = this.db.prepare(
      `SELECT t.id,t.title,t.node_type,t.note_file_id,t.parent_id,t.trashed_at,t.updated_at,t.sync_state
       FROM tree_nodes t
       WHERE t.parent_id=? AND t.deleted_at IS NULL
       ORDER BY t.trashed_at DESC`
    ).all(this.trashNotebookId) as TrashRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      nodeType: row.node_type,
      noteFileId: row.note_file_id,
      parentId: row.parent_id,
      deletedAt: row.trashed_at,
      updatedAt: row.updated_at,
      hasFile: !!row.note_file_id,
      purged: row.sync_state === "purged",
    }));
  }

  listReminder(days: number): TrashReminderItem[] {
    if (!Number.isFinite(days) || days <= 0) return [];
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    return this.list()
      .filter((item) => item.deletedAt !== null && item.deletedAt < cutoff)
      .map((item) => ({ id: item.id, title: item.title, deletedAt: item.deletedAt as string }));
  }
}
