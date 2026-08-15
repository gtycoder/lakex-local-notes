import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import os from "node:os";
import { net, safeStorage } from "electron";
import { ASSET_PORT } from "./assetServer.js";
import { mdToHtml, wrapHtmlPage } from "./mdToHtml.js";
import { lakeHtmlToMarkdown, lakeHtmlToPlain } from "./lakeCaches.js";
import { assertSafeRemoteHost, SsrfError } from "./ssrf.js";
import { log } from "./logger.js";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_NOTEBOOK_ID = "notebook-personal";
/** 隐藏回收站笔记本（固定 ID，每端本地初始化、不同步 folder；软删 = 移入此处）。 */
export const TRASH_NOTEBOOK_ID = "notebook-trash";

/**
 * 从 Lake 正文（.lake HTML）提取引用的资源文件名。
 * Lake 序列化图片时把 URL 百分号编码嵌进 data: URL，但文件名
 * {13位时间戳}_{8位随机}.ext 只含字母数字/下划线/点，编码后原样保留。
 * 文件名全局唯一（时间戳+随机），按笔记目录隔离，因此匹配到的即为该笔记引用的资源。
 * 历史快照 refs_json 与孤儿判定共用此工具。
 */
export const ASSET_NAME_RE = /\d{13}_[0-9a-f]{8}\.(?:png|jpg|jpeg|gif|webp|avif)/g;
export function extractAssetRefs(content: string): Set<string> {
  return new Set([...content.matchAll(ASSET_NAME_RE)].map((m) => m[0]));
}
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// 下载外部图片的超时与请求头（移植自 Tauri 版 Rust 后端，见 lake-notes-tauri-poc/src-tauri/src/store.rs）
const DOWNLOAD_TIMEOUT_MS = 30_000;
// 知乎等 CDN 的防盗链 403 有波动性，重试可显著提高成功率
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_MAX_REDIRECTS = 5;
const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class AppError extends Error {
  constructor(public kind: "NotFound" | "InvalidInput" | "Internal", message: string) {
    super(message);
  }
}

interface NoteSummary {
  id: string; title: string; parentId: string | null; sortOrder: number;
  updatedAt: string; syncState: string; isConflict: boolean;
  isLocked?: boolean;
  lockedAt?: string | null;
}
interface NoteDocument extends NoteSummary { content: string; }
interface TreeNode {
  id: string; workspaceId: string; parentId: string | null; nodeType: string;
  title: string; noteFileId: string | null; sortOrder: number; createdAt: string;
  updatedAt: string; syncState: string; isConflict: boolean; icon: string | null;
}
interface ResourceUploadOutput {
  url: string; resourceRef: string; filename: string; mimeType: string; size: number;
}
interface OrphanAsset {
  id: number; noteId: string; filename: string; filePath: string; size: number; mimeType: string; detectedAt: string;
}
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
interface SyncNote {
  id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string;
  /** 仅本地 listNotesForSync 提供；远端导入/元数据字面量可省略（视为非 synced，走全量路径）。 */
  syncState?: string; isConflict: boolean;
  isLocked?: boolean; lockedAt?: string | null; icon?: string | null;
  /** 回收站条目：进入回收站时间（自动过期基准）与删除前父目录（恢复位置）。 */
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
}
interface RemoteAsset {
  filename: string; size: number; hash: string;
}

