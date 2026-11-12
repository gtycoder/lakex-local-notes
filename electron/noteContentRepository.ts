import type { DbLike } from "./dbLike.js";
import fs from "node:fs";
import { AppError } from "../src/core/storeErrors.js";
import { hasNoteSaveChanges } from "../src/core/noteSaveDecision.js";
import { noteBodyHash } from "./noteBodyHash.js";

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
  /**
   * 261110：本进程最近一次成功写入的正文 hash（按 note）。
   * 用途 = 「自伤竞态」自愈：同一次编辑停顿里排队的两笔保存，第二笔的 baseHash 可能还是旧的
   * （第一笔成功时渲染层因为"期间有新编辑"没刷新基线），此时 diskHash 恰好等于本进程刚写的版本。
   * 外部写入不可能命中这个值 ⇒ 判据只在进程内有效、重启不保留（重启后外部改动照常拦截）。
   * 上限 2000 条，超出丢最早键（粗略 LRU；只影响自愈命中率，不影响正确性）。
   */
  private readonly lastWrittenHash = new Map<string, string>();

  constructor(private readonly deps: NoteContentRepositoryDeps) {}

  private rememberWritten(noteId: string, hash: string): void {
    this.lastWrittenHash.delete(noteId);
    this.lastWrittenHash.set(noteId, hash);
    if (this.lastWrittenHash.size > 2000) {
      const oldest = this.lastWrittenHash.keys().next().value;
      if (oldest !== undefined) this.lastWrittenHash.delete(oldest);
    }
  }

  /**
   * 落盘正文（唯一写入口）。
   * `baseHash`（Batch4-D 保存版本守卫）：编辑器打开/上次保存时的正文 hash；磁盘当前正文 hash 不一致
   * ⇒ **不写盘**，返回 `{ diskHash }` 由调用方（Store）包装成结构化冲突。缺省 = 旧行为（无条件写）。
   */
  /**
   * 同步专用正文写入（261112 P0）：**允许写「已进回收站」的行**（保留 trashed 状态，只更新正文/标题/缓存）；
   * 与用户保存的唯一差异 = 不触发「回收站拒写」守卫。**purged / 已删仍拒绝**（不可复活）。
   * 为什么需要：回收站 = 特殊笔记本，内容编辑与位置移动是独立字段；远端编辑应用到本地回收站行时
   * 不得因生命周期而整篇失败（否则一篇卡死整轮同步）。
   */
  saveSynced(noteId: string, title: string, content: string, caches?: NoteCacheInput): void {
    this.save(noteId, title, content, caches, undefined, { allowTrashed: true });
  }

  save(
    noteId: string,
    title: string,
    content: string,
    caches?: NoteCacheInput,
    baseHash?: string,
    opts?: { allowTrashed?: boolean },
  ): { diskHash: string } | null {
    const notePath = this.deps.notePathFor(noteId);
    if (!fs.existsSync(notePath)) throw new AppError("NotFound", `笔记不存在: ${noteId}`);

    const current = this.deps.db.prepare("SELECT title, trashed_at, is_purged FROM notes WHERE id=? AND deleted_at IS NULL").get(noteId) as
      | { title: string; trashed_at: string | null; is_purged?: number | null }
      | undefined;
    if (!current) throw new AppError("NotFound", `笔记不存在: ${noteId}`);
    // purged = 永久删除，任何写入路径都拒绝；trashed 只在**同步专用路径**（allowTrashed）放行，
    // 且该路径不会改动 trashed_at -> 仍留在回收站（见 saveSynced）。
    if (current.is_purged === 1) {
      // 文案保留「已删除」字样（noteContentRepository.test.ts 的 F04 断言判据），并说明不可恢复。
      throw new AppError("InvalidInput", `笔记已被彻底删除（不可恢复），保存被拒绝；已删除条目不可复原: ${noteId}`);
    }
    if (current.trashed_at != null && !opts?.allowTrashed) {
      throw new AppError("InvalidInput", `笔记已在回收站或已被删除，保存被拒绝；请先显式恢复: ${noteId}`);
    }
    const currentContent = fs.readFileSync(notePath, "utf8");
    if (!hasNoteSaveChanges({ title: current.title, content: currentContent }, { title, content })) {
      // 编辑器打开时可能只补派生缓存；缓存更新不能改变 updated_at/is_dirty。
      if (caches) {
        const transaction = this.deps.db.transaction(() => {
          this.deps.db.prepare("UPDATE notes SET md_cache=?,text_cache=? WHERE id=? AND deleted_at IS NULL")
            .run(caches.markdown ?? null, caches.plain ?? null, noteId);
          this.deps.upsertSearch(noteId, title, caches.plain ?? "");
        });
        transaction();
      }
      return null;
    }

    // Batch4-D 版本守卫：放在「无变化早退」**之后**——内容与磁盘一致时根本不会写正文，
    // 此时 baseHash 陈旧（例如同步刚把同一内容写盘）不该弹冲突；真要写正文才比 hash。
    // 只在调用方给了 baseHash 时才计算（不给 = 旧行为，逐字节一致）。
    if (baseHash !== undefined) {
      const diskHash = noteBodyHash(currentContent);
      // 261110：磁盘版本 == 本进程刚写的那一版 ⇒ 是我们自己的写入（排队竞态），不是"他处编辑"。
      if (diskHash !== baseHash && diskHash !== this.lastWrittenHash.get(noteId)) {
        // **竞态自愈（261110 现场误报）**：磁盘上已经就是"我们正要写的内容"
        // ⇒ 只是 baseHash 旧了（上一次保存/同步/他线程先落了同一份），不是"他处编辑过"。
        // 但**标题可能也变了**（用户同内容下改名）：那种情况不能在这里 return —— 要走正常写路径
        // 把 title / updated_at / tree_nodes.title 一并落库，否则改名会被静默丢弃。
        if (noteBodyHash(content) !== diskHash) return { diskHash };
        if (title === current.title) {
          if (caches) {
            const transaction = this.deps.db.transaction(() => {
              this.deps.db.prepare("UPDATE notes SET md_cache=?,text_cache=? WHERE id=? AND deleted_at IS NULL")
                .run(caches.markdown ?? null, caches.plain ?? null, noteId);
              this.deps.upsertSearch(noteId, title, caches.plain ?? "");
            });
            transaction();
          }
          return null;
        }
        // 标题变了 ⇒ 落到下面的正常写路径（正文同字节重写无害，元数据必须更新）。
      }
    }

    const updatedAt = new Date().toISOString();
    // W-7：文件写（正文）先于 DB 事务——落盘失败在触碰 DB 前就抛错，不产生「DB 已提交但正文没写进文件」；
    // 仅极罕见 DB 提交失败时留「新正文+旧元数据」，该态由保存幂等/同步自愈。
    this.deps.atomicWrite(notePath, content);
    this.rememberWritten(noteId, noteBodyHash(content));
    const transaction = this.deps.db.transaction(() => {
      if (caches) {
        this.deps.db.prepare("UPDATE notes SET title=?,updated_at=?,is_dirty=1,md_cache=?,text_cache=? WHERE id=? AND deleted_at IS NULL")
          .run(title, updatedAt, caches.markdown ?? null, caches.plain ?? null, noteId);
        this.deps.upsertSearch(noteId, title, caches.plain ?? "");
      } else {
        this.deps.db.prepare("UPDATE notes SET title=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL")
          .run(title, updatedAt, noteId);
        this.deps.upsertSearch(noteId, title, null);
      }
      this.deps.db.prepare("UPDATE tree_nodes SET title=?,updated_at=?,is_dirty=1 WHERE note_file_id=? AND deleted_at IS NULL")
        .run(title, updatedAt, noteId);
    });
    transaction();

    // Orphan detection is post-commit maintenance. A failure must not turn a
    // successful note save into a user-visible save failure.
    try { this.deps.detectOrphans(noteId, content); }
    catch (error) { console.warn("[store] 孤儿资源检测失败（不影响保存）:", error); }
    this.deps.markHistoryDirty(noteId);
    return null;
  }
}