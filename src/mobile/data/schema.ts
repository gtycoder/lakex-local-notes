import { applyQuickNotesSyncSchema } from "./quickNotesDbPort.js";
import type { MobileDb } from "./sqliteDb.js";

/**
 * 移动端 SQLite schema。
 *
 * 261019 存储架构对齐桌面：**正文不再进 SQLite**（文档正文/小记正文/历史快照都是文件，见
 * src/core/noteBodyPaths.ts + native/bodyStore.ts），DB 只存元数据、hash、同步账本与**派生**文本缓存。
 *
 * 本阶段的存量数据策略（用户 261019 定稿）：开发数据可丢 ⇒ 检测到旧 schema（带 content 列）时
 * **整库用户数据重置一次**，不做逐行迁移；正文文件的旧目录（note-assets/quick-notes 等）由
 * bridge/context 的 resetLegacyBodyFiles() 清理。
 */

/** 旧库（正文在 SQLite）的识别：notes / quick_notes / note_history 任一还有 content 列。 */
export async function hasLegacyBodySchema(db: MobileDb): Promise<boolean> {
  for (const table of ["notes", "quick_notes", "note_history"]) {
    const columns = (await db.prepare(`PRAGMA table_info(${table})`).all()) as Array<{ name: string }>;
    if (columns.some((column) => column.name === "content")) return true;
  }
  return false;
}

/** 重置用户数据表（正文迁文件后不再有 content；旧正文直接丢弃，不迁移）。 */
async function dropLegacyUserTables(db: MobileDb): Promise<void> {
  const tables = [
    "notes_fts",
    "search_index",
    "notes",
    "folders",
    "sync_base",
    "declared_assets",
    "deleted_notes",
    "note_history",
    "orphan_assets",
    "s3_gc_pending",
    "s3_gc_log",
    "device_state",
    "quick_notes",
    "quick_note_deleted",
  ];
  for (const table of tables) await db.exec(`DROP TABLE IF EXISTS ${table}`);
}

