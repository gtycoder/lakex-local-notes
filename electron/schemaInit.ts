import type { DbLike } from "./dbLike.js";
import { WELCOME_NOTE_BODY } from "../src/core/lakeDocForm.js";
import {
  NOTES_SEARCH_LEDGER_ROWID_INDEX,
  NOTES_SEARCH_LEDGER_TABLE,
  SEARCH_LEDGER_COLUMN,
  notesFtsDDL,
  searchLedgerDDL,
  searchLedgerRowidIndexDDL,
} from "../src/core/search/schema.js";

function nowIso(): string {
  return new Date().toISOString();
}

/** 初始化上下文：DB + 回调（由 Store 装配）。 */
export interface SchemaInitContext {
  db: DbLike;
  workspaceId: string;
  trashNotebookId: string;
  defaultNotebookId: string;
  nextSortOrder: (parentId: string | null) => number;
  atomicWrite: (filePath: string, data: string) => void;
  notePathFor: (noteId: string) => string;
}

/**
 * schema 初始化 + 首次种子。
 * migrate 每次 Store 构造幂等执行：建表（**当前完整 DDL**）→ 容器/种子初始化；
 * 不再做旧库逐列补列 / 旧 trigram 重建 / 旧模型 notes→tree 迁移（AGENTS §3 #7：不做旧数据兼容）。
 * seed 仅在 notes 全空时写欢迎笔记（固定 id 跨端一致）。
 */
export class SchemaInit {
  private readonly ctx: SchemaInitContext;

  constructor(ctx: SchemaInitContext) {
    this.ctx = ctx;
  }

