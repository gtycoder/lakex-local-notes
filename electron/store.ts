import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import os from "node:os";
import { ASSET_PORT } from "./assetServer.js";
import { mdToHtml, wrapHtmlPage } from "../src/core/mdToHtml.js";
import { lakeHtmlToMarkdown, lakeHtmlToPlain } from "../src/core/lakeCaches.js";
import { createSilentLoggerScopes, type LoggerScopes } from "../src/core/logger.js";
import { AppError } from "../src/core/storeErrors.js";
import { extractAssetRefs, isSafePathSegment, sanitizeFileName, selectHistoryDrops } from "../src/core/storeUtils.js";
import { readNoteDigest, type NoteDigest } from "./storeQueries.js";
import { SearchRepository, type SearchResult } from "../src/core/searchRepository.js";
import { HistoryRepository, type HistorySnapshotPreview, type HistorySnapshotSummary } from "./historyRepository.js";
import { TrashRepository, type TrashItem, type TrashReminderItem } from "../src/core/trashRepository.js";
import { AssetRepository, type OrphanAsset, type OrphanAssetRow } from "./assetRepository.js";
import { NoteQueries, type NoteSummary, type SummaryRow, type SyncFolder, type SyncNote, type TreeNode, type TreeNodeRow } from "../src/core/noteQueries.js";
import { NoteMetadataRepository } from "./noteMetadataRepository.js";
import { NoteContentRepository, type NoteCacheInput } from "./noteContentRepository.js";
import { mimeTypeForFilename } from "../src/core/imageUtils.js";
import { createPlaintextSecretCipher, type SecretCipher } from "../src/core/secretCipher.js";
import type { DbLike } from "../src/core/dbLike.js";
import { ResourceRepository } from "./resourceRepository.js";
import { RemoteImportRepository } from "./remoteImportRepository.js";
import type { ResourceUploadOutput } from "./storeTypes.js";

export { ASSET_NAME_RE, extractAssetRefs, isoWeekKey, selectHistoryDrops, sanitizeFileName } from "../src/core/storeUtils.js";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_NOTEBOOK_ID = "notebook-personal";
/** 隐藏回收站笔记本（固定 ID，每端本地初始化、不同步 folder；软删 = 移入此处）。 */
export const TRASH_NOTEBOOK_ID = "notebook-trash";

export { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../src/core/storeLimits.js";

export { AppError } from "../src/core/storeErrors.js";

interface NoteDocument extends NoteSummary { content: string; }
interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}

/** 历史保留策略配置（P5，可配置；存 settings 表，纯本地） */
export interface HistorySettings {
  /** 每文档最多保留的快照份数（默认 100） */
  maxSnapshots: number;
  /** 快照保留天数兜底（默认 30） */
  retentionDays: number;
  /** 定期巡检清理间隔（小时，默认 24；0 = 关闭定期巡检） */
  cleanupIntervalHours: number;
  /** 自动快照间隔（分钟，默认 15；0 = 关闭自动快照） */
  snapshotIntervalMinutes: number;
}

/** 云同步开关与自动/手动同步策略（v4，可配置；存 settings 表，纯本地） */
export interface SyncSettings {
  /** 云同步总开关：false 时完全不执行任何 S3 后台任务/同步（纯本地）。 */
  enabled: boolean;
  /** 自动同步模式：interval=按间隔；onOpenClose=仅在开启/关闭时；manual=完全手动。 */
  autoMode: "interval" | "onOpenClose" | "manual";
  /** autoMode=interval 时的间隔分钟数（>=1）。 */
  autoIntervalMinutes: number;
}

/** S3 GC 保留策略配置（v4，可配置；存 settings 表，纯本地） */
export interface S3GcSettings {
  /** 待回收键保留窗口天数（默认 7） */
  gcRetentionDays: number;
  /** 定期对账周期小时数（默认 24） */
  gcIntervalHours: number;
  /** 回收站自动清空提醒天数（默认 0=关闭；仅提醒，不自动删） */
  trashAutoPurgeDays: number;
}

export interface HistoryCleanupResult {
  deletedSnapshots: number;
  freedBytes: number;
}
/** 仅供主进程内部的小记转换调用。sourcePath 绝不来自渲染进程。 */
export interface ImportedNoteAsset {
  filename: string;
  sourcePath: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

/**
 * W-3：资产服务器 URL 提取正则工厂。端口跟随 ASSET_PORT（LAKE_ASSET_PORT 可覆盖，
 * 多端同机双开），此前硬编码 19876 会在端口覆盖时让导出静默丢失全部图片。
 */
export function localAssetLakeSrcRe(port: number): RegExp {
  return new RegExp(`^http://127\\.0\\.0\\.1:${port}/([^/]+)/([^/]+)$`);
}
export function localAssetHtmlImgRe(port: number): RegExp {
  return new RegExp(`<img[^>]*src="(http://127\\.0\\.0\\.1:${port}/([^/]+)/([^/"\\s]+))"`, "g");
}
export function localAssetMdImgRe(port: number): RegExp {
  return new RegExp(`!\\[[^\\]]*\\]\\((http://127\\.0\\.0\\.1:${port}/([^/)]+)/([^/)]+))\\)`, "g");
}

export class Store {
  private db: DbLike;
  private root: string;
  private noteAssetsDir: string;
  /** 15 分钟自动快照的 dirty 集合（saveNote 落盘时标记，flush 后清空，内存态） */
  private historyDirty = new Set<string>();
  private searchRepository: SearchRepository;
  private historyRepository: HistoryRepository;
  private trashRepository: TrashRepository;
  private assetRepository: AssetRepository;
  private noteQueries: NoteQueries;
  private noteMetadata: NoteMetadataRepository;
  private noteContent: NoteContentRepository;
  private resourceRepository: ResourceRepository;
  private remoteImport: RemoteImportRepository;
  /** V5 Phase 2：密钥加解密注入点（桌面默认 = safeStorage，由 main.ts 装配） */
  private secretCipher: SecretCipher;
  /** V5 Phase 2：日志注入点（桌面默认 = electron-log，由 main.ts 装配；sync/quickNotes 经此读取） */
  readonly logScopes: LoggerScopes;

  constructor(root: string, secretCipher: SecretCipher = createPlaintextSecretCipher(), logScopes: LoggerScopes = createSilentLoggerScopes()) {
    this.root = root;
    this.secretCipher = secretCipher;
    this.logScopes = logScopes;
    this.noteAssetsDir = path.join(root, "note-assets");
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.mkdirSync(this.noteAssetsDir, { recursive: true });
    this.db = new Database(path.join(root, "metadata.sqlite3"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.historyRepository = new HistoryRepository(this.db, this.root);
    this.trashRepository = new TrashRepository(this.db, TRASH_NOTEBOOK_ID);
    this.noteQueries = new NoteQueries(this.db, DEFAULT_WORKSPACE_ID, TRASH_NOTEBOOK_ID);
    this.noteMetadata = new NoteMetadataRepository({
      db: this.db,
      workspaceId: DEFAULT_WORKSPACE_ID,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      uuid,
      nowIso,
      nextSortOrder: (parentId) => this.nextSortOrder(parentId),
      ensureParent: (parentId) => this.ensureParent(parentId),
      assertParentCompatible: (parentId, childType) => this.assertParentCompatible(parentId, childType),
      descendantIds: (id) => this.descendantIds(id),
      readTreeNode: (id) => this.readTreeNode(id),
      revivePurgedIfNeeded: (id) => this.revivePurgedIfNeeded(id),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
    });
    this.noteContent = new NoteContentRepository({
      db: this.db,
      notePathFor: (noteId) => this.notePath(noteId),
      atomicWrite: (filePath, content) => this.atomicWrite(filePath, content),
      revivePurgedIfNeeded: (noteId) => this.revivePurgedIfNeeded(noteId),
      createHistorySnapshot: (noteId, content, force) => this.createHistorySnapshot(noteId, content, force),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
      detectOrphans: (noteId, content) => this.detectOrphans(noteId, content),
      markHistoryDirty: (noteId) => this.markHistoryDirty(noteId),
    });
    this.resourceRepository = new ResourceRepository({
      noteAssetsDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      assetUrl: (noteId, filename) => this.assetUrl(noteId, filename),
      registerOrphan: (noteId, filename, size, mimeType) => this.registerOrphan(noteId, filename, size, mimeType),
    });
    this.remoteImport = new RemoteImportRepository({
      db: this.db,
      workspaceId: DEFAULT_WORKSPACE_ID,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      notePathFor: (noteId) => this.notePath(noteId),
      assetDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      isSafeSegment: isSafePathSegment,
      detectOrphans: (noteId, content) => this.detectOrphans(noteId, content),
      ensureNoteCaches: (noteId, content) => this.ensureNoteCaches(noteId, content),
      logImport: (noteId, bytes, assetCount, startedAt) => this.logScopes.store.info(`[perf] importRemoteNote ${noteId} ${Date.now() - startedAt}ms (lake=${bytes}B, assets=${assetCount})`),
    });
    this.assetRepository = new AssetRepository({
      db: this.db,
      notePathFor: (noteId) => this.notePath(noteId),
      extractAssetRefs,
    });
    this.searchRepository = new SearchRepository({
      db: this.db,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      ensureNoteCaches: (noteId) => this.ensureNoteCaches(noteId),
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
    });
    this.seed();
    // M2：全量重建全文索引（幂等；文档量小，启动开销可忽略）
    // V5 §5.7：启动耗时实测（100/1000/5000/10000 篇梯度；显著慢再考虑按需重建）
    const ftsStart = Date.now();
    try { this.searchRepository.rebuild(); } catch (error) {
      console.warn("[store] 全文索引重建失败（不影响使用）:", error);
    }
    console.info(`[perf] FTS rebuild ${Date.now() - ftsStart}ms`);
  }

  private migrate() {
    this.db.exec(`
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
    const cols = this.db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "is_locked")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.some((c) => c.name === "locked_at")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN locked_at TEXT");
    }
    // M1 文本缓存列：保存时由 Lake 内核生成的 markdown/纯文本（供导出资料包/复制MD/全文搜索）
    if (!cols.some((c) => c.name === "md_cache")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN md_cache TEXT");
    }
    // M1.6 文档/分组自定义图标（本地化，不进 manifest）
    const treeCols = this.db.prepare("PRAGMA table_info(tree_nodes)").all() as Array<{ name: string }>;
    if (!treeCols.some((c) => c.name === "icon")) {
      this.db.exec("ALTER TABLE tree_nodes ADD COLUMN icon TEXT");
    }
    // M2 全文搜索：FTS5 trigram（中文子串友好）。note_id UNINDEXED 用于关联删除。
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, note_id UNINDEXED, tokenize='trigram')`);
    if (!cols.some((c) => c.name === "text_cache")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN text_cache TEXT");
    }
    // P0-1：sync_base 记录"本机最后一次成功上传的 hash"，用于恢复后判定"远端是否本机传的"
    const baseCols = this.db.prepare("PRAGMA table_info(sync_base)").all() as Array<{ name: string }>;
    if (!baseCols.some((c) => c.name === "last_uploaded_hash")) {
      this.db.exec("ALTER TABLE sync_base ADD COLUMN last_uploaded_hash TEXT");
    }
    // 统一冲突语义（先同步者胜）：记录"本设备上次成功同步时该笔记的 updated_at"（元数据已确认版本）。
    // 下载对账据此判定远端元数据是否"新于本设备已确认版本"：是 → 应用远端（先同步者胜）；
    // 否 → 保留本地（在已确认基础上续编/改名不被远端旧值回滚）。与正文 baseHash、小记 baseHash 同构。
    if (!baseCols.some((c) => c.name === "last_synced_meta_at")) {
      this.db.exec("ALTER TABLE sync_base ADD COLUMN last_synced_meta_at TEXT");
    }
    const deletedCols = this.db.prepare("PRAGMA table_info(deleted_notes)").all() as Array<{ name: string }>;
    if (!deletedCols.some((c) => c.name === "purged_at")) {
      this.db.exec("ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT");
    }
    // node_type：区分 folder/group 墓碑（仅本地下载过滤，不进 manifest.notes）与 note 墓碑（发布 deleted:true）
    if (!deletedCols.some((c) => c.name === "node_type")) {
      this.db.exec("ALTER TABLE deleted_notes ADD COLUMN node_type TEXT NOT NULL DEFAULT 'note'");
    }
    // published_at：墓碑已发布到 manifest 的时间（NULL = 未发布，计入"待上传"）
    if (!deletedCols.some((c) => c.name === "published_at")) {
      this.db.exec("ALTER TABLE deleted_notes ADD COLUMN published_at TEXT");
    }
    // 恢复标记（墓碑权威的显式例外）：restoreTrashItem 写入，markSynced 清除。
    // 同步下载分支据此区分"被动编辑"（跟随删除）与"主动恢复"（local wins）。
    if (!cols.some((c) => c.name === "restore_pending_at")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN restore_pending_at TEXT");
    }
    // TRASH-NOTEBOOK：回收站笔记本重构（删除=移动）。trashed_at=进入回收站时间（自动过期基准），
    // deleted_from_parent_id=删除前父目录（恢复位置，上云）。
    if (!cols.some((c) => c.name === "trashed_at")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN trashed_at TEXT");
    }
    if (!cols.some((c) => c.name === "deleted_from_parent_id")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN deleted_from_parent_id TEXT");
    }
    if (!treeCols.some((c) => c.name === "trashed_at")) {
      this.db.exec("ALTER TABLE tree_nodes ADD COLUMN trashed_at TEXT");
    }
    if (!treeCols.some((c) => c.name === "deleted_from_parent_id")) {
      this.db.exec("ALTER TABLE tree_nodes ADD COLUMN deleted_from_parent_id TEXT");
    }
    const now = nowIso();
    this.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
      VALUES(?,?,?,?,?,NULL,0,?,?,NULL,'local',0)`).run(DEFAULT_NOTEBOOK_ID, DEFAULT_WORKSPACE_ID, null, "notebook", "个人笔记", now, now);
    // 回收站笔记本：固定 ID 每端本地初始化；侧栏/搜索/同步 folder 全部排除（与默认笔记本同法）。
    this.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
      VALUES(?,?,?,?,?,NULL,0,?,?,NULL,'synced',0)`).run(TRASH_NOTEBOOK_ID, DEFAULT_WORKSPACE_ID, null, "notebook", "回收站", now, now);
    // Migrate any notes not yet in tree_nodes
    this.db.prepare(`INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
      SELECT id,?,COALESCE(parent_id,?),'note',title,id,sort_order,updated_at,updated_at,deleted_at,sync_state,is_conflict
      FROM notes WHERE id NOT IN (SELECT id FROM tree_nodes)`).run(DEFAULT_WORKSPACE_ID, DEFAULT_NOTEBOOK_ID);
    this.db.prepare("UPDATE notes SET parent_id=? WHERE parent_id IS NULL").run(DEFAULT_NOTEBOOK_ID);
  }

  private seed() {
    const count = this.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    if (count.c === 0) {
      // 欢迎笔记用固定 id：全设备一致，S3 同步时不会产生重复
      const id = "welcome-note";
      const parent = DEFAULT_NOTEBOOK_ID;
      const updatedAt = nowIso();
      const sortOrder = this.nextSortOrder(parent);
      const content =
        `<h1 id="welcome" class="ne-h1">欢迎来到 Lake Notes</h1><p id="welcome-body" class="ne-p">这是一个基于 Lake 编辑器的本地优先笔记应用（Electron 桌面端）。</p>`;
      const tx = this.db.transaction(() => {
        this.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state) VALUES(?,?,?,?,?,'local')")
          .run(id, "欢迎来到 Lake Notes", parent, sortOrder, updatedAt);
        this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,'local',0)")
          .run(id, DEFAULT_WORKSPACE_ID, parent, "欢迎来到 Lake Notes", id, sortOrder, updatedAt, updatedAt);
        this.atomicWrite(this.notePath(id), content);
      });
      tx();
    }
  }

