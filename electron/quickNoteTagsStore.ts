/**
 * 标签目录子系统（桌面）：只拥有 `tags`（通用标签目录），不认识小记、不读 `.qnote`。
 * 关联关系在 `quickNoteTagLinksStore`；两者只在协调层 `quickNoteTagService` 里组合。
 *
 * 261105 用户定稿：**目录顺序是设备本地视图**（不参与同步；置顶功能已删除）。
 * - 未手动排序过：默认「新的在前（created_at DESC）→ 名称」；
 * - 手动拖拽排序后：记本机标记（device_state），按本机 sort_order；之后新增标签追加到末尾；
 * - 同步合并只更新名称/墓碑/时间，**不覆盖本机顺序**。
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
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const MANUAL_ORDER_KEY = "quick_tags_manual_order";

function mapTagRow(row: QuickNoteTagRow): QuickNoteTag {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "zh-CN");
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `);
    this.db.exec("CREATE TABLE IF NOT EXISTS device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tags_local_order ON tags(deleted_at, sort_order, name)");
  }

  /** 是否已在本机手动排序过（设备本地标记，不参与同步）。 */
  isManualOrder(): boolean {
    const row = this.db.prepare("SELECT value FROM device_state WHERE key=?").get(MANUAL_ORDER_KEY) as { value?: string } | undefined;
    return row?.value === "1";
  }

  private markManualOrder(): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(MANUAL_ORDER_KEY, "1");
  }

  /** 目录列表（本地展示顺序）：手动排序过按 sort_order，否则新→旧 → 名称。 */
  list(options: { includeDeleted?: boolean } = {}): QuickNoteTag[] {
    const where = options.includeDeleted ? "" : "WHERE deleted_at IS NULL";
    const rows = this.db.prepare(`SELECT * FROM tags ${where}`).all() as QuickNoteTagRow[];
    const manual = this.isManualOrder();
    rows.sort(manual
      ? (a, b) => (a.sort_order - b.sort_order) || byName(a, b)
      : (a, b) => b.created_at.localeCompare(a.created_at) || byName(a, b));
    return rows.map(mapTagRow);
  }

  nameById(): Map<string, string> {
    return new Map(this.list().map((tag) => [tag.id, tag.name] as const));
  }

  /** 幂等创建：同名 active 直接返回；同名墓碑按原 ID 复活。新标签默认追加到末尾。 */
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
      createdAt: previous?.created_at ?? at,
      updatedAt: at,
      deletedAt: null,
    };
    this.insertTag(tag, sortOrder);
    return tag;
  }

  create(name: string): QuickNoteTag {
    return this.ensure(name);
  }

  /** 只改名称（顺序/置顶不在模型内；改名会刷新搜索索引里的标签词）。 */
  update(id: string, patch: { name?: string }): QuickNoteTag {
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
    const next: QuickNoteTag = {
      id,
      name,
      createdAt: row.created_at,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    this.db.prepare("UPDATE tags SET name=?, updated_at=?, deleted_at=NULL WHERE id=?").run(next.name, next.updatedAt, id);
    return next;
  }

  /** 手动拖拽排序：写本机顺序 + 标记「已手动排序」；**不 bump updatedAt**（不触发同步）。 */
  reorder(orderedIds: readonly string[]): QuickNoteTag[] {
    this.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        this.db.prepare("UPDATE tags SET sort_order=? WHERE id=? AND deleted_at IS NULL").run(index, id);
      });
      this.markManualOrder();
    })();
    return this.list();
  }

  /** 写墓碑（关联清理由协调层负责）。 */
  tombstone(id: string, at = new Date().toISOString()): void {
    const row = this.active(id);
    if (!row) throw new AppError("NotFound", "标签不存在或已删除");
    this.db.prepare("UPDATE tags SET updated_at=?, deleted_at=? WHERE id=?").run(at, at, id);
  }

  /**
   * 目录 LWW 合并（同步端口）：返回合并后的全量目录。
   * 只合并名称/墓碑/时间；**本机 sort_order 不动**；远端新标签追加到本机末尾。
   */
  mergeRemote(remote: readonly QuickNoteTag[]): QuickNoteTag[] {
    const local = this.list({ includeDeleted: true });
    const merged = mergeQuickNoteTags(local, remote);
    let nextSortOrder = (this.db.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM tags WHERE deleted_at IS NULL").get() as { m: number }).m + 1;
    this.db.transaction(() => {
      for (const tag of merged) {
        const exists = this.db.prepare("SELECT 1 FROM tags WHERE id=?").get(tag.id);
        if (exists) {
          this.db.prepare("UPDATE tags SET name=?, updated_at=?, deleted_at=? WHERE id=?").run(tag.name, tag.updatedAt, tag.deletedAt ?? null, tag.id);
          continue;
        }
        this.db.prepare("INSERT INTO tags(id,name,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?)")
          .run(tag.id, tag.name, nextSortOrder, tag.createdAt, tag.updatedAt, tag.deletedAt ?? null);
        nextSortOrder += 1;
      }
    })();
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

  private insertTag(tag: QuickNoteTag, sortOrder: number): void {
    this.db.prepare("INSERT INTO tags(id,name,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?)")
      .run(tag.id, tag.name, sortOrder, tag.createdAt, tag.updatedAt, tag.deletedAt);
  }
}
