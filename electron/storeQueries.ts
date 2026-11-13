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
  is_dirty?: number;
  is_purged?: number;
  trashed_at?: string | null;
}

/** Read only the metadata needed to decide whether an open tab must reload. */
export function readNoteDigest(db: DbLike, noteId: string, trashNotebookId: string): NoteDigest | null {
  const row = db.prepare("SELECT id,title,updated_at,parent_id,is_purged,trashed_at FROM notes WHERE id=?").get(noteId) as NoteDigestRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    // 261114：删除笔记本时子文档 parent_id 不变、只标 trashed_at ⇒ 不能只看 parent_id，否则
    // 同步后仍以为它还活着（打开中的 tab 不标只读、自动保存继续往回收站文档写）。
    deleted: row.trashed_at != null || row.parent_id === trashNotebookId || !!row.is_purged,
  };
}
