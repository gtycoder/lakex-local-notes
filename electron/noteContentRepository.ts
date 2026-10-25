import type { DbLike } from "./dbLike.js";
import fs from "node:fs";
import { AppError } from "../src/core/storeErrors.js";
import { hasNoteSaveChanges } from "../src/core/noteSaveDecision.js";

export interface NoteCacheInput {
  markdown?: string | null;
  plain?: string | null;
}

interface NoteContentRepositoryDeps {
  db: DbLike;
  notePathFor(noteId: string): string;
  atomicWrite(filePath: string, content: string): void;
  upsertSearch(noteId: string, title: string, body: string | null): void;
  detectOrphans(noteId: string, content: string): void;
  markHistoryDirty(noteId: string): void;
}

/**
 * Coordinates a single note content save. It intentionally does not own
 * note metadata, history, or asset repositories; those remain explicit
 * callbacks so the old ordering and transaction boundary stay visible.
 *
 * 审计 F04：普通保存只写"活跃"文档，不兼职恢复——回收站条目 / 他端 purge 的保留副本在这里明确拒绝；
 * 旧 revivePurgedIfNeeded（编辑即隐式恢复）已删除。恢复是唯一显式例外，走 trashLifecycle.restoreTrashItem。
 */
export class NoteContentRepository {
  constructor(private readonly deps: NoteContentRepositoryDeps) {}

  save(noteId: string, title: string, content: string, caches?: NoteCacheInput): void {
    const notePath = this.deps.notePathFor(noteId);
    if (!fs.existsSync(notePath)) throw new AppError("NotFound", `笔记不存在: ${noteId}`);

    const current = this.deps.db.prepare("SELECT title, trashed_at, sync_state, is_purged FROM notes WHERE id=? AND deleted_at IS NULL").get(noteId) as
      | { title: string; trashed_at: string | null; sync_state: string | null; is_purged?: number | null }
      | undefined;
    if (!current) throw new AppError("NotFound", `笔记不存在: ${noteId}`);
    if (current.trashed_at != null || current.sync_state === "purged" || current.is_purged === 1) {
      throw new AppError("InvalidInput", `笔记已在回收站或已被删除，保存被拒绝；请先显式恢复: ${noteId}`);
    }
    const currentContent = fs.readFileSync(notePath, "utf8");
    if (!hasNoteSaveChanges({ title: current.title, content: currentContent }, { title, content })) {
      // 编辑器打开时可能只补派生缓存；缓存更新不能改变 updated_at/sync_state。
      if (caches) {
        const transaction = this.deps.db.transaction(() => {
          this.deps.db.prepare("UPDATE notes SET md_cache=?,text_cache=? WHERE id=? AND deleted_at IS NULL")
            .run(caches.markdown ?? null, caches.plain ?? null, noteId);
          this.deps.upsertSearch(noteId, title, caches.plain ?? "");
        });
        transaction();
      }
      return;
    }

    const updatedAt = new Date().toISOString();
    // W-7：文件写（正文）先于 DB 事务——落盘失败在触碰 DB 前就抛错，不产生「DB 已提交但正文没写进文件」；
    // 仅极罕见 DB 提交失败时留「新正文+旧元数据」，该态由保存幂等/同步自愈。
    this.deps.atomicWrite(notePath, content);
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
    });
    transaction();

    // Orphan detection is post-commit maintenance. A failure must not turn a
    // successful note save into a user-visible save failure.
    try { this.deps.detectOrphans(noteId, content); }
    catch (error) { console.warn("[store] 孤儿资源检测失败（不影响保存）:", error); }
    this.deps.markHistoryDirty(noteId);
  }
}
