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
import { SearchRepository } from "./searchRepository.js";
import type { SearchResult } from "../src/core/searchTypes.js";
import { HistoryRepository, type HistorySnapshotPreview, type HistorySnapshotSummary } from "./historyRepository.js";
import { TrashRepository } from "./trashRepository.js";
import { TrashLifecycle } from "./trashLifecycle.js";
import { HistoryLifecycle } from "./historyLifecycle.js";
import { OrphanLifecycle } from "./orphanLifecycle.js";
import { Diagnostics } from "./diagnostics.js";
import { SyncReconciliation } from "./syncReconciliation.js";
import type { TrashItem, TrashReminderItem } from "./trashRepository.js";
export type { TrashItem, TrashReminderItem };
import { AssetRepository, type OrphanAsset, type OrphanAssetRow } from "./assetRepository.js";
import { NoteQueries } from "./noteQueries.js";
import type { NoteSummary, SummaryRow, SyncFolder, SyncNote, TreeNode, TreeNodeRow } from "./noteQueries.js";
import { NoteMetadataRepository } from "./noteMetadataRepository.js";
import { NoteContentRepository, type NoteCacheInput } from "./noteContentRepository.js";
import { mimeTypeForFilename } from "../src/core/imageUtils.js";
import { createPlaintextSecretCipher, type SecretCipher } from "../src/core/secretCipher.js";
import type { DbLike } from "./dbLike.js";
import { ResourceRepository } from "./resourceRepository.js";
import { RemoteImportRepository } from "./remoteImportRepository.js";
import type { ResourceUploadOutput, HistorySettings, HistoryCleanupResult } from "./storeTypes.js";
import { sqlParameterBatches } from "../src/core/sqlParameterBatch.js";

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

