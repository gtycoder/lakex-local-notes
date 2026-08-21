import type { DbLike } from "../src/core/dbLike.js";
import fs from "node:fs";
import { AppError } from "./storeErrors.js";

export interface NoteCacheInput {
  markdown?: string | null;
  plain?: string | null;
}

interface NoteContentRepositoryDeps {
  db: DbLike;
  notePathFor(noteId: string): string;
  atomicWrite(filePath: string, content: string): void;
  revivePurgedIfNeeded(noteId: string): boolean;
  createHistorySnapshot(noteId: string, content?: string, force?: boolean): number | null;
  upsertSearch(noteId: string, title: string, body: string | null): void;
  detectOrphans(noteId: string, content: string): void;
  markHistoryDirty(noteId: string): void;
}

/**
 * Coordinates a single note content save. It intentionally does not own
 * note metadata, history, or asset repositories; those remain explicit
 * callbacks so the old ordering and transaction boundary stay visible.
 */
export class NoteContentRepository {
  constructor(private readonly deps: NoteContentRepositoryDeps) {}

  save(noteId: string, title: string, content: string, caches?: NoteCacheInput): void {
    const notePath = this.deps.notePathFor(noteId);
    if (!fs.existsSync(notePath)) throw new AppError("NotFound", `笔记不存在: ${noteId}`);

    // Editing a purged local copy is an implicit restore. Preserve the old
    // content before the new body replaces it, exactly as the legacy flow did.
    if (this.deps.revivePurgedIfNeeded(noteId)) {
      try { this.deps.createHistorySnapshot(noteId, undefined, true); } catch { /* 留档失败不阻断编辑 */ }
    }

    const updatedAt = new Date().toISOString();
    const transaction = this.deps.db.transaction(() => {
      if (caches) {
        this.deps.db.prepare("UPDATE notes SET title=?,updated_at=?,sync_state='local',md_cache=?,text_cache=? WHERE id=? AND deleted_at IS NULL")
          .run(title, updatedAt, caches.markdown ?? null, caches.plain ?? null, noteId);
        this.deps.upsertSearch(noteId, title, caches.plain ?? "");
      } else {
        this.deps.db.prepare("UPDATE notes SET title=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
          .run(title, updatedAt, noteId);
        this.deps.upsertSearch(noteId, title, null);
      }
      this.deps.db.prepare("UPDATE tree_nodes SET title=?,updated_at=?,sync_state='local' WHERE note_file_id=? AND deleted_at IS NULL")
        .run(title, updatedAt, noteId);
      this.deps.atomicWrite(notePath, content);
    });
    transaction();

    // Orphan detection is post-commit maintenance. A failure must not turn a
    // successful note save into a user-visible save failure.
    try { this.deps.detectOrphans(noteId, content); }
    catch (error) { console.warn("[store] 孤儿资源检测失败（不影响保存）:", error); }
    this.deps.markHistoryDirty(noteId);
  }
}
