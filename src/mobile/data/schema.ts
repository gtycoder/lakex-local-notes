import { buildQuickNotesSyncSchemaStatements } from "./quickNotesDbPort.js";
import type { MobileDb } from "./sqliteDb.js";

/**
 * 移动端 SQLite schema。
 *
 * 261019 存储架构对齐桌面：**正文不再进 SQLite**（文档正文/小记正文/历史快照都是文件，见
 * src/core/noteBodyPaths.ts + native/bodyStore.ts），DB 只存元数据、hash、同步账本与**派生**文本缓存。
 *
 * 261022 起旧设备迁移窗口已关闭：不再识别/重置旧 SQLite 正文 schema，也不再扫描旧正文目录。
 *
 * 261021 冷启动（用户点单"批量 SQL 才是正解"）：这段 DDL 有 28 条，逐条 `exec` 在原生 SQLite 上是
 * **每条一次桥往返**（实测 ~68ms）⇒ 首次启动 2.4s。现在：
 * ① `PRAGMA user_version` 版本门跳过重复执行（稳态 0 条 DDL）；
 * ② 首次仍要跑时，把 DDL **拆成两批**、每批一次 `executeSet` 桥往返：
 *    · 第一批 = 不依赖读状态的"底表"建表（含旧库 DROP）；
 *    · 第二批 = 需要读 `PRAGMA table_info` / `sqlite_master` / 种子的条件语句 + 小记 schema 增量。
 *    两批之间只有 4~5 次只读查询，写侧从 28 次往返降到 **2 次**。
 */

/**
 * 移动端 schema 版本（261021）：**改表/索引就 +1**。
 *
 * 背景：`applyMobileSchema` 是 30+ 条独立 SQL，每条走一次 Capacitor 桥往返
 * （设备实测单次 ~68ms）⇒ 冷启动固定多花 **~2.4s**。改成"版本已到就整段跳过"后，
 * 只有首次安装/升级那一次会付这笔钱（且那一次已批量成两次往返）。
 *
 * ⚠️ 只用于"建表/加列/建索引"这类幂等 DDL；**数据迁移仍然每次都按判据检查**（如旧库识别）。
 */
export const MOBILE_SCHEMA_VERSION = 5; // 261024：+quick_note_tags（小记标签目录，随小记 Manifest 同步）；261023：+ai_conversations（AI 历史对话索引，设备本地）

/**
 * 读当前库的 schema 版本（PRAGMA user_version；空库 = 0）。
 *
 * ⚠️ 必须走 `db.pragma()` 而**不是** `db.prepare(...).get()`：sql.js 下后者不会释放语句，
 * 紧接着的 DDL `exec` 会报 "database table is locked"（261021 单测当场抓到）。
 */
export async function readMobileSchemaVersion(db: MobileDb): Promise<number> {
  try {
    const rows = (await db.pragma("PRAGMA user_version")) as unknown;
    if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === "object" && rows[0]) {
      return Number((rows[0] as Record<string, unknown>).user_version ?? 0);
    }
    if (rows && typeof rows === "object" && !Array.isArray(rows)) {
      return Number((rows as Record<string, unknown>).user_version ?? 0);
    }
    return 0;
  } catch {
    return 0;
  }
}

/** 单条 schema 语句；`optional` = 环境不支持时（如 sql.js 无 FTS5）可忽略。 */
export interface SchemaStatement {
  statement: string;
  values?: unknown[];
  optional?: boolean;
}

