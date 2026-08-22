/**
 * POC JS 桥（M0/M1）：window.lakeNative 兼容接口的移动端实现。
 * - 数据层：sql.js（WASM 同步 DbLike，见 sqliteDb.ts）+ IndexedDB 快照持久化
 * - S3：@aws-sdk/client-s3 + CapacitorHttpHandler（原生传输层，无 CORS）
 * - 同步：syncEngine（manifest v4 协议，复用 src/core 决策纯函数）
 * - 范围 = docs/MOBILE-TECH-STACK.md §9.2 的最小 IPC 集（POC 版）
 */
import { SqlJsDb } from "./sqliteDb";
import { loadSnapshot, saveSnapshot, saveAssetBytes, loadAssetBytes, listAssetKeys } from "./persistence";
import { syncNow as runSync, type SyncConfig, type SyncDbPort } from "../core/syncEngine.js";
import { TRASH_NOTEBOOK_ID } from "../core/syncDecisions.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { createCapacitorS3Store } from "./s3Store";

export interface POCNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix?: string;
}

const S3_STORAGE_KEY = "lake-notes-mobile.s3";
/** 与桌面一致的初始 Lake 内容（store.ts createNoteInWithContent） */
export const INITIAL_LAKE_CONTENT = `<p class="ne-p"><br></p>`;

let db: SqlJsDb | null = null;
/** 已下载资源（POC 内存态；M2 接 Capacitor Filesystem 持久化）。key = "{noteId}/{filename}" */
const assets = new Map<string, Uint8Array>();

