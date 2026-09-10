import { sha256Sync } from "../core/sha256Sync.js";
import { applyQuickNotesSyncSchema } from "./quickNotesDbPort.js";
import { SqlJsAsyncDb, type DbLike } from "./sqliteDb.js";

/** Apply idempotent mobile schema migrations and first-run seed data. */
export async function applyMobileSchema(db: DbLike): Promise<void> {
  try {
    db.exec("PRAGMA foreign_keys = ON");
  } catch {
    // Older databases or constrained environments may not support the pragma.
  }

  db.exec(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    content_hash TEXT,
    sync_state TEXT NOT NULL DEFAULT 'local',
    is_conflict INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT
  )`);
  const noteColumns = (
    db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>
  ).map((column) => column.name);
  const addNoteColumn = (name: string, declaration: string) => {
    if (!noteColumns.includes(name)) {
      db.exec(`ALTER TABLE notes ADD COLUMN ${name} ${declaration}`);
    }
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

  const missingHashes = db.prepare(
    "SELECT id, content FROM notes WHERE content_hash IS NULL",
  ).all() as Array<{ id: string; content: string }>;
  for (const row of missingHashes) {
    db.prepare("UPDATE notes SET content_hash=? WHERE id=?").run(
      sha256Sync(new TextEncoder().encode(row.content)),
      row.id,
    );
  }

  db.exec(`CREATE TABLE IF NOT EXISTS sync_base (
    note_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    last_synced_meta_at TEXT,
    last_uploaded_hash TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS declared_assets (
    note_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY(note_id, filename)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS deleted_notes (
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
    db.prepare("PRAGMA table_info(deleted_notes)").all() as Array<{ name: string }>
  ).map((column) => column.name);
  if (!deletedColumns.includes("node_type")) {
    db.exec("ALTER TABLE deleted_notes ADD COLUMN node_type TEXT NOT NULL DEFAULT 'note'");
  }
  if (!deletedColumns.includes("purged_at")) {
    db.exec("ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT");
  }
  if (!deletedColumns.includes("published_at")) {
    db.exec("ALTER TABLE deleted_notes ADD COLUMN published_at TEXT");
  }

  db.exec(`CREATE TABLE IF NOT EXISTS folders (
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
    db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>
  ).map((column) => column.name);
  if (!folderColumns.includes("sync_state")) {
    db.exec("ALTER TABLE folders ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'synced'");
  }

  db.exec(`CREATE TABLE IF NOT EXISTS device_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS quick_notes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    preview_text TEXT NOT NULL,
    image_count INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'local',
    is_conflict INTEGER NOT NULL DEFAULT 0,
    restore_pending_at TEXT
  )`);
  await applyQuickNotesSyncSchema(new SqlJsAsyncDb(db));

  const seeded = db.prepare(
    "SELECT value FROM device_state WHERE key='seed_initialized'",
  ).get() as { value?: string } | undefined;
  if (!seeded) {
    db.prepare(
      `INSERT OR IGNORE INTO folders
        (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state)
       VALUES (?,?,NULL,0,'notebook',NULL,?,'synced')`,
    ).run("notebook-personal", "个人笔记", new Date().toISOString());
    db.prepare(
      "INSERT INTO device_state(key,value) VALUES('seed_initialized','1') ON CONFLICT(key) DO NOTHING",
    ).run();
  }

  db.exec(`CREATE TABLE IF NOT EXISTS note_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS orphan_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    detected_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orphan_path ON orphan_assets(file_path)");
  db.exec("CREATE TABLE IF NOT EXISTS s3_gc_pending (key TEXT PRIMARY KEY, marked_at TEXT NOT NULL)");
  db.exec(`CREATE TABLE IF NOT EXISTS s3_gc_log (
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