/** 第一阶段：不依赖任何读操作的建表。必须覆盖第二阶段所有 ALTER 的目标表。 */
export function baseSchemaStatements(): SchemaStatement[] {
  const statements: SchemaStatement[] = [];
  const push = (statement: string): void => { statements.push({ statement }); };

  push(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    content_hash TEXT,
    sync_state TEXT NOT NULL DEFAULT 'local',
    is_conflict INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    doc_kind TEXT NOT NULL DEFAULT 'doc'
  )`);
  push(`CREATE TABLE IF NOT EXISTS deleted_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    node_type TEXT NOT NULL DEFAULT 'note',
    purged_at TEXT,
    published_at TEXT
  )`);
  push(`CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL,
    node_type TEXT NOT NULL,
    icon TEXT,
    updated_at TEXT NOT NULL,
    trashed_at TEXT,
    deleted_from_parent_id TEXT,
    sync_state TEXT NOT NULL DEFAULT 'synced'
  )`);
  push(`CREATE TABLE IF NOT EXISTS device_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  push(`CREATE TABLE IF NOT EXISTS quick_notes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    image_count INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'local',
    is_conflict INTEGER NOT NULL DEFAULT 0,
    restore_pending_at TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    tag_ids_json TEXT NOT NULL DEFAULT '[]',
    first_image TEXT,
    list_metadata_version INTEGER NOT NULL DEFAULT 0
  )`);
  // 标签目录（261024）：名称/排序/置顶/墓碑；小记正文只存 tagIds。
  push(`CREATE TABLE IF NOT EXISTS quick_note_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`);
  push(`CREATE TABLE IF NOT EXISTS sync_base (
    note_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    last_synced_meta_at TEXT,
    last_uploaded_hash TEXT
  )`);
  push(`CREATE TABLE IF NOT EXISTS declared_assets (
    note_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY(note_id, filename)
  )`);
  push(`CREATE TABLE IF NOT EXISTS note_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    refs_json TEXT NOT NULL DEFAULT '[]',
    ref_count INTEGER NOT NULL DEFAULT 0,
    protected_until TEXT
  )`);
  push(`CREATE TABLE IF NOT EXISTS orphan_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    detected_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  push("CREATE TABLE IF NOT EXISTS s3_gc_pending (key TEXT PRIMARY KEY, marked_at TEXT NOT NULL)");
  push(`CREATE TABLE IF NOT EXISTS s3_gc_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    key TEXT NOT NULL,
    reason TEXT NOT NULL,
    commit_id TEXT,
    device_id TEXT,
    ok INTEGER NOT NULL
  )`);
  return statements;
}

/** 第二阶段：需要读状态的语句（加列 / FTS 重建 / 种子 / 小记 schema 增量）。 */
export async function collectSchemaStatements(db: MobileDb): Promise<SchemaStatement[]> {
  const statements: SchemaStatement[] = [];
  const push = (statement: string, extra: { optional?: boolean } = {}): void => {
    statements.push(extra.optional ? { statement, optional: true } : { statement });
  };

  const noteColumns = (
    (await db.prepare("PRAGMA table_info(notes)").all()) as Array<{ name: string }>
  ).map((column) => column.name);
  const addNoteColumn = (name: string, declaration: string): void => {
    if (!noteColumns.includes(name)) push(`ALTER TABLE notes ADD COLUMN ${name} ${declaration}`);
  };
  addNoteColumn("parent_id", "TEXT");
  addNoteColumn("sort_order", "INTEGER NOT NULL DEFAULT 0");
  addNoteColumn("content_hash", "TEXT");
  addNoteColumn("sync_state", "TEXT NOT NULL DEFAULT 'local'");
  addNoteColumn("is_conflict", "INTEGER NOT NULL DEFAULT 0");
  addNoteColumn("deleted_at", "TEXT");
  addNoteColumn("trashed_at", "TEXT");
  addNoteColumn("deleted_from_parent_id", "TEXT");
  addNoteColumn("restore_pending_at", "TEXT");
  addNoteColumn("is_locked", "INTEGER NOT NULL DEFAULT 0");
  addNoteColumn("locked_at", "TEXT");
  addNoteColumn("icon", "TEXT");
  // 文档类型（doc | usheet | bitable | board | ink）：与桌面 notes.kind 对应，随 manifest 同步
  addNoteColumn("doc_kind", "TEXT NOT NULL DEFAULT 'doc'");
  addNoteColumn("text_cache", "TEXT");

  // 全文搜索 v2：FTS5 + unicode61（中文单字预分词，src/core/search）。旧库若为 trigram 则重建。
  const ftsRow = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notes_fts'").get() as { sql: string | null } | undefined;
  if (ftsRow?.sql && !ftsRow.sql.includes("unicode61")) {
    push("DROP TABLE notes_fts", { optional: true });
    push("DROP TABLE IF EXISTS search_index", { optional: true });
  }
  // 测试环境 sql.js 无 FTS5 模块 → 跳过虚拟表（生产 SQLCipher 有；searchIndex 会按 sqlite_master 探测）。
  push("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, tokenize='unicode61')", { optional: true });
  push(
    "CREATE TABLE IF NOT EXISTS search_index (" +
    "note_id TEXT PRIMARY KEY, " +
    "fts_rowid INTEGER NOT NULL, " +
    "title TEXT NOT NULL, " +
    "raw_hash TEXT, " +
    "title_hash TEXT NOT NULL, " +
    "body_hash TEXT NOT NULL, " +
    "indexed_at TEXT NOT NULL)",
  );
  push("CREATE UNIQUE INDEX IF NOT EXISTS idx_search_index_rowid ON search_index(fts_rowid)");

  const deletedColumns = (
    (await db.prepare("PRAGMA table_info(deleted_notes)").all()) as Array<{ name: string }>
  ).map((column) => column.name);
  if (!deletedColumns.includes("node_type")) {
    push("ALTER TABLE deleted_notes ADD COLUMN node_type TEXT NOT NULL DEFAULT 'note'");
  }
  if (!deletedColumns.includes("purged_at")) {
    push("ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT");
  }
  if (!deletedColumns.includes("published_at")) {
    push("ALTER TABLE deleted_notes ADD COLUMN published_at TEXT");
  }

  const folderColumns = (
    (await db.prepare("PRAGMA table_info(folders)").all()) as Array<{ name: string }>
  ).map((column) => column.name);
  if (!folderColumns.includes("sync_state")) {
    push("ALTER TABLE folders ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'synced'");
  }

  for (const statement of await buildQuickNotesSyncSchemaStatements(db)) push(statement);
  // 列表/树/小记时间线的最小索引集合（261022 代码 review P1-3）；列必须在上面的 ALTER 之后建索引。
  push("CREATE INDEX IF NOT EXISTS idx_notes_active_parent_sort ON notes(parent_id, sort_order) WHERE trashed_at IS NULL");
  push("CREATE INDEX IF NOT EXISTS idx_notes_active_updated ON notes(updated_at DESC) WHERE trashed_at IS NULL");
  push("CREATE INDEX IF NOT EXISTS idx_folders_active_parent_sort ON folders(parent_id, sort_order) WHERE trashed_at IS NULL");
  push("CREATE INDEX IF NOT EXISTS idx_quick_notes_active_updated ON quick_notes(updated_at DESC, id DESC) WHERE deleted_at IS NULL");
  // 小记独立 FTS（与文档 notes_fts 分开；quick_notes 不在 notes 表，不能共用 join）。
  push("CREATE VIRTUAL TABLE IF NOT EXISTS quick_notes_fts USING fts5(body, tags, tokenize='unicode61')", { optional: true });
  push(
    "CREATE TABLE IF NOT EXISTS quick_notes_search_index (" +
    "quick_note_id TEXT PRIMARY KEY, " +
    "fts_rowid INTEGER NOT NULL, " +
    "content_hash TEXT NOT NULL, " +
    "text_cache TEXT NOT NULL, " +
    "tags TEXT NOT NULL, " +
    "indexed_at TEXT NOT NULL)",
  );
  push("CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_notes_search_rowid ON quick_notes_search_index(fts_rowid)");

  let seeded: { value?: string } | undefined;
  try {
    seeded = await db.prepare("SELECT value FROM device_state WHERE key='seed_initialized'").get() as { value?: string } | undefined;
  } catch {
    seeded = undefined; // 空库/刚建表：按未种子处理（INSERT OR IGNORE 本身幂等）
  }
  if (!seeded) {
    statements.push({
      statement: `INSERT OR IGNORE INTO folders
        (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state)
       VALUES (?,?,NULL,0,'notebook',NULL,?,'synced')`,
      values: ["notebook-personal", "个人笔记", new Date().toISOString()],
    });
    statements.push({
      statement: "INSERT INTO device_state(key,value) VALUES('seed_initialized','1') ON CONFLICT(key) DO NOTHING",
    });
  }

  // AI 历史对话索引（261023）：消息正文/资料快照在 files/ai/conversations/{id}.json，这里只存列表与搜索所需的元数据。
  push(`CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    preview TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    docs_json TEXT NOT NULL DEFAULT '[]'
  )`);
  push("CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at DESC)");
  push("CREATE INDEX IF NOT EXISTS idx_note_history_note ON note_history(note_id, created_at DESC)");
  push("CREATE UNIQUE INDEX IF NOT EXISTS idx_orphan_path ON orphan_assets(file_path)");
  return statements;
}

/** 批量下发：原生端 executeSet 一次桥往返（单事务）；无 executeSet（测试 sql.js）或批里有可选语句失败时逐条兜底。 */
async function execSchemaStatements(db: MobileDb, statements: SchemaStatement[]): Promise<void> {
  if (statements.length === 0) return;
  if (db.executeSet) {
    try {
      await db.executeSet(statements.map((item) => ({ statement: item.statement, values: item.values ?? [] })));
      return;
    } catch {
      // 例如 sql.js 没有 FTS5 模块：整批回滚 ⇒ 退逐条，只对 optional 语句容错（真实错误照旧抛）。
    }
  }
  for (const item of statements) {
    try {
      await db.exec(item.statement);
    } catch (error) {
      if (!item.optional) throw error;
    }
  }
}

/** Apply idempotent mobile schema migrations and first-run seed data. */
export async function applyMobileSchema(db: MobileDb): Promise<void> {
  // 快路径（261021）：版本已到 ⇒ 建表/加列/索引全部跳过（冷启动省 ~2.4s）。
  if ((await readMobileSchemaVersion(db)) >= MOBILE_SCHEMA_VERSION) return;

  try {
    await db.pragma("PRAGMA foreign_keys = ON");
  } catch {
    // Older databases or constrained environments may not support the pragma.
  }
  // 两批 = 两次桥往返：先底表（条件读必须先有表），再条件语句 + 种子。
  await execSchemaStatements(db, baseSchemaStatements());
  await execSchemaStatements(db, await collectSchemaStatements(db));
  // 全部 DDL 成功后才写版本（失败下次仍会重放，幂等）。
  await db.exec(`PRAGMA user_version = ${MOBILE_SCHEMA_VERSION}`);
}