  private notePath(id: string): string {
    // 审计 #3/#17：校验下沉到路径构造本身——manifest（sync 导入）与 IPC（save/read）
    // 的 id 都可能来自外部，必须保证是安全单路径段，否则 ../ 可逃逸工作区
    if (!isSafePathSegment(id)) {
      throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    }
    return path.join(this.root, "notes", `${id}.lake`);
  }

  private atomicWrite(filePath: string, data: string) {
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, filePath);
  }

  private nextSortOrder(parentId: string | null): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM tree_nodes WHERE workspace_id=? AND parent_id IS ? AND deleted_at IS NULL"
    ).get(DEFAULT_WORKSPACE_ID, parentId) as { n: number };
    return row.n;
  }

  private ensureParent(parentId: string | null) {
    if (!parentId) return;
    const row = this.db.prepare("SELECT id FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(parentId);
    if (!row) throw new AppError("NotFound", `父节点不存在: ${parentId}`);
  }

  /** 树结构不变量：notebook 只能位于根层；note/group 必须位于某个节点下。
   * 支持多层嵌套：文档可包含分组/文档，分组可包含文档/分组（note/group 的父节点不限类型）。 */
  private assertParentCompatible(parentId: string | null, childType: string): void {
    if (parentId === TRASH_NOTEBOOK_ID) {
      throw new AppError("InvalidInput", "回收站是隐藏笔记本，不能直接作为父目录（删除请走删除操作）");
    }
    if (childType === "notebook") {
      if (parentId !== null) throw new AppError("InvalidInput", "笔记本只能位于根层");
      return;
    }
    if (parentId === null) throw new AppError("InvalidInput", "note/group 必须位于目录节点下");
    const parent = this.db.prepare("SELECT node_type FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(parentId) as { node_type: string } | undefined;
    if (!parent) throw new AppError("NotFound", `父节点不存在: ${parentId}`);
  }

  bootstrap() {
    const notes = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at FROM notes WHERE deleted_at IS NULL AND parent_id != ? ORDER BY sort_order"
    ).all(TRASH_NOTEBOOK_ID).map((r) => this.noteQueries.mapSummary(r as SummaryRow));
    const last = this.db.prepare("SELECT value FROM device_state WHERE key='last_opened_note_id'").get() as { value: string } | undefined;
    return {
      workspaceId: DEFAULT_WORKSPACE_ID,
      workspaceName: "Lake Notes 本地仓库",
      notes,
      lastOpenedNoteId: last?.value ?? null,
      sync: { phase: "idle", message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 },
    };
  }

  /** 侧栏树：排除隐藏回收站笔记本及其全部后代（trash 子树只出现在回收站面板）。 */
  listTreeNodes(): TreeNode[] {
    return this.noteQueries.listTreeNodes();
  }

  private readTreeNode(id: string): TreeNode {
    const row = this.db.prepare("SELECT * FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(id);
    if (!row) throw new AppError("NotFound", `节点不存在: ${id}`);
    return this.noteQueries.mapTreeNode(row as TreeNodeRow);
  }

  readNote(id: string): NoteDocument {
    const row = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at FROM notes WHERE id=? AND deleted_at IS NULL"
    ).get(id);
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const content = fs.readFileSync(this.notePath(id), "utf8");
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_opened_note_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);
    return { ...this.noteQueries.mapSummary(row as SummaryRow), content };
  }

  /** 轻量状态摘要：只读 DB 行（不读正文文件），供渲染进程在同步后判断打开 tab 是否需重载。
   * - 返回 null：笔记已被彻底删除（purge）或从未存在；
   * - deleted=true：软删除（回收站/远端删除墓碑已应用）；
   * - 否则 updatedAt/title 任一变化即代表正文或元数据被远端更新过。 */
  getNoteDigest(id: string): NoteDigest | null {
    return readNoteDigest(this.db, id, TRASH_NOTEBOOK_ID);
  }

  createNote(title: string): NoteDocument {
    return this.createNoteIn(DEFAULT_NOTEBOOK_ID, title);
  }

  createNoteIn(parentId: string | null, title: string): NoteDocument {
    const id = uuid();
    return this.createNoteInWithContent(parentId, title, `<p id="${id}-body" class="ne-p"><br></p>`, [], id, "bottom");
  }

  /**
   * 在指定目录的顶部创建正式笔记。它是目录排序的底层通用能力：未来普通“新建文档”
   * 也可选择 top / bottom；小记转换仅是第一个使用者。
   *
   * sourcePath 只允许由主进程内部传入，先复制并验证目标资源，再写入元数据。若进程
   * 在跨空间转换中断，调用方的 conversion journal 会负责识别并清理未登记的目标文件。
   */
  createNoteInAtTopWithContent(parentId: string, title: string, content: string, assets: ImportedNoteAsset[], id = uuid()): NoteDocument {
    return this.createNoteInWithContent(parentId, title, content, assets, id, "top");
  }

  private createNoteInWithContent(
    parentId: string | null,
    title: string,
    content: string,
    assets: ImportedNoteAsset[],
    id: string,
    position: "top" | "bottom",
  ): NoteDocument {
    const parent = parentId ?? DEFAULT_NOTEBOOK_ID;
    this.ensureParent(parent);
    this.assertParentCompatible(parent, "note");
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const normalizedTitle = title.trim() || "无标题文档";
    const updatedAt = nowIso();
    const sortOrder = position === "top" ? 0 : this.nextSortOrder(parent);
    const targetAssetsDir = this.noteAssetsDirFor(id);
    const targetNotePath = this.notePath(id);

    // 资源副本先完整落盘；任何失败都在写数据库前回收，保证源小记绝不被影响。
    try {
      if (assets.length > 0) fs.mkdirSync(targetAssetsDir, { recursive: true });
      for (const asset of assets) {
        if (!isSafePathSegment(asset.filename)) throw new AppError("InvalidInput", `无效的资源文件名: ${asset.filename}`);
        if (!fs.existsSync(asset.sourcePath) || !fs.statSync(asset.sourcePath).isFile()) {
          throw new AppError("NotFound", `转换资源不存在: ${asset.filename}`);
        }
        const destination = path.join(targetAssetsDir, asset.filename);
        if (fs.existsSync(destination)) throw new AppError("InvalidInput", `目标资源重名: ${asset.filename}`);
        const temporary = `${destination}.tmp-${process.pid}`;
        fs.copyFileSync(asset.sourcePath, temporary);
        fs.renameSync(temporary, destination);
      }
      this.atomicWrite(targetNotePath, content);
      const tx = this.db.transaction(() => {
        if (position === "top") {
          // 同一事务内挪开所有同级节点和笔记元数据，避免排序重叠与 IPC 中断窗口。
          this.db.prepare("UPDATE tree_nodes SET sort_order=sort_order+1,updated_at=?,sync_state='local' WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL")
            .run(updatedAt, DEFAULT_WORKSPACE_ID, parent);
          this.db.prepare("UPDATE notes SET sort_order=sort_order+1,updated_at=?,sync_state='local' WHERE parent_id=? AND deleted_at IS NULL")
            .run(updatedAt, parent);
        }
        this.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state) VALUES(?,?,?,?,?,'local')")
          .run(id, normalizedTitle, parent, sortOrder, updatedAt);
        this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,'local',0)")
          .run(id, DEFAULT_WORKSPACE_ID, parent, normalizedTitle, id, sortOrder, updatedAt, updatedAt);
      });
      tx();
    } catch (error) {
      // 本地原子性边界：元数据未成功时回收目标半成品；若元数据已成功，绝不误删。
      const exists = this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(id);
      if (!exists) {
        try { fs.rmSync(targetNotePath, { force: true }); } catch { /* best effort */ }
        try { fs.rmSync(targetAssetsDir, { force: true, recursive: true }); } catch { /* best effort */ }
      }
      throw error;
    }
    return { id, title: normalizedTitle, parentId: parent, sortOrder, updatedAt, syncState: "local", isConflict: false, content };
  }

  /** conversion journal 崩溃恢复使用：仅删除没有元数据登记的目标残留。 */
  removeUntrackedNoteArtifacts(id: string): void {
    if (!isSafePathSegment(id)) return;
    const exists = this.db.prepare("SELECT 1 FROM notes WHERE id=? AND deleted_at IS NULL").get(id);
    if (exists) return;
    try { fs.rmSync(this.notePath(id), { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(this.noteAssetsDirFor(id), { force: true, recursive: true }); } catch { /* best effort */ }
  }

  hasNote(id: string): boolean {
    if (!isSafePathSegment(id)) return false;
    return !!this.db.prepare("SELECT 1 FROM notes WHERE id=? AND deleted_at IS NULL").get(id);
  }

  createNotebook(title: string): TreeNode {
    return this.noteMetadata.createNotebook(title);
  }

  createGroup(parentId: string, title: string): TreeNode {
    return this.noteMetadata.createGroup(parentId, title);
  }

  renameTreeNode(id: string, title: string): TreeNode {
    return this.noteMetadata.renameTreeNode(id, title);
  }

  saveNote(id: string, title: string, content: string, caches?: NoteCacheInput): NoteDocument {
    this.noteContent.save(id, title, content, caches);
    return this.readNote(id);
  }

  /** 15 分钟自动快照：标记文档为"本周期内保存过"（saveNote 落盘时调用） */
  markHistoryDirty(noteId: string): void {
    this.historyDirty.add(noteId);
  }

  /** 15 分钟自动快照：把 dirty 集合中文档各快照一次（force=false 走 24h 防抖），然后清空。
   * 返回实际创建的快照数。由主进程定时器调用。 */
  flushHistorySnapshots(): number {
    const t0 = Date.now();
    const pending = [...this.historyDirty];
    this.historyDirty.clear();
    let created = 0;
    for (const noteId of pending) {
      try {
        if (this.createHistorySnapshot(noteId)) created++;
      } catch { /* 单篇失败不阻断其余 */ }
    }
    this.logScopes.history.info(`[perf] flush-snapshots ${Date.now() - t0}ms (pending=${pending.length}, created=${created})`);
    return created;
  }

  /** M1：单独更新文本缓存（打开文档时补缓存用，不重写 .lake 正文） */
  updateNoteCaches(id: string, markdown: string | null, plain: string | null): void {
    this.db.prepare("UPDATE notes SET md_cache=?, text_cache=? WHERE id=?").run(markdown, plain, id);
    const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    this.searchRepository.upsert(id, titleRow?.title ?? "", plain ?? "");
  }

  /**
   * 兜底补齐文本缓存：锁定态 Viewer 无法用内核 getDocument 生成缓存，
   * 这里从磁盘 .lake 正文解析 md/text 缓存（不重写正文）。
   * 已有缓存时不覆盖；传 lakeContent 则用它（避免重复读盘）。
   * 返回是否写入了新缓存。
   */
  ensureNoteCaches(id: string, lakeContent?: string): boolean {
    const caches = this.readNoteCaches(id);
    if (caches.markdown && caches.plain) return false;
    const content = lakeContent ?? (() => {
      if (!fs.existsSync(this.notePath(id))) return "";
      return fs.readFileSync(this.notePath(id), "utf8");
    })();
    const markdown = lakeHtmlToMarkdown(content);
    const plain = lakeHtmlToPlain(content);
    if (!markdown && !plain) return false;
    this.updateNoteCaches(id, markdown, plain);
    return true;
  }

  /** M1：读取文本缓存（导出资料包 / 复制 Markdown 用） */
  readNoteCaches(id: string): { markdown: string | null; plain: string | null } {
    const row = this.db.prepare("SELECT md_cache, text_cache FROM notes WHERE id=?").get(id) as { md_cache: string | null; text_cache: string | null } | undefined;
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    return { markdown: row.md_cache, plain: row.text_cache };
  }

  // ---- M2 全文搜索 ----

  /** Rebuild the full-text index without exposing repository internals to callers. */
  checkpointWal(): void {
    try { this.db.pragma("wal_checkpoint(TRUNCATE)"); }
    catch (error) { this.logScopes.store.warn(`[store] WAL checkpoint failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  checkIntegrity(): { ok: boolean; integrity: string; foreignKeyErrors: number } {
    const row = this.db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const foreignKeyErrors = this.db.prepare("PRAGMA foreign_key_check").all().length;
    const integrity = row?.integrity_check ?? "unknown";
    return { ok: integrity === "ok" && foreignKeyErrors === 0, integrity, foreignKeyErrors };
  }

  rebuildSearchIndex(): void {
    this.searchRepository.rebuild();
  }

  /** Search notes through FTS5, with the existing short-query title fallback. */
  searchNotes(query: string, limit = 30): SearchResult[] {
    return this.searchRepository.search(query, limit);
  }

  /** M1：返回文档正文/图片目录的绝对路径（供“复制资料路径给本机 AI”） */
  /**
   * M1：导出原生 Lake 文档（图片 base64 内嵌，VS Code Lake 插件兼容）。
   * 把 image card 的 src 从本地 assetServer URL 替换为 data:image/...;base64，其余结构原样保留。
   */
  exportNativeLake(id: string, baseDir?: string): { exportPath: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const lakePath = this.notePath(id);
    if (!fs.existsSync(lakePath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const lake = fs.readFileSync(lakePath, "utf8");
    const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? path.join(os.homedir(), "Desktop", "lake-notes-导出");
    let exportDir = path.join(base, title);
    let suffix = 2;
    while (fs.existsSync(exportDir)) {
      exportDir = path.join(base, `${title}-${suffix}`);
      suffix++;
    }
    fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `${title}.lake`);
    // image card: <card ... name="image" ... value="data:...">（value = "data:" + encodeURIComponent(JSON)）
    const cardRe = /(<card\b[^>]*\bname="image"[^>]*\bvalue=")data:([^"]+)(")/g;
    let imageCount = 0;
    let skipped = 0;
    const out = lake.replace(cardRe, (whole, prefix: string, encoded: string, suffixTag: string) => {
      try {
        const value = JSON.parse(decodeURIComponent(encoded)) as { src?: string };
        const src = typeof value.src === "string" ? value.src : "";
        const m = localAssetLakeSrcRe(ASSET_PORT).exec(src);
        if (!m) { skipped++; return whole; } // 远程 URL 保持原样
        const noteId = m[1];
        const filename = m[2];
        if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) { skipped++; return whole; }
        const file = path.join(this.noteAssetsDir, noteId, filename);
        if (!fs.existsSync(file)) { skipped++; return whole; }
        const bytes = fs.readFileSync(file);
        const mime = mimeTypeForFilename(filename);
        value.src = `data:${mime};base64,${bytes.toString("base64")}`;
        imageCount++;
        return prefix + "data:" + encodeURIComponent(JSON.stringify(value)) + suffixTag;
      } catch { skipped++; return whole; }
    });
    fs.writeFileSync(exportPath, out, "utf8");
    return { exportPath, imageCount, skipped, size: out.length };
  }

  /**
   * M1：导出 HTML（收口导出的一环）：读缓存 Markdown → 轻量转 HTML →
   * 复制本地图片到 images/ 并改写相对引用 → 写 {标题}/index.html。
   */
  exportHtmlNote(id: string, baseDir?: string): { exportPath: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const caches = this.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? path.join(os.homedir(), "Desktop", "lake-notes-导出");
    let exportDir = path.join(base, title);
    let suffix = 2;
    while (fs.existsSync(exportDir)) {
      exportDir = path.join(base, `${title}-${suffix}`);
      suffix++;
    }
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    let body = mdToHtml(markdown);
    // 提取 <img src="http://127.0.0.1:{ASSET_PORT}/{noteId}/{file}"> 并复制 + 改写相对引用
    const imgRe = localAssetHtmlImgRe(ASSET_PORT);
    const seen = new Set<string>();
    let imageCount = 0;
    let skipped = 0;
    body = body.replace(imgRe, (whole: string, url: string, noteId: string, filename: string) => {
      const key = `${noteId}/${filename}`;
      if (seen.has(key)) return whole.replace(url, `images/${filename}`);
      seen.add(key);
      if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) { skipped++; return whole; }
      const src = path.join(this.noteAssetsDir, noteId, filename);
      try {
        if (fs.existsSync(src)) {
          const dest = path.join(imagesDir, filename);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
          imageCount++;
          return whole.replace(url, `images/${filename}`);
        }
      } catch { /* 复制失败算跳过 */ }
      skipped++;
      return whole;
    });
    const page = wrapHtmlPage(title, body);
    fs.writeFileSync(path.join(exportDir, "index.html"), page, "utf8");
    return { exportPath: path.join(exportDir, "index.html"), imageCount, skipped, size: page.length };
  }

  getNotePaths(id: string): { title: string; lakePath: string; assetsDir: string } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    return { title: row.title, lakePath: this.notePath(id), assetsDir: path.join(this.noteAssetsDir, id) };
  }

  /**
   * M1：导出资料包（Markdown + 图片）到桌面 lake-notes-导出/{标题}/。
   * 图片引用从 Lake 生成的 markdown 里以轻量正则提取（`![](http://127.0.0.1:19876/{noteId}/{filename})`），
   * 复制到导出目录 images/ 并把 MD 改写为相对引用，产出自包含资料包。
   */
  exportNotePackage(id: string, baseDir?: string): { exportDir: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const caches = this.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    // 提取图片引用（仅处理本地 assetServer URL；远程 URL 保持原样）
    const imgRe = localAssetMdImgRe(ASSET_PORT);
    const unique: Array<{ url: string; noteId: string; filename: string }> = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(markdown))) {
      const url = m[1], noteId = m[2], filename = m[3];
      if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) continue; // 防路径穿越
      const key = `${noteId}/${filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ url, noteId, filename });
    }
    const base = baseDir ?? path.join(os.homedir(), "Desktop", "lake-notes-导出");
    let exportDir = path.join(base, title);
    let suffix = 2;
    while (fs.existsSync(exportDir)) {
      exportDir = path.join(base, `${title}-${suffix}`);
      suffix++;
    }
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    let imageCount = 0;
    let skipped = 0;
    let md = markdown;
    for (const img of unique) {
      const src = path.join(this.noteAssetsDir, img.noteId, img.filename);
      let copied = false;
      try {
        if (fs.existsSync(src)) {
          const dest = path.join(imagesDir, img.filename);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
          copied = true;
        }
      } catch { /* 复制失败算跳过 */ }
      if (copied) {
        imageCount++;
        md = md.split(img.url).join(`images/${img.filename}`);
      } else {
        skipped++;
      }
    }
    fs.writeFileSync(path.join(exportDir, "index.md"), md, "utf8");
    return { exportDir, imageCount, skipped, size: md.length };
  }

  // ===== 文档历史（快照，纯本地不参与同步） =====

  /** 历史快照目录（相对 workspace root） */
  private historyDir(): string {
    return path.join(this.root, "history");
  }

  private historyNoteDir(noteId: string): string {
    return path.join(this.historyDir(), noteId);
  }

  /** gzip 快照正文 → Buffer */
  private gzipContent(content: string): Buffer {
    return zlib.gzipSync(content, { level: 6 });
  }

  /** 读取历史快照正文（解压） */
  private readHistoryContent(filePath: string): string {
    return zlib.gunzipSync(fs.readFileSync(path.join(this.root, filePath))).toString("utf8");
  }

  /** 24h 内同 hash 是否已有快照（去重防抖，P0-2：不用 UNIQUE） */
  private hasRecentDuplicate(noteId: string, hash: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM note_history WHERE note_id=? AND content_hash=? AND created_at > ? LIMIT 1"
    ).get(noteId, hash, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    return !!row;
  }

  /** 创建历史快照。content 缺省时读磁盘 .lake。
   * 返回快照 id；同 hash 且 24h 内已有则跳过返回 null。 */
  createHistorySnapshot(noteId: string, content?: string, force = false): number | null {
    const t0 = Date.now();
    if (!isSafePathSegment(noteId)) throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    const lakePath = this.notePath(noteId);
    if (!fs.existsSync(lakePath)) return null;
    const body = content ?? fs.readFileSync(lakePath, "utf8");
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    // 恢复动作 force=true 强制写（即使同 hash，用 created_at 区分）；普通快照 24h 防抖
    if (!force && this.hasRecentDuplicate(noteId, hash)) return null;
    const refs = [...extractAssetRefs(body)];
    const gz = this.gzipContent(body);
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19); // YYYY-MM-DD-HH-mm-ss
    const filename = `${ts}-${hash.slice(0, 16)}.lake.gz`;
    const relPath = `history/${noteId}/${filename}`;
    const absPath = path.join(this.root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, gz);
    // created_at 用单调时间：同毫秒内多条快照会撞（UNIQUE 已去，但排序需稳定），
    // 若与上一条同毫秒则 +1ms，保证 ORDER BY created_at DESC 稳定（P2-4）。
    let created = new Date().toISOString();
    const lastRow = this.db.prepare("SELECT created_at FROM note_history WHERE note_id=? ORDER BY created_at DESC LIMIT 1").get(noteId) as { created_at: string } | undefined;
    if (lastRow && created <= lastRow.created_at) {
      created = new Date(new Date(lastRow.created_at).getTime() + 1).toISOString();
    }
    const info = this.db.prepare(
      "INSERT INTO note_history(note_id,file_path,content_hash,created_at,size,refs_json,ref_count) VALUES(?,?,?,?,?,?,?)"
    ).run(noteId, relPath, hash, created, gz.length, JSON.stringify(refs), refs.length);
    const id = Number(info.lastInsertRowid);
    this.logScopes.history.info(`[perf] snapshot ${noteId} ${Date.now() - t0}ms id=${id}${force ? " force" : ""} (body=${body.length}B, gz=${gz.length}B, refs=${refs.length})`);
    return id;
  }

  /** 列出文档历史快照（新→旧）。 */
  listNoteHistory(noteId: string): HistorySnapshotSummary[] {
    return this.historyRepository.listForNote(noteId);
  }

  /** 快照预览：解压历史快照正文 → 纯文本。 */
  previewHistorySnapshot(historyId: number): HistorySnapshotPreview | null {
    return this.historyRepository.preview(historyId);
  }

  /** 孤儿文件预览：读取 note-assets/{noteId}/{filename} 内容。
   * 图片返回 base64 data URL；文本返回前 64KB；其他返回 null。 */
  previewNoteOrphan(noteId: string, filename: string): { kind: "image" | "text"; data: string; size: number } | null {
    if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) return null;
    const full = path.join(this.noteAssetsDirFor(noteId), filename);
    if (!fs.existsSync(full)) return null;
    try {
      const stat = fs.statSync(full);
      const mime = mimeTypeForFilename(filename);
      if (mime.startsWith("image/")) {
        const buf = fs.readFileSync(full);
        return { kind: "image", data: `data:${mime};base64,${buf.toString("base64")}`, size: stat.size };
      }
      const buf = fs.readFileSync(full);
      const text = buf.toString("utf8").slice(0, 65536);
      return { kind: "text", data: text, size: stat.size };
    } catch {
      return null;
    }
  }

  /** 恢复历史版本。
   * 1) 恢复前强制快照当前版本（可反悔，force=true 即使同 hash）
   * 2) 解压写回 .lake + 更新缓存/FTS
   * 3) 重算 hash → setBaseHash + markSynced（恢复=新基线，非本地新修改，P0-1）
   */
  restoreHistory(historyId: number): void {
    const t0 = Date.now();
    const row = this.db.prepare("SELECT note_id,file_path FROM note_history WHERE id=?").get(historyId) as
      { note_id: string; file_path: string } | undefined;
    if (!row) throw new AppError("NotFound", `历史快照不存在: ${historyId}`);
    const noteId = row.note_id;
    if (!isSafePathSegment(noteId)) throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    // 1) 恢复前留档（默认防抖：24h 内同内容已有快照则跳过，避免自动快照+覆盖留档产生重复；
    //    若表里没有（含被手动删除）会重新写，可反悔保障不丢）
    this.createHistorySnapshot(noteId, undefined, false);
    // 2) 解压写回
    const body = this.readHistoryContent(row.file_path);
    this.atomicWrite(this.notePath(noteId), body);
    // 3) 更新缓存/FTS（用恢复的正文）
    const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(noteId) as { title: string } | undefined;
    if (titleRow) {
      const markdown = lakeHtmlToMarkdown(body);
      const plain = lakeHtmlToPlain(body);
      this.updateNoteCaches(noteId, markdown, plain);
    }
    // 4) 同步语义（P0-1，与 S3-GC v4 §5.2 一致）：恢复 = 本地写回 + 待上传。
    // 不再 setBaseHash/setLastUploadedHash/markSynced；保持恢复前 base/lastUploaded，
    // 下次同步上传覆盖（远端被他人改则接受远端、恢复版已入历史）。
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE notes SET sync_state='local', updated_at=? WHERE id=?").run(now, noteId);
      this.db.prepare("UPDATE tree_nodes SET sync_state='local' WHERE id=?").run(noteId);
    });
    tx();
    this.logScopes.history.info(`[perf] restore ${noteId} from history#${historyId} ${Date.now() - t0}ms`);
  }

  /** 手动删除单个历史快照（文件 + DB）。调用方随后刷新孤儿列表（顺序 §5）。 */
  deleteHistory(historyId: number): void {
    const t0 = Date.now();
    const row = this.db.prepare("SELECT file_path FROM note_history WHERE id=?").get(historyId) as { file_path: string } | undefined;
    if (!row) throw new AppError("NotFound", `历史快照不存在: ${historyId}`);
    this.db.prepare("DELETE FROM note_history WHERE id=?").run(historyId);
    try { fs.rmSync(path.join(this.root, row.file_path), { force: true }); } catch { /* 忽略 */ }
    // 若目录空则清理
    this.pruneEmptyHistoryDirs();
    this.logScopes.history.info(`[perf] delete-history ${historyId} ${Date.now() - t0}ms`);
  }

  /** 惰性清理：每文档超 100 份删最旧；created_at < 30 天删。
   * 删除后对受影响文档重算引用，无引用资源物理删（方案 A）。 */
  cleanupHistory(): HistoryCleanupResult {
    const t0 = Date.now();
    // P5 + M8：保留策略可配置（份数硬上限 + 天数兜底 + 分层保留判定）
    const cfg = this.getHistorySettings();
    const result: HistoryCleanupResult = { deletedSnapshots: 0, freedBytes: 0 };
    const notes = this.db.prepare("SELECT DISTINCT note_id FROM note_history").all() as Array<{ note_id: string }>;
    for (const { note_id } of notes) {
      const rows = this.db.prepare(
        "SELECT id,file_path,created_at FROM note_history WHERE note_id=? ORDER BY created_at ASC"
      ).all(note_id) as Array<{ id: number; file_path: string; created_at: string }>;
      if (rows.length === 0) continue;
      const drops = selectHistoryDrops(rows.map((r) => r.created_at), { maxSnapshots: cfg.maxSnapshots, retentionDays: cfg.retentionDays });
      const expired = rows.filter((r) => drops.has(r.created_at));
      if (expired.length === 0) continue;
      for (const e of expired) {
        this.db.prepare("DELETE FROM note_history WHERE id=?").run(e.id);
        try {
          const p = path.join(this.root, e.file_path);
          result.freedBytes += fs.statSync(p).size;
          fs.rmSync(p, { force: true });
          result.deletedSnapshots++;
        } catch { /* 忽略 */ }
      }
      // 方案 A：清理后重算该文档引用，无引用资源物理删
      this.cleanupUnreferencedAssetsForNote(note_id);
    }
    this.pruneEmptyHistoryDirs();
    this.logScopes.history.info(`[perf] cleanup-history ${Date.now() - t0}ms (deleted=${result.deletedSnapshots}, freed=${result.freedBytes}B)`);
    return result;
  }

  /** 历史占用统计（U6/P4：设置面板展示"快照总数 + 占用字节"）。 */
  getHistoryStats(): { snapshotCount: number; totalBytes: number } {
    return this.historyRepository.stats();
  }

  /** 清理某文档"当前正文不引用 + 无历史快照引用"的资源。 */
  private cleanupUnreferencedAssetsForNote(noteId: string): void {
    const dir = this.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return;
    const disk = fs.readdirSync(dir);
    if (disk.length === 0) return;
    const protectedRefs = this.assetRepository.getProtectedRefs(noteId);
    for (const filename of disk) {
      if (protectedRefs.has(filename)) continue;
      try { fs.rmSync(path.join(dir, filename), { force: true }); } catch { /* 忽略 */ }
    }
  }

  /** 公共引用集（当前正文 ∪ 历史 refs）：历史/孤儿/S3 keep 三处复用。 */
  getProtectedRefs(noteId: string): Set<string> {
    return this.assetRepository.getProtectedRefs(noteId);
  }

  /** 所有存在历史快照的 noteId（S3 GC keep 集历史引用保护用）。 */
  listNoteIdsWithHistory(): string[] {
    return this.assetRepository.listNoteIdsWithHistory();
  }

  /** 当前正文引用集（上传资格判定用）。 */
  getCurrentContentRefs(noteId: string): Set<string> {
    return this.assetRepository.getCurrentContentRefs(noteId);
  }

  /** 文档级孤儿列表（实时）：磁盘文件 − (当前正文引用 ∪ 历史 refs) */
  listNoteOrphans(noteId: string): Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }> {
    const dir = this.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return [];
    const currentRefs = this.assetRepository.getCurrentContentRefs(noteId);
    const historyRefs = this.assetRepository.getHistoryRefs(noteId);
    const out: Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }> = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const inCurrent = currentRefs.has(f);
      const inHistory = historyRefs.has(f);
      if (inCurrent) continue; // 当前引用不是孤儿
      out.push({ filename: f, size: st.size, mimeType: mimeTypeForFilename(f), protectedByHistory: inHistory });
    }
    return out;
  }

  /** 清理文档级孤儿：只删非 protectedByHistory 的文件（被历史引用的跳过）。
   * filenames 缺省清全部可清。 */
  cleanNoteOrphans(noteId: string, filenames?: string[]): { count: number; freedBytes: number } {
    const orphans = this.listNoteOrphans(noteId);
    const targets = orphans.filter((o) => !o.protectedByHistory && (!filenames || filenames.includes(o.filename)));
    let count = 0, freed = 0;
    for (const o of targets) {
      const full = path.join(this.noteAssetsDirFor(noteId), o.filename);
      try { freed += fs.statSync(full).size; fs.unlinkSync(full); count++; } catch { /* 忽略 */ }
    }
    return { count, freedBytes: freed };
  }

  /** 清理空的历史文档目录 */
  private pruneEmptyHistoryDirs(): void {
    const root = this.historyDir();
    if (!fs.existsSync(root)) return;
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d);
      try { if (fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0) fs.rmdirSync(p); } catch { /* 忽略 */ }
    }
  }

  deleteNote(id: string) {
    this.deleteTreeNode(id);
  }

  private descendantIds(id: string): string[] {
    const result: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      result.push(cur);
      const children = this.db.prepare("SELECT id FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL").all(cur) as { id: string }[];
      for (const c of children) stack.push(c.id);
    }
    return result;
  }

  /** 该节点子树内全部 note_file_id（含自身；含已删除节点，purge 用）。 */
  private descendantNoteFileIds(id: string): string[] {
    const ids = this.descendantIdsIncludingDeleted(id);
    const out: string[] = [];
    for (const nid of ids) {
      const row = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?").get(nid) as { note_file_id: string | null } | undefined;
      if (row?.note_file_id) out.push(row.note_file_id);
    }
    return out;
  }

  /**
   * 软删除（回收站笔记本重构）：删除 = 把节点移入隐藏回收站笔记本（parentId=notebook-trash），
   * 记录 trashed_at（进入回收站时间）+ deleted_from_parent_id（删除前父目录，恢复位置），标 local 待上传。
   * 不递归子节点（子节点随父移动）、不写墓碑（回收站条目是普通条目，移动即同步传播）。
   * 文件保留（.lake / 资源不删）；彻底删除走 purgeTrashItem。审计 #10：DB 事务原子提交。
   */
  deleteTreeNode(id: string) {
    if (id === TRASH_NOTEBOOK_ID || id === DEFAULT_NOTEBOOK_ID) {
      throw new AppError("InvalidInput", "不能删除默认/回收站笔记本");
    }
    const node = this.readTreeNode(id);
    if (node.parentId === TRASH_NOTEBOOK_ID) return; // 已在回收站
    const now = nowIso();
    const tx = this.db.transaction(() => {
      if (node.noteFileId) {
        this.db.prepare(
          "UPDATE notes SET parent_id=?,trashed_at=?,deleted_from_parent_id=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL"
        ).run(TRASH_NOTEBOOK_ID, now, node.parentId, now, node.noteFileId);
      }
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=?,deleted_from_parent_id=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL"
      ).run(TRASH_NOTEBOOK_ID, now, node.parentId, now, id);
      // 级联：子树所有节点（嵌套分组 + 笔记）跟随根进回收站——trashed_at 必须标上，
      // 否则同步发布时子树按"正常"传播，其他端不跟随删除（内容"没删掉"、根恢复/删除语义不一致）。
      const subtreeIds = this.descendantIdsIncludingDeleted(id).filter((sid) => sid !== id);
      if (subtreeIds.length > 0) {
        const ph = subtreeIds.map(() => "?").join(",");
        this.db.prepare(`UPDATE tree_nodes SET trashed_at=?,updated_at=?,sync_state='local' WHERE id IN (${ph}) AND deleted_at IS NULL`).run(now, now, ...subtreeIds);
        const subNotes = this.db.prepare(`SELECT note_file_id FROM tree_nodes WHERE id IN (${ph}) AND note_file_id IS NOT NULL AND deleted_at IS NULL`).all(...subtreeIds) as Array<{ note_file_id: string }>;
        if (subNotes.length > 0) {
          const nph = subNotes.map(() => "?").join(",");
          this.db.prepare(`UPDATE notes SET trashed_at=?,updated_at=?,sync_state='local' WHERE id IN (${nph}) AND deleted_at IS NULL`).run(now, now, ...subNotes.map((s) => s.note_file_id));
        }
      }
      // 回收站条目不出现在搜索（子树整体移出 FTS，恢复时重建）
      const noteIds = this.descendantNoteFileIds(id);
      if (noteIds.length > 0) {
        const ph = noteIds.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM notes_fts WHERE note_id IN (${ph})`).run(...noteIds);
      }
    });
    tx();
  }

  /** 回收站：trash 笔记本的直接子节点（文件夹整体显示，子节点随动）。 */
  listTrash(): TrashItem[] {
    return this.trashRepository.list();
  }

  /** M9：回收站自动过期候选。 */
  listTrashReminder(days: number): TrashReminderItem[] {
    return this.trashRepository.listReminder(days);
  }

  /** 回收站自动过期（TRASH-NOTEBOOK）：trashed_at 超过 N 天的 trash 顶级条目自动 purge。返回 purge 数。 */
  autoPurgeExpiredTrash(days: number): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const rows = this.db.prepare(
      "SELECT id FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL AND trashed_at IS NOT NULL AND trashed_at < ? ORDER BY trashed_at"
    ).all(TRASH_NOTEBOOK_ID, cutoff) as Array<{ id: string }>;
    for (const r of rows) this.purgeTrashItem(r.id);
    return rows.length;
  }

  /** 审计（编辑即恢复）：编辑"他端已 purge、本端保留"（sync_state='purged'）的回收站条目时，
   * 视为一次显式恢复：移出回收站 + restore_pending_at（D2 例外，后续编辑内容作为恢复版上传）。
   * 返回是否发生了恢复。 */
  revivePurgedIfNeeded(id: string): boolean {
    const row = this.db.prepare(
      "SELECT t.note_file_id FROM tree_nodes t JOIN notes n ON n.id = t.note_file_id WHERE t.id=? AND t.parent_id=? AND n.sync_state='purged' AND n.deleted_at IS NULL"
    ).get(id, TRASH_NOTEBOOK_ID) as { note_file_id: string | null } | undefined;
    if (!row?.note_file_id) return false;
    this.restoreTrashItem(row.note_file_id);
    return true;
  }

  /** 恢复回收站节点：移回原位置（deleted_from_parent_id）；原父不存在/已被删/在回收站 → 默认笔记本。
   * 无墓碑可压（回收站条目是普通条目），恢复 = 移出 + 标 local 待上传（LWW 由 updatedAt 承担）。 */
  restoreTrashItem(id: string): void {
    const node = this.db.prepare("SELECT * FROM tree_nodes WHERE id=? AND parent_id=? AND deleted_at IS NULL").get(id, TRASH_NOTEBOOK_ID) as
      { note_file_id: string | null; node_type: string; deleted_from_parent_id: string | null } | undefined;
    if (!node) throw new AppError("NotFound", `回收站节点不存在: ${id}`);
    // 笔记本只能回根层（parentId=null）；note/group 回原位置，原父缺失/被删/在回收站 → 默认笔记本
    const isNotebook = node.node_type === "notebook";
    let parentId: string | null = isNotebook ? null : node.deleted_from_parent_id;
    if (parentId === null || parentId === TRASH_NOTEBOOK_ID) {
      parentId = isNotebook ? null : DEFAULT_NOTEBOOK_ID;
    } else {
      // 原父必须存在、未被删、且不在回收站内，否则回退默认笔记本。
      // 注意：根级笔记本 parent_id 为 NULL，`parent_id != ?` 会因 SQL 三值逻辑得 NULL 而漏判，
      // 导致恢复到根级笔记本时误回退到默认笔记本（恢复位置错误）——必须显式允许 NULL。
      const parent = this.db.prepare(
        "SELECT id FROM tree_nodes WHERE id=? AND deleted_at IS NULL AND (parent_id IS NULL OR parent_id != ?)"
      ).get(parentId, TRASH_NOTEBOOK_ID) as { id: string } | undefined;
      if (!parent) parentId = DEFAULT_NOTEBOOK_ID;
    }
    const now = nowIso();
    const tx = this.db.transaction(() => {
      if (node.note_file_id) {
        this.db.prepare(
          "UPDATE notes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,sync_state='local',restore_pending_at=? WHERE id=?"
        ).run(parentId, now, now, node.note_file_id);
        const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(node.note_file_id) as { title: string } | undefined;
        const caches = this.readNoteCaches(node.note_file_id);
        this.searchRepository.upsert(node.note_file_id, titleRow?.title ?? "", caches.plain ?? null);
      }
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,sync_state='local' WHERE id=?"
      ).run(parentId, now, id);
      // 级联：子树（跟随根进回收站的嵌套分组/笔记）随根恢复——清 trashed_at（父位置不变）。
      const subtreeIds = this.descendantIdsIncludingDeleted(id).filter((sid) => sid !== id);
      if (subtreeIds.length > 0) {
        const ph = subtreeIds.map(() => "?").join(",");
        this.db.prepare(`UPDATE tree_nodes SET trashed_at=NULL,updated_at=?,sync_state='local' WHERE id IN (${ph}) AND deleted_at IS NULL`).run(now, ...subtreeIds);
        const subNotes = this.db.prepare(`SELECT note_file_id FROM tree_nodes WHERE id IN (${ph}) AND note_file_id IS NOT NULL AND deleted_at IS NULL`).all(...subtreeIds) as Array<{ note_file_id: string }>;
        if (subNotes.length > 0) {
          const nph = subNotes.map(() => "?").join(",");
          this.db.prepare(`UPDATE notes SET trashed_at=NULL,updated_at=?,sync_state='local' WHERE id IN (${nph}) AND deleted_at IS NULL`).run(now, ...subNotes.map((s) => s.note_file_id));
        }
      }
    });
    tx();
  }

  /**
   * 撤销本地删除（sync 下载分支在"远端恢复较新"时调用）：清 purge 墓碑；
   * 若本地有"收到他端 purge 后保留的回收站副本（purged）"，解除抑制（后续由下载/对账对齐）。
   * 与 restoreTrashItem 不同：不强制标 local——远端为权威，随后由下载/对账流程对齐并 markSynced。
   */
  revokeLocalDeletion(id: string): void {
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM deleted_notes WHERE id=?").run(id);
      this.db.prepare("UPDATE notes SET sync_state='local' WHERE id=? AND sync_state='purged'").run(id);
      this.db.prepare("UPDATE tree_nodes SET sync_state='local' WHERE note_file_id=? AND sync_state='purged'").run(id);
      const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
      // 容错：本端已 purge（行被彻底删除）时跳过缓存/FTS——行将由下载分支 importRemoteNote 重建，
      // 避免 readNoteCaches 对不存在的行抛"笔记不存在"导致同步中断（远端恢复传播场景）。
      if (titleRow) {
        const caches = this.readNoteCaches(id);
        this.searchRepository.upsert(id, titleRow.title, caches.plain ?? null);
      }
      this.db.prepare("UPDATE tree_nodes SET updated_at=? WHERE note_file_id=?").run(now, id);
    });
    tx();
  }

  /** 彻底删除回收站节点（不可恢复）：物理删子树 + 写 purge 墓碑（deleted_notes，带 purged_at）。
   * 墓碑上云（deleted:true）防其他端被动复活；其他端收到后保留本地副本并标 purged（可恢复）。
   * M4 前缀删除由同步侧按 listPurgedNotesForSync 执行。 */
  purgeTrashItem(id: string): void {
    const t0 = Date.now();
    // 回收站树内任意节点可 purge（含嵌套分组/文档子树；根或子树节点均可）。
    // 校验：节点必须在回收站笔记本子树内（根 = parent_id=trash，子树 = 祖先链含 trash）。
    const node = this.db.prepare(
      `WITH RECURSIVE trash_ancestors(id) AS (
         SELECT ? UNION ALL
         SELECT t.parent_id FROM tree_nodes t JOIN trash_ancestors ta ON t.id=ta.id
       )
       SELECT t.id,t.note_file_id FROM tree_nodes t
       WHERE t.id=? AND t.deleted_at IS NULL AND (SELECT COUNT(*) FROM trash_ancestors WHERE id=?)>0`
    ).get(id, id, TRASH_NOTEBOOK_ID) as { id: string; note_file_id: string | null } | undefined;
    if (!node) throw new AppError("NotFound", `回收站节点不存在: ${id}`);
    const ids = this.descendantIdsIncludingDeleted(id);
    const filesToRemove: Array<{ path: string; recursive: boolean }> = [];
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const nodeStmt = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?");
      const noteMeta = this.db.prepare("SELECT id,title,parent_id,sort_order,updated_at FROM notes WHERE id=?");
      // node_type：note（进 manifest.notes 发布 deleted:true）vs folder（仅本地下载过滤，不进 manifest）。
      // 新墓碑 published_at=NULL（未发布，计入待上传）；ON CONFLICT 不清已发布的 published_at（幂等重复 purge 场景）。
      const tombstone = this.db.prepare(
        "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,purged_at,node_type) VALUES(?,?,?,?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, purged_at=excluded.purged_at, node_type=excluded.node_type"
      );
      const delNote = this.db.prepare("DELETE FROM notes WHERE id=?");
      const delFts = this.db.prepare("DELETE FROM notes_fts WHERE note_id=?");
      const delNode = this.db.prepare("DELETE FROM tree_nodes WHERE id=?");
      const delOrphans = this.db.prepare("DELETE FROM orphan_assets WHERE note_id=?");
      const delHistory = this.db.prepare("DELETE FROM note_history WHERE note_id=?");
      for (const nid of ids) {
        const n = nodeStmt.get(nid) as { note_file_id: string | null } | undefined;
        if (n?.note_file_id) {
          filesToRemove.push({ path: this.notePath(n.note_file_id), recursive: false });
          filesToRemove.push({ path: path.join(this.noteAssetsDir, n.note_file_id), recursive: true });
          // 彻底删除 = 连历史快照 + 历史引用的资源一起物理删（用户确认）
          filesToRemove.push({ path: this.historyNoteDir(n.note_file_id), recursive: true });
          const meta = noteMeta.get(n.note_file_id) as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
          if (meta) tombstone.run(meta.id, meta.title, meta.parent_id, meta.sort_order, meta.updated_at, now, now, "note");
          delHistory.run(n.note_file_id);
          delOrphans.run(n.note_file_id);
          delFts.run(n.note_file_id);
          delNote.run(n.note_file_id);
        } else {
          // folder/group（无 note_file_id）purge 也必须写墓碑（deleted_notes + purged_at）：
          // 否则物理删除后无任何持久"已删"记录，同步下载阶段会把远端 manifest.folders 里
          // 仍存在的该笔记本重新导入（删除/清空回收站后同步 → 被删的又回来）。
          const f = this.db.prepare("SELECT title,parent_id,sort_order,updated_at FROM tree_nodes WHERE id=?").get(nid) as { title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
          if (f) tombstone.run(nid, f.title, f.parent_id, f.sort_order, f.updated_at, now, now, "folder");
        }
        delNode.run(nid);
      }
    });
    tx();
    for (const f of filesToRemove) {
      try { fs.rmSync(f.path, { force: true, recursive: f.recursive }); }
      catch (error) { console.warn("[store] 彻底删除清理文件失败:", f.path, error); }
    }
    this.logScopes.store.info(`[perf] purge ${id} ${Date.now() - t0}ms (files=${filesToRemove.length})`);
  }

  /** 清空回收站：彻底删除 trash 笔记本的全部根节点（各 purge 连带子树，写 purge 墓碑）。
   * 只遍历根（parent_id=trash），避免整棵子树重复 purge。 */
  emptyTrash(): void {
    const items = this.db.prepare(
      "SELECT id FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL"
    ).all(TRASH_NOTEBOOK_ID) as Array<{ id: string }>;
    for (const item of items) this.purgeTrashItem(item.id);
  }

  /** 包含已删除节点的后代（用于彻底删除回收站子树） */
  private descendantIdsIncludingDeleted(id: string): string[] {
    const result: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      result.push(cur);
      const children = this.db.prepare("SELECT id FROM tree_nodes WHERE parent_id=?").all(cur) as { id: string }[];
      for (const c of children) stack.push(c.id);
    }
    return result;
  }

  /** M1.6：设置/清除文档或分组的自定义图标（emoji，本地化） */
  setNodeIcon(id: string, icon: string | null): TreeNode {
    return this.noteMetadata.setNodeIcon(id, icon);
  }

  moveTreeNode(id: string, parentId: string | null, sortOrder: number): TreeNode {
    return this.noteMetadata.moveTreeNode(id, parentId, sortOrder);
  }

  /** 审计 #18：移动 + 同级重排一次原子完成。 */
  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): TreeNode {
    return this.noteMetadata.moveTreeNodeOrdered(id, parentId, orderedIds);
  }

  reorderTreeNodes(parentId: string | null, orderedIds: string[]): void {
    this.noteMetadata.reorderTreeNodes(parentId, orderedIds);
  }

  private noteAssetsDirFor(noteId: string): string {
    if (!isSafePathSegment(noteId)) {
      throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    }
    return path.join(this.noteAssetsDir, noteId);
  }

  private assetUrl(noteId: string, filename: string): string {
    return `http://127.0.0.1:${ASSET_PORT}/${noteId}/${filename}`;
  }

  /** 当前正文引用的资源文件名（复用公共 extractAssetRefs） */
  private referencedFilenames(content: string): Set<string> {
    return extractAssetRefs(content);
  }

  /** 写盘即登记孤儿（思源式"写时登记、保存时对账"）：
   * 图片下载/插入落盘瞬间正文必然尚未引用它；先登记为孤儿，杜绝"未登记就被同步上传"
   * 的窄窗口（S3 累积无用文件）。随后 saveNote 的 detectOrphans 会按正文引用撤销登记。 */
  private registerOrphan(noteId: string, filename: string, size: number, mimeType: string): void {
    try {
      this.db.prepare(
        `INSERT OR IGNORE INTO orphan_assets(note_id, filename, file_path, size, mime_type)
         VALUES(?,?,?,?,?)`
      ).run(noteId, filename, `note-assets/${noteId}/${filename}`, size, mimeType);
    } catch (error) {
      console.warn("[store] 孤儿登记失败（不影响主流程）:", error);
    }
  }

  private detectOrphans(noteId: string, content: string): void {
    const dir = this.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return;
    const diskSet = new Set(fs.readdirSync(dir));
    const referencedSet = this.referencedFilenames(content);
    // P2：孤儿登记并入"历史 refs"——被任何历史快照引用的资源不算孤儿，
    // 保证全局 cleanOrphanAssets / 同步跳过上传 / 文档级 listNoteOrphans 三个消费者一致，
    // 避免"本机 SyncPanel 全局清理误删历史引用资源 → 本机历史恢复裂图"。
    const historyRefs = this.assetRepository.getHistoryRefs(noteId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO orphan_assets(note_id, filename, file_path, size, mime_type)
       VALUES(?,?,?,?,?)`
    );
    const unorphan = this.db.prepare("DELETE FROM orphan_assets WHERE note_id=? AND filename=?");
    const tx = this.db.transaction(() => {
      for (const filename of diskSet) {
        if (referencedSet.has(filename) || historyRefs.has(filename)) {
          unorphan.run(noteId, filename);
        } else {
          const stat = fs.statSync(path.join(dir, filename));
          if (!stat.isFile()) continue;
          insert.run(noteId, filename, `note-assets/${noteId}/${filename}`, stat.size, mimeTypeForFilename(filename));
        }
      }
    });
    tx();
  }

  listOrphanAssets(): OrphanAsset[] {
    return this.assetRepository.listOrphanAssets();
  }

  cleanOrphanAssets(): { count: number; freedBytes: number } {
    // 审计 #12：仅当文件不存在或删除成功时才删除记录并计数；失败保留记录（UI 可重试）
    const rows = this.db.prepare("SELECT * FROM orphan_assets").all() as OrphanAssetRow[];
    let count = 0;
    let freedBytes = 0;
    for (const row of rows) {
      const fullPath = path.join(this.root, row.file_path);
      try {
        if (fs.existsSync(fullPath)) {
          freedBytes += fs.statSync(fullPath).size;
          fs.unlinkSync(fullPath);
        }
        this.db.prepare("DELETE FROM orphan_assets WHERE id=?").run(row.id);
        count++;
      } catch (error) {
        console.warn("[store] 清理孤儿资源失败，保留记录待重试:", fullPath, error);
      }
    }
    return { count, freedBytes };
  }

  // ===== S3 同步支持 =====

  getS3Settings(): S3Settings | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='s3_settings'").get() as { value: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as S3Settings;
      if (!parsed || typeof parsed.endpoint !== "string") return null;
      if (typeof parsed.secretAccessKey === "string") parsed.secretAccessKey = this.decryptSecret(parsed.secretAccessKey);
      return parsed;
    } catch {
      return null;
    }
  }

  /** 历史保留策略配置（P5）：读取，缺省返回默认值 */
  getHistorySettings(): HistorySettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='history_settings'").get() as { value: string } | undefined;
    const def: HistorySettings = { maxSnapshots: 100, retentionDays: 30, cleanupIntervalHours: 24, snapshotIntervalMinutes: 15 };
    if (!row) return def;
    try {
      const parsed = JSON.parse(row.value) as Partial<HistorySettings>;
      return {
        maxSnapshots: typeof parsed.maxSnapshots === "number" && parsed.maxSnapshots > 0 ? parsed.maxSnapshots : def.maxSnapshots,
        retentionDays: typeof parsed.retentionDays === "number" && parsed.retentionDays > 0 ? parsed.retentionDays : def.retentionDays,
        cleanupIntervalHours: typeof parsed.cleanupIntervalHours === "number" && parsed.cleanupIntervalHours >= 0 ? parsed.cleanupIntervalHours : def.cleanupIntervalHours,
        snapshotIntervalMinutes: typeof parsed.snapshotIntervalMinutes === "number" && parsed.snapshotIntervalMinutes >= 0 ? parsed.snapshotIntervalMinutes : def.snapshotIntervalMinutes,
      };
    } catch {
      return def;
    }
  }

  saveHistorySettings(settings: HistorySettings): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('history_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
  }

  saveS3Settings(settings: S3Settings): void {
    // 密钥用 Electron safeStorage（macOS Keychain）加密落盘；不可用时退回明文
    const stored = { ...settings, secretAccessKey: this.encryptSecret(settings.secretAccessKey) };
    this.db.prepare("INSERT INTO settings(key,value) VALUES('s3_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(stored));
  }

  private encryptSecret(value: string): string {
    return this.secretCipher.encrypt(value);
  }

  private decryptSecret(value: string): string {
    return this.secretCipher.decrypt(value);
  }

  contentHash(id: string): string {
    return crypto.createHash("sha256").update(fs.readFileSync(this.notePath(id))).digest("hex");
  }

  baseHash(id: string): string | null {
    const row = this.db.prepare("SELECT content_hash FROM sync_base WHERE note_id=?").get(id) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }

  setBaseHash(id: string, hash: string): void {
    this.db.prepare("INSERT INTO sync_base(note_id,content_hash) VALUES(?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash")
      .run(id, hash);
  }

  /** P0-1：本机最后一次成功上传某文档的 hash（同步上传成功后调用）；hash 传 null = 清除（两端一致 skip 记账用）。
   * null 走 UPDATE 而非 INSERT——INSERT VALUES(id,null,null) 即使 ON CONFLICT 也会触发 content_hash NOT NULL（SQLite upsert 行为）。 */
  setLastUploadedHash(id: string, hash: string | null): void {
    if (hash === null) {
      this.db.prepare("UPDATE sync_base SET last_uploaded_hash=NULL WHERE note_id=?").run(id);
      return;
    }
    this.db.prepare("INSERT INTO sync_base(note_id,content_hash,last_uploaded_hash) VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET last_uploaded_hash=excluded.last_uploaded_hash")
      .run(id, hash, hash);
  }

  /** P0-1：读本机最后一次上传的 hash（无则 null） */
  lastUploadedHash(id: string): string | null {
    const row = this.db.prepare("SELECT last_uploaded_hash FROM sync_base WHERE note_id=?").get(id) as { last_uploaded_hash: string | null } | undefined;
    return row?.last_uploaded_hash ?? null;
  }

  /** 统一冲突语义：读本设备"上次成功同步时该笔记的 updated_at"（元数据已确认版本；无则 null）。
   * 下载对账：远端 updatedAt 新于它 → 远端是未确认的新变更（先同步者胜，应用远端）；
   * 否则远端是本设备已确认版本（保留本地续编/改名，上传回写）。 */
  lastSyncedMetaAt(id: string): string | null {
    const row = this.db.prepare("SELECT last_synced_meta_at FROM sync_base WHERE note_id=?").get(id) as { last_synced_meta_at: string | null } | undefined;
    return row?.last_synced_meta_at ?? null;
  }

  /** 只读锁：本地操作；不触碰正文/updated_at，锁同步走 manifest v3 独立字段 */
  setNoteLocked(id: string, locked: boolean): void {
    this.noteMetadata.setNoteLocked(id, locked);
  }

  /** 同步合并写入（远端锁状态按 lockedAt LWW 后由调用方判定）。 */
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): void {
    this.noteMetadata.applyRemoteLock(id, locked, lockedAt);
  }

  /** 本地同步快照保护（V5 §5.2）：上传/对账结束后，仅当本地状态与快照一致才标记 synced。
   * - 事务外重读磁盘正文 hash（覆盖「上传全程的正文编辑」）；
   * - 事务内重读 metadata 比对（覆盖 title/parent/sort/lock/icon——锁变更不改 updated_at，必须比对字段）；
   * - 条件更新 updated_at（meta 编辑最后防线；changes=0 → 快照后又有编辑 → 不标）。
   * 任一不一致 → 保持 sync_state='local'，下次同步重传。
   * 这是单设备内快照比对，不是分布式 CAS；updated_at 无严格单调，同毫秒残留后果=延迟非丢失。 */
  markSyncedIfUnchanged(noteId: string, expected: {
    contentHash: string; updatedAt: string; title: string; parentId: string | null;
    sortOrder: number; isLocked: boolean; lockedAt: string | null; icon: string | null;
  }): boolean {
    // 1) 事务外：重读磁盘正文 hash（正文在 .lake 文件，DB 事务管不到磁盘）
    if (this.contentHash(noteId) !== expected.contentHash) return false;
    return this.db.transaction(() => {
      // 2) metadata 比对（锁变更不改 updated_at，必须显式比对字段）
      const meta = this.db.prepare(
        "SELECT n.title,n.parent_id,n.sort_order,n.is_locked,n.locked_at,t.icon FROM notes n LEFT JOIN tree_nodes t ON t.note_file_id=n.id WHERE n.id=? AND n.deleted_at IS NULL"
      ).get(noteId) as { title: string; parent_id: string | null; sort_order: number; is_locked: number; locked_at: string | null; icon: string | null } | undefined;
      if (!meta) return false;
      if (meta.title !== expected.title || meta.parent_id !== expected.parentId || meta.sort_order !== expected.sortOrder ||
          !!meta.is_locked !== expected.isLocked || (meta.locked_at ?? null) !== expected.lockedAt || (meta.icon ?? null) !== expected.icon) return false;
      // 3) 条件更新（快照后 meta 编辑的最后防线）
      const info = this.db.prepare(
        "UPDATE notes SET sync_state='synced', restore_pending_at=NULL WHERE id=? AND updated_at=?"
      ).run(noteId, expected.updatedAt);
      if (info.changes === 0) return false;
      // 4) 归位 + 记录元数据已确认版本（与原 markSynced 语义一致）
      this.db.prepare("UPDATE tree_nodes SET sync_state='synced' WHERE note_file_id=?").run(noteId);
      this.db.prepare("UPDATE sync_base SET last_synced_meta_at=? WHERE note_id=?").run(expected.updatedAt, noteId);
      return true;
    })();
  }

  markSynced(id: string): void {
    const tx = this.db.transaction(() => {
      // restore_pending_at 一并清除：任何"变为 synced"的路径都代表恢复已生效或被远端采纳，
      // 残留标记会让本设备永远 local-wins、压住后续墓碑（墓碑永胜被破坏）。
      this.db.prepare("UPDATE notes SET sync_state='synced', restore_pending_at=NULL WHERE id=?").run(id);
      // 侧栏/状态栏读的是 tree_nodes.sync_state，必须同步置为 synced。
      this.db.prepare("UPDATE tree_nodes SET sync_state='synced' WHERE note_file_id=?").run(id);
      // 统一冲突语义：记录本次成功同步时笔记的 updated_at（元数据已确认版本），供下次对账 LWW。
      // 真实同步流中 sync_base 行已由 setBaseHash/setLastUploadedHash 创建，这里仅更新；
      // 无行时（如单测直接调用）跳过，last_synced_meta_at 保持 null（远端视为未确认 → 应用远端）。
      this.db.prepare(
        "UPDATE sync_base SET last_synced_meta_at=(SELECT updated_at FROM notes WHERE id=?) WHERE note_id=?"
      ).run(id, id);
    });
    tx();
  }

  /** 目录/分组归位（V5 §5.1）：folder 无独立对象上传（只进 manifest.folders），
   * latest 发布成功后按构建 manifest 时的 updatedAt 快照条件归位，
   * 防同步期间本地再改 group 被误标（与 markSyncedIfUnchanged 同构）。
   * 只作用于无 note_file_id 的 group/notebook 节点；返回是否归位成功。 */
  markFolderSynced(id: string, expectedUpdatedAt: string): boolean {
    const info = this.db.prepare(
      "UPDATE tree_nodes SET sync_state='synced' WHERE id=? AND updated_at=? AND note_file_id IS NULL"
    ).run(id, expectedUpdatedAt);
    return info.changes > 0;
  }

  /** 是否处于"回收站恢复后待同步"状态（显式恢复标记）。
   * 墓碑权威下这是唯一允许 local-wins 抵抗远端删除的例外。 */
  isRestorePending(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM notes WHERE id=? AND restore_pending_at IS NOT NULL").get(id);
  }

  /** 是否处于待上传/本地未对齐状态（sync_state != synced）。用于远端墓碑与本地恢复的 P0-1 判定。 */
  isSyncPending(id: string): boolean {
    const row = this.db.prepare("SELECT sync_state FROM notes WHERE id=?").get(id) as { sync_state: string } | undefined;
    return row !== undefined && row.sync_state !== "synced";
  }

  getS3GcSettings(): S3GcSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='s3_gc_settings'").get() as { value: string } | undefined;
    const def: S3GcSettings = { gcRetentionDays: 7, gcIntervalHours: 24, trashAutoPurgeDays: 60 };
    if (!row) return def;
    try {
      const parsed = JSON.parse(row.value) as Partial<S3GcSettings>;
      return {
        gcRetentionDays: typeof parsed.gcRetentionDays === "number" && parsed.gcRetentionDays >= 0 ? parsed.gcRetentionDays : def.gcRetentionDays,
        gcIntervalHours: typeof parsed.gcIntervalHours === "number" && parsed.gcIntervalHours >= 0 ? parsed.gcIntervalHours : def.gcIntervalHours,
        trashAutoPurgeDays: typeof parsed.trashAutoPurgeDays === "number" && parsed.trashAutoPurgeDays >= 0 ? parsed.trashAutoPurgeDays : def.trashAutoPurgeDays,
      };
    } catch {
      return def;
    }
  }

  saveS3GcSettings(settings: S3GcSettings): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('s3_gc_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
  }

  getSyncSettings(): SyncSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='sync_settings'").get() as { value: string } | undefined;
    const def: SyncSettings = { enabled: true, autoMode: "manual", autoIntervalMinutes: 15 };
    if (!row) return def;
    try {
      const parsed = JSON.parse(row.value) as Partial<SyncSettings>;
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : def.enabled,
        autoMode: parsed.autoMode === "interval" || parsed.autoMode === "onOpenClose" || parsed.autoMode === "manual" ? parsed.autoMode : def.autoMode,
        autoIntervalMinutes: typeof parsed.autoIntervalMinutes === "number" && parsed.autoIntervalMinutes >= 1 ? Math.floor(parsed.autoIntervalMinutes) : def.autoIntervalMinutes,
      };
    } catch {
      return def;
    }
  }

  saveSyncSettings(settings: SyncSettings): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('sync_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
  }

  addS3GcPending(key: string, markedAt: string = nowIso()): void {
    this.db.prepare("INSERT INTO s3_gc_pending(key,marked_at) VALUES(?,?) ON CONFLICT(key) DO NOTHING").run(key, markedAt);
  }

  removeS3GcPending(keys: string[]): void {
    if (keys.length === 0) return;
    const placeholders = keys.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM s3_gc_pending WHERE key IN (${placeholders})`).run(...keys);
  }

  listS3GcPending(): Array<{ key: string; markedAt: string }> {
    return this.db.prepare("SELECT key,marked_at AS markedAt FROM s3_gc_pending ORDER BY marked_at").all() as Array<{ key: string; markedAt: string }>;
  }

  recordS3GcLog(action: string, key: string, reason: string, commitId: string | null, deviceId: string | null, ok: boolean): void {
    this.db.prepare("INSERT INTO s3_gc_log(ts,action,key,reason,commit_id,device_id,ok) VALUES(?,?,?,?,?,?,?)")
      .run(nowIso(), action, key, reason, commitId, deviceId, ok ? 1 : 0);
  }

  listS3GcLog(): Array<{ id: number; ts: string; action: string; key: string; reason: string; commitId: string | null; deviceId: string | null; ok: boolean }> {
    return this.db.prepare("SELECT id,ts,action,key,reason,commit_id AS commitId,device_id AS deviceId,ok FROM s3_gc_log ORDER BY id DESC LIMIT 500")
      .all().map((value) => { const r = value as { id: number; ts: string; action: string; key: string; reason: string; commitId: string | null; deviceId: string | null; ok: unknown }; return { ...r, ok: !!r.ok }; });
  }

  markSyncComplete(at: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(at);
  }

  recordSyncResult(json: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_sync_result',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json);
  }

  /** P4：记录最近一次历史清理结果（自动/手动），供设置面板展示与排查 */
  recordHistoryCleanup(result: HistoryCleanupResult): void {
    const payload = { at: new Date().toISOString(), ...result };
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_history_cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(payload));
  }

  getLastHistoryCleanup(): { at: string; deletedSnapshots: number; freedBytes: number } | null {
    const row = this.db.prepare("SELECT value FROM device_state WHERE key='last_history_cleanup'").get() as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }

  /** 已写入同步清单的删除标记可安全剪除，避免 deleted_notes 无限累积 */
  pruneTombstones(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM deleted_notes WHERE id IN (${placeholders})`).run(...ids);
  }

  getSyncStatus(): { lastSyncedAt: string | null; lastResult: Record<string, unknown> | null } {
    const at = this.db.prepare("SELECT value FROM device_state WHERE key='last_synced_at'").get() as { value: string } | undefined;
    const row = this.db.prepare("SELECT value FROM device_state WHERE key='last_sync_result'").get() as { value: string } | undefined;
    let lastResult: Record<string, unknown> | null = null;
    if (row) { try { lastResult = JSON.parse(row.value); } catch { lastResult = null; } }
    return { lastSyncedAt: at?.value ?? null, lastResult };
  }

  notePathFor(id: string): string {
    return this.notePath(id);
  }

  noteAssetsPathFor(id: string): string {
    return this.noteAssetsDirFor(id);
  }

  /** 渲染层刷新用：全部笔记摘要（含锁状态）。 */
  listNoteSummaries(): NoteSummary[] {
    return this.noteQueries.listNoteSummaries();
  }

  listNotesForSync(): SyncNote[] {
    return this.noteQueries.listNotesForSync();
  }

  /** 同步目录树：活动 notebook/group（不包含隐藏回收站笔记本）。 */
  listFoldersForSync(): SyncFolder[] {
    return this.noteQueries.listFoldersForSync();
  }

  /** 导入远端 notebook/group 节点。 */
  importRemoteFolder(folder: SyncFolder): void {
    this.noteMetadata.importRemoteFolder(folder);
  }

  defaultNotebookId(): string {
    return this.noteMetadata.defaultNotebookId();
  }

  hasTreeNode(id: string): boolean {
    return this.noteMetadata.hasTreeNode(id);
  }

  /** 正文 hash 相同、仅元数据变化（标题/父目录/排序/图标/回收站字段）时的对账。 */
  applyRemoteNoteMeta(note: SyncNote): void {
    const tx = this.db.transaction(() => {
      // 回收站条目：同步 trashed_at + deleted_from_parent_id；移出回收站（恢复传播）时清空。
      const inTrash = note.parentId === TRASH_NOTEBOOK_ID;
      const trashedAt = inTrash ? (note.trashedAt ?? new Date().toISOString()) : null;
      const deletedFrom = inTrash ? (note.deletedFromParentId ?? null) : null;
      this.db.prepare(
        "UPDATE notes SET title=?, parent_id=?, sort_order=?, updated_at=?, is_conflict=?, trashed_at=?, deleted_from_parent_id=? WHERE id=?"
      ).run(note.title, note.parentId, note.sortOrder, note.updatedAt, note.isConflict ? 1 : 0, trashedAt, deletedFrom, note.id);
      // 旧清单无 icon 字段时保留本地图标（icon=undefined 是"未声明"，null 才是"显式清除"）；
      // 否则旧客户端写出的 manifest 会把新端本地图标静默清掉（验收 #1 健壮性）。
      if (note.icon !== undefined) {
        this.db.prepare(
          "UPDATE tree_nodes SET title=?, parent_id=?, sort_order=?, updated_at=?, icon=?, trashed_at=?, deleted_from_parent_id=? WHERE note_file_id=?"
        ).run(note.title, note.parentId, note.sortOrder, note.updatedAt, note.icon ?? null, trashedAt, deletedFrom, note.id);
      } else {
        this.db.prepare(
          "UPDATE tree_nodes SET title=?, parent_id=?, sort_order=?, updated_at=?, trashed_at=?, deleted_from_parent_id=? WHERE note_file_id=?"
        ).run(note.title, note.parentId, note.sortOrder, note.updatedAt, trashedAt, deletedFrom, note.id);
      }
    });
    tx();
  }

  /** 远端把该笔记移入回收站（软删传播，删除压编辑）：本地 active → 移入回收站 + 标 local（由下载分支重新核对内容后 markSynced）。
   * 与 applyRemotePurge 不同：这是正常回收站条目（上云），不抑制上传；本地编辑由调用方先留档。 */
  applyRemoteMoveToTrash(id: string, trashedAt: string | null, deletedFromParentId: string | null): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        "UPDATE notes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,?),updated_at=?,sync_state='local',restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
      ).run(TRASH_NOTEBOOK_ID, trashedAt, deletedFromParentId, trashedAt ?? nowIso(), id);
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,?),updated_at=?,sync_state='local' WHERE note_file_id=? AND deleted_at IS NULL"
      ).run(TRASH_NOTEBOOK_ID, trashedAt, deletedFromParentId, trashedAt ?? nowIso(), id);
      this.db.prepare("DELETE FROM notes_fts WHERE note_id=?").run(id);
    });
    tx();
  }

  /** 远端恢复该笔记（移出回收站传播）：本地 trash 条目 → 移回原位置 + 清回收站字段，标 local 待下载分支对齐。 */
  applyRemoteRestore(id: string, parentId: string | null, updatedAt: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        "UPDATE notes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,sync_state='local',restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
      ).run(parentId, updatedAt, id);
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,sync_state='local' WHERE note_file_id=? AND deleted_at IS NULL"
      ).run(parentId, updatedAt, id);
      const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
      if (titleRow) {
        const caches = this.readNoteCaches(id);
        this.searchRepository.upsert(id, titleRow.title, caches.plain ?? null);
      }
    });
    tx();
  }

  /** 收到他端 purge 墓碑：把本地条目移入回收站并标 purged（保留可恢复、不上传）。
   * 与软删不同——purge 不广播强制删除，其他端保留恢复路子。 */
  applyRemotePurge(id: string): void {
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare(
        "UPDATE notes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,sync_state='purged' WHERE id=? AND deleted_at IS NULL"
      ).run(TRASH_NOTEBOOK_ID, now, now, id);
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=COALESCE(trashed_at,?),deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id),updated_at=?,sync_state='purged' WHERE note_file_id=? AND deleted_at IS NULL"
      ).run(TRASH_NOTEBOOK_ID, now, now, id);
      this.db.prepare("DELETE FROM notes_fts WHERE note_id=?").run(id);
    });
    tx();
  }

  /** 记录"从云端学到的删除"（本设备从未持有该笔记）：与本地删除同语义，
   * 防止 manifest 的 deleted 标记因设备清空/换机而丢失（审计 #2）。 */
  rememberDeleted(note: SyncNote, deletedAt: string): void {
    // 不用 INSERT OR REPLACE：purge 后该行已带 purged_at，若被远端墓碑重插会清空 purged_at，
    // 导致 listPurgedNotesForSync 漏掉、S3 对象前缀永远不删。
    // node_type=note（只有 manifest.notes 条目会触发 remember；folder 不进 manifest.notes）；
    // published_at=deletedAt：学到即已在云端发布（该墓碑来自 manifest），不计入待上传；
    // ON CONFLICT 不清已有 published_at（本地 purge 后恰逢远端墓碑重插时不误标已发布）。
    this.db.prepare(
      "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,node_type,published_at) VALUES(?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, node_type=excluded.node_type, published_at=COALESCE(deleted_notes.published_at, excluded.published_at)"
    ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, deletedAt, "note", deletedAt);
  }

  /** purge 前缀删除成功后，清除 purged_at（保留墓碑，避免下次同步重复删前缀）。 */
  markPurgeSynced(id: string): void {
    this.db.prepare("UPDATE deleted_notes SET purged_at=NULL WHERE id=?").run(id);
  }

  listDeletedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; nodeType: string }> {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,deleted_at,node_type FROM deleted_notes ORDER BY deleted_at"
    ).all().map((value) => {
      const r = value as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string; deleted_at: string; node_type: string };
      return {
        id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
        updatedAt: r.updated_at, deletedAt: r.deleted_at, nodeType: r.node_type ?? "note",
      };
    });
  }

  /** 墓碑已发布到 manifest（发布成功后由 syncEngine 调用）：标记 published_at，从待上传计数中移除。
   * 墓碑本体永久保留（防 manifest 删除标记因他端 B4 移除而丢失 → 离线设备复活，审计 #2）。 */
  markTombstonesPublished(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(
      "UPDATE deleted_notes SET published_at=COALESCE(published_at, ?) WHERE id IN (" + placeholders + ") AND node_type != 'folder'"
    ).run(nowIso(), ...ids);
  }

  /** 零变更早退：本设备上次成功读/写的 manifest commitId（device_state）。 */
  getLastSeenCommitId(): string | null {
    const row = this.db.prepare("SELECT value FROM device_state WHERE key='last_seen_commit_id'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }
  setLastSeenCommitId(commitId: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_seen_commit_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(commitId);
  }

  /** 本地上次同步时的墓碑签名（COUNT:MAX(deleted_at)），早退判定"是否新增了 purge"。 */
  getLastTombstoneSig(): string {
    const row = this.db.prepare("SELECT value FROM device_state WHERE key='last_tombstone_sig'").get() as { value: string } | undefined;
    return row?.value ?? "";
  }
  setLastTombstoneSig(sig: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_tombstone_sig',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(sig);
  }
  tombstoneSignature(): string {
    const row = this.db.prepare("SELECT COUNT(*) AS c, COALESCE(MAX(deleted_at),'') AS m FROM deleted_notes").get() as { c: number; m: string };
    return `${row.c}:${row.m}`;
  }

  getSyncPendingSummary(): { documents: number; resources: number; generatedAt: string } {
    // purged（收到他端删除的保留副本）永不上传、永不标 synced，不计入待上传（否则计数永远虚高）。
    const pendingRows = this.noteQueries.listNotesForSync().filter((note) => note.syncState !== "synced" && note.syncState !== "purged");
    let resources = 0;
    for (const note of pendingRows) {
      try { resources += extractAssetRefs(fs.readFileSync(this.notePath(note.id), "utf8")).size; }
      catch { /* missing/corrupt content is reported by sync itself; summary stays best-effort */ }
    }
    // 待上传墓碑 = 未发布（published_at IS NULL）的 note 墓碑；folder 墓碑仅本地下载过滤、永不发布，不计入。
    // NULL node_type（历史行）按 note 处理（发布后即标 published → 计数归零）。
    const tombstones = (this.db.prepare(
      "SELECT COUNT(*) AS count FROM deleted_notes WHERE (node_type IS NULL OR node_type != 'folder') AND published_at IS NULL"
    ).get() as { count: number }).count;
    return { documents: pendingRows.length + tombstones, resources, generatedAt: nowIso() };
  }

  /** 是否有本地待上传变更（早退判定）：notes 非 synced（含锁/元数据变更）或纯目录/分组改动（V5 §5.1）。
   * group/notebook 节点无 note_file_id，rename/icon/reorder 只写 tree_nodes；
   * 排除回收站笔记本：固定节点不进 manifest.folders（listFoldersForSync 排除），其 local 状态不应阻塞早退。
   * purged（收到他端删除的保留副本）也排除：永不上传，不应阻塞早退。 */
  hasLocalPendingNotes(): boolean {
    const noteRow = this.db.prepare("SELECT 1 FROM notes WHERE sync_state NOT IN ('synced','purged') AND deleted_at IS NULL LIMIT 1").get();
    if (noteRow) return true;
    const groupRow = this.db.prepare(
      "SELECT 1 FROM tree_nodes WHERE sync_state != 'synced' AND note_file_id IS NULL AND id != ? LIMIT 1"
    ).get(TRASH_NOTEBOOK_ID);
    return !!groupRow;
  }

  /** 批量读取同步基线信息（一次性取回，替代逐条 lastSyncedMetaAt 查询 + 支撑记账去重）。 */
  allSyncBaseInfo(): Map<string, { syncState: string; updatedAt: string; baseHash: string | null; lastSyncedMetaAt: string | null; lastUploadedHash: string | null }> {
    const rows = this.db.prepare(
      "SELECT n.id,n.sync_state,n.updated_at,s.content_hash,s.last_synced_meta_at,s.last_uploaded_hash FROM notes n LEFT JOIN sync_base s ON s.note_id=n.id WHERE n.deleted_at IS NULL"
    ).all() as Array<{ id: string; sync_state: string; updated_at: string; content_hash: string | null; last_synced_meta_at: string | null; last_uploaded_hash: string | null }>;
    return new Map(rows.map((r) => [r.id, {
      syncState: r.sync_state, updatedAt: r.updated_at, baseHash: r.content_hash ?? null,
      lastSyncedMetaAt: r.last_synced_meta_at ?? null, lastUploadedHash: r.last_uploaded_hash ?? null,
    }]));
  }

  /** 本地已彻底删除（purge）的 folder/group（deleted_notes 带 purged_at）——同步下载过滤/发布强制移除用。 */
  isFolderPurged(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM deleted_notes WHERE id=? AND purged_at IS NOT NULL").get(id);
  }

  /** 已彻底删除（purge）的墓碑：下次同步需立即删 S3 前缀。 */
  listPurgedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; purgedAt: string }> {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,deleted_at,purged_at FROM deleted_notes WHERE purged_at IS NOT NULL ORDER BY purged_at"
    ).all().map((value) => {
      const r = value as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string; deleted_at: string; purged_at: string };
      return {
        id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
        updatedAt: r.updated_at, deletedAt: r.deleted_at, purgedAt: r.purged_at,
      };
    });
  }

  /** 导入远程笔记：写 .lake + note-assets 资源 + upsert DB 记录。 */
  importRemoteNote(note: SyncNote, content: Buffer, assets: Array<{ filename: string; bytes: Buffer }>): void {
    this.remoteImport.importNote(note, content, assets);
  }

  async uploadResource(input: { bytes: number[]; filename: string }, noteId: string): Promise<ResourceUploadOutput> {
    return this.resourceRepository.upload(input, noteId);
  }

  async downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput> {
    return this.resourceRepository.downloadRemote(url, noteId);
  }

}