/** 仅供主进程内部的小记转换调用。sourcePath 绝不来自渲染进程。 */
export interface ImportedNoteAsset {
  filename: string;
  sourcePath: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ISO 周年（周一起始）分桶键：用于「每周×30 天」分层保留。 */
export function isoWeekKey(t: number): string {
  const d = new Date(t);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // 1(周一)..7(周日)
  date.setUTCDate(date.getUTCDate() + 4 - day); // 移到该周周四
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 历史分层保留判定（M8）：近 24h 全留 / 每日×7 天 / 每周×30 天 / 硬上限 maxSnapshots。
 * 返回应删除的 created_at 集合。纯函数，便于单测。 */
export function selectHistoryDrops(createdAtList: string[], cfg: { maxSnapshots: number; retentionDays: number }): Set<string> {
  const now = Date.now();
  const recent = 24 * 3600 * 1000;
  const daily = 7 * 24 * 3600 * 1000;
  const weekly = 30 * 24 * 3600 * 1000;
  const cutoff = now - cfg.retentionDays * 24 * 3600 * 1000;
  const sorted = [...createdAtList].sort();
  const keep = new Set<string>();
  const dayLatest = new Map<string, string>();
  const weekLatest = new Map<string, string>();

  for (const ts of sorted) {
    const t = Date.parse(ts);
    if (t >= now - recent) { keep.add(ts); continue; }
    if (t >= now - daily) {
      const day = new Date(t).toISOString().slice(0, 10);
      const prev = dayLatest.get(day);
      if (prev === undefined || ts > prev) { if (prev !== undefined) keep.delete(prev); dayLatest.set(day, ts); keep.add(ts); }
      continue;
    }
    if (t >= now - weekly) {
      const week = isoWeekKey(t);
      const prev = weekLatest.get(week);
      if (prev === undefined || ts > prev) { if (prev !== undefined) keep.delete(prev); weekLatest.set(week, ts); keep.add(ts); }
      continue;
    }
    // 超出分层窗口：不主动 keep（是否兜底由 hard cap 决定）
  }

  // 硬上限：最多保留最新 maxSnapshots 份（0/负数视为至少 1，避免误删全部）
  const cap = Math.max(1, cfg.maxSnapshots);
  const capped = [...keep].sort().slice(-cap);
  const finalKeep = new Set(capped);
  const drops = new Set<string>();
  for (const ts of sorted) {
    if (!finalKeep.has(ts) || Date.parse(ts) < cutoff) drops.add(ts);
  }
  return drops;
}

function uuid(): string {
  return crypto.randomUUID();
}

export class Store {
  private db: Database.Database;
  private root: string;
  private noteAssetsDir: string;
  /** 15 分钟自动快照的 dirty 集合（saveNote 落盘时标记，flush 后清空，内存态） */
  private historyDirty = new Set<string>();

  constructor(root: string) {
    this.root = root;
    this.noteAssetsDir = path.join(root, "note-assets");
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.mkdirSync(this.noteAssetsDir, { recursive: true });
    this.db = new Database(path.join(root, "metadata.sqlite3"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.seed();
    // M2：全量重建全文索引（幂等；文档量小，启动开销可忽略）
    try { this.rebuildSearchIndex(); } catch (error) {
      console.warn("[store] 全文索引重建失败（不影响使用）:", error);
    }
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
        content_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deleted_notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT,
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL
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
    const deletedCols = this.db.prepare("PRAGMA table_info(deleted_notes)").all() as Array<{ name: string }>;
    if (!deletedCols.some((c) => c.name === "purged_at")) {
      this.db.exec("ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT");
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

  private mapSummary(row: any): NoteSummary {
    return { id: row.id, title: row.title, parentId: row.parent_id, sortOrder: row.sort_order,
      updatedAt: row.updated_at, syncState: row.sync_state, isConflict: !!row.is_conflict,
      isLocked: !!row.is_locked, lockedAt: row.locked_at ?? null };
  }

  private mapTreeNode(row: any): TreeNode {
    return { id: row.id, workspaceId: row.workspace_id, parentId: row.parent_id, nodeType: row.node_type,
      title: row.title, noteFileId: row.note_file_id, sortOrder: row.sort_order, createdAt: row.created_at,
      updatedAt: row.updated_at, syncState: row.sync_state, isConflict: !!row.is_conflict, icon: row.icon ?? null };
  }

  bootstrap() {
    const notes = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at FROM notes WHERE deleted_at IS NULL AND parent_id != ? ORDER BY sort_order"
    ).all(TRASH_NOTEBOOK_ID).map((r) => this.mapSummary(r));
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
    return this.db.prepare(
      `WITH RECURSIVE trash_ids(id) AS (
         SELECT ? FROM tree_nodes WHERE id=?
         UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
       )
       SELECT t.* FROM tree_nodes t
       WHERE t.workspace_id=? AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)
       ORDER BY t.sort_order`
    ).all(TRASH_NOTEBOOK_ID, TRASH_NOTEBOOK_ID, DEFAULT_WORKSPACE_ID).map((r) => this.mapTreeNode(r));
  }

  private readTreeNode(id: string): TreeNode {
    const row = this.db.prepare("SELECT * FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(id);
    if (!row) throw new AppError("NotFound", `节点不存在: ${id}`);
    return this.mapTreeNode(row);
  }

  readNote(id: string): NoteDocument {
    const row = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at FROM notes WHERE id=? AND deleted_at IS NULL"
    ).get(id);
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const content = fs.readFileSync(this.notePath(id), "utf8");
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_opened_note_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);
    return { ...this.mapSummary(row), content };
  }

  /** 轻量状态摘要：只读 DB 行（不读正文文件），供渲染进程在同步后判断打开 tab 是否需重载。
   * - 返回 null：笔记已被彻底删除（purge）或从未存在；
   * - deleted=true：软删除（回收站/远端删除墓碑已应用）；
   * - 否则 updatedAt/title 任一变化即代表正文或元数据被远端更新过。 */
  getNoteDigest(id: string): { id: string; title: string; updatedAt: string; deleted: boolean } | null {
    const row = this.db.prepare("SELECT id,title,updated_at,parent_id,sync_state FROM notes WHERE id=?").get(id) as
      { id: string; title: string; updated_at: string; parent_id: string | null; sync_state: string } | undefined;
    if (!row) return null;
    // TRASH-NOTEBOOK：deleted = 移入回收站（parentId=trash）或收到他端 purge 被抑制（purged）
    return { id: row.id, title: row.title, updatedAt: row.updated_at, deleted: row.parent_id === TRASH_NOTEBOOK_ID || row.sync_state === "purged" };
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
    const id = uuid();
    const now = nowIso();
    const sortOrder = this.nextSortOrder(null);
    this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,NULL,'notebook',?,NULL,?,?,?,'local',0)")
      .run(id, DEFAULT_WORKSPACE_ID, title, sortOrder, now, now);
    return this.readTreeNode(id);
  }

  createGroup(parentId: string, title: string): TreeNode {
    this.ensureParent(parentId);
    this.assertParentCompatible(parentId, "group");
    const id = uuid();
    const now = nowIso();
    const sortOrder = this.nextSortOrder(parentId);
    this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'group',?,NULL,?,?,?,'local',0)")
      .run(id, DEFAULT_WORKSPACE_ID, parentId, title, sortOrder, now, now);
    return this.readTreeNode(id);
  }

  renameTreeNode(id: string, title: string): TreeNode {
    const trimmed = title.trim();
    if (!trimmed) throw new AppError("InvalidInput", "名称不能为空");
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE tree_nodes SET title=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL").run(trimmed, now, id).changes;
      if (changed === 0) throw new AppError("NotFound", `节点不存在: ${id}`);
      this.db.prepare("UPDATE notes SET title=?,updated_at=?,sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL").run(trimmed, now, id);
      // M2：重命名后同步全文索引标题
      const node = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?").get(id) as { note_file_id: string | null } | undefined;
      if (node?.note_file_id) this.upsertFts(node.note_file_id, trimmed, null);
    });
    tx();
    return this.readTreeNode(id);
  }

