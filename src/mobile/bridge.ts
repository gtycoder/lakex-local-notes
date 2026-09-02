/**
 * POC JS 桥（M0/M1）：window.lakeNative 兼容接口的移动端实现。
 * - 数据层：sql.js（WASM 同步 DbLike，见 sqliteDb.ts）+ IndexedDB 快照持久化
 * - S3：@aws-sdk/client-s3 + CapacitorHttpHandler（原生传输层，无 CORS）
 * - 同步：syncEngine（manifest v4 协议，复用 src/core 决策纯函数）
 * - 范围 = docs/MOBILE-TECH-STACK.md §9.2 的最小 IPC 集（POC 版）
 */
import { SqlJsDb } from "./sqliteDb";
import { loadSnapshot, saveSnapshot } from "./persistence";
import { saveAssetBytesFs, loadAssetBytesFs, listAssetKeysFs, removeAssetBytesFs } from "./assetFs";
import { syncNow as runSync, downloadNoteAssets, type SyncConfig, type SyncDbPort, type SyncReport } from "../core/syncEngine.js";
import { KeyedAsyncQueue } from "../core/keyedAsyncQueue.js";
import type { QuickNotesSyncResult } from "../core/quickNotesSyncEngine.js";
import { TRASH_NOTEBOOK_ID } from "../core/syncDecisions.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { createCapacitorS3Store } from "./s3Store";
import { buildAssetFilename, extOf } from "../core/assetNaming.js";
import { localAssetHttpUrl } from "../core/assetUrl.js";
import type { S3Settings, TreeNode, TreeNodeType } from "../lib/types";
import type { SearchResult } from "../core/searchRepository.js";
import { assertMoveTarget, assertNodeIcon, assertOrderedChildren, assertRootConstraint, assertTreeNodeTitle, nextSortOrder } from "../core/treeRules.js";
import { buildLikePattern, buildSearchSql, toSearchResult } from "../core/mobileSearch.js";
import { buildQuickNoteImageFiles, normalizeQuickNoteContent, previewQuickNote, serializeQuickNoteContent, validateQuickNoteContent } from "../core/quickNoteModel.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { syncQuickNotesViaEngine } from "../core/quickNotesSyncEngine.js";
import { applyQuickNotesSyncSchema, createQuickNotesSyncDbPort } from "./quickNotesDbPort.js";
import { mobileSecretStore } from "./secretStore.js";
import { hasNoteSaveChanges } from "../core/noteSaveDecision.js";

export interface POCNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  /** 所属笔记本/分组 id（快捷切换目录用） */
  parentId: string | null;
}

/** 列表页只需要元数据；正文在 readNote() 打开文档时按需读取。 */
export interface POCNoteSummary {
  id: string;
  title: string;
  updatedAt: string;
  parentId: string | null;
}

/** 移动端同步结果（P2-5，GPT 审计）：文档/小记分字段，便于 UI 分别展示进度与失败。 */
export interface MobileSyncResult {
  message: string;
  notes: SyncReport | null;
  quickNotes: QuickNotesSyncResult | { error: string } | null;
}

/** 与桌面一致的默认同步 prefix（对齐桌面 store.ts 默认 "lake-notes"；P1-7 GPT 审计：ab-test-verify 仅限测试） */
const DEFAULT_S3_PREFIX = "lake-notes";

const S3_STORAGE_KEY = "lake-notes-mobile.s3";
/** 与桌面一致的初始 Lake 内容（store.ts createNoteInWithContent） */
export const INITIAL_LAKE_CONTENT = `<p class="ne-p"><br></p>`;

let db: SqlJsDb | null = null;
/** 运行期资源缓存（新上传/同步中使用）；持久化资源不在启动时全量载入。key = "{noteId}/{filename}" */
const assets = new Map<string, Uint8Array>();
/** 主维护队列（GPT 审计 P2-6）：同步与本地写操作（保存/删除/恢复）串行化，防交错
 * 覆盖快照/发布旧状态；小记同步与编辑竞态由队列闭合（引擎 markSynced 无"未变才标"守卫时也安全）。 */
const maintenance = new KeyedAsyncQueue();

/** 与桌面一致的随机 8-hex 片段（crypto.randomBytes(4) 的等价物）。 */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp",
  ico: "image/x-icon", tiff: "image/tiff", tif: "image/tiff",
};
function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function ensureDb(): Promise<SqlJsDb> {
  if (db) return db;
  const snap = await loadSnapshot();
  db = snap ? await SqlJsDb.openFrom(snap) : await SqlJsDb.open();
  // P2-9（GPT 审计）：外键约束启用（sql.js 支持 PRAGMA foreign_keys；新建表的外键声明才生效）
  try { db.exec("PRAGMA foreign_keys = ON"); } catch { /* 旧库/兼容环境忽略 */ }
  // M1 schema：对齐桌面 notes 子集 + sync_base（旧 POC 表自动迁移，列缺失则 ALTER 补充）
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
  const cols = (db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>).map((c) => c.name);
  const addCol = (name: string, decl: string) => {
    if (!cols.includes(name)) db!.exec(`ALTER TABLE notes ADD COLUMN ${name} ${decl}`);
  };
  addCol("parent_id", "TEXT");
  addCol("sort_order", "INTEGER NOT NULL DEFAULT 0");
  addCol("content_hash", "TEXT");
  addCol("sync_state", "TEXT NOT NULL DEFAULT 'local'");
  addCol("is_conflict", "INTEGER NOT NULL DEFAULT 0");
  addCol("deleted_at", "TEXT");
  // 同步语义补齐：回收站 + 恢复标记（对齐桌面 notes 表）
  addCol("trashed_at", "TEXT");
  addCol("deleted_from_parent_id", "TEXT");
  addCol("restore_pending_at", "TEXT");
  // 协议字段透传（D9）：锁/图标/冲突标记，移动端不展示也必须落库（红线 §3.5）
  addCol("is_locked", "INTEGER NOT NULL DEFAULT 0");
  addCol("locked_at", "TEXT");
  addCol("icon", "TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS sync_base (
    note_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    last_synced_meta_at TEXT,
    last_uploaded_hash TEXT
  )`);
  // B4：从云端学到的删除（本设备从未持有），防离线设备把残留当新文档上传复活（对齐桌面 deleted_notes）
  // node_type：note（发布方向进 manifest.notes 标记 deleted:true）/ folder（仅本地下载过滤）；
  // purged_at：本地主动彻底删除（purge）标记——isFolderPurged 过滤 + 发布方向防复活；
  // published_at：墓碑已发布到 manifest（对齐桌面计数语义，移动端无待上传计数 UI，仅保持列一致）。
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
  {
    const delCols = (db.prepare("PRAGMA table_info(deleted_notes)").all() as Array<{ name: string }>).map((c) => c.name);
    if (!delCols.includes("node_type")) db.exec("ALTER TABLE deleted_notes ADD COLUMN node_type TEXT NOT NULL DEFAULT 'note'");
    if (!delCols.includes("purged_at")) db.exec("ALTER TABLE deleted_notes ADD COLUMN purged_at TEXT");
    if (!delCols.includes("published_at")) db.exec("ALTER TABLE deleted_notes ADD COLUMN published_at TEXT");
  }
  // D4：目录树（notebook/group），导入远端 folders 供父目录判定/未来树 UI（对齐桌面 tree_nodes 子集）
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
  if (!(db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>).some((c) => c.name === "sync_state")) {
    db.exec("ALTER TABLE folders ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'synced'");
  }
  // 零变更早退：本设备上次成功读/写的 manifest commitId + 墓碑签名（对齐桌面 device_state）
  db.exec(`CREATE TABLE IF NOT EXISTS device_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  // B3：小记（对齐桌面 quick_notes 表列；移动端单库方案正文存 content 列，不建独立库/文件）
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
  // P2（小记同步端口）：软删墓碑/基线/图片字节 schema（见 quickNotesDbPort.ts，幂等）
  applyQuickNotesSyncSchema(db);
  // 种子笔记本：仅全新库首次初始化自动创建一个普通笔记本（固定 ID 仅为多端首启同步一致，无默认/特殊行为；
  // seed_initialized 标记保证用户删除（含 purge）后不复活）。对齐桌面 store.ts。
  const seeded = db.prepare("SELECT value FROM device_state WHERE key='seed_initialized'").get() as { value?: string } | undefined;
  if (!seeded) {
    db.prepare("INSERT OR IGNORE INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,NULL,0,'notebook',NULL,?,'synced')")
      .run("notebook-personal", "个人笔记", new Date().toISOString());
    db.prepare("INSERT INTO device_state(key,value) VALUES('seed_initialized','1') ON CONFLICT(key) DO NOTHING").run();
  }
  // D5：文档历史快照（纯本地，不参与同步）；覆盖前留档，防丢数据（对齐桌面 note_history 简化）
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
  return db;
}

