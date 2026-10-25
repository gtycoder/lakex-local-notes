import type { DbLike } from "./dbLike.js";

export interface NoteDigest {
  id: string;
  title: string;
  updatedAt: string;
  deleted: boolean;
}

interface NoteDigestRow {
  id: string;
  title: string;
  updated_at: string;
  parent_id: string | null;
  sync_state: string;
  is_purged?: number;
}

/** Read only the metadata needed to decide whether an open tab must reload. */
export function readNoteDigest(db: DbLike, noteId: string, trashNotebookId: string): NoteDigest | null {
  const row = db.prepare("SELECT id,title,updated_at,parent_id,sync_state,is_purged FROM notes WHERE id=?").get(noteId) as NoteDigestRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    deleted: row.parent_id === trashNotebookId || row.sync_state === "purged" || !!row.is_purged,
  };
}