  saveNote(id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }): NoteDocument {
    const p = this.notePath(id);
    if (!fs.existsSync(p)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const updatedAt = nowIso();
    const tx = this.db.transaction(() => {
      if (caches) {
        // M1 文本缓存：与正文同事务落库，保证缓存与 .lake 一致
        this.db.prepare("UPDATE notes SET title=?,updated_at=?,sync_state='local',md_cache=?,text_cache=? WHERE id=? AND deleted_at IS NULL")
          .run(title, updatedAt, caches.markdown ?? null, caches.plain ?? null, id);
        // M2：同步全文索引（正文用纯文本缓存）
        this.upsertFts(id, title, caches.plain ?? "");
      } else {
        this.db.prepare("UPDATE notes SET title=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL").run(title, updatedAt, id);
        this.upsertFts(id, title, null);
      }
      this.db.prepare("UPDATE tree_nodes SET title=?,updated_at=?,sync_state='local' WHERE note_file_id=? AND deleted_at IS NULL").run(title, updatedAt, id);
      this.atomicWrite(p, content);
    });
    tx();
    // 审计 #22：孤儿检测是后置维护任务，失败不应让已成功保存的笔记显示"保存失败"
    try {
      this.detectOrphans(id, content);
    } catch (error) {
      console.warn("[store] 孤儿资源检测失败（不影响保存）:", error);
    }
    // 15 分钟自动快照：落盘成功即标记 dirty（U1，dirty 由 saveNote 落盘驱动，与锁状态解耦）
    this.historyDirty.add(id);
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
    log.history.info(`[perf] flush-snapshots ${Date.now() - t0}ms (pending=${pending.length}, created=${created})`);
    return created;
  }

  /** M1：单独更新文本缓存（打开文档时补缓存用，不重写 .lake 正文） */
  updateNoteCaches(id: string, markdown: string | null, plain: string | null): void {
    this.db.prepare("UPDATE notes SET md_cache=?, text_cache=? WHERE id=?").run(markdown, plain, id);
    const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    this.upsertFts(id, titleRow?.title ?? "", plain ?? "");
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

  /** 同步单条笔记到 FTS 表（body 为空时仅索引标题） */
  private upsertFts(id: string, title: string, body: string | null): void {
    this.db.prepare("DELETE FROM notes_fts WHERE note_id=?").run(id);
    this.db.prepare("INSERT INTO notes_fts(title, body, note_id) VALUES(?,?,?)").run(title, body ?? "", id);
  }

  /** 全量重建全文索引：所有未删除 note 的标题 + 已有纯文本缓存正文 */
  /**
   * 全量重建全文索引（幂等）。对无文本缓存的文档先从磁盘 .lake 兜底生成缓存
   * （锁定态/同步下载未编辑的文档没有 md_cache/text_cache），再重建 FTS。
   * 已有缓存不覆盖（保留编辑态 Lake 内核生成的高质量缓存）。
   */
  rebuildSearchIndex(): void {
    this.db.exec("DELETE FROM notes_fts");
    const rows = this.db.prepare(`
      WITH RECURSIVE trash_ids(id) AS (
        SELECT ? FROM tree_nodes WHERE id=?
        UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
      )
      SELECT t.note_file_id AS id, t.title, n.text_cache
      FROM tree_nodes t LEFT JOIN notes n ON n.id = t.note_file_id
      WHERE t.node_type = 'note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids)
    `).all(TRASH_NOTEBOOK_ID, TRASH_NOTEBOOK_ID) as Array<{ id: string | null; title: string; text_cache: string | null }>;
    const ins = this.db.prepare("INSERT INTO notes_fts(title, body, note_id) VALUES(?,?,?)");
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        if (!r.id) continue;
        // 无缓存 → 兜底从磁盘 .lake 生成（幂等；已有缓存不覆盖）
        if (!r.text_cache) {
          try { this.ensureNoteCaches(r.id); } catch { /* 兜底失败不阻断重建 */ }
        }
        const caches = this.readNoteCaches(r.id);
        ins.run(r.title, caches.plain ?? "", r.id);
      }
    });
    tx();
  }

  /**
   * M2 全文搜索。≥3 字走 FTS5 trigram（中文子串命中 + highlight 高亮）；
   * 1-2 字 trigram 匹配不到，回退标题 LIKE（文档量小可接受）。
   */
  searchNotes(query: string, limit = 30): Array<{ id: string; title: string; snippet: string }> {
    const q = query.trim();
    if (!q) return [];
    if (q.length >= 3) {
      const match = escapeFtsQuery(q);
      const rows = this.db.prepare(
        "SELECT note_id, title, highlight(notes_fts, 1, '<mark>', '</mark>') AS snippet FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?"
      ).all(match, limit) as Array<{ note_id: string; title: string; snippet: string }>;
      return rows.map((r) => ({ id: r.note_id, title: r.title, snippet: r.snippet ?? "" }));
    }
    // 短查询回退：标题包含匹配
    const rows = this.db.prepare(
      `WITH RECURSIVE trash_ids(id) AS (
         SELECT ? FROM tree_nodes WHERE id=?
         UNION ALL SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id
       )
       SELECT t.id, t.title, '' AS snippet FROM tree_nodes t
       WHERE t.node_type='note' AND t.deleted_at IS NULL AND t.id NOT IN (SELECT id FROM trash_ids) AND t.title LIKE ?
       ORDER BY t.sort_order LIMIT ?`
    ).all(TRASH_NOTEBOOK_ID, TRASH_NOTEBOOK_ID, `%${q}%`, limit) as Array<{ id: string; title: string; snippet: string }>;
    return rows.map((r) => ({ id: r.id, title: r.title, snippet: r.snippet ?? "" }));
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
        const m = /^http:\/\/127\.0\.0\.1:19876\/([^/]+)\/([^/]+)$/.exec(src);
        if (!m) { skipped++; return whole; } // 远程 URL 保持原样
        const noteId = m[1];
        const filename = m[2];
        if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) { skipped++; return whole; }
        const file = path.join(this.noteAssetsDir, noteId, filename);
        if (!fs.existsSync(file)) { skipped++; return whole; }
        const bytes = fs.readFileSync(file);
        const mime = MIME_FROM_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
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
    // 提取 <img src="http://127.0.0.1:19876/{noteId}/{file}"> 并复制 + 改写相对引用
    const imgRe = /<img[^>]*src="(http:\/\/127\.0\.0\.1:19876\/([^/]+)\/([^/"\s]+))"/g;
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
    const imgRe = /!\[[^\]]*\]\((http:\/\/127\.0\.0\.1:19876\/([^/)]+)\/([^/)]+))\)/g;
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
    log.history.info(`[perf] snapshot ${noteId} ${Date.now() - t0}ms id=${id}${force ? " force" : ""} (body=${body.length}B, gz=${gz.length}B, refs=${refs.length})`);
    return id;
  }

  /** 列出文档历史快照（新→旧） */
  listNoteHistory(noteId: string): Array<{ id: number; createdAt: string; size: number; contentHash: string; refCount: number; filePath: string }> {
    const rows = this.db.prepare(
      "SELECT id,created_at,size,content_hash,ref_count,file_path FROM note_history WHERE note_id=? ORDER BY created_at DESC"
    ).all(noteId) as Array<{ id: number; created_at: string; size: number; content_hash: string; ref_count: number; file_path: string }>;
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, size: r.size, contentHash: r.content_hash, refCount: r.ref_count, filePath: r.file_path }));
  }

  /** 快照预览：解压历史快照正文 → 纯文本（供 HistoryPanel 预览弹层）。
   * 返回 null 表示快照不存在或解压失败。 */
  previewHistorySnapshot(historyId: number): { plain: string; createdAt: string; contentHash: string } | null {
    const row = this.db.prepare("SELECT note_id,file_path,created_at,content_hash FROM note_history WHERE id=?").get(historyId) as
      { note_id: string; file_path: string; created_at: string; content_hash: string } | undefined;
    if (!row) return null;
    try {
      const body = this.readHistoryContent(row.file_path);
      return { plain: lakeHtmlToPlain(body), createdAt: row.created_at, contentHash: row.content_hash };
    } catch {
      return null;
    }
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
    log.history.info(`[perf] restore ${noteId} from history#${historyId} ${Date.now() - t0}ms`);
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
    log.history.info(`[perf] delete-history ${historyId} ${Date.now() - t0}ms`);
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
    log.history.info(`[perf] cleanup-history ${Date.now() - t0}ms (deleted=${result.deletedSnapshots}, freed=${result.freedBytes}B)`);
    return result;
  }

  /** 历史占用统计（U6/P4：设置面板展示"快照总数 + 占用字节"） */
  getHistoryStats(): { snapshotCount: number; totalBytes: number } {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS bytes FROM note_history"
    ).get() as { c: number; bytes: number };
    return { snapshotCount: row.c, totalBytes: row.bytes };
  }

  /** 清理某文档"当前正文不引用 + 无历史快照引用"的资源（方案 A / 手动清理共用） */
  private cleanupUnreferencedAssetsForNote(noteId: string): void {
    const dir = this.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return;
    const disk = fs.readdirSync(dir);
    if (disk.length === 0) return;
    // 当前正文引用 + 所有历史 refs
    const currentRefs = this.currentContentRefs(noteId);
    const historyRefs = this.historyRefsForNote(noteId);
    for (const f of disk) {
      if (currentRefs.has(f) || historyRefs.has(f)) continue;
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* 忽略 */ }
    }
  }

  /** 当前正文引用的资源 */
  private currentContentRefs(noteId: string): Set<string> {
    const p = this.notePath(noteId);
    if (!fs.existsSync(p)) return new Set();
    return extractAssetRefs(fs.readFileSync(p, "utf8"));
  }

  /** 该文档所有历史快照 refs 合并（去重） */
  private historyRefsForNote(noteId: string): Set<string> {
    const rows = this.db.prepare("SELECT refs_json FROM note_history WHERE note_id=?").all(noteId) as Array<{ refs_json: string }>;
    const all = new Set<string>();
    for (const r of rows) {
      try { for (const f of JSON.parse(r.refs_json) as string[]) all.add(f); } catch { /* 忽略 */ }
    }
    return all;
  }

  /** 公共引用集（当前正文 ∪ 历史 refs）：历史/孤儿/S3 keep 三处复用，防漂移。 */
  getProtectedRefs(noteId: string): Set<string> {
    const current = this.currentContentRefs(noteId);
    const history = this.historyRefsForNote(noteId);
    for (const f of history) current.add(f);
    return current;
  }

  /** 所有存在历史快照的 noteId（S3 GC keep 集历史引用保护用）。 */
  listNoteIdsWithHistory(): string[] {
    return this.db.prepare("SELECT DISTINCT note_id AS id FROM note_history").all().map((r: any) => r.id as string);
  }

  /** 当前正文引用集（上传资格判定用）。 */
  getCurrentContentRefs(noteId: string): Set<string> {
    return this.currentContentRefs(noteId);
  }

  /** 文档级孤儿列表（实时）：磁盘文件 − (当前正文引用 ∪ 历史 refs) */
  listNoteOrphans(noteId: string): Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }> {
    const dir = this.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return [];
    const currentRefs = this.currentContentRefs(noteId);
    const historyRefs = this.historyRefsForNote(noteId);
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
      // 回收站条目不出现在搜索（子树整体移出 FTS，恢复时重建）
      const noteIds = this.descendantNoteFileIds(id);
      if (noteIds.length > 0) {
        const ph = noteIds.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM notes_fts WHERE note_id IN (${ph})`).run(...noteIds);
      }
    });
    tx();
  }

  /** 回收站：trash 笔记本的直接子节点（文件夹整体显示，子节点随动），按进入回收站时间倒序。 */
  listTrash(): Array<{
    id: string; title: string; nodeType: string; noteFileId: string | null;
    parentId: string | null; deletedAt: string | null; updatedAt: string;
    hasFile: boolean; purged: boolean;
  }> {
    const rows = this.db.prepare(
      `SELECT t.id,t.title,t.node_type,t.note_file_id,t.parent_id,t.trashed_at,t.updated_at,t.sync_state
       FROM tree_nodes t
       WHERE t.parent_id=? AND t.deleted_at IS NULL
       ORDER BY t.trashed_at DESC`
    ).all(TRASH_NOTEBOOK_ID) as Array<{
      id: string; title: string; node_type: string; note_file_id: string | null;
      parent_id: string | null; trashed_at: string | null; updated_at: string; sync_state: string;
    }>;
    return rows.map((r) => ({
      id: r.id, title: r.title, nodeType: r.node_type, noteFileId: r.note_file_id,
      parentId: r.parent_id, deletedAt: r.trashed_at, updatedAt: r.updated_at,
      hasFile: !!r.note_file_id, purged: r.sync_state === "purged",
    }));
  }

  /** M9：回收站自动过期候选（listTrash 已只含 trash 笔记本顶级条目）。 */
  listTrashReminder(days: number): Array<{ id: string; title: string; deletedAt: string }> {
    if (!Number.isFinite(days) || days <= 0) return [];
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const items = this.listTrash();
    return items
      .filter((i) => !!i.deletedAt && i.deletedAt < cutoff)
      .map((i) => ({ id: i.id, title: i.title, deletedAt: i.deletedAt! }));
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
      // 原父必须存在、未被删、且不在回收站内，否则回退默认笔记本
      const parent = this.db.prepare(
        "SELECT id FROM tree_nodes WHERE id=? AND deleted_at IS NULL AND parent_id != ?"
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
        this.upsertFts(node.note_file_id, titleRow?.title ?? "", caches.plain ?? null);
      }
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,sync_state='local' WHERE id=?"
      ).run(parentId, now, id);
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
        this.upsertFts(id, titleRow.title, caches.plain ?? null);
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
    const node = this.db.prepare("SELECT * FROM tree_nodes WHERE id=? AND parent_id=? AND deleted_at IS NULL").get(id, TRASH_NOTEBOOK_ID) as
      { note_file_id: string | null } | undefined;
    if (!node) throw new AppError("NotFound", `回收站节点不存在: ${id}`);
    const ids = this.descendantIdsIncludingDeleted(id);
    const filesToRemove: Array<{ path: string; recursive: boolean }> = [];
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const nodeStmt = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?");
      const noteMeta = this.db.prepare("SELECT id,title,parent_id,sort_order,updated_at FROM notes WHERE id=?");
      const tombstone = this.db.prepare(
        "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,purged_at) VALUES(?,?,?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, purged_at=excluded.purged_at"
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
          if (meta) tombstone.run(meta.id, meta.title, meta.parent_id, meta.sort_order, meta.updated_at, now, now);
          delHistory.run(n.note_file_id);
          delOrphans.run(n.note_file_id);
          delFts.run(n.note_file_id);
          delNote.run(n.note_file_id);
        }
        delNode.run(nid);
      }
    });
    tx();
    for (const f of filesToRemove) {
      try { fs.rmSync(f.path, { force: true, recursive: f.recursive }); }
      catch (error) { console.warn("[store] 彻底删除清理文件失败:", f.path, error); }
    }
    log.store.info(`[perf] purge ${id} ${Date.now() - t0}ms (files=${filesToRemove.length})`);
  }

  /** 清空回收站：彻底删除 trash 笔记本的全部直接子节点（各写 purge 墓碑）。 */
  emptyTrash(): void {
    const items = this.listTrash();
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
    if (icon !== null && (typeof icon !== "string" || icon.length > 16)) {
      throw new AppError("InvalidInput", "无效的图标");
    }
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
      // 图标存于 tree_nodes，但下载 meta 对账按 notes.sync_state 判断本地是否有 pending 改动；
      // 不标记 notes 会被远端旧图标回滚。
      this.db.prepare("UPDATE notes SET updated_at=?, sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL")
        .run(now, id);
    });
    tx();
    return this.readTreeNode(id);
  }

  moveTreeNode(id: string, parentId: string | null, sortOrder: number): TreeNode {
    const moving = this.readTreeNode(id);
    if (parentId) {
      if (parentId === id) throw new AppError("InvalidInput", "不能移动到自身");
      const descendants = new Set(this.descendantIds(id));
      if (descendants.has(parentId)) throw new AppError("InvalidInput", "不能移动到子节点");
      this.ensureParent(parentId);
    }
    this.assertParentCompatible(parentId, moving.nodeType);
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
        .run(parentId, sortOrder, now, id);
      // 同步源是 notes 表：移动必须同步更新 notes（否则 manifest 携带过期 parentId，跨端移动不同步）
      if (moving.noteFileId) {
        this.db.prepare("UPDATE notes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
          .run(parentId, sortOrder, now, moving.noteFileId);
      }
    });
    tx();
    return this.readTreeNode(id);
  }

  /** 审计 #18：移动 + 同级重排一次原子完成（前端两次 IPC 之间有崩溃窗口，
   * 会造成 parent 已改但 sortOrder 未更新的不一致树）。校验复用 move/reorder 规则。 */
  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): TreeNode {
    const moving = this.readTreeNode(id);
    if (parentId) {
      if (parentId === id) throw new AppError("InvalidInput", "不能移动到自身");
      const descendants = new Set(this.descendantIds(id));
      if (descendants.has(parentId)) throw new AppError("InvalidInput", "不能移动到子节点");
      this.ensureParent(parentId);
    }
    this.assertParentCompatible(parentId, moving.nodeType);
    if (new Set(orderedIds).size !== orderedIds.length) throw new AppError("InvalidInput", "重排列表包含重复节点");
    const children = this.db.prepare(
      "SELECT id FROM tree_nodes WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL"
    ).all(DEFAULT_WORKSPACE_ID, parentId).map((r) => (r as { id: string }).id);
    const childSet = new Set(children);
    for (const childId of orderedIds) {
      if (!childSet.has(childId)) throw new AppError("InvalidInput", `重排列表包含不属于该父节点的节点: ${childId}`);
    }
    if (orderedIds.length !== children.length) throw new AppError("InvalidInput", "重排列表必须包含该父节点的全部子节点");
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
        .run(parentId, orderedIds.indexOf(id), now, id);
      const stmt = this.db.prepare("UPDATE tree_nodes SET sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL");
      orderedIds.forEach((childId, index) => stmt.run(index, now, childId));
      // 同步更新 notes（parentId 对同级不变，重复写无害）
      const noteStmt = this.db.prepare(
        "UPDATE notes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL"
      );
      orderedIds.forEach((childId, index) => noteStmt.run(parentId, index, now, childId));
    });
    tx();
    return this.readTreeNode(id);
  }

  reorderTreeNodes(parentId: string | null, orderedIds: string[]) {
    // 审计 #9：事务内校验——无重复、无未知 id、集合与当前子节点完全一致（防漏排）
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new AppError("InvalidInput", "重排列表包含重复节点");
    }
    const children = this.db.prepare(
      "SELECT id FROM tree_nodes WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL"
    ).all(DEFAULT_WORKSPACE_ID, parentId).map((r) => (r as { id: string }).id);
    const childSet = new Set(children);
    for (const id of orderedIds) {
      if (!childSet.has(id)) throw new AppError("InvalidInput", `重排列表包含不属于该父节点的节点: ${id}`);
    }
    if (orderedIds.length !== children.length) {
      throw new AppError("InvalidInput", "重排列表必须包含该父节点的全部子节点");
    }
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare("UPDATE tree_nodes SET sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL");
      const noteStmt = this.db.prepare(
        "UPDATE notes SET sort_order=?,updated_at=?,sync_state='local' WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL"
      );
      orderedIds.forEach((id, index) => { stmt.run(index, now, id); noteStmt.run(index, now, id); });
    });
    tx();
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
  private referencedFilenames(noteId: string, content: string): Set<string> {
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
    const referencedSet = this.referencedFilenames(noteId, content);
    // P2：孤儿登记并入"历史 refs"——被任何历史快照引用的资源不算孤儿，
    // 保证全局 cleanOrphanAssets / 同步跳过上传 / 文档级 listNoteOrphans 三个消费者一致，
    // 避免"本机 SyncPanel 全局清理误删历史引用资源 → 本机历史恢复裂图"。
    const historyRefs = this.historyRefsForNote(noteId);
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
    return this.db.prepare("SELECT * FROM orphan_assets ORDER BY detected_at DESC").all().map((r: any) => ({
      id: r.id, noteId: r.note_id, filename: r.filename, filePath: r.file_path,
      size: r.size, mimeType: r.mime_type, detectedAt: r.detected_at,
    }));
  }

  cleanOrphanAssets(): { count: number; freedBytes: number } {
    // 审计 #12：仅当文件不存在或删除成功时才删除记录并计数；失败保留记录（UI 可重试）
    const rows = this.db.prepare("SELECT * FROM orphan_assets").all() as any[];
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
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return `enc:v1:${safeStorage.encryptString(value).toString("base64")}`;
      }
    } catch (error) {
      console.warn("[store] safeStorage 加密不可用，S3 Secret 将明文保存:", error);
    }
    return value;
  }

  private decryptSecret(value: string): string {
    if (!value.startsWith("enc:v1:")) return value; // 旧版明文数据
    try {
      return safeStorage.decryptString(Buffer.from(value.slice("enc:v1:".length), "base64"));
    } catch (error) {
      // 密钥串丢失/换机：无法解密时返回空串，提示用户重新填写
      console.warn("[store] S3 Secret 解密失败，请重新填写:", error);
      return "";
    }
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

  /** P0-1：本机最后一次成功上传某文档的 hash（同步上传成功后调用） */
  setLastUploadedHash(id: string, hash: string): void {
    this.db.prepare("INSERT INTO sync_base(note_id,content_hash,last_uploaded_hash) VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET last_uploaded_hash=excluded.last_uploaded_hash")
      .run(id, hash, hash);
  }

  /** P0-1：读本机最后一次上传的 hash（无则 null） */
  lastUploadedHash(id: string): string | null {
    const row = this.db.prepare("SELECT last_uploaded_hash FROM sync_base WHERE note_id=?").get(id) as { last_uploaded_hash: string | null } | undefined;
    return row?.last_uploaded_hash ?? null;
  }

  /** 只读锁：本地操作；不触碰正文/updated_at，锁同步走 manifest v3 独立字段 */
  setNoteLocked(id: string, locked: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE notes SET is_locked=?, locked_at=? WHERE id=? AND deleted_at IS NULL")
      .run(locked ? 1 : 0, now, id);
  }

  /** 同步合并写入（远端锁状态按 lockedAt LWW 后由调用方判定） */
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): void {
    this.db.prepare("UPDATE notes SET is_locked=?, locked_at=? WHERE id=? AND deleted_at IS NULL")
      .run(locked ? 1 : 0, lockedAt, id);
  }

  markSynced(id: string): void {
    const tx = this.db.transaction(() => {
      // restore_pending_at 一并清除：任何"变为 synced"的路径都代表恢复已生效或被远端采纳，
      // 残留标记会让本设备永远 local-wins、压住后续墓碑（墓碑永胜被破坏）。
      this.db.prepare("UPDATE notes SET sync_state='synced', restore_pending_at=NULL WHERE id=?").run(id);
      // 侧栏/状态栏读的是 tree_nodes.sync_state，必须同步置为 synced。
      this.db.prepare("UPDATE tree_nodes SET sync_state='synced' WHERE note_file_id=?").run(id);
    });
    tx();
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
      .all().map((r: any) => ({ ...r, ok: !!r.ok }));
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

  /** 渲染层刷新用：全部笔记摘要（含锁状态） */
  listNoteSummaries(): NoteSummary[] {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,is_locked,locked_at FROM notes WHERE deleted_at IS NULL ORDER BY sort_order"
    ).all().map((r) => this.mapSummary(r));
  }

  listNotesForSync(): SyncNote[] {
    // icon 存于 tree_nodes，join 取出参与同步
    return this.db.prepare(
      `SELECT n.id,n.title,n.parent_id,n.sort_order,n.updated_at,n.sync_state,n.is_conflict,n.is_locked,n.locked_at,t.icon,n.trashed_at,n.deleted_from_parent_id
       FROM notes n LEFT JOIN tree_nodes t ON t.note_file_id = n.id
       WHERE n.deleted_at IS NULL ORDER BY n.sort_order`
    ).all().map((r: any) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
      updatedAt: r.updated_at, syncState: r.sync_state, isConflict: !!r.is_conflict,
      isLocked: !!r.is_locked, lockedAt: r.locked_at ?? null, icon: r.icon ?? null,
      trashedAt: r.trashed_at ?? null, deletedFromParentId: r.deleted_from_parent_id ?? null,
    }));
  }

  /** 同步目录树：活动 notebook/group（不含默认个人笔记本，它两端都会本地初始化）。 */
  listFoldersForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; nodeType: "notebook" | "group"; icon: string | null; updatedAt: string; trashedAt?: string | null; deletedFromParentId?: string | null }> {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id FROM tree_nodes WHERE node_type IN ('notebook','group') AND deleted_at IS NULL AND id != ? AND id != ? ORDER BY sort_order"
    ).all(DEFAULT_NOTEBOOK_ID, TRASH_NOTEBOOK_ID).map((r: any) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order, nodeType: r.node_type, icon: r.icon ?? null, updatedAt: r.updated_at,
      trashedAt: r.trashed_at ?? null, deletedFromParentId: r.deleted_from_parent_id ?? null,
    }));
  }

  /** 导入远端 notebook/group 节点：按 updatedAt 做 LWW，避免“本地非空优先”造成图标来回覆盖。
   * 回收站笔记本本身本地初始化，不参与 folder 同步（忽略）。 */
  importRemoteFolder(folder: { id: string; title: string; parentId: string | null; sortOrder: number; nodeType: "notebook" | "group"; icon: string | null; updatedAt: string; trashedAt?: string | null; deletedFromParentId?: string | null }): void {
    if (folder.id === TRASH_NOTEBOOK_ID) return;
    const existing = this.db.prepare("SELECT title,parent_id,sort_order,node_type,icon,updated_at FROM tree_nodes WHERE id=?").get(folder.id) as
      { title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null; updated_at: string } | undefined;
    if (!existing) {
      this.db.prepare(
        `INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict,icon,trashed_at,deleted_from_parent_id)
         VALUES(?,?,?,?,?,NULL,?,?,?,NULL,'synced',0,?,?,?)`
      ).run(folder.id, DEFAULT_WORKSPACE_ID, folder.parentId, folder.nodeType, folder.title, folder.sortOrder, folder.updatedAt, folder.updatedAt, folder.icon ?? null,
        folder.parentId === TRASH_NOTEBOOK_ID ? (folder.trashedAt ?? null) : null,
        folder.parentId === TRASH_NOTEBOOK_ID ? (folder.deletedFromParentId ?? null) : null);
      return;
    }
    // 远端更新更晚才覆盖；否则保留本地（本地可能是更新的编辑，等待下次上传）。
    if (folder.updatedAt > existing.updated_at) {
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?, title=?, sort_order=?, updated_at=?, icon=?, sync_state='synced', node_type=?, trashed_at=?, deleted_from_parent_id=? WHERE id=?"
      ).run(folder.parentId, folder.title, folder.sortOrder, folder.updatedAt, folder.icon ?? null, folder.nodeType,
        folder.parentId === TRASH_NOTEBOOK_ID ? (folder.trashedAt ?? null) : null,
        folder.parentId === TRASH_NOTEBOOK_ID ? (folder.deletedFromParentId ?? null) : null,
        folder.id);
    }
  }

  defaultNotebookId(): string { return DEFAULT_NOTEBOOK_ID; }

  hasTreeNode(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(id);
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
      this.db.prepare(
        "UPDATE tree_nodes SET title=?, parent_id=?, sort_order=?, updated_at=?, icon=?, trashed_at=?, deleted_from_parent_id=? WHERE note_file_id=?"
      ).run(note.title, note.parentId, note.sortOrder, note.updatedAt, note.icon ?? null, trashedAt, deletedFrom, note.id);
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
        this.upsertFts(id, titleRow.title, caches.plain ?? null);
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
    this.db.prepare(
      "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at) VALUES(?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at"
    ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, deletedAt);
  }

  /** purge 前缀删除成功后，清除 purged_at（保留墓碑，避免下次同步重复删前缀）。 */
  markPurgeSynced(id: string): void {
    this.db.prepare("UPDATE deleted_notes SET purged_at=NULL WHERE id=?").run(id);
  }

  listDeletedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string }> {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,deleted_at FROM deleted_notes ORDER BY deleted_at"
    ).all().map((r: any) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
      updatedAt: r.updated_at, deletedAt: r.deleted_at,
    }));
  }

  /** 已彻底删除（purge）的墓碑：下次同步需立即删 S3 前缀。 */
  listPurgedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; purgedAt: string }> {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,deleted_at,purged_at FROM deleted_notes WHERE purged_at IS NOT NULL ORDER BY purged_at"
    ).all().map((r: any) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
      updatedAt: r.updated_at, deletedAt: r.deleted_at, purgedAt: r.purged_at,
    }));
  }

  /** 导入远程笔记：写 .lake + note-assets 资源 + upsert DB 记录 */
  importRemoteNote(note: SyncNote, content: Buffer, assets: Array<{ filename: string; bytes: Buffer }>): void {
    const t0 = Date.now();
    // 审计 #3/#17：任何写操作前先校验全部目标路径段，拒绝恶意 manifest 的
    // note.id / asset.filename（../、绝对路径、反斜杠、空段），防止写半成品
    this.notePath(note.id);
    for (const asset of assets) {
      if (!isSafePathSegment(asset.filename)) {
        throw new AppError("InvalidInput", `无效的资源文件名: ${asset.filename}`);
      }
    }
    // 审计 #10：staging 写入——先写临时文件/临时目录，DB 事务成功后再原子落位；
    // 任一环节失败都清理临时产物，绝不留下"DB 已回滚但文件已写入/覆盖"的半成品
    const lakePath = this.notePath(note.id);
    const lakeTmp = `${lakePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const assetDir = assets.length > 0 ? this.noteAssetsDirFor(note.id) : null;
    const assetTmpDir = assetDir ? `${assetDir}.staging-${crypto.randomBytes(4).toString("hex")}` : null;
    let moved = false;
    try {
      fs.writeFileSync(lakeTmp, content, "utf8");
      if (assetTmpDir) {
        fs.mkdirSync(assetTmpDir, { recursive: true });
        for (const asset of assets) {
          fs.writeFileSync(path.join(assetTmpDir, asset.filename), asset.bytes);
        }
      }
      const tx = this.db.transaction(() => {
        // upsert notes（含回收站字段：trashed_at / deleted_from_parent_id）
        this.db.prepare(
          `INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,deleted_at,is_locked,locked_at,trashed_at,deleted_from_parent_id)
           VALUES(?,?,?,?,?,'synced',?,NULL,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title,parent_id=excluded.parent_id,
             sort_order=excluded.sort_order,updated_at=excluded.updated_at,
             is_locked=excluded.is_locked,locked_at=excluded.locked_at,
             sync_state='synced',is_conflict=excluded.is_conflict,deleted_at=NULL,
             trashed_at=excluded.trashed_at,deleted_from_parent_id=excluded.deleted_from_parent_id`
        ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, note.isConflict ? 1 : 0,
          note.isLocked ? 1 : 0, note.lockedAt ?? null,
          note.parentId === TRASH_NOTEBOOK_ID ? (note.trashedAt ?? null) : null,
          note.parentId === TRASH_NOTEBOOK_ID ? (note.deletedFromParentId ?? null) : null);
        // upsert tree_nodes（note 节点）
        this.db.prepare(
          `INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict,icon,trashed_at,deleted_from_parent_id)
           VALUES(?,?,?,'note',?,?,?,?,?,NULL,'synced',?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,
             sort_order=excluded.sort_order,updated_at=excluded.updated_at,
             deleted_at=NULL,sync_state='synced',is_conflict=excluded.is_conflict,icon=excluded.icon,
             trashed_at=excluded.trashed_at,deleted_from_parent_id=excluded.deleted_from_parent_id`
        ).run(note.id, DEFAULT_WORKSPACE_ID, note.parentId, note.title, note.id, note.sortOrder, note.updatedAt, note.updatedAt, note.isConflict ? 1 : 0, note.icon ?? null,
          note.parentId === TRASH_NOTEBOOK_ID ? (note.trashedAt ?? null) : null,
          note.parentId === TRASH_NOTEBOOK_ID ? (note.deletedFromParentId ?? null) : null);
      });
      tx();
      // DB 提交成功 → 原子落位
      fs.mkdirSync(path.dirname(lakePath), { recursive: true });
      fs.renameSync(lakeTmp, lakePath);
      moved = true;
      if (assetTmpDir && assetDir) {
        fs.mkdirSync(assetDir, { recursive: true });
        for (const asset of assets) {
          fs.renameSync(path.join(assetTmpDir, asset.filename), path.join(assetDir, asset.filename));
        }
      }
    } catch (error) {
      try { fs.rmSync(lakeTmp, { force: true }); } catch { /* 忽略 */ }
      if (assetTmpDir) { try { fs.rmSync(assetTmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ } }
      throw error;
    } finally {
      if (!moved) { try { fs.rmSync(lakeTmp, { force: true }); } catch { /* 忽略 */ } }
      if (assetTmpDir && !moved) { try { fs.rmSync(assetTmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ } }
    }
    // 审计 #11：导入后按**正文引用**对账——远端资源集合缩小时，本地仍存在但正文不再
    // 引用的旧文件标记为孤儿（保留在本地当回收站，不再上传，与远端保持一致）。
    // 以正文为权威而非 manifest 列表，可自愈历史 #1 造成的 manifest 资源缺失
    // （被引用的文件会被 unorphan 并重新进入同步）。
    try {
      this.detectOrphans(note.id, content.toString("utf8"));
    } catch (error) {
      console.warn("[store] 导入后孤儿对账失败（不影响导入）:", error);
    }
    // 统一索引：同步下载的新文档立即生成文本缓存 + FTS 正文索引，
    // 保证"锁定且从未编辑"的文档在新设备上也能被全文搜索/导出（无需打开/解锁）。
    // ensureNoteCaches 幂等：已有缓存（编辑态 Lake 高质量缓存）不覆盖。
    try {
      this.ensureNoteCaches(note.id, content.toString("utf8"));
    } catch (error) {
      console.warn("[store] 导入后缓存生成失败（不影响导入）:", error);
    }
    log.store.info(`[perf] importRemoteNote ${note.id} ${Date.now() - t0}ms (lake=${content.length}B, assets=${assets.length})`);
  }

  uploadResource(input: { bytes: number[]; filename: string }, noteId: string): ResourceUploadOutput {
    const bytes = Buffer.from(input.bytes);
    const out = imageOutput(bytes, input.filename, this.noteAssetsDirFor(noteId), this.assetUrl.bind(this, noteId));
    // 写盘即登记孤儿：插入瞬间正文尚未引用；saveNote 对账后撤销
    this.registerOrphan(noteId, out.filename, out.size, out.mimeType);
    return out;
  }

  async downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput> {
    // 先校验 noteId 再做网络请求
    const assetsDir = this.noteAssetsDirFor(noteId);
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    // 校验初始 URL 的协议（redirect 逐跳另有协议校验）
    {
      const parsed = new URL(normalized);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new AppError("InvalidInput", "图片地址仅支持 HTTP 或 HTTPS");
      }
    }
    // 下载头（移植 Rust 版）：Referer 设为图片 URL 自身 + 浏览器 UA，绕过常见防盗链。
    // 受控下载（net.request + followRedirect:false）：每跳校验协议 + DNS 解析
    // （域名→私网/本机即拒），手工跟随重定向并逐跳重新校验（审计 #5。注：Chromium
    // net.fetch 的 redirect:"manual" 会抛 "Redirect was cancelled"，故用 net.request）
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      try {
        const { request, response, status } = await this.fetchControlled(normalized);
        try {
          if (status < 200 || status >= 300) {
            request.abort();
            throw new AppError("Internal", `下载失败: HTTP ${status}`);
          }
          // content-length 预检查 + 流式读取限量（防大响应撑爆内存）
          const declared = response.headers["content-length"];
          const declaredLength = Number(Array.isArray(declared) ? declared[0] : declared || 0);
          if (declaredLength > MAX_IMAGE_BYTES) {
            request.abort();
            throw new AppError("InvalidInput", "图片超过 25 MiB");
          }
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of response) {
            total += chunk.length;
            if (total > MAX_IMAGE_BYTES) {
              request.abort();
              throw new AppError("InvalidInput", "图片超过 25 MiB");
            }
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const buf = Buffer.concat(chunks);
          const out = imageOutput(buf, path.basename(new URL(normalized).pathname) || "image", assetsDir, this.assetUrl.bind(this, noteId));
          // 写盘即登记孤儿：下载落盘瞬间正文尚未引用；saveNote 对账后撤销
          this.registerOrphan(noteId, out.filename, out.size, out.mimeType);
          return out;
        } finally {
          request.abort(); // 流读完/出错后释放连接
        }
      } catch (error) {
        // 安全类拒绝（SSRF/格式/大小）不重试，直接抛出
        if (error instanceof AppError && error.kind === "InvalidInput") throw error;
        if (error instanceof SsrfError) throw new AppError("InvalidInput", error.message);
        lastError = error instanceof Error && error.name === "AbortError"
          ? new AppError("Internal", `下载超时（${DOWNLOAD_TIMEOUT_MS / 1000}s）`)
          : new AppError("Internal", `网络错误: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (attempt < DOWNLOAD_MAX_ATTEMPTS) await sleep(attempt * 500);
    }
    throw lastError instanceof AppError ? lastError : new AppError("Internal", `下载失败: ${String(lastError)}`);
  }

  /** 受控下载：基于 net.request（Chromium 网络栈）逐跳（含重定向）校验协议 + 主机安全。
   *  - followRedirect:false + redirect 事件手动跟随，每跳重新 assertSafeRemoteHost
   *  - 重定向上限 DOWNLOAD_MAX_REDIRECTS，拒绝重定向环
   */
  private async fetchControlled(url: string): Promise<{ request: Electron.ClientRequest; response: NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> }; status: number }> {
    let current = url;
    for (let hop = 0; ; hop++) {
      const parsed = new URL(current);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new AppError("InvalidInput", "重定向目标仅支持 HTTP 或 HTTPS");
      }
      await assertSafeRemoteHost(parsed.hostname);
      const outcome = await new Promise<{ kind: "redirect"; url: string } | { kind: "response"; status: number; response: NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> }; request: Electron.ClientRequest }>((resolve, reject) => {
        // followRedirect 类型缺失（Electron 类型滞后），运行时受支持
        const req = net.request({ url: current, followRedirect: false } as Electron.ClientRequestConstructorOptions & { followRedirect?: boolean });
        req.setHeader("User-Agent", DOWNLOAD_USER_AGENT);
        // 防盗链：每跳以"当前 URL 自身"为 Referer（对齐 Rust 版"Referer=图片自身"策略）。
        // 不能固定原始 URL：外部 Referer 会被部分 CDN（如 Google）客户端级拦截
        req.setHeader("Referer", current);
        const timer = setTimeout(() => { req.abort(); reject(new Error("AbortError")); }, DOWNLOAD_TIMEOUT_MS);
        let settled = false;
        req.on("redirect", (_statusCode: number, _method: string, redirectUrl: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          req.abort();
          resolve({ kind: "redirect", url: redirectUrl });
        });
        req.on("response", (response: Electron.IncomingMessage) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "response", status: response.statusCode, response: response as never, request: req });
        });
        req.on("error", (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        req.end();
      });
      if (outcome.kind === "redirect") {
        if (hop >= DOWNLOAD_MAX_REDIRECTS) {
          throw new AppError("Internal", `重定向次数过多: ${current}`);
        }
        current = outcome.url;
        continue;
      }
      return { request: outcome.request, response: outcome.response, status: outcome.status };
    }
  }
}

function sniffImageFormat(bytes: Buffer): { mimeType: string; extension: string } | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (bytes.subarray(0, 6).toString() === "GIF87a" || bytes.subarray(0, 6).toString() === "GIF89a") return { mimeType: "image/gif", extension: "gif" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString() === "ftyp" && ["avif", "avis"].includes(bytes.subarray(8, 12).toString())) return { mimeType: "image/avif", extension: "avif" };
  return null;
}

const MIME_FROM_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

function mimeTypeForFilename(filename: string): string {
  return MIME_FROM_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

function imageOutput(bytes: Buffer, _requestedFilename: string, noteAssetsDir: string, makeUrl: (filename: string) => string): ResourceUploadOutput {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new AppError("InvalidInput", "图片为空或超过 25 MiB");
  }
  const format = sniffImageFormat(bytes);
  if (!format) throw new AppError("InvalidInput", "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
  // 每次插入独立文件：{timestamp}_{random8}.ext，不做去重、零耦合
  const uniqueId = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const filename = `${uniqueId}.${format.extension}`;
  fs.mkdirSync(noteAssetsDir, { recursive: true });
  const filePath = path.join(noteAssetsDir, filename);
  fs.writeFileSync(filePath, bytes);
  const url = makeUrl(filename);
  return { resourceRef: url, url, filename, mimeType: format.mimeType, size: bytes.length };
}

/** M2：FTS MATCH 查询串转义——逐词加引号，避免特殊字符破坏查询语法 */
function escapeFtsQuery(q: string): string {
  return q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");
}

/** M1：目录名清洗：去掉文件系统非法字符，空则回退“未命名” */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "未命名";
}

/** 安全单路径段校验：拒绝空、./..，以及含 / 或 \\ 的字符串（防目录穿越，审计 #3/#17） */
function isSafePathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}
