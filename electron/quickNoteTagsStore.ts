/**
 * 标签目录子系统（桌面）：只拥有 `tags`（通用标签目录），不认识小记、不读 `.qnote`。
 * 关联关系在 `quickNoteTagLinksStore`；两者只在协调层（quickNoteTagService）里组合。
 */
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import {
  mergeQuickNoteTags,
  normalizeQuickNoteTag,
  quickNoteTagId,
  QuickNoteTagError,
  type QuickNoteTag,
} from "../src/core/quickNoteTags.js";

interface QuickNoteTagRow {
  id: string;
  name: string;
  sort_order: number;
  pinned: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapTagRow(row: QuickNoteTagRow): QuickNoteTag {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    pinned: !!row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toTagError<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof QuickNoteTagError) throw new AppError("InvalidInput", error.message);
    throw error;
  }
}

export class QuickNoteTagsStore {
  constructor(private readonly db: DbLike) {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tags_order ON tags(deleted_at, pinned, sort_order, name)");
  }

  list(options: { includeDeleted?: boolean } = {}): QuickNoteTag[] {
    const where = options.includeDeleted ? "" : "WHERE deleted_at IS NULL";
    const rows = this.db.prepare(`SELECT * FROM tags ${where} ORDER BY pinned DESC, sort_order, name`).all() as QuickNoteTagRow[];
    return rows.map(mapTagRow);
  }

  nameById(): Map<string, string> {
    return new Map(this.list().map((tag) => [tag.id, tag.name] as const));
  }

  /** 幂等创建：同名 active 直接返回；同名墓碑按原 ID 复活。 */
  ensure(raw: string, at = new Date().toISOString()): QuickNoteTag {
    const name = toTagError(() => normalizeQuickNoteTag(raw));
    const existing = this.db.prepare("SELECT * FROM tags WHERE name=? AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(name) as QuickNoteTagRow | undefined;
    if (existing) return mapTagRow(existing);
    const id = quickNoteTagId(name);
    const previous = this.db.prepare("SELECT * FROM tags WHERE id=?").get(id) as QuickNoteTagRow | undefined;
    const sortOrder = (this.db.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM tags WHERE deleted_at IS NULL").get() as { m: number }).m + 1;
    const tag: QuickNoteTag = {
      id,
      name,
      sortOrder,
      pinned: false,
      createdAt: previous?.created_at ?? at,
      updatedAt: at,
      deletedAt: null,
    };
    this.upsert(tag);
    return tag;
  }

  create(name: string): QuickNoteTag {
    return this.ensure(name);
  }

  update(id: string, patch: { name?: string; pinned?: boolean; sortOrder?: number }): QuickNoteTag {
    const row = this.active(id);
    if (!row) throw new AppError("NotFound", "标签不存在或已删除");
    let name = row.name;
    if (patch.name !== undefined) {
      name = toTagError(() => normalizeQuickNoteTag(patch.name));
      if (name !== row.name) {
        const clash = this.db.prepare("SELECT id FROM tags WHERE name=? AND deleted_at IS NULL AND id<>?").get(name, id) as { id: string } | undefined;
        if (clash) throw new AppError("InvalidInput", `已存在同名标签“${name}”，请改用合并`);
      }
    }
    const sortOrder = patch.sortOrder ?? row.sort_order;
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) throw new AppError("InvalidInput", "标签排序值无效");
    const next: QuickNoteTag = {
      id,
      name,
      sortOrder,
      pinned: patch.pinned ?? !!row.pinned,
      createdAt: row.created_at,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    this.upsert(next);
    return next;
  }

  reorder(orderedIds: readonly string[]): QuickNoteTag[] {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        this.db.prepare("UPDATE tags SET sort_order=?, updated_at=? WHERE id=? AND deleted_at IS NULL").run(index, now, id);
      });
    })();
    return this.list();
  }

  /** 写墓碑（关联清理由协调层负责）。 */
  tombstone(id: string, at = new Date().toISOString()): void {
    const row = this.active(id);
    if (!row) throw new AppError("NotFound", "标签不存在或已删除");
    this.upsert({ ...mapTagRow(row), updatedAt: at, deletedAt: at });
  }

  /** 目录 LWW 合并（同步端口）：返回合并后的全量目录（含墓碑）。 */
  mergeRemote(remote: readonly QuickNoteTag[]): QuickNoteTag[] {
    const merged = mergeQuickNoteTags(this.list({ includeDeleted: true }), remote);
    for (const tag of merged) this.upsert(tag);
    return merged;
  }

  assertExist(tagIds: readonly string[]): void {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return;
    const rows = this.db.prepare(`SELECT id FROM tags WHERE deleted_at IS NULL AND id IN (${unique.map(() => "?").join(",")})`).all(...unique) as Array<{ id: string }>;
    if (rows.length !== unique.length) throw new AppError("InvalidInput", "标签不存在或已删除");
  }

  private active(id: string): QuickNoteTagRow | null {
    const row = this.db.prepare("SELECT * FROM tags WHERE id=? AND deleted_at IS NULL").get(id) as QuickNoteTagRow | undefined;
    return row ?? null;
  }

  private upsert(tag: QuickNoteTag): void {
    this.db.prepare(
      "INSERT INTO tags(id,name,sort_order,pinned,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, pinned=excluded.pinned, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at"
    ).run(tag.id, tag.name, tag.sortOrder, tag.pinned ? 1 : 0, tag.createdAt, tag.updatedAt, tag.deletedAt);
  }
}