/**
 * 小记保存的实际写入逻辑。调用方必须在 maintenance 队列中调用它；不要在这里
 * 再次入队，否则 createQuickNote → saveQuickNote 会对同一个 key 发生嵌套等待死锁。
 */
async function saveQuickNoteInternal(id: string, text: string, images: StoredQuickNoteImage[] = []): Promise<string> {
  const d = await ensureDb();
  const now = new Date().toISOString();
  const content = normalizeQuickNoteContent(text, images);
  const serialized = serializeQuickNoteContent(content);
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  const preview = previewQuickNote(text, images.length);
  d.transaction(() => {
    d.prepare(
      `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, ready_to_sync)
       VALUES (?,?,?,?,?,?,?,'local',0,NULL,1)
       ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1`
    ).run(id, now, now, preview, images.length, contentHash, serialized);
    d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
  })();
  await saveSnapshot(d.exportBytes());
  return id;
}

function rowToNote(r: Record<string, unknown>): POCNote {
  return { id: String(r.id), title: String(r.title), content: String(r.content), updatedAt: String(r.updated_at), parentId: r.parent_id ? String(r.parent_id) : null };
}

function rowToNoteSummary(r: Record<string, unknown>): POCNoteSummary {
  return { id: String(r.id), title: String(r.title), updatedAt: String(r.updated_at), parentId: r.parent_id ? String(r.parent_id) : null };
}

/** folders 行 → TreeNode（共享目录节点形状；统一 rename/setIcon/move 的映射避免重复）。 */
function noteRowToTreeNode(row: Record<string, unknown>, overrides: { updatedAt?: string; title?: string; icon?: string | null; parentId?: string | null } = {}): TreeNode {
  return {
    id: String(row.id),
    workspaceId: "mobile",
    parentId: overrides.parentId !== undefined ? overrides.parentId : (row.parent_id ? String(row.parent_id) : null),
    nodeType: "note",
    title: overrides.title ?? String(row.title),
    noteFileId: String(row.id),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.updated_at),
    updatedAt: overrides.updatedAt ?? String(row.updated_at),
    syncState: String(row.sync_state ?? "local") as TreeNode["syncState"],
    isConflict: Boolean(row.is_conflict),
    icon: overrides.icon !== undefined ? overrides.icon : (row.icon ? String(row.icon) : null),
  };
}

function folderRowToTreeNode(row: Record<string, unknown>, overrides: { updatedAt?: string; title?: string; icon?: string | null; parentId?: string | null } = {}): TreeNode {
  return {
    id: String(row.id),
    workspaceId: "mobile",
    parentId: overrides.parentId !== undefined ? overrides.parentId : (row.parent_id ? String(row.parent_id) : null),
    nodeType: String(row.node_type) as TreeNodeType,
    title: overrides.title ?? String(row.title),
    noteFileId: null,
    sortOrder: Number(row.sort_order),
    createdAt: String(row.updated_at),
    updatedAt: overrides.updatedAt ?? String(row.updated_at),
    syncState: "local",
    isConflict: false,
    icon: overrides.icon !== undefined ? overrides.icon : (row.icon ? String(row.icon) : null),
  };
}

/** 收集 folder 子树 id（含自身）：沿 parent_id 迭代展开，供恢复/删除/树查询复用。 */
function collectFolderSubtree(folders: Array<{ id: string; parent_id: string | null }>, rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return ids;
}

async function createS3Client(cfg: S3Settings): Promise<import("@aws-sdk/client-s3").S3Client> {
  const [{ S3Client }, { CapacitorHttpHandler }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("./capacitorHttpHandler"),
  ]);
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // 请求分层：HTTP 传输走 Capacitor 原生（OkHttp），绕开 WebView CORS（见 capacitorHttpHandler.ts）
    requestHandler: new CapacitorHttpHandler(),
  });
}

/** syncEngine 的本地 DB 端口实现（sql.js 同步 DbLike 之上） */
function rowToLocal(r: Record<string, unknown>) {
  return {
    id: String(r.id), title: String(r.title), content: String(r.content),
    updatedAt: String(r.updated_at), syncState: String(r.sync_state),
    trashedAt: r.trashed_at ? String(r.trashed_at) : null,
    restorePendingAt: r.restore_pending_at ? String(r.restore_pending_at) : null,
    parentId: r.parent_id ? String(r.parent_id) : null,
    sortOrder: Number(r.sort_order ?? 0),
    isLocked: !!r.is_locked,
    lockedAt: r.locked_at ? String(r.locked_at) : null,
    icon: r.icon ? String(r.icon) : null,
    isConflict: !!r.is_conflict,
  };
}

