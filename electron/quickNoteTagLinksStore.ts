/**
 * 标签 ↔ 目标（小记/文档）关联表（桌面）：关系是唯一事实，正文/索引不存标签名。
 * 表：tag_links(target_kind,target_id,tag_id,position) + tag_link_versions(每目标关系版本)。
 * 本 store 只写关联与关系版本，不碰正文/文件/标签目录。
 */
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { normalizeQuickNoteTagIds, QuickNoteTagError } from "../src/core/quickNoteTags.js";

const KIND = "quickNote";

interface LinkRow { target_id: string; tag_id: string }
interface VersionRow { target_id: string; links_updated_at: string }

export class QuickNoteTagLinksStore {
  /** 本次构造是否**新建**了关联表（用于升级后一次性重建标签搜索词，见 QuickNotesStore 构造器）。 */
  readonly schemaCreated: boolean;

  constructor(private readonly db: DbLike) {
    this.schemaCreated = !this.db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name='tag_links'").get();
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tag_links (
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(target_kind, target_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS tag_link_versions (
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        links_updated_at TEXT NOT NULL,
        PRIMARY KEY(target_kind, target_id)
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tag_links_tag ON tag_links(tag_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tag_links_target ON tag_links(target_kind, target_id)");
  }

  listFor(noteId: string): string[] {
    const rows = this.db.prepare("SELECT tag_id FROM tag_links WHERE target_kind=? AND target_id=? ORDER BY position, tag_id").all(KIND, noteId) as Array<{ tag_id: string }>;
    return rows.map((row) => row.tag_id);
  }

  listAll(): Map<string, string[]> {
    const rows = this.db.prepare("SELECT target_id, tag_id FROM tag_links WHERE target_kind=? ORDER BY target_id, position, tag_id").all(KIND) as LinkRow[];
    const byNote = new Map<string, string[]>();
    for (const row of rows) {
      const list = byNote.get(row.target_id);
      if (list) list.push(row.tag_id);
      else byNote.set(row.target_id, [row.tag_id]);
    }
    return byNote;
  }

  /** 恢复/复制后把关系版本推进到指定时间（无行时也保留版本）。 */
  setVersion(noteId: string, at: string): void { this.upsertVersion(noteId, at); }

  tagsUpdatedAt(noteId: string): string {
    const row = this.db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind=? AND target_id=?").get(KIND, noteId) as { links_updated_at?: string } | undefined;
    return row?.links_updated_at ?? "";
  }

  /** 一次性读出全部关系版本（同步列表用，避免逐条 N+1）。 */
  allTagsUpdatedAt(): Map<string, string> {
    const rows = this.db.prepare("SELECT target_id, links_updated_at FROM tag_link_versions WHERE target_kind=? AND links_updated_at <> ''").all(KIND) as VersionRow[];
    return new Map(rows.map((row) => [row.target_id, row.links_updated_at] as const));
  }

  /** 整组替换（标签关系 API）：去重并推进关系版本；标签存在性由协调层校验。 */
  setForNote(noteId: string, rawTagIds: readonly string[], at = new Date().toISOString()): string[] {
    const tagIds = this.normalize(rawTagIds);
    const exists = this.db.prepare("SELECT 1 FROM quick_notes WHERE id=?").get(noteId);
    if (!exists) throw new AppError("NotFound", "小记不存在");
    this.db.transaction(() => {
      this.writeLinks(noteId, tagIds);
      this.upsertVersion(noteId, at);
    })();
    return tagIds;
  }

  /** 删除某标签的全部关联（跨所有目标类型）：返回受影响小记数。 */
  removeTag(tagId: string, at = new Date().toISOString()): number {
    const rows = this.db.prepare("SELECT target_kind, target_id FROM tag_links WHERE tag_id=?").all(tagId) as Array<{ target_kind: string; target_id: string }>;
    if (rows.length === 0) return 0;
    const noteIds = rows.filter((row) => row.target_kind === KIND).map((row) => row.target_id);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM tag_links WHERE tag_id=?").run(tagId);
      for (const noteId of noteIds) this.upsertVersion(noteId, at);
    })();
    return noteIds.length;
  }

  /** 合并：把源标签的关联替换为目标标签（保留位置、去重），返回受影响小记数。 */
  replaceTag(sourceId: string, targetId: string, at = new Date().toISOString()): number {
    const rows = this.db.prepare("SELECT target_kind, target_id FROM tag_links WHERE tag_id=?").all(sourceId) as Array<{ target_kind: string; target_id: string }>;
    if (rows.length === 0) return 0;
    const noteIds = rows.filter((row) => row.target_kind === KIND).map((row) => row.target_id);
    this.db.transaction(() => {
      for (const noteId of noteIds) {
        const current = this.listFor(noteId);
        const next: string[] = [];
        for (const tagId of current) {
          const value = tagId === sourceId ? targetId : tagId;
          if (!next.includes(value)) next.push(value);
        }
        this.writeLinks(noteId, next);
        this.upsertVersion(noteId, at);
      }
      this.db.prepare("DELETE FROM tag_links WHERE tag_id=? AND target_kind<>?").run(sourceId, KIND);
    })();
    return noteIds.length;
  }

  /** 远端关系 LWW：远端版本更新才覆盖；deletedTagIds 由协调层传入。返回是否采纳。 */
  applyRemote(noteId: string, rawTagIds: readonly string[], remoteUpdatedAt: string, deletedTagIds: ReadonlySet<string>): boolean {
    if (!remoteUpdatedAt || remoteUpdatedAt <= this.tagsUpdatedAt(noteId)) return false;
    const tagIds = this.normalize(rawTagIds).filter((tagId) => !deletedTagIds.has(tagId));
    this.db.transaction(() => {
      this.writeLinks(noteId, tagIds);
      // 允许远端引用尚未到达的标签 ID：目录随同一份清单同步，下一轮即可解析名称。
      this.upsertVersion(noteId, remoteUpdatedAt);
    })();
    return true;
  }

  removeNote(noteId: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=?").run(KIND, noteId);
      this.db.prepare("DELETE FROM tag_link_versions WHERE target_kind=? AND target_id=?").run(KIND, noteId);
    })();
  }

  private writeLinks(noteId: string, tagIds: readonly string[]): void {
    this.db.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=?").run(KIND, noteId);
    const insert = this.db.prepare("INSERT OR IGNORE INTO tag_links(target_kind, target_id, tag_id, position) VALUES(?,?,?,?)");
    tagIds.forEach((tagId, index) => insert.run(KIND, noteId, tagId, index));
  }

  private upsertVersion(noteId: string, at: string): void {
    this.db.prepare(
      "INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES(?,?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at",
    ).run(KIND, noteId, at);
  }

  private normalize(rawTagIds: readonly string[]): string[] {
    try { return normalizeQuickNoteTagIds(rawTagIds); }
    catch (error) {
      if (error instanceof QuickNoteTagError) throw new AppError("InvalidInput", error.message);
      throw error;
    }
  }
}