  migrate() {
    this.ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT,
        sort_order INTEGER NOT NULL, updated_at TEXT NOT NULL,
        is_conflict INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        kind TEXT NOT NULL DEFAULT 'doc',
        is_locked INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        md_cache TEXT,
        text_cache TEXT,
        restore_pending_at TEXT,
        trashed_at TEXT,
        deleted_from_parent_id TEXT,
        is_purged INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0,
        cloud_deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tree_nodes (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT,
        node_type TEXT NOT NULL CHECK(node_type IN ('notebook','group','note')),
        title TEXT NOT NULL, note_file_id TEXT, sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        is_conflict INTEGER NOT NULL DEFAULT 0,
        icon TEXT,
        trashed_at TEXT,
        deleted_from_parent_id TEXT,
        is_purged INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0,
        cloud_deleted INTEGER NOT NULL DEFAULT 0,
        CHECK((node_type IN ('notebook','group') AND note_file_id IS NULL) OR (node_type = 'note' AND note_file_id IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_tree_nodes_parent ON tree_nodes(workspace_id,parent_id,deleted_at,sort_order);
      CREATE INDEX IF NOT EXISTS idx_tree_nodes_note_file ON tree_nodes(note_file_id);
      CREATE TABLE IF NOT EXISTS orphan_assets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id     TEXT NOT NULL,
        filename    TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        size        INTEGER NOT NULL,
        mime_type   TEXT NOT NULL,
        detected_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orphan_path ON orphan_assets(file_path);
      -- 261029 Del-6：manifest 时代的两张死账本已删除——declared_assets（「本机已声明资产」；v3 声明是
      -- 每篇一份的内容寻址对象，从不写它）与 sync_base（v2 hash 账本；v3 基线在 sync-v3/baseline.json.gz，
      -- 诊断改为直接对拍该基线，从云端拉回正文也不再回写）。桌面已无任何生产读写点；
      -- 旧库残留空表无害，不为旧数据写迁移/清理（AGENTS §3#7）。
      CREATE TABLE IF NOT EXISTS deleted_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        node_type TEXT NOT NULL DEFAULT 'note',
        purged_at TEXT
      );
      -- 文档历史快照（纯本地，不参与同步）。refs_json=该快照引用的资源文件名清单。
      -- 不设 UNIQUE(note_id,content_hash)：恢复/回退同内容会再次出现，UNIQUE 会让
      -- "恢复前留档"被静默跳过（P0-2）。去重改为 24h 时间窗口防抖 + 恢复强制写。
      CREATE TABLE IF NOT EXISTS note_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        size INTEGER NOT NULL,
        refs_json TEXT NOT NULL,
        ref_count INTEGER NOT NULL,
        protected_until TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_note_history_note ON note_history(note_id, created_at DESC);
      -- S3 GC：删除审计日志（v3 深清理真实写入；manifest 时代的 s3_gc_pending 待回收表已删）
      CREATE TABLE IF NOT EXISTS s3_gc_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        action TEXT NOT NULL,
        key TEXT NOT NULL,
        reason TEXT NOT NULL,
        commit_id TEXT,
        device_id TEXT,
        ok INTEGER NOT NULL
      );
    `);

    // M2 全文搜索 v2：FTS5 + unicode61；中文按单字预分词（src/core/search），任意长度查询都可走索引。
    // CORE-13：分词器/表名/列片段/索引名统一来自 src/core/search/schema.ts（与移动端同一份字符串来源）。
    this.ctx.db.exec(notesFtsDDL());
    this.ctx.db.exec(
      searchLedgerDDL(NOTES_SEARCH_LEDGER_TABLE, [
        SEARCH_LEDGER_COLUMN.noteId,
        SEARCH_LEDGER_COLUMN.ftsRowid,
        SEARCH_LEDGER_COLUMN.titleHash,
        SEARCH_LEDGER_COLUMN.bodyHash,
        SEARCH_LEDGER_COLUMN.indexedAt,
      ]),
    );
    this.ctx.db.exec(searchLedgerRowidIndexDDL(NOTES_SEARCH_LEDGER_ROWID_INDEX, NOTES_SEARCH_LEDGER_TABLE));

    // 轻量列迁移：不写历史数据兼容，只补新列默认值（旧值由调用方决定）。
    for (const [table, column, ddl] of [
      ["notes", "is_purged", "ALTER TABLE notes ADD COLUMN is_purged INTEGER NOT NULL DEFAULT 0"],
      ["tree_nodes", "is_purged", "ALTER TABLE tree_nodes ADD COLUMN is_purged INTEGER NOT NULL DEFAULT 0"],
      ["notes", "is_dirty", "ALTER TABLE notes ADD COLUMN is_dirty INTEGER NOT NULL DEFAULT 0"],
      ["tree_nodes", "is_dirty", "ALTER TABLE tree_nodes ADD COLUMN is_dirty INTEGER NOT NULL DEFAULT 0"],
      // v3 remotePurged（远端已彻底删除、本机保留回收站副本）的 UI 标记；独立于 is_purged
      //（is_purged = 本地/他端彻底删除的抑制位，cloud_deleted = 「云端已删除 · 仅本地」）。
      ["notes", "cloud_deleted", "ALTER TABLE notes ADD COLUMN cloud_deleted INTEGER NOT NULL DEFAULT 0"],
      ["tree_nodes", "cloud_deleted", "ALTER TABLE tree_nodes ADD COLUMN cloud_deleted INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      const cols = this.ctx.db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) this.ctx.db.exec(ddl);
    }
    // 迁移：sync_state 已由 is_dirty/is_purged 替代；先删旧触发器再删列（无数据回填）。
    for (const table of ["notes", "tree_nodes"] as const) {
      this.ctx.db.exec(`DROP TRIGGER IF EXISTS ${table}_dirty_insert; DROP TRIGGER IF EXISTS ${table}_dirty_update; DROP TRIGGER IF EXISTS ${table}_clean_synced; DROP TRIGGER IF EXISTS ${table}_clean_purged;`);
      const cols = this.ctx.db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === "sync_state")) this.ctx.db.exec("ALTER TABLE " + table + " DROP COLUMN sync_state");
    }
    // Del-6（261029）：墓碑发布记账从「逐行 published_at」改为**单一水线**（device_state）：
    //   - 键 tombstones_published_at = 上次成功同步完成时间（desktopSync 成功后写入）；
    //   - 待同步判据 = deleted_at > 水线（见 electron/syncReconciliation.ts）；
    //   - 首次升级：水线 = COALESCE(MAX(published_at),'0')，保留尚未发布旧行的 pending 语义；
    //   - 迁移完直接删列（SQLite ≥3.35；Electron 44 / better-sqlite3 13 均满足）。
    {
      const tombCols = this.ctx.db.prepare("PRAGMA table_info(deleted_notes)").all() as Array<{ name: string }>;
      const hasPublishedAt = tombCols.some((c) => c.name === "published_at");
      const existing = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='tombstones_published_at'").get() as { value: string } | undefined;
      if (!existing) {
        const legacyRow = hasPublishedAt
          ? (this.ctx.db.prepare("SELECT COALESCE(MAX(published_at),'0') AS m FROM deleted_notes").get() as { m: string | null })
          : undefined;
        this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('tombstones_published_at',?)").run(legacyRow?.m || "0");
      }
      if (hasPublishedAt) this.ctx.db.exec("ALTER TABLE deleted_notes DROP COLUMN published_at");
    }

    const now = nowIso();
    // 回收站笔记本：固定 ID 每端本地初始化；侧栏/搜索/同步 folder 全部排除。唯一机制容器，不可删。
    this.ctx.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,is_dirty,is_conflict)
      VALUES(?,?,?,?,?,NULL,0,?,?,NULL,0,0)`).run(this.ctx.trashNotebookId, this.ctx.workspaceId, null, "notebook", "回收站", now, now);
    // 种子笔记本：仅全新库首次初始化自动创建一个普通笔记本（固定 ID 仅为多端首启同步一致）。
    // 行为与用户手动创建的笔记本完全相同——可删/改名/purge、无任何默认/特殊地位；
    // seed_initialized 标记保证用户删除（含 purge）后**不复活**。
    const seeded = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='seed_initialized'").get() as { value: string } | undefined;
    if (!seeded) {
      this.ctx.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,is_dirty,is_conflict)
        VALUES(?,?,?,?,?,NULL,0,?,?,NULL,1,0)`).run(this.ctx.defaultNotebookId, this.ctx.workspaceId, null, "notebook", "个人笔记", now, now);

      this.ctx.db.prepare("INSERT INTO device_state(key,value) VALUES('seed_initialized','1')").run();
    }
  }

  seed() {
    const count = this.ctx.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    if (count.c === 0) {
      // 欢迎笔记用固定 id：全设备一致，S3 同步时不会产生重复
      const id = "welcome-note";
      const parent = this.ctx.defaultNotebookId;
      const updatedAt = nowIso();
      const sortOrder = this.ctx.nextSortOrder(parent);
      const content = WELCOME_NOTE_BODY;
      const tx = this.ctx.db.transaction(() => {
        this.ctx.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,is_dirty) VALUES(?,?,?,?,?,1)")
          .run(id, "欢迎来到 LakexLocalNotes", parent, sortOrder, updatedAt);
        this.ctx.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,1,0)")
          .run(id, this.ctx.workspaceId, parent, "欢迎来到 LakexLocalNotes", id, sortOrder, updatedAt, updatedAt);
        this.ctx.atomicWrite(this.ctx.notePathFor(id), content);
      });
      tx();
    }
  }
}
