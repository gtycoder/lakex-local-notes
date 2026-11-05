/**
 * 标签目录子系统（桌面）：只拥有 `tags`（通用标签目录），不认识小记、不读 `.qnote`。
 * 关联关系在 `quickNoteTagLinksStore`；两者只在协调层 `quickNoteTagService` 里组合。
 *
 * 261105 用户定稿（两条，别回退）：
 * - **删除 = 缺席**：云端 `tags[]` 只出现 active 标签，**禁止墓碑进索引**（「S3 列表表不得出现
 *   永久存在的条目」）。本机删除 = 物理 DELETE 目录行 + 清关联/版本，**不再写 `deleted_at`**；
 *   离线删过的 id 记进 `device_state.tag_deleted`（JSON 字符串数组），供同步**抑制远端重发**，
 *   远端确认缺席后由引擎结算清空（删除压编辑）。旧库 `deleted_at` 墓碑由一次性迁移
 *   （`tag_absent_migrated`）清掉并并入待删。
 * - **目录顺序是设备本地视图**（不参与同步；置顶功能已删除）：默认「新的在前（created_at DESC）
 *   → 名称」；手动拖拽排序后记本机标记（`quick_tags_manual_order`），按本机 sort_order，
 *   之后新增标签追加到末尾；同步合并只更新名称/时间，**不覆盖本机顺序**。
 */
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import {
  QUICK_NOTE_TAG_ID_RE,
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
}

const MANUAL_ORDER_KEY = "quick_tags_manual_order";
/** 本机待删标签 id（JSON 字符串数组）：设备本地记账，**不上传**；同步引擎据此抑制远端重发。 */
const PENDING_DELETES_KEY = "tag_deleted";
/** 一次性迁移标记：旧库「删除=墓碑」→ 新语义「删除=缺席」只跑一次。 */
const ABSENCE_MIGRATED_KEY = "tag_absent_migrated";

