import type { DbLike } from "./dbLike.js";

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
 * schema 初始化/迁移 + 首次种子（原样迁移自 Store；REFACTOR：只搬家不改行为）。
 * migrate 每次 Store 构造幂等执行：建表 → 旧库补列 → 容器/种子初始化。
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
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tree_nodes (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT,
        node_type TEXT NOT NULL CHECK(node_type IN ('notebook','group','note')),
        title TEXT NOT NULL, note_file_id TEXT, sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        sync_state TEXT NOT NULL DEFAULT 'local', is_conflict INTEGER NOT NULL DEFAULT 0,
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
        last_synced_meta_at TEXT
      );
      CREATE TABLE IF NOT EXISTS deleted_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        node_type TEXT NOT NULL DEFAULT 'note',
        published_at TEXT
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
        ref_count INTEGER NOT NULL
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
    // 锁状态列（v3 同步元数据）：旧库无列时补齐
    const cols = this.ctx.db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "is_locked")) {
      this.ctx.db.exec("ALTER TABLE notes ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.some((c) => c.name === "locked_at")) {
      this.ctx.db.exec("ALTER TABLE notes ADD COLUMN locked_at TEXT");
    }
    // B3（冲突归档保护）：superseded 快照保护窗口（protected_until 未到不自动清理；手动删除不受限）
    const histCols = this.ctx.db.prepare("PRAGMA table_info(note_history)").all() as Array<{ name: string }>;
    if (!histCols.some((c) => c.name === "protected_until")) {
      this.ctx.db.exec("ALTER TABLE note_history ADD COLUMN protected_until TEXT");
    }
    // M1 文本缓存列：保存时由 Lake 内核生成的 markdown/纯文本（供导出资料包/复制MD/全文搜索）
    if (!cols.some((c) => c.name === "md_cache")) {
      this.ctx.db.exec("ALTER TABLE notes ADD COLUMN md_cache TEXT");
    }
    // M1.6 文档/分组自定义图标（**同步**：进 manifest icon 字段，两端 applyRemoteNoteMeta/listFoldersForSync；见 docs/STORAGE-LAYERS.md）
    const treeCols = this.ctx.db.prepare("PRAGMA table_info(tree_nodes)").all() as Array<{ name: string }>;
    if (!treeCols.some((c) => c.name === "icon")) {
      this.ctx.db.exec("ALTER TABLE tree_nodes ADD COLUMN icon TEXT");
    }
    // M2 全文搜索 v2：FTS5 + unicode61；中文按单字预分词（src/core/search），任意长度查询都可走索引。
    // 旧库若仍是 trigram，直接 DROP 重建（开发期数据可重建，AGENTS §3 #7/#10）。
    const ftsSql = (this.ctx.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notes_fts'").get() as { sql: string | null } | undefined)?.sql ?? "";
    if (ftsSql && !ftsSql.includes("unicode61")) {
      this.ctx.db.exec("DROP TABLE notes_fts");
      this.ctx.db.exec("DROP TABLE IF EXISTS search_index");
    }
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
    if (!cols.some((c) => c.name === "text_cache")) {
      this.ctx.db.exec("ALTER TABLE notes ADD COLUMN text_cache TEXT");
    }
    // P0-1：sync_base 记录"本机最后一次成功上传的 hash"，用于恢复后判定"远端是否本机传的"
    const baseCols = this.ctx.db.prepare("PRAGMA table_info(sync_base)").all() as Array<{ name: string }>;
    if (!baseCols.some((c) => c.name === "last_uploaded_hash")) {
      this.ctx.db.exec("ALTER TABLE sync_base ADD COLUMN last_uploaded_hash TEXT");
    }
    // 统一冲突语义（先同步者胜）：记录"本设备上次成功同步时该笔记的 updated_at"（元数据已确认版本）。
    // 下载对账据此判定远端元数据是否"新于本设备已确认版本"：是 → 应用远端（先同步者胜）；
    // 否 → 保留本地（在已确认基础上续编/改名不被远端旧值回滚）。与正文 baseHash、小记 baseHash 同构。
    if (!baseCols.some((c) => c.name === "last_synced_meta_at")) {
      this.ctx.db.exec("ALTER TABLE sync_base ADD COLUMN last_synced_meta_at TEXT");
    }
    const deletedCols = this.ctx.db.prepare("PRAGMA table_info(deleted_notes)").all() as Array<{ name: string }>;
    if (!deletedCols.some((c) => c.name === "purged_at")) {
      this.ctx.db.exec("ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT");
    }
    // node_type：区分 folder/group 墓碑（仅本地下载过滤，不进 manifest.notes）与 note 墓碑（发布 deleted:true）
    if (!deletedCols.some((c) => c.name === "node_type")) {
      this.ctx.db.exec("ALTER TABLE deleted_notes ADD COLUMN node_type TEXT NOT NULL DEFAULT 'note'");
    }
    // published_at：墓碑已发布到 manifest 的时间（NULL = 未发布，计入"待上传"）
    if (!deletedCols.some((c) => c.name === "published_at")) {
      this.ctx.db.exec("ALTER TABLE deleted_notes ADD COLUMN published_at TEXT");
    }
    // 恢复标记（墓碑权威的显式例外）：restoreTrashItem 写入，markSynced 清除。
    // 同步下载分支据此区分"被动编辑"（跟随删除）与"主动恢复"（local wins）。
    if (!cols.some((c) => c.name === "restore_pending_at")) {
      this.ctx.db.exec("ALTER TABLE notes ADD COLUMN restore_pending_at TEXT");
    }
    // TRASH-NOTEBOOK：回收站笔记本重构（删除=移动）。trashed_at=进入回收站时间（自动过期基准），
    // deleted_from_parent_id=删除前父目录（恢复位置，上云）。
    if (!cols.some((c) => c.name === "trashed_at")) {
      this.ctx.db.exec("ALTER TABLE notes ADD COLUMN trashed_at TEXT");
    }
    if (!cols.some((c) => c.name === "deleted_from_parent_id")) {
      this.ctx.db.exec("ALTER TABLE notes ADD COLUMN deleted_from_parent_id TEXT");
    }
    if (!treeCols.some((c) => c.name === "trashed_at")) {
      this.ctx.db.exec("ALTER TABLE tree_nodes ADD COLUMN trashed_at TEXT");
    }
    if (!treeCols.some((c) => c.name === "deleted_from_parent_id")) {
      this.ctx.db.exec("ALTER TABLE tree_nodes ADD COLUMN deleted_from_parent_id TEXT");
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
      // Migrate any notes not yet in tree_nodes（旧库升级兜底）
      this.ctx.db.prepare(`INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
        SELECT id,?,COALESCE(parent_id,?),'note',title,id,sort_order,updated_at,updated_at,deleted_at,sync_state,is_conflict
        FROM notes WHERE id NOT IN (SELECT id FROM tree_nodes)`).run(this.ctx.workspaceId, this.ctx.defaultNotebookId);
      this.ctx.db.prepare("UPDATE notes SET parent_id=? WHERE parent_id IS NULL").run(this.ctx.defaultNotebookId);
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
      const content =
        `<h1 id="welcome" class="ne-h1">欢迎来到 Lake Notes</h1><p id="welcome-body" class="ne-p">这是一个基于 Lake 编辑器的本地优先笔记应用（Electron 桌面端）。</p>`;
      const tx = this.ctx.db.transaction(() => {
        this.ctx.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state) VALUES(?,?,?,?,?,'local')")
          .run(id, "欢迎来到 Lake Notes", parent, sortOrder, updatedAt);
        this.ctx.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,'local',0)")
          .run(id, this.ctx.workspaceId, parent, "欢迎来到 Lake Notes", id, sortOrder, updatedAt, updatedAt);
        this.ctx.atomicWrite(this.ctx.notePathFor(id), content);
      });
      tx();
    }
  }
}
