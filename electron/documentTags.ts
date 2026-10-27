/**
 * 文档标签服务（桌面）：文档 ↔ 标签只走 tag_links(target_kind='note')；
 * 标签目录复用通用 tags 表（QuickNoteTagsStore 只是目录 API 的实现名，表是通用的）。
 * 正文/搜索索引不存标签真相。
 */
import type { DbLike } from "./dbLike.js";
import type { QuickNoteTag } from "../src/core/quickNoteTags.js";
import { QuickNoteTagsStore } from "./quickNoteTagsStore.js";

const KIND = "note";

export class DocumentTagsService {
  private readonly catalog: QuickNoteTagsStore;

  constructor(private readonly db: DbLike) {
    this.catalog = new QuickNoteTagsStore(db);
    // 关联/版本表由通用标签层持有；Store 不一定构造 QuickNotesStore，所以这里幂等建表。
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
      CREATE INDEX IF NOT EXISTS idx_tag_links_tag ON tag_links(tag_id);
      CREATE INDEX IF NOT EXISTS idx_tag_links_target ON tag_links(target_kind, target_id);
    `);
  }

  list(options: { includeDeleted?: boolean } = {}): QuickNoteTag[] {
    return this.catalog.list(options);
  }

  create(name: string): QuickNoteTag {
    return this.catalog.create(name);
  }

  update(id: string, patch: { name?: string; pinned?: boolean; sortOrder?: number }): QuickNoteTag {
    return this.catalog.update(id, patch);
  }

  reorder(orderedIds: readonly string[]): QuickNoteTag[] {
    return this.catalog.reorder(orderedIds);
  }

  /** 删除标签：目录写墓碑 + 清掉该标签在所有目标（文档/小记）上的关联。 */
  delete(id: string, at = new Date().toISOString()): number {
    this.catalog.tombstone(id, at);
    return this.db.transaction(() => {
      const rows = this.db.prepare("SELECT target_kind, target_id FROM tag_links WHERE tag_id=?").all(id) as Array<{ target_kind: string; target_id: string }>;
      this.db.prepare("DELETE FROM tag_links WHERE tag_id=?").run(id);
      for (const row of rows) this.bump(row.target_kind, row.target_id, at);
      return rows.length;
    })();
  }

  /** 合并：源标签关联改指目标，源写墓碑。 */
  merge(sourceId: string, targetId: string, at = new Date().toISOString()): number {
    if (sourceId === targetId) return 0;
    this.catalog.assertExist([targetId]);
    this.catalog.tombstone(sourceId, at);
    return this.db.transaction(() => {
      const rows = this.db.prepare("SELECT target_kind, target_id FROM tag_links WHERE tag_id=?").all(sourceId) as Array<{ target_kind: string; target_id: string }>;
      for (const row of rows) {
        const position = this.db.prepare("SELECT position FROM tag_links WHERE target_kind=? AND target_id=? AND tag_id=?").get(row.target_kind, row.target_id, sourceId) as { position?: number } | undefined;
        // 目标已有关联则直接删源，避免重复；否则改指向
        const clash = this.db.prepare("SELECT 1 FROM tag_links WHERE target_kind=? AND target_id=? AND tag_id=?").get(row.target_kind, row.target_id, targetId);
        if (clash) this.db.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=? AND tag_id=?").run(row.target_kind, row.target_id, sourceId);
        else this.db.prepare("UPDATE tag_links SET tag_id=? WHERE target_kind=? AND target_id=? AND tag_id=?").run(targetId, row.target_kind, row.target_id, sourceId);
        if (position) this.bump(row.target_kind, row.target_id, at);
      }
      return rows.length;
    })();
  }

  getDocumentTagIds(noteId: string): string[] {
    const rows = this.db.prepare("SELECT tag_id FROM tag_links WHERE target_kind=? AND target_id=? ORDER BY position, tag_id").all(KIND, noteId) as Array<{ tag_id: string }>;
    return rows.map((row) => row.tag_id);
  }

  setDocumentTags(noteId: string, tagIds: readonly string[], at = new Date().toISOString()): string[] {
    const unique = [...new Set(tagIds)];
    this.catalog.assertExist(unique);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=?").run(KIND, noteId);
      unique.forEach((tagId, index) => {
        this.db.prepare("INSERT INTO tag_links(target_kind,target_id,tag_id,position) VALUES(?,?,?,?)").run(KIND, noteId, tagId, index);
      });
      this.bump(KIND, noteId, at);
    })();
    return unique;
  }

  tagsUpdatedAt(noteId: string): string {
    const row = this.db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind=? AND target_id=?").get(KIND, noteId) as { links_updated_at?: string } | undefined;
    return row?.links_updated_at ?? "";
  }

  private bump(kind: string, targetId: string, at: string): void {
    this.db.prepare(
      "INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES(?,?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at",
    ).run(kind, targetId, at);
  }

}
