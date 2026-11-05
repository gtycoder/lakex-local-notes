/**
 * 文档 ↔ 标签**关系**（主库）：只拥有 tag_links / tag_link_versions 的 target_kind='note' 行。
 *
 * 261105 P1 定稿：
 * - **目录单一来源 = quick-notes 库的 tags 表（已随 quick-notes 索引同步）**；本库不再维护标签目录
 *   （旧主库 tags 表按「可重建」原则丢弃/不读，不写兼容；删除/重命名/合并由主进程跨库协调）。
 * - 关系是唯一事实；展示/应用时过滤「目录里不存在」的 tag id（干净兜底，启动自检另有孤儿清理）。
 * - 关系按**集合 + 关系版本** LWW 同步（与小记 tagIds 同口径）：保留本机顺序、远端新增插最前。
 */
import type { DbLike } from "./dbLike.js";
import { normalizeQuickNoteTagIds, QuickNoteTagError } from "../src/core/quickNoteTags.js";
import { AppError } from "../src/core/storeErrors.js";

const KIND = "note";

function nowIso(): string { return new Date().toISOString(); }

export class DocumentTagsService {
  constructor(private readonly db: DbLike) {
    // 只建关系/版本表；**不再创建/读取主库 tags 目录**（目录唯一来源 = quick-notes 库）。
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

  /** 单文档关系（本机顺序）。 */
  getDocumentTagIds(noteId: string): string[] {
    const rows = this.db.prepare("SELECT tag_id FROM tag_links WHERE target_kind=? AND target_id=? ORDER BY position, tag_id").all(KIND, noteId) as Array<{ tag_id: string }>;
    return rows.map((row) => row.tag_id);
  }

  /** 全部文档关系（拼 lake 索引同步清单用，避免 N+1）。 */
  listAll(): Map<string, string[]> {
    const rows = this.db.prepare("SELECT target_id, tag_id FROM tag_links WHERE target_kind=? ORDER BY target_id, position, tag_id").all(KIND) as Array<{ target_id: string; tag_id: string }>;
    const byNote = new Map<string, string[]>();
    for (const row of rows) {
      const list = byNote.get(row.target_id);
      if (list) list.push(row.tag_id);
      else byNote.set(row.target_id, [row.tag_id]);
    }
    return byNote;
  }

  /** 单文档关系版本（LWW）。 */
  tagsUpdatedAt(noteId: string): string {
    const row = this.db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind=? AND target_id=?").get(KIND, noteId) as { links_updated_at?: string } | undefined;
    return row?.links_updated_at ?? "";
  }

  /** 全部关系版本（同步清单用）。 */
  allTagsUpdatedAt(): Map<string, string> {
    const rows = this.db.prepare("SELECT target_id, links_updated_at FROM tag_link_versions WHERE target_kind=? AND links_updated_at <> ''").all(KIND) as Array<{ target_id: string; links_updated_at: string }>;
    return new Map(rows.map((row) => [row.target_id, row.links_updated_at] as const));
  }

  /**
   * 整组替换文档关系 + bump 关系版本（用户动作 / 转换继承用）。
   * 标签存在性由协调层（quick-notes 目录）校验——本服务不认识目录。
   */
  setNoteTags(noteId: string, rawTagIds: readonly string[], at = nowIso()): string[] {
    const tagIds = this.normalize(rawTagIds);
    this.db.transaction(() => {
      this.writeLinks(noteId, tagIds);
      this.upsertVersion(noteId, at);
    })();
    return tagIds;
  }

  /**
   * 远端关系 LWW：版本更新才覆盖；只接受 `allowedTagIds`（目录里 active 的标签）。
   * **保留本机顺序、远端新增插最前**（与小记 applyRemote 同语义）。
   */
  applyRemote(noteId: string, rawTagIds: readonly string[], remoteUpdatedAt: string): boolean {
    if (!remoteUpdatedAt || remoteUpdatedAt <= this.tagsUpdatedAt(noteId)) return false;
    // 目录过滤拆到 cleanupOrphans（saveState 末尾、目录合并之后）：首轮同步时目录可能同轮才到达。
    const tagIds = this.normalize(rawTagIds);
    const local = this.getDocumentTagIds(noteId);
    const remoteSet = new Set(tagIds);
    const added = tagIds.filter((tagId) => !local.includes(tagId));
    const next = [...added, ...local.filter((tagId) => remoteSet.has(tagId))];
    this.db.transaction(() => {
      this.writeLinks(noteId, next);
      // 允许远端引用尚未到达的标签 ID：目录随同一份 quick-notes 索引同步，下一轮即可解析名称。
      this.upsertVersion(noteId, remoteUpdatedAt);
    })();
    return true;
  }

  /**
   * 删除标签（跨库协调的主库半边）：清该标签全部文档关系，并把受影响文档的关系版本推进到 `at`
   *（关系变更是本机新动作，必须能在 LWW 里胜出）。
   */
  removeTag(tagId: string, at = nowIso()): number {
    const targets = this.db.prepare("SELECT target_id FROM tag_links WHERE target_kind=? AND tag_id=?").all(KIND, tagId) as Array<{ target_id: string }>;
    if (targets.length === 0) return 0;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM tag_links WHERE target_kind=? AND tag_id=?").run(KIND, tagId);
      for (const target of targets) this.upsertVersion(target.target_id, at);
    })();
    return targets.length;
  }

  /** 合并标签：源标签的文档关系改指目标（去重、保留位置），推进受影响文档关系版本。 */
  mergeTag(sourceId: string, targetId: string, at = nowIso()): number {
    if (sourceId === targetId) return 0;
    const targets = this.db.prepare("SELECT target_id FROM tag_links WHERE target_kind=? AND tag_id=?").all(KIND, sourceId) as Array<{ target_id: string }>;
    if (targets.length === 0) return 0;
    this.db.transaction(() => {
      for (const target of targets) {
        const current = this.getDocumentTagIds(target.target_id);
        const next: string[] = [];
        for (const tagId of current) {
          const value = tagId === sourceId ? targetId : tagId;
          if (!next.includes(value)) next.push(value);
        }
        this.writeLinks(target.target_id, next);
        this.upsertVersion(target.target_id, at);
      }
    })();
    return targets.length;
  }

  /**
   * 启动自检：清理「关系指向不存在标签」的孤儿（目录 = quick-notes 库 active 标签）。
   * 返回清理的行数与标签数；受影响文档推进关系版本（让删除也能传播）。
   */
  cleanupOrphans(validTagIds: ReadonlySet<string>, at = nowIso()): { links: number; tags: number } {
    const rows = this.db.prepare("SELECT tag_id, target_id FROM tag_links WHERE target_kind=?").all(KIND) as Array<{ tag_id: string; target_id: string }>;
    const orphans = rows.filter((row) => !validTagIds.has(row.tag_id));
    if (orphans.length === 0) return { links: 0, tags: 0 };
    const tags = new Set(orphans.map((row) => row.tag_id));
    this.db.transaction(() => {
      for (const orphan of orphans) {
        this.db.prepare("DELETE FROM tag_links WHERE target_kind=? AND target_id=? AND tag_id=?").run(KIND, orphan.target_id, orphan.tag_id);
        this.upsertVersion(orphan.target_id, at);
      }
    })();
    return { links: orphans.length, tags: tags.size };
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