/** 历史保留策略配置（P5，可配置；存 settings 表，纯本地）——定义已收敛到 storeTypes.ts */
export type { HistorySettings, HistoryCleanupResult } from "./storeTypes.js";

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
  private trashLifecycle: TrashLifecycle;
  private historyLifecycle: HistoryLifecycle;
  private orphanLifecycle: OrphanLifecycle;
  private diagnostics: Diagnostics;
  private syncReconciliation: SyncReconciliation;
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
      detectOrphans: (noteId, content) => this.orphanLifecycle.detectOrphans(noteId, content),
      markHistoryDirty: (noteId) => this.markHistoryDirty(noteId),
    });
    this.resourceRepository = new ResourceRepository({
      noteAssetsDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      assetUrl: (noteId, filename) => this.assetUrl(noteId, filename),
      registerOrphan: (noteId, filename, size, mimeType) => this.orphanLifecycle.registerOrphan(noteId, filename, size, mimeType),
    });
    this.remoteImport = new RemoteImportRepository({
      db: this.db,
      workspaceId: DEFAULT_WORKSPACE_ID,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      notePathFor: (noteId) => this.notePath(noteId),
      assetDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      isSafeSegment: isSafePathSegment,
      detectOrphans: (noteId, content) => this.orphanLifecycle.detectOrphans(noteId, content),
      ensureNoteCaches: (noteId, content) => this.ensureNoteCaches(noteId, content),
      logImport: (noteId, bytes, assetCount, startedAt) => this.logScopes.store.info(`[perf] importRemoteNote ${noteId} ${Date.now() - startedAt}ms (lake=${bytes}B, assets=${assetCount})`),
    });
    this.assetRepository = new AssetRepository({
      db: this.db,
      notePathFor: (noteId) => this.notePath(noteId),
      extractAssetRefs,
    });
    this.orphanLifecycle = new OrphanLifecycle({
      db: this.db,
      root: this.root,
      noteAssetsDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      assetRepository: this.assetRepository,
    });
    this.diagnostics = new Diagnostics({
      db: this.db,
      root: this.root,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      noteAssetsDir: this.noteAssetsDir,
      notePathFor: (noteId) => this.notePath(noteId),
      noteAssetsDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      logScopes: this.logScopes,
    });
    this.searchRepository = new SearchRepository({
      db: this.db,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      ensureNoteCaches: (noteId) => this.ensureNoteCaches(noteId),
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
    });
    this.syncReconciliation = new SyncReconciliation({
      db: this.db,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      notePathFor: (noteId) => this.notePath(noteId),
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
      listNotesForSync: () => this.noteQueries.listNotesForSync(),
    });
    this.historyLifecycle = new HistoryLifecycle({
      db: this.db,
      root: this.root,
      logScopes: this.logScopes,
      notePathFor: (noteId) => this.notePath(noteId),
      atomicWrite: (filePath, content) => this.atomicWrite(filePath, content),
      updateNoteCaches: (noteId, markdown, plain) => this.updateNoteCaches(noteId, markdown, plain),
      getHistorySettings: () => this.getHistorySettings(),
      cleanupUnreferencedAssetsForNote: (noteId) => this.orphanLifecycle.cleanupUnreferencedAssetsForNote(noteId),
    });
    this.trashLifecycle = new TrashLifecycle({
      db: this.db,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      notePathFor: (noteId) => this.notePath(noteId),
      noteAssetsDir: this.noteAssetsDir,
      historyNoteDirFor: (noteId) => this.historyLifecycle.historyNoteDir(noteId),
      logScopes: this.logScopes,
      readTreeNode: (id) => this.readTreeNode(id),
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
      resolveParentNotebook: () => this.resolveParentNotebook(),
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
    const cols = this.db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "is_locked")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.some((c) => c.name === "locked_at")) {
      this.db.exec("ALTER TABLE notes ADD COLUMN locked_at TEXT");
    }
    // B3（冲突归档保护）：superseded 快照保护窗口（protected_until 未到不自动清理；手动删除不受限）
    const histCols = this.db.prepare("PRAGMA table_info(note_history)").all() as Array<{ name: string }>;
    if (!histCols.some((c) => c.name === "protected_until")) {
      this.db.exec("ALTER TABLE note_history ADD COLUMN protected_until TEXT");
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
    // 回收站笔记本：固定 ID 每端本地初始化；侧栏/搜索/同步 folder 全部排除。唯一机制容器，不可删。
    this.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
      VALUES(?,?,?,?,?,NULL,0,?,?,NULL,'synced',0)`).run(TRASH_NOTEBOOK_ID, DEFAULT_WORKSPACE_ID, null, "notebook", "回收站", now, now);
    // 种子笔记本：仅全新库首次初始化自动创建一个普通笔记本（固定 ID 仅为多端首启同步一致）。
    // 行为与用户手动创建的笔记本完全相同——可删/改名/purge、无任何默认/特殊地位；
    // seed_initialized 标记保证用户删除（含 purge）后**不复活**。
    const seeded = this.db.prepare("SELECT value FROM device_state WHERE key='seed_initialized'").get() as { value: string } | undefined;
    if (!seeded) {
      this.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
        VALUES(?,?,?,?,?,NULL,0,?,?,NULL,'local',0)`).run(DEFAULT_NOTEBOOK_ID, DEFAULT_WORKSPACE_ID, null, "notebook", "个人笔记", now, now);
      // Migrate any notes not yet in tree_nodes（旧库升级兜底）
      this.db.prepare(`INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
        SELECT id,?,COALESCE(parent_id,?),'note',title,id,sort_order,updated_at,updated_at,deleted_at,sync_state,is_conflict
        FROM notes WHERE id NOT IN (SELECT id FROM tree_nodes)`).run(DEFAULT_WORKSPACE_ID, DEFAULT_NOTEBOOK_ID);
      this.db.prepare("UPDATE notes SET parent_id=? WHERE parent_id IS NULL").run(DEFAULT_NOTEBOOK_ID);
      this.db.prepare("INSERT INTO device_state(key,value) VALUES('seed_initialized','1')").run();
    }
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
    // 无默认笔记本概念：无父新建落到兜底父笔记本（任意存在的笔记本；无则自动创建"未分类"）
    return this.createNoteIn(this.resolveParentNotebook(), title);
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
    const parent = parentId ?? this.resolveParentNotebook();
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
    // P1-2a：免回读——正文即入参 content（刚写入的同一字符串），不再 readFileSync 全文重读 +
    // IPC 全文回传；轻量 SELECT 只取元数据（无文件 IO）。副作用修正：保存不再误写
    // last_opened_note_id（那是「打开」语义，保存非活动文档不应改「最后打开」记录）。
    const row = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at FROM notes WHERE id=? AND deleted_at IS NULL"
    ).get(id);
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    return { ...this.noteQueries.mapSummary(row as SummaryRow), content };
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
    this.diagnostics.checkpointWal();
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

  /** 创建历史快照。content 缺省时读磁盘 .lake；protectedDays>0 时写 protected_until（冲突归档保护，B3）。
   * 返回快照 id；同 hash 且 24h 内已有则跳过返回 null。 */
  createHistorySnapshot(noteId: string, content?: string, force = false, protectedDays?: number): number | null {
    return this.historyLifecycle.createHistorySnapshot(noteId, content, force, protectedDays);
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
    return this.orphanLifecycle.previewNoteOrphan(noteId, filename);
  }

  /** 恢复历史版本（恢复前留档 + 解压写回 + 标 local 待上传；语义详见 historyLifecycle）。 */
  restoreHistory(historyId: number): void {
    this.historyLifecycle.restoreHistory(historyId);
  }

  /** 手动删除单个历史快照（文件 + DB）。调用方随后刷新孤儿列表（顺序 §5）。 */
  deleteHistory(historyId: number): void {
    this.historyLifecycle.deleteHistory(historyId);
  }

  /** 惰性清理：每文档超上限删最旧 + 天数兜底；删除后重算引用，无引用资源物理删（方案 A）。 */
  cleanupHistory(): HistoryCleanupResult {
    return this.historyLifecycle.cleanupHistory();
  }

  /** 历史占用统计（U6/P4：设置面板展示"快照总数 + 占用字节"）。 */
  getHistoryStats(): { snapshotCount: number; totalBytes: number } {
    return this.historyRepository.stats();
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
    return this.orphanLifecycle.listNoteOrphans(noteId);
  }

  /** 清理文档级孤儿：只删非 protectedByHistory 的文件（被历史引用的跳过）。
   * filenames 缺省清全部可清。 */
  cleanNoteOrphans(noteId: string, filenames?: string[]): { count: number; freedBytes: number } {
    return this.orphanLifecycle.cleanNoteOrphans(noteId, filenames);
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

  /**
   * 无父新建/恢复/同步兜底的父笔记本（系统中没有"默认笔记本"——所有笔记本都是普通笔记本）：
   * 1. 任意存在的笔记本（非回收站，sortOrder 最小）→ 用它；
   * 2. 否则自动创建一个普通笔记本"未分类"（随机 ID + 图标 X，与用户手动创建完全一致，可随意删除）。
   * 仅在"必须给内容一个家"（新建/恢复/同步导入，数据不丢红线）时自动创建。
   */
  private resolveParentNotebook(): string {
    // 回收站容器（notebook-trash）本身也是根层 notebook，必须显式排除；
    // 根层笔记本 parent_id 为 NULL：parent_id != ? 对 NULL 恒不成立（SQL 三值逻辑），必须显式允许 NULL
    const any = this.db.prepare(
      "SELECT id FROM tree_nodes WHERE node_type='notebook' AND deleted_at IS NULL AND id != ? AND (parent_id IS NULL OR parent_id != ?) ORDER BY sort_order LIMIT 1"
    ).get(TRASH_NOTEBOOK_ID, TRASH_NOTEBOOK_ID) as { id: string } | undefined;
    if (any) return any.id;
    const created = this.createNotebook("未分类");
    try { this.setNodeIcon(created.id, "X"); } catch { /* 图标设置失败不影响兜底 */ }
    return created.id;
  }

  /**
   * 软删除（移入隐藏回收站笔记本）：记录 trashed_at + 删除前父目录，标 local 待上传；
   * 不写墓碑（回收站条目是普通条目，移动即同步传播）；文件保留；彻底删除走 purgeTrashItem。
   */
  deleteTreeNode(id: string) {
    this.trashLifecycle.deleteTreeNode(id);
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
    return this.trashLifecycle.autoPurgeExpiredTrash(days);
  }

  /** 审计（编辑即恢复）：编辑"他端已 purge、本端保留"（sync_state='purged'）的回收站条目时，
   * 视为一次显式恢复（移出回收站 + restore_pending_at，D2 例外）。返回是否发生了恢复。 */
  revivePurgedIfNeeded(id: string): boolean {
    return this.trashLifecycle.revivePurgedIfNeeded(id);
  }

  /** 恢复回收站节点：移回原位置（deleted_from_parent_id）；原父不存在/已被删/在回收站 → 默认笔记本。 */
  restoreTrashItem(id: string): void {
    this.trashLifecycle.restoreTrashItem(id);
  }

  /**
   * 撤销本地删除（sync 下载分支在"远端恢复较新"时调用）：清 purge 墓碑。
   * 语义详见 trashLifecycle（不强制标 local——远端为权威，随后由下载/对账流程对齐并 markSynced）。
   */
  revokeLocalDeletion(id: string): void {
    this.trashLifecycle.revokeLocalDeletion(id);
  }

  /** 彻底删除回收站节点（不可恢复）：物理删子树 + 写 purge 墓碑（deleted_notes，带 purged_at）。 */
  purgeTrashItem(id: string): void {
    this.trashLifecycle.purgeTrashItem(id);
  }

  /** 清空回收站：彻底删除 trash 笔记本的全部根节点（各 purge 连带子树，写 purge 墓碑）。 */
  emptyTrash(): void {
    this.trashLifecycle.emptyTrash();
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

  /** 单条删除未引用资源（与 cleanOrphanAssets 同规则：清理前按当前正文/历史引用再校验）。 */
  deleteOrphanAsset(id: number): { deleted: boolean; freedBytes: number } {
    return this.orphanLifecycle.deleteOrphanAsset(id);
  }

  /** 读取孤儿文件预览（仅图片返回 dataUrl；其它类型/过大返回 supported=false）。 */
  readOrphanPreview(id: number): { filename: string; mimeType: string; supported: boolean; dataUrl?: string } {
    return this.orphanLifecycle.readOrphanPreview(id);
  }

  /** 按 noteId+filename 直接读取 note-assets 下文件预览（未引用资源/历史保护文件共用；路径双段校验）。 */
  readAssetPreview(noteId: string, filename: string): { filename: string; mimeType: string; supported: boolean; dataUrl?: string } {
    return this.orphanLifecycle.readAssetPreview(noteId, filename);
  }

  /** 全局“未引用/被移除资源”汇总（orphan 可删 / history 受保护；设置页聚合）。 */
  listRemovedAssets(): Array<{
    noteId: string; filename: string; status: "orphan" | "history"; orphanId?: number;
    size: number; mimeType: string; noteTitle: string; noteState: "active" | "trash" | "missing"; detectedAt?: string;
  }> {
    return this.orphanLifecycle.listRemovedAssets();
  }

  listOrphanAssets(): OrphanAsset[] {
    return this.orphanLifecycle.listOrphanAssets();
  }

  /** 某笔记当前登记的孤儿文件名集合（供“孤儿不同步上传”过滤与 UI 幂等）。 */
  orphanFilenamesForNote(noteId: string): Set<string> {
    return this.orphanLifecycle.orphanFilenamesForNote(noteId);
  }

  cleanOrphanAssets(): { count: number; freedBytes: number } {
    return this.orphanLifecycle.cleanOrphanAssets();
  }

  /** 关于页「数据与存储」概览（只读）：库内计数 + 资源目录浅两层遍历（不做全盘扫描）。
   * 小记在独立库（quick-notes/metadata.sqlite3），计数由调用方补（见 registerSystemInfo）。 */
  getStorageOverview(): {
    root: string; dbBytes: number;
    notes: number; notebooks: number; groups: number; trashedNodes: number; tombstones: number;
    historySnapshots: number; historyBytes: number;
    assetFiles: number; assetBytes: number; orphanRows: number;
  } {
    return this.diagnostics.getStorageOverview();
  }

  // ===== A3 数据体检（只读诊断：不自动修复、不写库） =====

  /** 只读四查（notes↔文件、history↔快照、孤儿登记漂移、树完整性 + 资源引用；语义详见 diagnostics）。 */
  runDataHealthCheck(): {
    notesChecked: number;
    notesMissingFile: Array<{ id: string; title: string }>;
    notesHashMismatch: Array<{ id: string; title: string }>;
    historyChecked: number;
    historyMissingFile: number;
    historyMissingSample: Array<{ id: number; noteId: string; filePath: string }>;
    orphanRowsChecked: number;
    orphanRowsFileMissing: Array<{ id: number; noteId: string; filename: string }>;
    treeChecked: number;
    treeDanglingParent: Array<{ id: string; title: string; parentId: string }>;
    refsChecked: number;
    refsMissingResource: Array<{ noteId: string; filename: string }>;
    checkedAt: string;
  } {
    return this.diagnostics.runDataHealthCheck();
  }

  /** A1 一致性 DB 快照：VACUUM INTO 单文件（无 WAL 依赖、可独立打开）。 */
  backupDatabaseTo(targetPath: string): void {
    this.diagnostics.backupDatabaseTo(targetPath);
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

  /** A2 恢复 seed：导出 settings 表原始行（secretAccessKey 为 enc:v1: 密文，绝不解密成明文）。无配置 → null。 */
  exportS3SettingsRow(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='s3_settings'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** A2 恢复 seed：把密文行原样写回（不经 saveS3Settings，避免二次加密）。 */
  importS3SettingsRow(value: string): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('s3_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
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
    return this.syncReconciliation.contentHash(id);
  }

  baseHash(id: string): string | null {
    return this.syncReconciliation.baseHash(id);
  }

  setBaseHash(id: string, hash: string): void {
    this.syncReconciliation.setBaseHash(id, hash);
  }

  /** P0-1：本机最后一次成功上传某文档的 hash；null = 清除（两端一致 skip 记账用）。 */
  setLastUploadedHash(id: string, hash: string | null): void {
    this.syncReconciliation.setLastUploadedHash(id, hash);
  }

  /** P0-1：读本机最后一次上传的 hash（无则 null） */
  lastUploadedHash(id: string): string | null {
    return this.syncReconciliation.lastUploadedHash(id);
  }

  /** 统一冲突语义：本设备"上次成功同步时该笔记的 updated_at"（元数据已确认版本；无则 null）。 */
  lastSyncedMetaAt(id: string): string | null {
    return this.syncReconciliation.lastSyncedMetaAt(id);
  }

  /** 只读锁：本地操作；不触碰正文/updated_at，锁同步走 manifest v3 独立字段 */
  setNoteLocked(id: string, locked: boolean): void {
    this.noteMetadata.setNoteLocked(id, locked);
  }

  /** 同步合并写入（远端锁状态按 lockedAt LWW 后由调用方判定）。 */
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): void {
    this.noteMetadata.applyRemoteLock(id, locked, lockedAt);
  }

  /** 本地同步快照保护（V5 §5.2）：仅当本地状态与快照一致才标记 synced（语义详见 syncReconciliation）。 */
  markSyncedIfUnchanged(noteId: string, expected: {
    contentHash: string; updatedAt: string; title: string; parentId: string | null;
    sortOrder: number; isLocked: boolean; lockedAt: string | null; icon: string | null;
  }): boolean {
    return this.syncReconciliation.markSyncedIfUnchanged(noteId, expected);
  }

  markSynced(id: string): void {
    this.syncReconciliation.markSynced(id);
  }

  /** 目录/分组归位（V5 §5.1）：按构建 manifest 时的 updatedAt 快照条件归位。 */
  markFolderSynced(id: string, expectedUpdatedAt: string): boolean {
    return this.syncReconciliation.markFolderSynced(id, expectedUpdatedAt);
  }

  /** 是否处于"回收站恢复后待同步"状态（墓碑权威下唯一 local-wins 例外）。 */
  isRestorePending(id: string): boolean {
    return this.syncReconciliation.isRestorePending(id);
  }

  /** 是否处于待上传/本地未对齐状态（sync_state != synced）。 */
  isSyncPending(id: string): boolean {
    return this.syncReconciliation.isSyncPending(id);
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

  addS3GcPending(key: string, markedAt?: string): void {
    this.syncReconciliation.addS3GcPending(key, markedAt);
  }

  removeS3GcPending(keys: string[]): void {
    this.syncReconciliation.removeS3GcPending(keys);
  }

  listS3GcPending(): Array<{ key: string; markedAt: string }> {
    return this.syncReconciliation.listS3GcPending();
  }
  /** A 方案：记录 manifest 声明的资产元数据（即使本地文件缺失，上传 union 仍可正确声明）。 */
  recordDeclaredAssets(noteId: string, assets: Array<{ filename: string; size: number; hash: string }>): void {
    this.syncReconciliation.recordDeclaredAssets(noteId, assets);
  }

  /** A 方案：列出该笔记已声明（含本地缺失但 manifest 声明过）的资产元数据。 */
  listDeclaredAssets(noteId: string): Array<{ filename: string; size: number; hash: string }> {
    return this.syncReconciliation.listDeclaredAssets(noteId);
  }

  recordS3GcLog(action: string, key: string, reason: string, commitId: string | null, deviceId: string | null, ok: boolean): void {
    this.syncReconciliation.recordS3GcLog(action, key, reason, commitId, deviceId, ok);
  }

  listS3GcLog(): Array<{ id: number; ts: string; action: string; key: string; reason: string; commitId: string | null; deviceId: string | null; ok: boolean }> {
    return this.syncReconciliation.listS3GcLog();
  }

  markSyncComplete(at: string): void {
    this.syncReconciliation.markSyncComplete(at);
  }

  recordSyncResult(json: string): void {
    this.syncReconciliation.recordSyncResult(json);
  }

  /** P4：记录最近一次历史清理结果（自动/手动），供设置面板展示与排查 */
  recordHistoryCleanup(result: HistoryCleanupResult): void {
    this.syncReconciliation.recordHistoryCleanup(result);
  }

  getLastHistoryCleanup(): { at: string; deletedSnapshots: number; freedBytes: number } | null {
    return this.syncReconciliation.getLastHistoryCleanup();
  }

  /** 已写入同步清单的删除标记可安全剪除，避免 deleted_notes 无限累积 */
  pruneTombstones(ids: string[]): void {
    this.syncReconciliation.pruneTombstones(ids);
  }

  getSyncStatus(): { lastSyncedAt: string | null; lastResult: Record<string, unknown> | null } {
    return this.syncReconciliation.getSyncStatus();
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

  /** P3-1：单行同步元数据查询（getNote/记账路径用，替代全表 .find()）。 */
  getNoteForSync(id: string): SyncNote | null {
    return this.noteQueries.getNoteForSync(id);
  }

  /** 同步目录树：活动 notebook/group（不包含隐藏回收站笔记本）。 */
  listFoldersForSync(): SyncFolder[] {
    return this.noteQueries.listFoldersForSync();
  }

  /** 导入远端 notebook/group 节点。 */
  importRemoteFolder(folder: SyncFolder): void {
    this.noteMetadata.importRemoteFolder(folder);
  }

  /** 兜底父笔记本（无默认笔记本概念）：存在的笔记本 → 无则自动创建"未分类"（见 resolveParentNotebook）。 */
  defaultNotebookId(): string {
    return this.resolveParentNotebook();
  }

  hasTreeNode(id: string): boolean {
    return this.noteMetadata.hasTreeNode(id);
  }

  /** 正文 hash 相同、仅元数据变化（标题/父目录/排序/图标/回收站字段）时的对账。 */
  applyRemoteNoteMeta(note: SyncNote): void {
    this.syncReconciliation.applyRemoteNoteMeta(note);
  }

  /** 远端把该笔记移入回收站（软删传播，删除压编辑；详见 syncReconciliation）。 */
  applyRemoteMoveToTrash(id: string, trashedAt: string | null, deletedFromParentId: string | null): void {
    this.syncReconciliation.applyRemoteMoveToTrash(id, trashedAt, deletedFromParentId);
  }

  /** 远端恢复该笔记（移出回收站传播）：移回原位置 + 清回收站字段，标 local 待下载分支对齐。 */
  applyRemoteRestore(id: string, parentId: string | null, updatedAt: string): void {
    this.syncReconciliation.applyRemoteRestore(id, parentId, updatedAt);
  }

  /** 收到他端 purge 墓碑：本地条目移入回收站并标 purged（保留可恢复、不上传）。 */
  applyRemotePurge(id: string): void {
    this.syncReconciliation.applyRemotePurge(id);
  }

  /** 记录"从云端学到的删除"（防 manifest 删除标记因设备清空/换机丢失，审计 #2）。 */
  rememberDeleted(note: SyncNote, deletedAt: string): void {
    this.syncReconciliation.rememberDeleted(note, deletedAt);
  }

  /** purge 前缀删除成功后，清除 purged_at（保留墓碑，避免下次同步重复删前缀）。 */
  markPurgeSynced(id: string): void {
    this.syncReconciliation.markPurgeSynced(id);
  }

  listDeletedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; nodeType: string }> {
    return this.syncReconciliation.listDeletedNotesForSync();
  }

  /** 墓碑已发布到 manifest：标记 published_at；墓碑本体永久保留（审计 #2）。 */
  markTombstonesPublished(ids: string[]): void {
    this.syncReconciliation.markTombstonesPublished(ids);
  }

  /** 零变更早退：本设备上次成功读/写的 manifest commitId（device_state）。 */
  getLastSeenCommitId(): string | null {
    return this.syncReconciliation.getLastSeenCommitId();
  }
  setLastSeenCommitId(commitId: string): void {
    this.syncReconciliation.setLastSeenCommitId(commitId);
  }

  /** 本地上次同步时的墓碑签名（COUNT:MAX(deleted_at)），早退判定"是否新增了 purge"。 */
  getLastTombstoneSig(): string {
    return this.syncReconciliation.getLastTombstoneSig();
  }
  setLastTombstoneSig(sig: string): void {
    this.syncReconciliation.setLastTombstoneSig(sig);
  }
  tombstoneSignature(): string {
    return this.syncReconciliation.tombstoneSignature();
  }

  /** 廉价 pending 指纹（三个索引级 COUNT，微秒级）：IPC 层每次调用后 diff，变化才广播完整摘要。 */
  pendingSignature(): string {
    return this.syncReconciliation.pendingSignature();
  }

  getSyncPendingSummary(): { documents: number; folders: number; resources: number; generatedAt: string } {
    return this.syncReconciliation.getSyncPendingSummary();
  }

  /** 是否有本地待上传变更（早退判定；详见 syncReconciliation）。 */
  hasLocalPendingNotes(): boolean {
    return this.syncReconciliation.hasLocalPendingNotes();
  }

  /** 批量读取同步基线信息（一次性取回，替代逐条 lastSyncedMetaAt 查询 + 支撑记账去重）。 */
  allSyncBaseInfo(): Map<string, { syncState: string; updatedAt: string; baseHash: string | null; lastSyncedMetaAt: string | null; lastUploadedHash: string | null }> {
    return this.syncReconciliation.allSyncBaseInfo();
  }

  /** 本地已彻底删除（purge）过的 folder/group（永久判定，node_type='folder' 墓碑；详见 syncReconciliation）。 */
  isFolderPurged(id: string): boolean {
    return this.syncReconciliation.isFolderPurged(id);
  }

  /** 已彻底删除（purge）的墓碑：下次同步需立即删 S3 前缀。 */
  listPurgedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; purgedAt: string }> {
    return this.syncReconciliation.listPurgedNotesForSync();
  }

  /** 导入远程笔记：写 .lake + note-assets 资源 + upsert DB 记录。 */
  importRemoteNote(note: SyncNote, content: Buffer, assets: Array<{ filename: string; bytes: Buffer }>): void {
    this.remoteImport.importNote(note, content, assets);
  }

  async uploadResource(input: { bytes: Uint8Array; filename: string }, noteId: string): Promise<ResourceUploadOutput> {
    return this.resourceRepository.upload(input, noteId);
  }

  async downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput> {
    return this.resourceRepository.downloadRemote(url, noteId);
  }

}
