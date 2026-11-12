/**
 * 小记独立库的 **DDL 与一次性迁移**（261112 从 electron/quickNotes.ts 拆出）。
 *
 * 顺序不变量（**不要重排**）：
 *  1. 建表（quick_notes / assets / sync_base / deleted / conversions / file_ops）
 *  2. 建 FTS（quickNotesFtsDDL）+ 搜索账本（searchLedgerDDL; 与桌面文档账本、移动端同一份 DDL 来源）
 *  3. quick_note_deleted 补列 purged_at → 建 device_state → 水线回填（COALESCE(MAX(published_at))）→ 删旧列
 *  4. quick_notes 补列 restore_pending_at / is_dirty / cloud_deleted；quick_note_deleted 补 cloud_deleted
 *  5. 删遗留列 sync_state
 *
 * 全部用 `IF NOT EXISTS` / `PRAGMA table_info` 探测 ⇒ 可反复执行（每次启动都跑一遍）。
 */
import type { DbLike } from "../dbLike.js";
import {
  QUICK_NOTES_SEARCH_LEDGER_ROWID_INDEX,
  QUICK_NOTES_SEARCH_LEDGER_TABLE,
  SEARCH_LEDGER_COLUMN,
  quickNotesFtsDDL,
  searchLedgerDDL,
  searchLedgerRowidIndexDDL,
} from "../../src/core/search/schema.js";

export function migrateQuickNotesSchema(db: DbLike): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS quick_notes (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        preview_text TEXT NOT NULL,
        image_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        is_dirty INTEGER NOT NULL DEFAULT 0,
        is_conflict INTEGER NOT NULL DEFAULT 0,
        cloud_deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS quick_note_assets (
        id TEXT PRIMARY KEY,
        quick_note_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        size INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        FOREIGN KEY (quick_note_id) REFERENCES quick_notes(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_note_assets_file ON quick_note_assets(quick_note_id, filename);
      CREATE TABLE IF NOT EXISTS quick_note_sync_base (
        quick_note_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quick_note_deleted (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        conversion_target_note_id TEXT,
        ready_to_sync INTEGER NOT NULL DEFAULT 1,
        purged_at TEXT,
        cloud_deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS quick_note_conversions (
        source_quick_note_id TEXT PRIMARY KEY,
        target_note_id TEXT NOT NULL,
        target_notebook_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('prepared','target_created','source_deleted_waiting_sync','complete')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quick_note_file_ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL,
        quick_note_id TEXT NOT NULL,
        old_content_path TEXT,
        new_content_path TEXT,
        old_assets_path TEXT,
        new_assets_path TEXT,
        staging_key TEXT,
        content_hash TEXT,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_message TEXT
      );
    `);
  // 标签子系统（目录 + 关联）在各自的 store 里建表；这里只建小记自己的表。
  // V5 Phase 6：小记独立全文索引（与文档 notes_fts 分开，避免跨库 / tree_nodes join）。
  // body/tags 都由 src/core/search 的分词器预分词；ledger 保留 text_cache 供 buildSnippet。
  // CORE-13：与桌面文档账本、移动端同一份 DDL 字符串来源（src/core/search/schema.ts）。
  db.exec(quickNotesFtsDDL());
  db.exec(
    searchLedgerDDL(QUICK_NOTES_SEARCH_LEDGER_TABLE, [
      SEARCH_LEDGER_COLUMN.quickNoteId,
      SEARCH_LEDGER_COLUMN.ftsRowid,
      SEARCH_LEDGER_COLUMN.textHash,
      SEARCH_LEDGER_COLUMN.textCache,
      SEARCH_LEDGER_COLUMN.tags,
      SEARCH_LEDGER_COLUMN.indexedAt,
    ]),
  );
  db.exec(searchLedgerRowidIndexDDL(QUICK_NOTES_SEARCH_LEDGER_ROWID_INDEX, QUICK_NOTES_SEARCH_LEDGER_TABLE));
  const deletedCols = db.prepare("PRAGMA table_info(quick_note_deleted)").all() as Array<{ name: string }>;
  if (!deletedCols.some((c) => c.name === "purged_at")) {
    db.exec("ALTER TABLE quick_note_deleted ADD COLUMN purged_at TEXT");
  }
  // Del-6（261029）：墓碑发布记账从「逐行 published_at」改为**水线**（设备级标量）：
  //   小记库没有 device_state ⇒ 补建同形表；键 quick_tombstones_published_at = 上次成功同步完成时间；
  //   待同步判据 = deleted_at > 水线；首次升级 = COALESCE(MAX(published_at),'0')，随后删列。
  // 记录本身仍保留（供下载方向 LWW：墓碑 vs 远端恢复判定）。
  db.exec("CREATE TABLE IF NOT EXISTS device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const hasPublishedAt = deletedCols.some((c) => c.name === "published_at");
  const waterline = db.prepare("SELECT value FROM device_state WHERE key='quick_tombstones_published_at'").get() as { value: string } | undefined;
  if (!waterline) {
    const legacy = hasPublishedAt
      ? (db.prepare("SELECT COALESCE(MAX(published_at),'0') AS m FROM quick_note_deleted").get() as { m: string | null })
      : undefined;
    db.prepare("INSERT INTO device_state(key,value) VALUES('quick_tombstones_published_at',?)").run(legacy?.m || "0");
  }
  if (hasPublishedAt) db.exec("ALTER TABLE quick_note_deleted DROP COLUMN published_at");
  // 恢复标记（墓碑权威的显式例外）：restoreQuickNote 写入，markSynced 清除。
  const quickCols = db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>;
  if (!quickCols.some((c) => c.name === "restore_pending_at")) {
    db.exec("ALTER TABLE quick_notes ADD COLUMN restore_pending_at TEXT");
  }
  if (!quickCols.some((c) => c.name === "is_dirty")) {
    db.exec("ALTER TABLE quick_notes ADD COLUMN is_dirty INTEGER NOT NULL DEFAULT 0");
  }
  // v3 remotePurged 展示位（「云端已删除 · 仅本地」）：活动行与回收站墓碑各一份——
  // 远端删除的本地副本在回收站（quick_note_deleted），恢复后回到 quick_notes 才清标记。
  if (!quickCols.some((c) => c.name === "cloud_deleted")) {
    db.exec("ALTER TABLE quick_notes ADD COLUMN cloud_deleted INTEGER NOT NULL DEFAULT 0");
  }
  if (!deletedCols.some((c) => c.name === "cloud_deleted")) {
    db.exec("ALTER TABLE quick_note_deleted ADD COLUMN cloud_deleted INTEGER NOT NULL DEFAULT 0");
  }
  if (quickCols.some((c) => c.name === "sync_state")) {
    db.exec("ALTER TABLE quick_notes DROP COLUMN sync_state");
  }
}