async function ensureDb(): Promise<SqlJsDb> {
  if (db) return db;
  const snap = await loadSnapshot();
  db = snap ? await SqlJsDb.openFrom(snap) : await SqlJsDb.open();
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
  db.exec(`CREATE TABLE IF NOT EXISTS deleted_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL
  )`);
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
    deleted_from_parent_id TEXT
  )`);
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

function rowToNote(r: Record<string, unknown>): POCNote {
  return { id: String(r.id), title: String(r.title), content: String(r.content), updatedAt: String(r.updated_at) };
}

async function createS3Client(cfg: S3Config): Promise<import("@aws-sdk/client-s3").S3Client> {
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
    d.prepare(
      "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at"
    ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, deletedAt);
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
    d.prepare(
      "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at, last_uploaded_hash) VALUES (?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at, last_uploaded_hash=excluded.last_uploaded_hash"
    ).run(id, expectedContentHash, metaAt, lastUploadedHash);
  },
  setSyncBase(id, contentHash, metaAt, lastUploadedHash) {
    const d = db!;
    d.prepare(
      "INSERT INTO sync_base (note_id, content_hash, last_synced_meta_at, last_uploaded_hash) VALUES (?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET content_hash=excluded.content_hash, last_synced_meta_at=excluded.last_synced_meta_at, last_uploaded_hash=excluded.last_uploaded_hash"
    ).run(id, contentHash, metaAt, lastUploadedHash);
  },
  defaultNotebookId() {
    // 对齐桌面 store.ts DEFAULT_NOTEBOOK_ID（effectiveParent 回退基准）
    return "notebook-personal";
  },
  importRemoteFolder(folder) {
    const d = db!;
    d.prepare(
      "INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, node_type=excluded.node_type, icon=excluded.icon, updated_at=excluded.updated_at, trashed_at=excluded.trashed_at, deleted_from_parent_id=excluded.deleted_from_parent_id"
    ).run(folder.id, folder.title, folder.parentId, folder.sortOrder, folder.nodeType, folder.icon ?? null, folder.updatedAt, folder.trashedAt ?? null, folder.deletedFromParentId ?? null);
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
    // 持久化到 IndexedDB（图片较大，独立键，避免全库快照膨胀）；失败不阻断主流程
    void saveAssetBytes(key, bytes).catch(() => {});
  },
  log(msg) {
    console.log("[mobile-sync]", msg);
  },
};

export const bridge = {
  async init(): Promise<void> {
    await ensureDb();
    // 启动时从 IndexedDB 载入已持久化资产到内存（getAssetBytes 同步读）
    try {
      const keys = await listAssetKeys();
      for (const key of keys) {
        const bytes = await loadAssetBytes(key);
        if (bytes) assets.set(key, bytes);
      }
      if (keys.length > 0) console.log("[mobile] 已恢复资产:", keys.length);
    } catch (e) {
      console.warn("[mobile] 恢复资产失败（可重新同步）:", e);
    }
  },

  async listNotes(): Promise<POCNote[]> {
    const d = await ensureDb();
    const rows = d.prepare("SELECT id, title, content, updated_at FROM notes WHERE trashed_at IS NULL ORDER BY updated_at DESC").all();
    return rows.map(rowToNote);
  },

  async readNote(id: string): Promise<POCNote | null> {
    const d = await ensureDb();
    const row = d.prepare("SELECT id, title, content, updated_at FROM notes WHERE id = ?").get(id);
    return row ? rowToNote(row) : null;
  },

  /** D8：读取已下载资产字节（blob 注入时从本地内存态读取；M2 接 Capacitor Filesystem）。 */
  getAssetBytes(noteId: string, filename: string): Uint8Array | null {
    const bytes = assets.get(noteId + "/" + filename);
    return bytes ?? null;
  },

  async saveNote(id: string, title: string, content: string): Promise<void> {
    const d = await ensureDb();
    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO notes (id, title, content, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, updated_at=excluded.updated_at`
    ).run(id, title, content, now);
    await saveSnapshot(d.exportBytes());
  },

  async createNote(title: string): Promise<POCNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await bridge.saveNote(id, title, INITIAL_LAKE_CONTENT);
    return { id, title, content: INITIAL_LAKE_CONTENT, updatedAt: now };
  },

  /** 本地软删（入回收站）：同步时上传墓碑（删除压编辑） */
  async trashNote(id: string): Promise<void> {
    const d = await ensureDb();
    dbPort.localTrashNote(id);
    await saveSnapshot(d.exportBytes());
  },

  /** 本地恢复：restore_pending_at → 同步时 local-wins 上传 active 覆盖墓碑 */
  async restoreNote(id: string): Promise<void> {
    const d = await ensureDb();
    dbPort.localRestoreNote(id);
    await saveSnapshot(d.exportBytes());
  },

  /** 回收站列表 */
  async listTrashed(): Promise<POCNote[]> {
    const d = await ensureDb();
    const rows = d.prepare("SELECT id, title, content, updated_at FROM notes WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC").all();
    return rows.map(rowToNote);
  },

  /** 导出当前库快照字节（S3 通路验证 + 后续同步协议用） */
  async exportSnapshotBytes(): Promise<Uint8Array> {
    const d = await ensureDb();
    return d.exportBytes();
  },

  // ---- S3（POC 通路验证） ----

  getS3Settings(): S3Config | null {
    try {
      const raw = localStorage.getItem(S3_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as S3Config) : null;
    } catch {
      return null;
    }
  },

  saveS3Settings(cfg: S3Config): void {
    localStorage.setItem(S3_STORAGE_KEY, JSON.stringify(cfg));
  },

  /** 七牛验证必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404，AGENTS.md 踩坑 #4） */
  async testS3Connection(): Promise<string> {
    const cfg = bridge.getS3Settings();
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
    const cfg = bridge.getS3Settings();
    if (!cfg) throw new Error("S3 未配置");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await createS3Client(cfg);
    await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body }));
    return key;
  },

  /** M1 同步：manifest v4 协议（拉取对账 + 上传发布），复用 src/core 决策纯函数 */
  async syncNow(): Promise<string> {
    const cfg = bridge.getS3Settings();
    if (!cfg) return "未配置 S3";
    const d = await ensureDb();
    const syncCfg: SyncConfig = {
      endpoint: cfg.endpoint,
      region: cfg.region,
      bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      prefix: cfg.prefix ?? "ab-test-verify",
    };
    const s3Store = createCapacitorS3Store(syncCfg);
    const report = await runSync(syncCfg, s3Store, dbPort);
    await saveSnapshot(d.exportBytes());
    return report.message;
  },
};


