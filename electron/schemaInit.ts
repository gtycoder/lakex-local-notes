import type { DbLike } from "./dbLike.js";
import { WELCOME_NOTE_BODY } from "../src/core/lakeDocForm.js";

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
        sync_state TEXT NOT NULL DEFAULT 'local', is_conflict INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        kind TEXT NOT NULL DEFAULT 'doc',
        is_locked INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        md_cache TEXT,
        text_cache TEXT,
        restore_pending_at TEXT,
        trashed_at TEXT,
        deleted_from_parent_id TEXT,
        is_purged INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tree_nodes (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT,
        node_type TEXT NOT NULL CHECK(node_type IN ('notebook','group','note')),
        title TEXT NOT NULL, note_file_id TEXT, sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'local', is_conflict INTEGER NOT NULL DEFAULT 0,
        icon TEXT,
        trashed_at TEXT,
        deleted_from_parent_id TEXT,
        is_purged INTEGER NOT NULL DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS declared_assets (
        note_id    TEXT NOT NULL,
        filename   TEXT NOT NULL,
        size       INTEGER NOT NULL,
        hash       TEXT NOT NULL,
        PRIMARY KEY(note_id, filename)
      );
      CREATE TABLE IF NOT EXISTS sync_base (
        note_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        last_synced_meta_at TEXT,
        last_uploaded_hash TEXT
      );
      CREATE TABLE IF NOT EXISTS deleted_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        node_type TEXT NOT NULL DEFAULT 'note',
        published_at TEXT,
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
      -- S3 GC：待回收清单（提示/审计；删除依据 = 差集重算）与删除审计日志
      CREATE TABLE IF NOT EXISTS s3_gc_pending (
        key TEXT PRIMARY KEY,
        marked_at TEXT NOT NULL
      );
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

    // M2 全文搜索 v2：FTS5 + unicode61；中文按单字预分词（src/core/search），任意长度查询都可走索引。（S2：不再做旧 trigram 重建）
    this.ctx.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, tokenize='unicode61')");
    this.ctx.db.exec(
      "CREATE TABLE IF NOT EXISTS search_index (" +
      "note_id TEXT PRIMARY KEY, " +
      "fts_rowid INTEGER NOT NULL, " +
      "title_hash TEXT NOT NULL, " +
      "body_hash TEXT NOT NULL, " +
      "indexed_at TEXT NOT NULL)"
    );
    this.ctx.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_search_index_rowid ON search_index(fts_rowid)");

    // 轻量列迁移：不写历史数据兼容，只补新列默认值（旧值由调用方决定）。
    for (const [table, column, ddl] of [
      ["notes", "is_purged", "ALTER TABLE notes ADD COLUMN is_purged INTEGER NOT NULL DEFAULT 0"],
      ["tree_nodes", "is_purged", "ALTER TABLE tree_nodes ADD COLUMN is_purged INTEGER NOT NULL DEFAULT 0"],
    ] as const) {
      const cols = this.ctx.db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) this.ctx.db.exec(ddl);
    }
    const now = nowIso();
    // 回收站笔记本：固定 ID 每端本地初始化；侧栏/搜索/同步 folder 全部排除。唯一机制容器，不可删。
    this.ctx.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
      VALUES(?,?,?,?,?,NULL,0,?,?,NULL,'synced',0)`).run(this.ctx.trashNotebookId, this.ctx.workspaceId, null, "notebook", "回收站", now, now);
    // 种子笔记本：仅全新库首次初始化自动创建一个普通笔记本（固定 ID 仅为多端首启同步一致）。
    // 行为与用户手动创建的笔记本完全相同——可删/改名/purge、无任何默认/特殊地位；
    // seed_initialized 标记保证用户删除（含 purge）后**不复活**。
    const seeded = this.ctx.db.prepare("SELECT value FROM device_state WHERE key='seed_initialized'").get() as { value: string } | undefined;
    if (!seeded) {
      this.ctx.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
        VALUES(?,?,?,?,?,NULL,0,?,?,NULL,'local',0)`).run(this.ctx.defaultNotebookId, this.ctx.workspaceId, null, "notebook", "个人笔记", now, now);

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
        this.ctx.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state) VALUES(?,?,?,?,?,'local')")
          .run(id, "欢迎来到 LocalLakexNotes", parent, sortOrder, updatedAt);
        this.ctx.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,'local',0)")
          .run(id, this.ctx.workspaceId, parent, "欢迎来到 LocalLakexNotes", id, sortOrder, updatedAt, updatedAt);
        this.ctx.atomicWrite(this.ctx.notePathFor(id), content);
      });
      tx();
    }
  }
}