/** Apply idempotent mobile schema migrations and first-run seed data. */
export async function applyMobileSchema(db: MobileDb): Promise<void> {
  try {
    await db.exec("PRAGMA foreign_keys = ON");
  } catch {
    // Older databases or constrained environments may not support the pragma.
  }

  if (await hasLegacyBodySchema(db)) await dropLegacyUserTables(db);

  await db.exec(`CREATE TABLE IF NOT EXISTS notes (
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
  const noteColumns = (
    (await db.prepare("PRAGMA table_info(notes)").all()) as Array<{ name: string }>
  ).map((column) => column.name);
  const addNoteColumn = async (name: string, declaration: string): Promise<void> => {
    if (!noteColumns.includes(name)) {
      await db.exec(`ALTER TABLE notes ADD COLUMN ${name} ${declaration}`);
    }
  };
  await addNoteColumn("parent_id", "TEXT");
  await addNoteColumn("sort_order", "INTEGER NOT NULL DEFAULT 0");
  await addNoteColumn("content_hash", "TEXT");
  await addNoteColumn("sync_state", "TEXT NOT NULL DEFAULT 'local'");
  await addNoteColumn("is_conflict", "INTEGER NOT NULL DEFAULT 0");
  await addNoteColumn("deleted_at", "TEXT");
  await addNoteColumn("trashed_at", "TEXT");
  await addNoteColumn("deleted_from_parent_id", "TEXT");
  await addNoteColumn("restore_pending_at", "TEXT");
  await addNoteColumn("is_locked", "INTEGER NOT NULL DEFAULT 0");
  await addNoteColumn("locked_at", "TEXT");
  await addNoteColumn("icon", "TEXT");
  // 文档类型（doc | usheet | bitable | board | ink）：与桌面 notes.kind 对应，随 manifest 同步
  await addNoteColumn("doc_kind", "TEXT NOT NULL DEFAULT 'doc'");
  await addNoteColumn("text_cache", "TEXT");

  // 全文搜索 v2：FTS5 + unicode61（中文单字预分词，src/core/search）。旧库若为 trigram 则重建。
  const ftsRow = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notes_fts'").get() as { sql: string | null } | undefined;
  if (ftsRow?.sql && !ftsRow.sql.includes("unicode61")) {
    try { await db.exec("DROP TABLE notes_fts"); } catch { /* ignore */ }
    try { await db.exec("DROP TABLE IF EXISTS search_index"); } catch { /* ignore */ }
  }
  // 测试环境 sql.js 无 FTS5 模块 → 跳过虚拟表（生产 SQLCipher 有；searchIndex 会按 sqlite_master 探测）。
  try { await db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, tokenize='unicode61')"); } catch { /* FTS5 unavailable */ }
  await db.exec(
    "CREATE TABLE IF NOT EXISTS search_index (" +
    "note_id TEXT PRIMARY KEY, " +
    "fts_rowid INTEGER NOT NULL, " +
    "title TEXT NOT NULL, " +
    "raw_hash TEXT, " +
    "title_hash TEXT NOT NULL, " +
    "body_hash TEXT NOT NULL, " +
    "indexed_at TEXT NOT NULL)"
  );
  await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_search_index_rowid ON search_index(fts_rowid)");

  await db.exec(`CREATE TABLE IF NOT EXISTS sync_base (
    note_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    last_synced_meta_at TEXT,
    last_uploaded_hash TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS declared_assets (
    note_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY(note_id, filename)
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS deleted_notes (
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
  const deletedColumns = (
    (await db.prepare("PRAGMA table_info(deleted_notes)").all()) as Array<{ name: string }>
  ).map((column) => column.name);
  if (!deletedColumns.includes("node_type")) {
    await db.exec("ALTER TABLE deleted_notes ADD COLUMN node_type TEXT NOT NULL DEFAULT 'note'");
  }
  if (!deletedColumns.includes("purged_at")) {
    await db.exec("ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT");
  }
  if (!deletedColumns.includes("published_at")) {
    await db.exec("ALTER TABLE deleted_notes ADD COLUMN published_at TEXT");
  }

  await db.exec(`CREATE TABLE IF NOT EXISTS folders (
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
  const folderColumns = (
    (await db.prepare("PRAGMA table_info(folders)").all()) as Array<{ name: string }>
  ).map((column) => column.name);
  if (!folderColumns.includes("sync_state")) {
    await db.exec("ALTER TABLE folders ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'synced'");
  }

  await db.exec(`CREATE TABLE IF NOT EXISTS device_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS quick_notes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    image_count INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'local',
    is_conflict INTEGER NOT NULL DEFAULT 0,
    restore_pending_at TEXT
  )`);
  await applyQuickNotesSyncSchema(db);

  const seeded = await db.prepare(
    "SELECT value FROM device_state WHERE key='seed_initialized'",
  ).get() as { value?: string } | undefined;
  if (!seeded) {
    await db.prepare(
      `INSERT OR IGNORE INTO folders
        (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state)
       VALUES (?,?,NULL,0,'notebook',NULL,?,'synced')`,
    ).run("notebook-personal", "个人笔记", new Date().toISOString());
    await db.prepare(
      "INSERT INTO device_state(key,value) VALUES('seed_initialized','1') ON CONFLICT(key) DO NOTHING",
    ).run();
  }

  // 历史快照：正文是 history/{noteId}/*.body.gz（gzip 文件），DB 只存路径/hash/引用账。
  // title 是移动端历史列表展示用的元数据（桌面列表不展示标题，但保留这一列不影响正文归属）。
  await db.exec(`CREATE TABLE IF NOT EXISTS note_history (
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
  await db.exec("CREATE INDEX IF NOT EXISTS idx_note_history_note ON note_history(note_id, created_at DESC)");
  await db.exec(`CREATE TABLE IF NOT EXISTS orphan_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    detected_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orphan_path ON orphan_assets(file_path)");
  await db.exec("CREATE TABLE IF NOT EXISTS s3_gc_pending (key TEXT PRIMARY KEY, marked_at TEXT NOT NULL)");
  await db.exec(`CREATE TABLE IF NOT EXISTS s3_gc_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    key TEXT NOT NULL,
    reason TEXT NOT NULL,
    commit_id TEXT,
    device_id TEXT,
    ok INTEGER NOT NULL
  )`);
}