function mapTagRow(row: QuickNoteTagRow): QuickNoteTag {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function nowIso(): string { return new Date().toISOString(); }

export class QuickNoteTagsStore {
  constructor(private readonly db: DbLike) {
    this.ensureSchema();
    // 261105 迁移必须**先于第一次同步**：目录/关联一旦被同步读到，旧墓碑条目会被当成 active 复活。
    // 本类在 QuickNotesStore / DocumentTagsService 构造（= 打开 DB）时创建，正好赶在同步之前。
    this.migrateTagAbsence();
  }

  private ensureSchema(): void {
    // `deleted_at` 只为兼容旧库 DDL 保留（迁移读一次后既不再写、也不再有查询依赖它）；
    // 新库保留同形列，避免「新旧两套建表语句」这种第二来源。
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

  /**
   * 目录列表（本地展示顺序）：手动排序过按 sort_order，否则新→旧 → 名称。
   * 表里只剩 active 行（删除 = 缺席，物理删行）⇒ 不需要任何墓碑过滤。
   */
  list(): QuickNoteTag[] {
    const rows = this.db.prepare("SELECT * FROM tags").all() as QuickNoteTagRow[];
    const manual = this.isManualOrder();
    rows.sort(manual
      ? (a, b) => (a.sort_order - b.sort_order) || byName(a, b)
      : (a, b) => b.created_at.localeCompare(a.created_at) || byName(a, b));
    return rows.map(mapTagRow);
  }

  nameById(): Map<string, string> {
    return new Map(this.list().map((tag) => [tag.id, tag.name] as const));
  }

  /** 追加位（同步合并时远端新标签排到本机末尾）。 */
  nextSortOrder(): number {
    return (this.db.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM tags").get() as { m: number }).m + 1;
  }

  /**
   * 同步落库：upsert 一行 active 标签（name/createdAt/updatedAt），**不碰本机 sort_order**。
   * 只由协调层/端口在「分类已由 core 判定」后调用；行原本不存在时追加到本机末尾（sortOrder 由调用方给）。
   */
  upsert(tag: QuickNoteTag, sortOrder: number): boolean {
    const exists = this.db.prepare("SELECT 1 FROM tags WHERE id=?").get(tag.id);
    if (exists) {
      this.db.prepare("UPDATE tags SET name=?, created_at=?, updated_at=? WHERE id=?").run(tag.name, tag.createdAt, tag.updatedAt, tag.id);
      return false;
    }
    this.insertTag(tag, sortOrder);
    return true;
  }

  /** 幂等创建：同名 active 直接返回；否则用名称派生的稳定 ID 新建（追加到末尾）。 */
  ensure(raw: string, at = nowIso()): QuickNoteTag {
    const name = toTagError(() => normalizeQuickNoteTag(raw));
    const existing = this.db.prepare("SELECT * FROM tags WHERE name=? ORDER BY created_at LIMIT 1").get(name) as QuickNoteTagRow | undefined;
    if (existing) return mapTagRow(existing);
    const id = quickNoteTagId(name);
    // 删除 = 缺席后一般不会撞 ID；唯一可能是「旧名被改走，旧行仍占着该名称派生的 ID」
    // （改名只改目录、不换 ID）。此时再 INSERT 会撞主键 ⇒ 明确报错，让用户先处理已有标签。
    if (this.db.prepare("SELECT 1 FROM tags WHERE id=?").get(id)) {
      throw new AppError("InvalidInput", `标签“${name}”与已有标签的 ID 冲突，请先给已有标签改名`);
    }
    const tag: QuickNoteTag = { id, name, createdAt: at, updatedAt: at };
    this.insertTag(tag, this.nextSortOrder());
    // 用户主动重建同名标签 = 撤销本机删除意图：派生 ID 与待删记录相同，必须移除抑制，
    // 否则下一轮同步的 mergeQuickTags(removedIds=待删) 会把刚建好的行再删一次。
    this.settlePendingDeletes([id]);
    return tag;
  }

  create(name: string): QuickNoteTag {
    return this.ensure(name);
  }

  /** 只改名称（顺序不在模型内；改名会刷新搜索索引里的标签词）。 */
  update(id: string, patch: { name?: string }): QuickNoteTag {
    const row = this.active(id);
    if (!row) throw new AppError("NotFound", "标签不存在或已删除");
    let name = row.name;
    if (patch.name !== undefined) {
      name = toTagError(() => normalizeQuickNoteTag(patch.name));
      if (name !== row.name) {
        const clash = this.db.prepare("SELECT id FROM tags WHERE name=? AND id<>?").get(name, id) as { id: string } | undefined;
        if (clash) throw new AppError("InvalidInput", `已存在同名标签“${name}”，请改用合并`);
      }
    }
    const next: QuickNoteTag = {
      id,
      name,
      createdAt: row.created_at,
      updatedAt: nowIso(),
    };
    this.db.prepare("UPDATE tags SET name=?, updated_at=? WHERE id=?").run(next.name, next.updatedAt, id);
    return next;
  }

  /** 手动拖拽排序：写本机顺序 + 标记「已手动排序」；**不 bump updatedAt**（不触发同步）。 */
  reorder(orderedIds: readonly string[]): QuickNoteTag[] {
    this.db.transaction(() => {
      orderedIds.forEach((id, index) => {
        this.db.prepare("UPDATE tags SET sort_order=? WHERE id=?").run(index, id);
      });
      this.markManualOrder();
    })();
    return this.list();
  }

  /**
   * 用户删除标签：**物理删目录行**（261105：删除 = 缺席，不写墓碑）。
   * 关联/关系版本的清理由协调层在同一事务里做；本机待删记账也在那里。
   * 行不存在 ⇒ NotFound（UI 语义：重复删除是用户操作错误）。
   */
  remove(id: string): void {
    if (!this.active(id)) throw new AppError("NotFound", "标签不存在或已删除");
    this.db.prepare("DELETE FROM tags WHERE id=?").run(id);
  }

  /** 同步结算删除：物理删行；行不存在 = no-op（契约要求幂等）。 */
  deleteIfExists(id: string): boolean {
    return this.db.prepare("DELETE FROM tags WHERE id=?").run(id).changes > 0;
  }

  /** 本机待删标签 id（离线删过 / 合并掉、远端还没确认缺席）；**不上传**，仅设备本地。 */
  listPendingDeletes(): string[] {
    const row = this.db.prepare("SELECT value FROM device_state WHERE key=?").get(PENDING_DELETES_KEY) as { value?: string } | undefined;
    if (!row?.value) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(row.value); } catch { return []; }
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => typeof value === "string" && QUICK_NOTE_TAG_ID_RE.test(value)))].sort();
  }

  /**
   * **追加**待删 id（幂等）：删除/合并源标签、以及同步轮判定的删除都走这里。
   * 用追加而不是覆盖写（261105 复核窗口）：同步轮进行中用户又删了一个标签时，
   * 覆盖写会把这条新待删丢掉 ⇒ 下一轮远端重发就复活。
   */
  addPendingDeletes(ids: readonly string[]): void {
    const add = new Set(ids.filter((id): id is string => typeof id === "string" && QUICK_NOTE_TAG_ID_RE.test(id)));
    if (add.size === 0) return;
    this.writePendingDeletes([...this.listPendingDeletes(), ...add]);
  }

  /** **结算**：远端已确认缺席的 id 从待删集合移除（其余保留）；清空则删掉 device_state 行。 */
  settlePendingDeletes(ids: readonly string[]): void {
    const drop = new Set(ids);
    if (drop.size === 0) return;
    const pending = this.listPendingDeletes();
    const kept = pending.filter((id) => !drop.has(id));
    if (kept.length === pending.length) return;
    if (kept.length === 0) {
      this.db.prepare("DELETE FROM device_state WHERE key=?").run(PENDING_DELETES_KEY);
      return;
    }
    this.writePendingDeletes(kept);
  }

  /** 覆盖写待删集合（仅内部：迁移/重建同名标签/结算用，语义由调用方保证）。 */
  private writePendingDeletes(ids: readonly string[]): void {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && QUICK_NOTE_TAG_ID_RE.test(id)))].sort();
    this.saveDeviceValue(PENDING_DELETES_KEY, JSON.stringify(unique));
  }

  assertExist(tagIds: readonly string[]): void {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return;
    const rows = this.db.prepare(`SELECT id FROM tags WHERE id IN (${unique.map(() => "?").join(",")})`).all(...unique) as Array<{ id: string }>;
    if (rows.length !== unique.length) throw new AppError("InvalidInput", "标签不存在或已删除");
  }

  /**
   * 一次性迁移（261105）：旧库「删除 = 墓碑（deleted_at 非空）」→「删除 = 缺席」。
   *
   * 墓碑行必须**并入本机待删**：旧版把墓碑随索引发布出去，新版协议会把条目的 deletedAt 丢弃
   * 并当成 active ⇒ 不登记待删就会被远端重发复活（删除压编辑）。
   * 随后物理删行 + 清关联/版本（含文档标签关联 target_kind='note'），最后置标记。
   * 整个迁移单事务：中途失败不落标记，下次打开重跑（幂等）。
   */
  private migrateTagAbsence(): void {
    const done = this.db.prepare("SELECT value FROM device_state WHERE key=?").get(ABSENCE_MIGRATED_KEY) as { value?: string } | undefined;
    if (done?.value === "1") return;
    this.db.transaction(() => {
      const tombstones = this.db.prepare("SELECT id FROM tags WHERE deleted_at IS NOT NULL").all() as Array<{ id: string }>;
      if (tombstones.length > 0) {
        // 关联/版本表由通用标签层持有；旧库有、全新库可能还没建（本类可能先于 links store 构造）。
        const hasLinks = this.tableExists("tag_links");
        const hasVersions = this.tableExists("tag_link_versions");
        const pending = new Set(this.listPendingDeletes());
        for (const { id } of tombstones) {
          pending.add(id);
          if (hasLinks) {
            const targets = this.db.prepare("SELECT target_kind, target_id FROM tag_links WHERE tag_id=?").all(id) as Array<{ target_kind: string; target_id: string }>;
            this.db.prepare("DELETE FROM tag_links WHERE tag_id=?").run(id);
            if (hasVersions && targets.length > 0) {
              for (const target of targets) {
                this.db.prepare("DELETE FROM tag_link_versions WHERE target_kind=? AND target_id=?").run(target.target_kind, target.target_id);
              }
            }
          }
          this.db.prepare("DELETE FROM tags WHERE id=?").run(id);
        }
        this.writePendingDeletes([...pending]);
      }
      this.saveDeviceValue(ABSENCE_MIGRATED_KEY, "1");
    })();
  }

  private tableExists(name: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  }

  private saveDeviceValue(key: string, value: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }

  private active(id: string): QuickNoteTagRow | null {
    const row = this.db.prepare("SELECT * FROM tags WHERE id=?").get(id) as QuickNoteTagRow | undefined;
    return row ?? null;
  }

  private insertTag(tag: QuickNoteTag, sortOrder: number): void {
    this.db.prepare("INSERT INTO tags(id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(tag.id, tag.name, sortOrder, tag.createdAt, tag.updatedAt);
  }
}