const dbPort: SyncDbPort = {
  getNote(id) {
    const d = db!;
    const row = d.prepare("SELECT id, title, content, updated_at, sync_state, trashed_at, restore_pending_at, parent_id, sort_order, is_locked, locked_at, icon, is_conflict FROM notes WHERE id = ?").get(id);
    return row ? rowToLocal(row) : null;
  },
  getAllNotes() {
    const d = db!;
    const rows = d.prepare("SELECT id, title, content, updated_at, sync_state, trashed_at, restore_pending_at, parent_id, sort_order, is_locked, locked_at, icon, is_conflict FROM notes").all();
    return rows.map(rowToLocal);
  },
  getSyncBase(id) {
    const d = db!;
    const row = d.prepare("SELECT content_hash, last_uploaded_hash, last_synced_meta_at FROM sync_base WHERE note_id = ?").get(id);
    return row ? { contentHash: String(row.content_hash), lastUploadedHash: row.last_uploaded_hash ? String(row.last_uploaded_hash) : null, lastSyncedMetaAt: row.last_synced_meta_at ? String(row.last_synced_meta_at) : null } : null;
  },
  recordDeclaredAssets(noteId: string, assets: Array<{ filename: string; size: number; hash: string }>): void {
    const d = db!;
    const stmt = d.prepare("INSERT INTO declared_assets(note_id,filename,size,hash) VALUES(?,?,?,?) ON CONFLICT(note_id,filename) DO UPDATE SET size=excluded.size, hash=excluded.hash");
    for (const a of assets) stmt.run(noteId, a.filename, a.size, a.hash);
  },
  listDeclaredAssets(noteId: string): Array<{ filename: string; size: number; hash: string }> {
    const d = db!;
    return (d.prepare("SELECT filename,size,hash FROM declared_assets WHERE note_id=?").all(noteId) as Array<{ filename: string; size: number; hash: string }>).map((r) => ({ filename: String(r.filename), size: Number(r.size), hash: String(r.hash) }));
  },
  applyRemoteNote(note, content) {
    const d = db!;
    d.prepare(
      `INSERT INTO notes (id, title, content, parent_id, sort_order, updated_at, content_hash, sync_state, is_conflict, is_locked, locked_at, icon, trashed_at, restore_pending_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, parent_id=excluded.parent_id,
         sort_order=excluded.sort_order, updated_at=excluded.updated_at, content_hash=excluded.content_hash,
         sync_state=excluded.sync_state, is_conflict=excluded.is_conflict, is_locked=excluded.is_locked, locked_at=excluded.locked_at, icon=excluded.icon, trashed_at=excluded.trashed_at, restore_pending_at=NULL`
    ).run(note.id, note.title, content, note.parentId, note.sortOrder, note.updatedAt, note.contentHash, "synced", note.isConflict ? 1 : 0, note.isLocked ? 1 : 0, note.lockedAt ?? null, note.icon ?? null, note.trashedAt ?? null, null);
  },
  applyRemoteTrash(id, content, title, trashedAt, deletedFromParentId, parentId, sortOrder) {
    const d = db!;
    d.prepare(
      `INSERT INTO notes (id, title, content, parent_id, sort_order, updated_at, content_hash, sync_state, trashed_at, deleted_from_parent_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, parent_id=excluded.parent_id,
         sort_order=excluded.sort_order, updated_at=excluded.updated_at, sync_state=excluded.sync_state,
         trashed_at=excluded.trashed_at, deleted_from_parent_id=excluded.deleted_from_parent_id`
    ).run(id, title, content, parentId, sortOrder, trashedAt, "", "synced", trashedAt, deletedFromParentId);
  },
  localTrashNote(id) {
    const d = db!;
    d.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL WHERE id=?").run(new Date().toISOString(), id);
  },
  localRestoreNote(id) {
    const d = db!;
    d.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local' WHERE id=?").run(new Date().toISOString(), id);
  },
  applyRemotePurge(id) {
    const d = db!;
    const now = new Date().toISOString();
    // 收到他端 purge：本地条目移入回收站并标 purged（保留可恢复、不上传）
    d.prepare("UPDATE notes SET parent_id=?, trashed_at=COALESCE(trashed_at,?), deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id), updated_at=?, sync_state='purged', restore_pending_at=NULL WHERE id=?").run(TRASH_NOTEBOOK_ID, now, now, id);
  },
  rememberDeleted(note, deletedAt) {
    const d = db!;
    // node_type=note（只有 manifest.notes 条目触发 remember；folder 不进 manifest.notes）；
    // published_at=deletedAt：学到即已在云端发布，不计入待上传（对齐桌面 rememberDeleted）。
    d.prepare(
      "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,node_type,published_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, node_type=excluded.node_type, published_at=COALESCE(deleted_notes.published_at, excluded.published_at)"
    ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, deletedAt, "note", deletedAt);
  },
  /** 本地删除墓碑列表（含 purge 墓碑 + 学到的删除）——发布方向：syncEngine 据此发布 deleted:true 传播删除。 */
  listDeletedNotesForSync() {
    const d = db!;
    const rows = d.prepare("SELECT id,title,parent_id,sort_order,updated_at,deleted_at,node_type FROM deleted_notes ORDER BY deleted_at").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string; deleted_at: string; node_type: string | null }>;
    return rows.map((r) => ({ id: String(r.id), title: String(r.title), parentId: r.parent_id, sortOrder: r.sort_order, updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at), nodeType: r.node_type ?? "note" }));
  },
  /** 读墓碑笔记的删除前内容（purge 后行已物理删除 → null → 引擎用占位符 id 发布墓碑）。 */
  async readDeletedContent(id: string): Promise<string | null> {
    const d = db!;
    const row = d.prepare("SELECT content FROM notes WHERE id=?").get(id) as { content: string } | undefined;
    return row ? String(row.content) : null;
  },
  /** 墓碑已发布到 manifest：标记 published_at（移动端无待上传计数 UI，实现仅为与桌面语义一致）。 */
  markTombstonesPublished(ids: string[]): void {
    if (ids.length === 0) return;
    const d = db!;
    const placeholders = ids.map(() => "?").join(",");
    d.prepare("UPDATE deleted_notes SET published_at=COALESCE(published_at, ?) WHERE id IN (" + placeholders + ") AND node_type != 'folder'").run(new Date().toISOString(), ...ids);
  },
  applyRemoteNoteMeta(note) {
    const d = db!;
    // 回收站条目：同步 trashed_at + deleted_from_parent_id；移出回收站（恢复传播）时清空
    const inTrash = note.parentId === TRASH_NOTEBOOK_ID;
    const trashedAt = inTrash ? (note.trashedAt ?? new Date().toISOString()) : null;
    const deletedFrom = inTrash ? (note.deletedFromParentId ?? null) : null;
    d.prepare("UPDATE notes SET title=?, parent_id=?, sort_order=?, updated_at=?, is_conflict=?, trashed_at=?, deleted_from_parent_id=?, icon=? WHERE id=?")
      .run(note.title, note.parentId, note.sortOrder, note.updatedAt, note.isConflict ? 1 : 0, trashedAt, deletedFrom, note.icon ?? null, note.id);
  },
  applyRemoteLock(id, locked, lockedAt) {
    const d = db!;
    d.prepare("UPDATE notes SET is_locked=?, locked_at=? WHERE id=?").run(locked ? 1 : 0, lockedAt, id);
  },
  markLocalNoteSynced(id, contentHash, metaAt, lastUploadedHash) {
    const d = db!;
    d.prepare("UPDATE notes SET sync_state='synced', content_hash=?, restore_pending_at=NULL WHERE id=?").run(contentHash, id);
    d.prepare(
      "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at, last_uploaded_hash) VALUES (?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at, last_uploaded_hash=excluded.last_uploaded_hash"
    ).run(id, contentHash, metaAt, lastUploadedHash);
  },
  markSyncedIfUnchanged(id, expectedContentHash, metaAt, lastUploadedHash) {
    const d = db!;
    const row = d.prepare("SELECT content FROM notes WHERE id=?").get(id);
    if (!row) return;
    // B2 快照保护：同步期间被编辑（内容 hash 变了）→ 不标 synced，等下轮重传
    const currentHash = sha256Sync(new TextEncoder().encode(String(row.content)));
    if (currentHash !== expectedContentHash) return;
    d.prepare("UPDATE notes SET sync_state='synced', content_hash=?, restore_pending_at=NULL WHERE id=?").run(expectedContentHash, id);
    // lastUploadedHash 非空才写：null = 下载对账/软删记账（不写不清，保留本机已上传标记——对齐桌面 adapter）
    d.prepare(
      "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at) VALUES (?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at"
    ).run(id, expectedContentHash, metaAt);
    if (lastUploadedHash != null) {
      d.prepare("UPDATE sync_base SET last_uploaded_hash=? WHERE note_id=?").run(lastUploadedHash, id);
    }
  },
  setSyncBase(id, contentHash, metaAt, lastUploadedHash) {
    const d = db!;
    // lastUploadedHash 非空才写：null = 下载对账收尾（不写不清，保留本机已上传标记——对齐桌面 adapter）
    d.prepare(
      "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at) VALUES (?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at"
    ).run(id, contentHash, metaAt);
    if (lastUploadedHash != null) {
      d.prepare("UPDATE sync_base SET last_uploaded_hash=? WHERE note_id=?").run(lastUploadedHash, id);
    }
  },
  defaultNotebookId() {
    // 兜底父笔记本（系统中没有"默认笔记本"）：任意存在的笔记本 → 无则自动创建普通笔记本"未分类"（图标 X）。
    const d = db!;
    const row = d.prepare("SELECT id FROM folders WHERE node_type='notebook' AND trashed_at IS NULL ORDER BY sort_order LIMIT 1").get() as { id: string } | undefined;
    if (row) return row.id;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxRow = d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL").get() as { m: number | null } | undefined;
    d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,NULL,?,?,?,?,'local')")
      .run(id, "未分类", nextSortOrder(maxRow?.m ?? null), "notebook", "X", now);
    return id;
  },
  importRemoteFolder(folder) {
    const d = db!;
    d.prepare(
      "INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id, sync_state) VALUES (?,?,?,?,?,?,?,?,?,'synced') ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, node_type=excluded.node_type, icon=excluded.icon, updated_at=excluded.updated_at, trashed_at=excluded.trashed_at, deleted_from_parent_id=excluded.deleted_from_parent_id"
    ).run(folder.id, folder.title, folder.parentId, folder.sortOrder, folder.nodeType, folder.icon ?? null, folder.updatedAt, folder.trashedAt ?? null, folder.deletedFromParentId ?? null);
  },
  listFoldersForSync() {
    const d = db!;
    const rows = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id FROM folders").all() as Array<{
      id: string; title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order, nodeType: r.node_type,
      icon: r.icon, updatedAt: r.updated_at, trashedAt: r.trashed_at ?? undefined, deletedFromParentId: r.deleted_from_parent_id ?? undefined,
    }));
  },
  createHistorySnapshot(noteId, content, meta) {
    const d = db!;
    const h = sha256Sync(new TextEncoder().encode(content));
    d.prepare("INSERT INTO note_history (note_id, content, content_hash, title, parent_id, sort_order, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(noteId, content, h, meta.title, meta.parentId, meta.sortOrder, new Date().toISOString());
  },
  async saveAsset(noteId, filename, bytes) {
    const key = noteId + "/" + filename;
    assets.set(key, bytes);
    // 持久化到 Capacitor Filesystem（B1：note-assets/{noteId}/{file}，目录与桌面一致）；失败不阻断主流程
    void saveAssetBytesFs(key, bytes).catch((e) => console.warn("[mobile] 资产落盘失败（可重新同步）:", e));
  },
  async listLocalAssets(noteId) {
    // 启动不预加载持久化资源；同步开始时才按当前笔记读取 Filesystem。
    const out = [];
    const prefix = noteId + "/";
    const keys = new Set(await listAssetKeysFs());
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const bytes = assets.get(key) ?? await loadAssetBytesFs(key);
      if (!bytes) continue;
      const filename = key.slice(prefix.length);
      out.push({ filename, size: bytes.length, hash: sha256Sync(bytes) });
    }
    for (const [key, bytes] of assets) {
      if (!key.startsWith(prefix) || keys.has(key)) continue;
      const filename = key.slice(prefix.length);
      out.push({ filename, size: bytes.length, hash: sha256Sync(bytes) });
    }
    return out;
  },
  async readLocalAsset(noteId, filename) {
    const key = noteId + "/" + filename;
    return assets.get(key) ?? await loadAssetBytesFs(key);
  },
  getLastSeenCommitId() {
    const d = db!;
    const row = d.prepare("SELECT value FROM device_state WHERE key='last_seen_commit_id'").get() as { value?: string } | undefined;
    return row?.value ?? null;
  },
  setLastSeenCommitId(commitId) {
    const d = db!;
    d.prepare("INSERT INTO device_state(key,value) VALUES('last_seen_commit_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(commitId);
  },
  getLastTombstoneSig() {
    const d = db!;
    const row = d.prepare("SELECT value FROM device_state WHERE key='last_tombstone_sig'").get() as { value?: string } | undefined;
    return row?.value ?? "";
  },
  setLastTombstoneSig(sig) {
    const d = db!;
    d.prepare("INSERT INTO device_state(key,value) VALUES('last_tombstone_sig',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(sig);
  },
  tombstoneSignature() {
    const d = db!;
    const row = d.prepare("SELECT COUNT(*) AS c, COALESCE(MAX(deleted_at),'') AS m FROM deleted_notes").get() as { c: number; m: string };
    return `${row.c}:${row.m}`;
  },
  hasLocalPendingNotes() {
    const d = db!;
    // purged（收到他端删除的保留副本）永不上传，不应阻塞早退（对齐桌面 hasLocalPendingNotes）
    const noteRow = d.prepare("SELECT 1 FROM notes WHERE sync_state NOT IN ('synced','purged') AND deleted_at IS NULL LIMIT 1").get();
    if (noteRow) return true;
    // 目录改动判定对齐桌面 tree_nodes.sync_state：仅 sync_state != 'synced' 的节点算待上传；
    // 存在默认笔记本等已同步节点不算（否则永不早退）。
    const groupRow = d.prepare("SELECT 1 FROM folders WHERE sync_state != 'synced' AND id != ? LIMIT 1").get(TRASH_NOTEBOOK_ID);
    return !!groupRow;
  },
  // 本地已 purge 的 folder（deleted_notes 带 purged_at）：下载导入远端 folders 前过滤，防复活（对齐桌面 isFolderPurged）。
  isFolderPurged(id: string): boolean {
    return !!db!.prepare("SELECT 1 FROM deleted_notes WHERE id=? AND purged_at IS NOT NULL").get(id);
  },
  log(msg) {
    console.log("[mobile-sync]", msg);
  },
};

/** 下载这些笔记的已声明资产（best-effort）；失败不阻断调用方（恢复/预览红线）。
 * @param onlyMissing true = 只补本地缺失的资源（预览用）；false = 强拉全量（恢复用） */
async function downloadDeclaredAssetsFor(noteIds: string[], onlyMissing = false): Promise<void> {
  if (noteIds.length === 0) return;
  try {
    const cfg = await bridge.getS3Settings();
    if (!cfg) return;
    const syncCfg: SyncConfig = {
      endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, prefix: cfg.prefix,
    };
    const s3Store = createCapacitorS3Store(syncCfg);
    const report: SyncReport = {
      pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "",
      warnings: [], supersededNotes: [], foldersUploaded: 0, foldersDownloaded: 0,
      trashedDown: 0, trashedUp: 0, uploadedBytes: 0, downloadedBytes: 0,
    };
    for (const noteId of noteIds) {
      let assets = typeof dbPort.listDeclaredAssets === "function" ? dbPort.listDeclaredAssets(noteId) : [];
      if (onlyMissing && assets.length > 0) {
        const local = new Set((await dbPort.listLocalAssets(noteId)).map((a) => a.filename));
        assets = assets.filter((a) => !local.has(a.filename));
      }
      if (assets.length === 0) continue;
      await downloadNoteAssets(syncCfg, s3Store, dbPort, noteId, assets, report, false);
    }
  } catch (e) {
    console.warn("[asset] 资源下载失败（保留调用方，资源下次同步补拉）", e);
  }
}

export const bridge = {
  async init(): Promise<void> {
    await ensureDb();
    // 资源显示走 AssetServer（Filesystem 文件直读，无需预加载/迁移）。
  },

  // ---- 目录树 CRUD（Phase 0B：对齐共享 TreeRepository 接口，§20 ports.ts） ----

  async listTreeNodes(): Promise<TreeNode[]> {
    const d = await ensureDb();
    // 按 sort_order 排序（目录顺序来自桌面拖拽重排/本地编辑，同步语义）
    const rows = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id, sync_state FROM folders WHERE trashed_at IS NULL ORDER BY parent_id, sort_order").all() as Array<{
      id: string; title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null; sync_state: string;
    }>;
    return rows.map((r) => ({
      id: r.id, workspaceId: "mobile", parentId: r.parent_id, nodeType: r.node_type as TreeNodeType,
      title: r.title, noteFileId: null, sortOrder: r.sort_order, createdAt: r.updated_at, updatedAt: r.updated_at,
      syncState: r.sync_state as TreeNode["syncState"], isConflict: false, icon: r.icon ?? null,
    }));
  },


  /** 笔记本详情（含文档套文档）——实现见模块级 listNotebookTreeImpl（bridge 对象与 lakeNative 契约共用）。 */

  /** 新建 notebook：根层创建，名称必填（trim 校验，共享 treeRules），默认图标不落库（icon 由 setNodeIcon 单独写入）。 */
  async createNotebook(input: { title: string; icon: string | null }): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const title = assertTreeNodeTitle(input.title);
      const d = await ensureDb();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      // 根层最大排序值（共享 nextSortOrder：MAX,-1)+1，首个节点为 0，对齐桌面）
      const maxRow = d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL").get() as { m: number | null } | undefined;
      const sortOrder = nextSortOrder(maxRow?.m ?? null);
      d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,NULL,?,?,?,?,'local')")
        .run(id, title, sortOrder, "notebook", null, now);
      if (input.icon) {
        d.prepare("UPDATE folders SET icon = ?, sync_state = 'local' WHERE id = ?").run(input.icon, id);
      }
      await saveSnapshot(d.exportBytes());
      const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
      return folderRowToTreeNode(row, { title, updatedAt: now, icon: input.icon ?? null });
    });
  },

  /** 新建 group：父节点必须存在（且非回收站），名称校验共享 treeRules。 */
  async createGroup(parentId: string, title: string): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const trimmed = assertTreeNodeTitle(title);
      const d = await ensureDb();
      const parent = d.prepare("SELECT 1 FROM folders WHERE id = ? AND trashed_at IS NULL").get(parentId);
      if (!parent) throw new Error("父节点不存在: " + parentId);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const maxRow = d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id = ? AND trashed_at IS NULL").get(parentId) as { m: number | null } | undefined;
      const sortOrder = nextSortOrder(maxRow?.m ?? null);
      d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,?,?,?,?,?,'local')")
        .run(id, trimmed, parentId, sortOrder, "group", null, now);
      await saveSnapshot(d.exportBytes());
      const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
      return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
    });
  },

  async renameTreeNode(id: string, title: string): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const trimmed = assertTreeNodeTitle(title);
      const d = await ensureDb();
      const now = new Date().toISOString();
      const changed = d.prepare("UPDATE folders SET title=?, updated_at=?, sync_state='local' WHERE id=?").run(trimmed, now, id).changes;
      if (!changed) throw new Error("节点不存在: " + id);
      await saveSnapshot(d.exportBytes());
      const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
      return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
    });
  },

  async setNodeIcon(id: string, icon: string | null): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      assertNodeIcon(icon);
      const d = await ensureDb();
      const now = new Date().toISOString();
      const folder = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state FROM folders WHERE id=?").get(id) as Record<string, unknown> | undefined;
      if (folder) {
        d.prepare("UPDATE folders SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
        const row = { ...folder, icon, updated_at: now, sync_state: "local" };
        await saveSnapshot(d.exportBytes());
        return folderRowToTreeNode(row, { icon, updatedAt: now });
      }
      const note = d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, sync_state, is_conflict FROM notes WHERE id=? AND trashed_at IS NULL").get(id) as Record<string, unknown> | undefined;
      if (!note) throw new Error("节点不存在: " + id);
      d.prepare("UPDATE notes SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
      const row = { ...note, icon, updated_at: now, sync_state: "local" };
      await saveSnapshot(d.exportBytes());
      return noteRowToTreeNode(row, { icon, updatedAt: now });
    });
  },

  async moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const moving = d.prepare("SELECT node_type FROM folders WHERE id = ? AND trashed_at IS NULL").get(id) as { node_type: string } | undefined;
      if (!moving) throw new Error("节点不存在: " + id);
      // 根层约束（共享 treeRules：notebook 必须根层；group/note 必须有父节点）
      assertRootConstraint(moving.node_type, parentId);
      // P1-5（GPT 审计）：完整移动校验——不能移到自身/后代；父节点存在；orderedIds 去重/归属/完整
      const all = d.prepare("SELECT id, parent_id FROM folders WHERE trashed_at IS NULL").all() as Array<{ id: string; parent_id: string | null }>;
      // 计算被移动节点的后代 id 集合
      const descendants = new Set<string>();
      const childrenMap = new Map<string, string[]>();
      for (const f of all) {
        const list = childrenMap.get(f.parent_id ?? "") ?? [];
        list.push(f.id);
        childrenMap.set(f.parent_id ?? "", list);
      }
      const walk = (nodeId: string) => {
        for (const c of childrenMap.get(nodeId) ?? []) {
          if (!descendants.has(c)) { descendants.add(c); walk(c); }
        }
      };
      walk(id);
      const parentExists = parentId === null || all.some((f) => f.id === parentId);
      assertMoveTarget(id, parentId, descendants, parentExists);
      // 目标父节点当前子节点（移动前快照，不含 id 若跨父）
      const currentChildren = (childrenMap.get(parentId ?? "") ?? []).filter((cid) => cid !== id);
      assertOrderedChildren(orderedIds, currentChildren, id);
      const now = new Date().toISOString();
      const tx = d.transaction(() => {
        d.prepare("UPDATE folders SET parent_id=?, updated_at=?, sync_state='local' WHERE id=?").run(parentId, now, id);
        // 排序从 0 起（对齐桌面 reorderTreeNodes/moveTreeNodeOrdered 的 index 语义）
        orderedIds.forEach((childId, index) => {
          d.prepare("UPDATE folders SET sort_order=?, updated_at=?, sync_state='local' WHERE id=?").run(index, now, childId);
        });
      });
      tx();
      await saveSnapshot(d.exportBytes());
      const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
      return folderRowToTreeNode(row, { parentId, updatedAt: now });
    });
  },

  /** 同级重排（自定义排序）：单事务更新 sort_order，不改父节点。对齐桌面 reorderTreeNodes。 */
  async reorderSiblings(parentId: string | null, orderedIds: string[]): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const now = new Date().toISOString();
      const tx = d.transaction(() => {
        orderedIds.forEach((childId, index) => {
          d.prepare("UPDATE folders SET sort_order=?, updated_at=?, sync_state='local' WHERE id=? AND trashed_at IS NULL").run(index, now, childId);
        });
      });
      tx();
      await saveSnapshot(d.exportBytes());
    });
  },

  async listNotes(): Promise<POCNoteSummary[]> {
    const d = await ensureDb();
    const rows = d.prepare("SELECT id, title, updated_at, parent_id FROM notes WHERE trashed_at IS NULL ORDER BY updated_at DESC").all();
    return rows.map(rowToNoteSummary);
  },

  async readNote(id: string): Promise<POCNote | null> {
    const d = await ensureDb();
    const row = d.prepare("SELECT id, title, content, updated_at FROM notes WHERE id = ?").get(id);
    return row ? rowToNote(row) : null;
  },

  /** Phase 0B-5：搜索 fallback（sql.js 无 FTS5 → LIKE；标题+正文，参数化 + ESCAPE）。 */
  async searchNotes(query: string): Promise<SearchResult[]> {
    const pattern = buildLikePattern(query);
    if (!pattern) return [];
    const d = await ensureDb();
    const [sql, params] = buildSearchSql(pattern);
    const rows = d.prepare(sql).all(...params) as Array<{
      id: string; title: string; content: string; updated_at: string; parent_id: string | null; parent_title: string | null;
    }>;
    const term = query.trim().toLocaleLowerCase();
    return rows.map((row) => toSearchResult(row, row.title.toLocaleLowerCase().includes(term)));
  },

  // ---- 小记（Phase B3：本地 CRUD + 列表；同步后置，依赖 quick-notes/ 子空间端口化） ----

  async listQuickNotes(): Promise<Array<{ id: string; previewText: string; imageCount: number; updatedAt: string }>> {
    const d = await ensureDb();
    const rows = d.prepare("SELECT id, preview_text, image_count, updated_at FROM quick_notes WHERE deleted_at IS NULL AND restore_pending_at IS NULL ORDER BY updated_at DESC").all() as Array<{ id: string; preview_text: string; image_count: number; updated_at: string }>;
    return rows.map((r) => ({ id: r.id, previewText: r.preview_text, imageCount: r.image_count, updatedAt: r.updated_at }));
  },

  async readQuickNote(id: string): Promise<{ id: string; content: StoredQuickNoteContent; previewText: string; updatedAt: string } | null> {
    const d = await ensureDb();
    const row = d.prepare("SELECT id, content, preview_text, updated_at FROM quick_notes WHERE id=?").get(id) as { id: string; content: string; preview_text: string; updated_at: string } | undefined;
    if (!row) return null;
    let parsed: StoredQuickNoteContent;
    try { parsed = JSON.parse(row.content) as StoredQuickNoteContent; }
    catch { return null; }
    return { id: row.id, content: parsed, previewText: row.preview_text, updatedAt: row.updated_at };
  },

  async saveQuickNote(id: string, text: string, images: StoredQuickNoteImage[] = []): Promise<string> {
    return maintenance.run("main", () => saveQuickNoteInternal(id, text, images));
  },

  /** 带图片字节保存小记（composer 用）：图片字节落盘为文件（canonical URL 由本地 AssetServer 服务），
   * 与桌面端小记完全一致——纯文件存储，完全不用 BLOB。文件名用 buildAssetFilename 唯一化（同文件多次添加不覆盖）。
   * 全量替换本小记图片（编辑时传已有图片字节 + 新增字节；简单一致，不引入 staged/retained 两段式）。 */
  async saveQuickNoteWithImages(id: string, text: string, imageFiles: Array<{ filename: string; mimeType: string; width: number | null; height: number | null; bytes: Uint8Array }> = []): Promise<string> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      // 唯一名只生成一次（content JSON 与落盘文件名必须一致；见 buildQuickNoteImageFiles 注释）
      const { images, files: imageFilesWithKey } = buildQuickNoteImageFiles(imageFiles);
      const now = new Date().toISOString();
      const content = normalizeQuickNoteContent(text, images);
      const serialized = serializeQuickNoteContent(content);
      const contentHash = sha256Sync(new TextEncoder().encode(serialized));
      const preview = previewQuickNote(text, images.length);
      // 先落盘图片文件（纯文件为准，完全不用 BLOB；落盘失败抛错——文件是唯一真相，不能静默降级）。
      // 文件名与 content 引用一致（buildQuickNoteImageFiles 只生成一次唯一名）。
      // 不做旧文件清理：与文档资源一致（每次上传生成唯一新文件，旧文件由 GC/孤儿清理回收；冗余是设计理念）。
      for (const f of imageFilesWithKey) {
        const key = "quick-notes/" + id + "/" + f.filename;
        assets.set(key, f.bytes); // 内存层（同步端口/显示优先读）
        await saveAssetBytesFs(key, f.bytes);
      }
      d.transaction(() => {
        d.prepare(
          "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, ready_to_sync) " +
          "VALUES (?,?,?,?,?,?,?,'local',0,NULL,1) " +
          "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, ready_to_sync=1"
        ).run(id, now, now, preview, images.length, contentHash, serialized);
      })();
      await saveSnapshot(d.exportBytes());
      return id;
    });
  },

  async createQuickNote(text: string): Promise<string> {
    return maintenance.run("main", async () => {
      const id = crypto.randomUUID();
      return saveQuickNoteInternal(id, text, []);
    });
  },

  /** 本地删除小记：软删（保留 content 供墓碑携带），同步时上传墓碑跨端传播删除。 */
  async deleteQuickNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      d.prepare("UPDATE quick_notes SET deleted_at=?, restore_pending_at=NULL, sync_state='local', ready_to_sync=1 WHERE id=?").run(new Date().toISOString(), id);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 小记图片字节读取（composer/卡片显示用；缺失 → null）。纯文件为准（无 BLOB）。 */
  async getQuickNoteImage(id: string, filename: string): Promise<Uint8Array | null> {
    return loadAssetBytesFs("quick-notes/" + id + "/" + filename);
  },

  /** 小记回收站列表（软删行；含冲突归档的 ready_to_sync=0 条目——它们也是可恢复的本地内容）。 */
  async listQuickNoteTrash(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string; previewText: string }>> {
    const d = await ensureDb();
    const rows = d.prepare("SELECT id, created_at, updated_at, deleted_at, preview_text FROM quick_notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all() as Array<{ id: string; created_at: string; updated_at: string; deleted_at: string; preview_text: string }>;
    return rows.map((r) => ({ id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at), previewText: String(r.preview_text) }));
  },

  /** 小记恢复（回收站 → active）：restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑。 */
  async restoreQuickNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const row = d.prepare("SELECT 1 FROM quick_notes WHERE id=? AND deleted_at IS NOT NULL").get(id);
      if (!row) throw new Error("小记不在回收站");
      const now = new Date().toISOString();
      d.prepare("UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=?, sync_state='local', updated_at=? WHERE id=?").run(now, now, id);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 小记彻底删除（回收站 → 不可恢复）：删行 + 删图片；保留墓碑记录（同步继续传播删除，正文已删 → 占位符 hash）。 */
  async purgeQuickNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      // 先读旧内容（删除前），用于清理图片文件（纯文件为准；无 BLOB）
      const prevRow = d.prepare("SELECT content FROM quick_notes WHERE id=?").get(id) as { content: string } | undefined;
      d.transaction(() => {
        // 墓碑记录保留（若行存在则取行时间戳；行已不存在则覆盖旧记录保持幂等）
        d.prepare("INSERT OR REPLACE INTO quick_note_deleted (id, created_at, updated_at, deleted_at) SELECT id, created_at, updated_at, deleted_at FROM quick_notes WHERE id=?").run(id);
        d.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
      })();
      // 删除小记图片文件
      if (prevRow) {
        try {
          const parsed = validateQuickNoteContent(JSON.parse(prevRow.content) as StoredQuickNoteContent);
          for (const img of parsed.images) {
            await removeAssetBytesFs("quick-notes/" + id + "/" + img.filename).catch(() => undefined);
          }
        } catch { /* 内容解析失败不阻断 purge */ }
      }
      await saveSnapshot(d.exportBytes());
    });
  },

  async saveNote(id: string, title: string, content: string, parentId: string | null = null): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const now = new Date().toISOString();
      // P1-9（GPT 审计）：文档标题不为空——空白回退"无标题文档"（对齐 createNote 默认语义，避免同步空标题）
      const safeTitle = title.trim() ? title.trim() : "无标题文档";
      const existing = d.prepare("SELECT title, content FROM notes WHERE id=? AND trashed_at IS NULL").get(id) as { title: string; content: string } | undefined;
      if (existing && !hasNoteSaveChanges(existing, { title: safeTitle, content })) return;
      // 本地编辑必须置 sync_state='local'（待上传），否则同步零变更早退会跳过本次修改
      // ON CONFLICT 不覆盖 parent_id：编辑后保留归属；新建时用传入 parentId
      d.prepare(
        `INSERT INTO notes (id, title, content, parent_id, updated_at, sync_state) VALUES (?,?,?,?,?,'local')
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, updated_at=excluded.updated_at, sync_state='local'`
      ).run(id, safeTitle, content, parentId, now);
      await saveSnapshot(d.exportBytes());
    });
  },

  async createNote(title: string, parentId: string | null = null): Promise<POCNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // 无父新建 → 兜底父笔记本（存在的笔记本；无则自动创建"未分类"）
    const pid = parentId ?? dbPort.defaultNotebookId();
    await bridge.saveNote(id, title, INITIAL_LAKE_CONTENT, pid);
    return { id, title, content: INITIAL_LAKE_CONTENT, updatedAt: now, parentId: pid };
  },

  /** 本地软删（入回收站）：同步时上传墓碑（删除压编辑） */
  async trashNote(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      dbPort.localTrashNote(id);
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 回收站预览：按需补拉该笔记本地缺失的资源（不恢复、不移出回收站）。best-effort。 */
  async ensureTrashNoteAssets(id: string): Promise<void> {
    return maintenance.run("main", async () => {
      await downloadDeclaredAssetsFor([id], true);
    });
  },

  /** 本地恢复单条笔记：restore_pending_at → 同步时 local-wins 上传 active 覆盖墓碑。
   * 与 restoreTreeItem(id, "note") 完全等价（同一实现）；回收站 UI 统一走 restoreTreeItem，
   * 本方法仅供 lakeNative 调试契约使用，避免两套恢复入口语义分叉。 */
  async restoreNote(id: string): Promise<void> {
    return bridge.restoreTreeItem(id, "note");
  },

  /** 回收站列表 */
  async listTrashed(): Promise<POCNote[]> {
    const d = await ensureDb();
    const rows = d.prepare("SELECT id, title, content, updated_at FROM notes WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC").all();
    return rows.map(rowToNote);
  },

  /** 软删除（入回收站）：folder = 整棵子树（含深层 folders + 子树 notes）标 trashed_at；note = 单条。
   * 与桌面 deleteTreeNode 同语义（删除 = 移入回收站，回收站条目是普通条目，移动即同步传播）：
   * 移动端无 notebook-trash 容器行，用 trashed_at 标记 + listFoldersForSync 输出 trashedAt 传播；
   * parent_id 不变（恢复即原地清 trashed_at，对齐 restoreTreeItem）。
   * 仅提供 API（lakeNative 契约/未来 UI 用），当前移动端 UI 未接入删除笔记本入口。 */
  async trashTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      const tx = d.transaction(() => {
        const now = new Date().toISOString();
        if (kind === "note") {
          dbPort.localTrashNote(id);
          return;
        }
        // folder：收集整棵子树（含自己）→ 全部标 trashed_at（同步传播删除）
        const all = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
        const ids = collectFolderSubtree(all, id);
        const idList = Array.from(ids);
        if (idList.length === 0) return;
        const ph = idList.map(() => "?").join(",");
        d.prepare("UPDATE folders SET trashed_at=?, sync_state='local', updated_at=? WHERE id IN (" + ph + ") AND trashed_at IS NULL").run(now, now, ...idList);
        // 子树下 notes 级联进回收站（对齐桌面 deleteTreeNode 子树 trashed_at 级联）
        const noteRows = d.prepare("SELECT id FROM notes WHERE parent_id IN (" + ph + ") AND trashed_at IS NULL").all(...idList) as Array<{ id: string }>;
        for (const n of noteRows) {
          d.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL, updated_at=? WHERE id=?").run(now, now, n.id);
        }
      });
      tx();
      await saveSnapshot(d.exportBytes());
    });
  },

  /** B2：统一回收站树（folders 笔记本/分组 + notes 文档）。复用桌面 TrashPanel 语义：仅根节点可恢复（整棵连带），任意节点可彻底删除。 */
  async listTrashTree(): Promise<Array<{ id: string; title: string; kind: "folder" | "note"; parentId: string | null; deletedAt: string | null }>> {
    const d = await ensureDb();
    const folders = d.prepare("SELECT id, title, parent_id, trashed_at FROM folders WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null }>;
    const notes = d.prepare("SELECT id, title, parent_id, trashed_at FROM notes WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null }>;
    return [
      ...folders.map((f) => ({ id: f.id, title: f.title, kind: "folder" as const, parentId: f.parent_id, deletedAt: f.trashed_at })),
      ...notes.map((n) => ({ id: n.id, title: n.title, kind: "note" as const, parentId: n.parent_id, deletedAt: n.trashed_at })),
    ].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  },

  /** B2：恢复回收站项。folder = 恢复整棵（含深层子树）；note = 文档级恢复。恢复标记 restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑。 */
  async restoreTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      // 恢复前强拉全量（惰性下载补偿）：先收集要恢复的 notes，best-effort 下载资产，再执行恢复
      let folderIds: string[] = [];
      let restoreNoteIds: string[] = [];
      if (kind === "note") {
        restoreNoteIds = [id];
      } else {
        const all = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
        folderIds = Array.from(collectFolderSubtree(all, id));
        restoreNoteIds = (d.prepare("SELECT id FROM notes WHERE parent_id IN (" + folderIds.map(() => "?").join(",") + ") AND trashed_at IS NOT NULL").all(...folderIds) as Array<{ id: string }>).map((n) => n.id);
      }
      await downloadDeclaredAssetsFor(restoreNoteIds);

      if (kind === "note") {
        dbPort.localRestoreNote(id);
      } else {
        // P1-4（GPT 审计）：folder 恢复必须同事务恢复其下 notes（否则文档继续留在回收站）
        const tx = d.transaction(() => {
          const now = new Date().toISOString();
          for (const fid of folderIds) {
            d.prepare("UPDATE folders SET trashed_at=NULL, updated_at=?, sync_state='local' WHERE id=?").run(now, fid);
          }
          for (const nid of restoreNoteIds) {
            d.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local', updated_at=? WHERE id=?").run(now, now, nid);
          }
        });
        tx();
      }
      await saveSnapshot(d.exportBytes());
    });
  },

  /** B2：彻底删除回收站项（purge）。folder = 子树全部 purge；note = 单条 purge（同步发墓碑）。
   * 对齐桌面 purgeTrashItem：物理删除行 + 写 deleted_notes 墓碑（purged_at + node_type）。
   * 墓碑经 syncEngine 发布 deleted:true 传播到其他端（否则仅从 manifest 移除 → 其他端保留 active 副本，删除不传播）；
   * folder 墓碑（purged_at）供 isFolderPurged 下载过滤（防远端文件夹重新导入复活）。
   * 与收到他端 purge（applyRemotePurge：行保留标 purged、可恢复）语义不同：本地主动 purge 不可恢复。 */
  async purgeTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return maintenance.run("main", async () => {
      const d = await ensureDb();
      // purge 同时修改 folders 与 notes；必须让整棵回收站子树在一个事务内完成，
      // 避免快照/同步在两批 UPDATE 之间观察到半完成状态。
      const tx = d.transaction(() => {
        const now = new Date().toISOString();
        const writeTombstone = d.prepare(
          "INSERT OR REPLACE INTO deleted_notes (id, title, parent_id, sort_order, updated_at, deleted_at, node_type, purged_at) VALUES (?,?,?,?,?,?,?,?)"
        );
        if (kind === "note") {
          const row = d.prepare("SELECT id, title, parent_id, sort_order, updated_at FROM notes WHERE id=?").get(id) as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
          if (row) writeTombstone.run(row.id, row.title, row.parent_id, row.sort_order, row.updated_at, now, "note", now);
          d.prepare("DELETE FROM notes WHERE id=?").run(id);
          d.prepare("DELETE FROM sync_base WHERE note_id=?").run(id);
          d.prepare("DELETE FROM note_history WHERE note_id=?").run(id);
        } else {
          // folder：收集子树（含自己）→ 每个 folder/note 节点写墓碑 + 物理删除
          const all = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
          const ids = collectFolderSubtree(all, id);
          for (const fid of ids) {
            const f = d.prepare("SELECT title, parent_id, sort_order, updated_at FROM folders WHERE id=?").get(fid) as { title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
            if (f) writeTombstone.run(fid, f.title, f.parent_id, f.sort_order, f.updated_at, now, "folder", now);
            d.prepare("DELETE FROM folders WHERE id=?").run(fid);
          }
          // 先收集子树 note（folders 删除后父目录信息已不在，不能依赖 folders 表反查）
          const idList = Array.from(ids);
          const noteIds = d.prepare("SELECT id, title, parent_id, sort_order, updated_at FROM notes WHERE parent_id IN (" + idList.map(() => "?").join(",") + ")").all(...idList) as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string }>;
          for (const n of noteIds) {
            writeTombstone.run(n.id, n.title, n.parent_id, n.sort_order, n.updated_at, now, "note", now);
            d.prepare("DELETE FROM notes WHERE id=?").run(n.id);
            d.prepare("DELETE FROM sync_base WHERE note_id=?").run(n.id);
            d.prepare("DELETE FROM note_history WHERE note_id=?").run(n.id);
          }
        }
      });
      tx();
      await saveSnapshot(d.exportBytes());
    });
  },

  /** 导出当前库快照字节（S3 通路验证 + 后续同步协议用） */
  async exportSnapshotBytes(): Promise<Uint8Array> {
    const d = await ensureDb();
    return d.exportBytes();
  },

  // ---- S3（POC 通路验证） ----

  async getS3Settings(): Promise<S3Settings | null> {
    try {
      const raw = localStorage.getItem(S3_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<S3Settings>;
      // §17.5/§22.3：secret 不落 localStorage 明文——从 secretStore（WebCrypto 加密 IndexedDB）读取；
      // 旧版本明文 secret 在 saveS3Settings 时已迁移，此处兜底兼容（读到则加密回存并清明文）。
      let secret = parsed.secretAccessKey ?? "";
      const stored = await mobileSecretStore.read("s3.secretAccessKey");
      if (stored !== null) secret = stored;
      else if (secret) {
        await mobileSecretStore.write("s3.secretAccessKey", secret);
        delete parsed.secretAccessKey;
        localStorage.setItem(S3_STORAGE_KEY, JSON.stringify(parsed));
      }
      return { ...parsed, prefix: parsed.prefix ?? DEFAULT_S3_PREFIX, secretAccessKey: secret } as S3Settings;
    } catch {
      return null;
    }
  },

  async saveS3Settings(cfg: S3Settings): Promise<void> {
    // P2-8（GPT 审计）：secret 加密存储失败必须让保存整体失败（否则 UI 显示已保存但同步密钥缺失）
    await mobileSecretStore.write("s3.secretAccessKey", cfg.secretAccessKey);
    const { secretAccessKey: _s, ...rest } = cfg;
    localStorage.setItem(S3_STORAGE_KEY, JSON.stringify(rest));
  },

  /** 七牛验证必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404，AGENTS.md 踩坑 #4） */
  async testS3Connection(): Promise<string> {
    const cfg = await bridge.getS3Settings();
    if (!cfg) return "未配置 S3";
    try {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const client = await createS3Client(cfg);
      const out = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1 }));
      return `OK（对象数 ≥ ${out.KeyCount ?? 0}）`;
    } catch (e) {
      return `FAIL: ${(e as Error).message}`;
    }
  },

  async uploadObject(key: string, body: Uint8Array | string): Promise<string> {
    const cfg = await bridge.getS3Settings();
    if (!cfg) throw new Error("S3 未配置");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await createS3Client(cfg);
    await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body }));
    return key;
  },

  /** D8+：图片/附件上传（Lake 编辑器粘贴/插入调用）。本地落盘 + 返回 canonical URL（本地 AssetServer 服务）。
   * 附件（非图片）同样走本路径：任意字节落盘 + 保留原扩展名（与桌面 assetNaming 命名一致）。 */
  async uploadResource(
    input: { bytes: Uint8Array; filename: string },
    noteId: string
  ): Promise<{ url: string; resourceRef: string; filename: string; mimeType: string; size: number }> {
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes as unknown as ArrayLike<number>);
    // 与桌面一致的资产文件名（共享 buildAssetFilename：{13ts}_{8hex}.{ext}，extractAssetRefs 正则匹配）
    const name = buildAssetFilename(input.filename);
    // 本地存储（内存 + Filesystem 持久化，AssetServer 读取显示）
    // P1-8（GPT 审计）：必须等待 Filesystem 落盘成功再返回，否则"正文保存成功但图片重启后丢失"
    const key = noteId + "/" + name;
    assets.set(key, bytes);
    try {
      await saveAssetBytesFs(key, bytes);
    } catch (e) {
      assets.delete(key);
      throw new Error("图片落盘失败: " + (e as Error).message);
    }
    const mimeType = mimeForExt(extOf(name));
    const url = localAssetHttpUrl(noteId, name);
    // filename 字段 = 原始文件名（Lake file 卡片展示名；磁盘名/同步用 URL 里的生成名，与桌面一致）
    const displayName = input.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "附件";
    return { url, resourceRef: url, filename: displayName, mimeType, size: bytes.length };
  },

  /** M1 同步：manifest v4 协议（拉取对账 + 上传发布）+ 小记 quick-notes/ 子空间同步，复用 src/core 引擎。
   * P2-5/6（GPT 审计）：结构化返回（notes/quickNotes 分字段）；主维护队列串行化防与本地写操作交错。 */
  async syncNow(): Promise<MobileSyncResult> {
    return maintenance.run("main", async () => {
      const cfg = await bridge.getS3Settings();
      if (!cfg) return { message: "未配置 S3", notes: null, quickNotes: null };
      const d = await ensureDb();
      const syncCfg: SyncConfig = {
        endpoint: cfg.endpoint,
        region: cfg.region,
        bucket: cfg.bucket,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        prefix: cfg.prefix,
      };
      const s3Store = createCapacitorS3Store(syncCfg);
      const report = await runSync(syncCfg, s3Store, dbPort);
      // 小记独立子空间同步（quick-notes/ 前缀，同一 S3 配置；墓碑/恢复/冲突语义与桌面一致）。
      // 失败不拖垮笔记同步（对齐桌面 main.ts：quickNotes 错误单独上报）。
      let quickNotes: QuickNotesSyncResult | { error: string };
      let quickMsg = "；小记已同步";
      try {
        quickNotes = await syncQuickNotesViaEngine(syncCfg, s3Store, createQuickNotesSyncDbPort(d, {
          assetBytes: assets,
          saveAssetFile: saveAssetBytesFs,
          loadAssetFile: loadAssetBytesFs,
          removeAssetFile: removeAssetBytesFs,
        }));
        if (quickNotes.uploaded + quickNotes.downloaded > 0) {
          quickMsg = `；小记 ↓${quickNotes.downloaded} ↑${quickNotes.uploaded}`;
        }
      } catch (reason) {
        quickNotes = { error: (reason as Error).message };
        quickMsg = `；小记同步失败：${quickNotes.error}`;
      }
      await saveSnapshot(d.exportBytes());
      return { message: report.message + quickMsg, notes: report, quickNotes };
    });
  },
  // ---- 目录树只读契约（同步调试/测试用） ----
  listNotebookTree: listNotebookTreeImpl,
  // ---- 墓碑只读契约（同步调试/测试用；生产同步路径直接走 dbPort，不经此对象） ----
  listDeletedNotesForSync() { return dbPort.listDeletedNotesForSync!(); },
  readDeletedContent(id: string) { return dbPort.readDeletedContent!(id); },
  markTombstonesPublished(ids: string[]) { dbPort.markTombstonesPublished!(ids); },
  isFolderPurged(id: string): boolean { return dbPort.isFolderPurged!(id); },
};

