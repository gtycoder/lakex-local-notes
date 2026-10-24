/**
 * 小记 ↔ 标签关联表（桌面）：关系是唯一事实，正文 `.qnote` 不含标签。
 * 本 store 只写 `quick_note_tag_links` 与 `quick_notes.tags_updated_at`，不碰正文/文件。
 */
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { normalizeQuickNoteTagIds, QuickNoteTagError } from "../src/core/quickNoteTags.js";

interface LinkRow { note_id: string; tag_id: string }

export class QuickNoteTagLinksStore {
  /** 本次构造是否**新建**了关联表（用于升级后一次性重建标签搜索词，见 QuickNotesStore 构造器）。 */
  readonly schemaCreated: boolean;

  constructor(private readonly db: DbLike) {
    this.schemaCreated = !this.db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name='quick_note_tag_links'").get();
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quick_note_tag_links (
        note_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(note_id, tag_id)
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_quick_note_tag_links_tag ON quick_note_tag_links(tag_id)");
    // 关系版本：与正文 updated_at 独立，按它做跨端 LWW。
    const cols = this.db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>;
    if (!cols.some((column) => column.name === "tags_updated_at")) {
      this.db.exec("ALTER TABLE quick_notes ADD COLUMN tags_updated_at TEXT NOT NULL DEFAULT ''");
    }
  }

  listFor(noteId: string): string[] {
    const rows = this.db.prepare("SELECT tag_id FROM quick_note_tag_links WHERE note_id=? ORDER BY position, tag_id").all(noteId) as Array<{ tag_id: string }>;
    return rows.map((row) => row.tag_id);
  }

  listAll(): Map<string, string[]> {
    const rows = this.db.prepare("SELECT note_id, tag_id FROM quick_note_tag_links ORDER BY note_id, position, tag_id").all() as LinkRow[];
    const byNote = new Map<string, string[]>();
    for (const row of rows) {
      const list = byNote.get(row.note_id);
      if (list) list.push(row.tag_id);
      else byNote.set(row.note_id, [row.tag_id]);
    }
    return byNote;
  }

  tagsUpdatedAt(noteId: string): string {
    const row = this.db.prepare("SELECT tags_updated_at FROM quick_notes WHERE id=?").get(noteId) as { tags_updated_at?: string } | undefined;
    return row?.tags_updated_at ?? "";
  }

  /** 一次性读出全部关系版本（同步列表用，避免逐条 N+1）。 */
  allTagsUpdatedAt(): Map<string, string> {
    const rows = this.db.prepare("SELECT id, tags_updated_at FROM quick_notes WHERE tags_updated_at <> ''").all() as Array<{ id: string; tags_updated_at: string }>;
    return new Map(rows.map((row) => [row.id, row.tags_updated_at] as const));
  }

  /** 整组替换（标签关系 API）：去重并推进关系版本；标签存在性由协调层校验。 */
  setForNote(noteId: string, rawTagIds: readonly string[], at = new Date().toISOString()): string[] {
    const tagIds = this.normalize(rawTagIds);
    const exists = this.db.prepare("SELECT 1 FROM quick_notes WHERE id=?").get(noteId);
    if (!exists) throw new AppError("NotFound", "小记不存在");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?").run(noteId);
      tagIds.forEach((tagId, index) => {
        this.db.prepare("INSERT INTO quick_note_tag_links(note_id, tag_id, position) VALUES(?,?,?)").run(noteId, tagId, index);
      });
      this.db.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?").run(at, noteId);
    })();
    return tagIds;
  }

  /** 删除某标签的全部关联（标签删除/墓碑）：返回受影响小记数。 */
  removeTag(tagId: string, at = new Date().toISOString()): number {
    const noteIds = (this.db.prepare("SELECT DISTINCT note_id FROM quick_note_tag_links WHERE tag_id=?").all(tagId) as Array<{ note_id: string }>).map((row) => row.note_id);
    if (noteIds.length === 0) return 0;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM quick_note_tag_links WHERE tag_id=?").run(tagId);
      const bump = this.db.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?");
      for (const noteId of noteIds) bump.run(at, noteId);
    })();
    return noteIds.length;
  }

  /** 合并：把源标签的关联替换为目标标签（保留位置、去重），返回受影响小记数。 */
  replaceTag(sourceId: string, targetId: string, at = new Date().toISOString()): number {
    const noteIds = (this.db.prepare("SELECT DISTINCT note_id FROM quick_note_tag_links WHERE tag_id=?").all(sourceId) as Array<{ note_id: string }>).map((row) => row.note_id);
    if (noteIds.length === 0) return 0;
    this.db.transaction(() => {
      const write = this.db.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?");
      const insert = this.db.prepare("INSERT OR IGNORE INTO quick_note_tag_links(note_id, tag_id, position) VALUES(?,?,?)");
      const bump = this.db.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?");
      for (const noteId of noteIds) {
        const current = this.listFor(noteId);
        const next: string[] = [];
        for (const tagId of current) {
          const value = tagId === sourceId ? targetId : tagId;
          if (!next.includes(value)) next.push(value);
        }
        write.run(noteId);
        next.forEach((tagId, index) => insert.run(noteId, tagId, index));
        bump.run(at, noteId);
      }
    })();
    return noteIds.length;
  }

  /** 远端关系 LWW：远端版本更新才覆盖；`deletedTagIds` 由协调层传入（已墓碑的标签不写入）。返回是否采纳。 */
  applyRemote(noteId: string, rawTagIds: readonly string[], remoteUpdatedAt: string, deletedTagIds: ReadonlySet<string>): boolean {
    if (!remoteUpdatedAt || remoteUpdatedAt <= this.tagsUpdatedAt(noteId)) return false;
    const tagIds = this.normalize(rawTagIds).filter((tagId) => !deletedTagIds.has(tagId));
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?").run(noteId);
      tagIds.forEach((tagId, index) => {
        this.db.prepare("INSERT INTO quick_note_tag_links(note_id, tag_id, position) VALUES(?,?,?)").run(noteId, tagId, index);
      });
      // 允许远端引用尚未到达的标签 ID：目录随同一份清单同步，下一轮即可解析名称。
      this.db.prepare("UPDATE quick_notes SET tags_updated_at=? WHERE id=?").run(remoteUpdatedAt, noteId);
    })();
    return true;
  }

  removeNote(noteId: string): void {
    this.db.prepare("DELETE FROM quick_note_tag_links WHERE note_id=?").run(noteId);
  }

  private normalize(rawTagIds: readonly string[]): string[] {
    try { return normalizeQuickNoteTagIds(rawTagIds); }
    catch (error) {
      if (error instanceof QuickNoteTagError) throw new AppError("InvalidInput", error.message);
      throw error;
    }
  }
}