/** 笔记本详情：返回完整子树（递归展开到叶），按 sort_order 排序（P1-3/P2-3/P2-4）。
 * 支持文档套文档：note 的 parent 可以是 folder 或 note（桌面嵌套文档在移动端也可见）。
 * 从 notebook 根 BFS 收集子树内所有节点（folders + notes，均可作父），再取父在子树内的节点。
 * 模块级函数：bridge 对象与 lakeNative 调试契约共用（函数声明 hoist，引用在对象内可用）。 */
async function listNotebookTreeImpl(notebookId: string): Promise<Array<{ id: string; title: string; kind: "group" | "note"; parentId: string | null; sortOrder: number; icon: string | null }>> {
  const d = await ensureDb();
  const allFolders = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon FROM folders WHERE trashed_at IS NULL").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null }>;
  const allNotes = d.prepare("SELECT id, title, parent_id, sort_order, icon FROM notes WHERE trashed_at IS NULL").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; icon: string | null }>;
  // 子树节点 id 集合（folder + note 都可作父；从根 BFS，支持任意层级嵌套）
  const inTree = new Set<string>();
  const queue = [notebookId];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (inTree.has(pid)) continue;
    inTree.add(pid);
    for (const f of allFolders) if (f.parent_id === pid && !inTree.has(f.id)) queue.push(f.id);
    for (const n of allNotes) if (n.parent_id === pid && !inTree.has(n.id)) queue.push(n.id);
  }
  const groups = allFolders.filter((f) => f.node_type === "group" && f.parent_id && inTree.has(f.parent_id));
  const notes = allNotes.filter((n) => n.parent_id && inTree.has(n.parent_id));
  const items: Array<{ id: string; title: string; kind: "group" | "note"; parentId: string | null; sortOrder: number; icon: string | null }> = [
    ...groups.map((g) => ({ id: g.id, title: g.title, kind: "group" as const, parentId: g.parent_id, sortOrder: g.sort_order, icon: g.icon ?? null })),
    ...notes.map((n) => ({ id: n.id, title: n.title, kind: "note" as const, parentId: n.parent_id, sortOrder: n.sort_order, icon: n.icon ?? null })),
  ];
  // 同父级内按 sort_order 排序（对齐桌面目录排序语义）
  items.sort((a, b) => {
    if (a.parentId !== b.parentId) return 0;
    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "zh");
  });
  return items;
}
