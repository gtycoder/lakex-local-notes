/**
 * POC JS 桥（M0/M1）：window.lakeNative 兼容接口的移动端实现。
 * - 数据层：sql.js（WASM 同步 DbLike，见 sqliteDb.ts）+ IndexedDB 快照持久化
 * - S3：@aws-sdk/client-s3 + CapacitorHttpHandler（原生传输层，无 CORS）
 * - 同步：syncEngine（manifest v4 协议，复用 src/core 决策纯函数）
 * - 范围 = docs/MOBILE-TECH-STACK.md §9.2 的最小 IPC 集（POC 版）
 */
import { SqlJsDb } from "./sqliteDb";
import { loadSnapshot, saveSnapshot, listAssetKeys as listLegacyAssetKeys, loadAssetBytes as loadLegacyAssetBytes } from "./persistence";
import { saveAssetBytesFs, loadAssetBytesFs, listAssetKeysFs } from "./assetFs";
import { syncNow as runSync, type SyncConfig, type SyncDbPort } from "../core/syncEngine.js";
import { TRASH_NOTEBOOK_ID } from "../core/syncDecisions.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { createCapacitorS3Store } from "./s3Store";
import type { S3Settings } from "../lib/types";
import { assertMoveTarget, assertNodeIcon, assertOrderedChildren, assertRootConstraint, assertTreeNodeTitle, nextSortOrder } from "../core/treeRules.js";
import { buildLikePattern, buildSearchSql, toSearchResult } from "../core/mobileSearch.js";
import { normalizeQuickNoteContent, previewQuickNote, serializeQuickNoteContent } from "../core/quickNoteModel.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../core/quickNoteModel.js";
import { mobileSecretStore } from "./secretStore.js";

export interface POCNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

/** 与桌面一致的默认同步 prefix（对齐桌面 store.ts 默认 "lake-notes"；P1-7 GPT 审计：ab-test-verify 仅限测试） */
const DEFAULT_S3_PREFIX = "lake-notes";

const S3_STORAGE_KEY = "lake-notes-mobile.s3";
/** 与桌面一致的初始 Lake 内容（store.ts createNoteInWithContent） */
export const INITIAL_LAKE_CONTENT = `<p class="ne-p"><br></p>`;

let db: SqlJsDb | null = null;
/** 已下载资源（POC 内存态；M2 接 Capacitor Filesystem 持久化）。key = "{noteId}/{filename}" */
const assets = new Map<string, Uint8Array>();

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
  // P1-2（GPT 审计）：默认笔记本 seed（对齐桌面 notebook-personal）。幂等：仅首次初始化种入。
  db.prepare("INSERT OR IGNORE INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,NULL,0,'notebook',NULL,?,'synced')")
    .run("notebook-personal", "个人笔记", new Date().toISOString());
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
    // 对齐桌面 store.ts DEFAULT_NOTEBOOK_ID（effectiveParent 回退基准）
    return "notebook-personal";
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
    // H3：从内存 assets Map 扫描该笔记的资产（POC 内存态；M2 接 FS 后改为目录扫描）
    const out = [];
    const prefix = noteId + "/";
    for (const [key, bytes] of assets) {
      if (!key.startsWith(prefix)) continue;
      const filename = key.slice(prefix.length);
      out.push({ filename, size: bytes.length, hash: sha256Sync(bytes) });
    }
    return out;
  },
  async readLocalAsset(noteId, filename) {
    // H3：从内存 assets Map 读取字节（与 getAssetBytes 同源）
    return assets.get(noteId + "/" + filename) ?? null;
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
    const noteRow = d.prepare("SELECT 1 FROM notes WHERE sync_state != 'synced' AND deleted_at IS NULL LIMIT 1").get();
    if (noteRow) return true;
    // 目录改动判定对齐桌面 tree_nodes.sync_state：仅 sync_state != 'synced' 的节点算待上传；
    // 存在默认笔记本等已同步节点不算（否则永不早退）。
    const groupRow = d.prepare("SELECT 1 FROM folders WHERE sync_state != 'synced' AND id != ? LIMIT 1").get(TRASH_NOTEBOOK_ID);
    return !!groupRow;
  },
  log(msg) {
    console.log("[mobile-sync]", msg);
  },
};

export const bridge = {
  async init(): Promise<void> {
    await ensureDb();
    // 启动时从 Capacitor Filesystem 载入已持久化资产到内存（getAssetBytes 同步读；B1）
    try {
      const keys = await listAssetKeysFs();
      // 一次性迁移：IndexedDB 旧资产（B1 升级前）→ Filesystem（缺失的键才搬，幂等）
      try {
        const legacyKeys = await listLegacyAssetKeys();
        let migrated = 0;
        for (const key of legacyKeys) {
          if (keys.includes(key)) continue;
          const bytes = await loadLegacyAssetBytes(key);
          if (bytes) {
            await saveAssetBytesFs(key, bytes);
            keys.push(key);
            migrated++;
          }
        }
        if (migrated > 0) console.log("[mobile] 已迁移旧资产:", migrated);
      } catch (e) {
        console.warn("[mobile] 旧资产迁移跳过（可重新同步）:", e);
      }
      for (const key of keys) {
        const bytes = await loadAssetBytesFs(key);
        if (bytes) assets.set(key, bytes);
      }
      if (keys.length > 0) console.log("[mobile] 已恢复资产:", keys.length);
    } catch (e) {
      console.warn("[mobile] 恢复资产失败（可重新同步）:", e);
    }
  },

  // ---- 目录树 CRUD（Phase 0B：对齐共享 TreeRepository 接口，§20 ports.ts） ----

  async listTreeNodes(): Promise<import("../lib/types").TreeNode[]> {
    const d = await ensureDb();
    const rows = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id, sync_state FROM folders WHERE trashed_at IS NULL").all() as Array<{
      id: string; title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null; sync_state: string;
    }>;
    return rows.map((r) => ({
      id: r.id, workspaceId: "mobile", parentId: r.parent_id, nodeType: r.node_type as import("../lib/types").TreeNodeType,
      title: r.title, noteFileId: null, sortOrder: r.sort_order, createdAt: r.updated_at, updatedAt: r.updated_at,
      syncState: r.sync_state as import("../lib/types").TreeNode["syncState"], isConflict: false, icon: r.icon ?? null,
    }));
  },

  /** 笔记本详情：返回完整子树（递归 group 展开到叶 note/group），按 sort_order 排序（P1-3/P2-3/P2-4）。 */
  async listNotebookTree(notebookId: string): Promise<Array<{ id: string; title: string; kind: "group" | "note"; parentId: string | null; sortOrder: number }>> {
    const d = await ensureDb();
    // 收集 notebook 下全部 folders（含深层 group）——沿 parent_id 迭代展开
    const allFolders = d.prepare("SELECT id, title, parent_id, sort_order, node_type FROM folders WHERE trashed_at IS NULL").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; node_type: string }>;
    const folderIds = new Set<string>([notebookId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of allFolders) {
        if (f.parent_id && folderIds.has(f.parent_id) && !folderIds.has(f.id)) { folderIds.add(f.id); grew = true; }
      }
    }
    const groups = allFolders.filter((f) => f.node_type === "group" && f.parent_id && folderIds.has(f.parent_id));
    const allNotes = d.prepare("SELECT id, title, parent_id, sort_order FROM notes WHERE trashed_at IS NULL").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number }>;
    const notes = allNotes.filter((n) => n.parent_id && folderIds.has(n.parent_id));
    const items: Array<{ id: string; title: string; kind: "group" | "note"; parentId: string | null; sortOrder: number }> = [
      ...groups.map((g) => ({ id: g.id, title: g.title, kind: "group" as const, parentId: g.parent_id, sortOrder: g.sort_order })),
      ...notes.map((n) => ({ id: n.id, title: n.title, kind: "note" as const, parentId: n.parent_id, sortOrder: n.sort_order })),
    ];
    // 同父级内按 sort_order 排序（对齐桌面目录排序语义）
    items.sort((a, b) => {
      if (a.parentId !== b.parentId) return 0;
      return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "zh");
    });
    return items;
  },

  /** 新建 notebook：根层创建，名称必填（trim 校验，共享 treeRules），默认图标不落库（icon 由 setNodeIcon 单独写入）。 */
  async createNotebook(input: { title: string; icon: string | null }): Promise<import("../lib/types").TreeNode> {
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
    return {
      id, workspaceId: "mobile", parentId: null, nodeType: "notebook", title,
      noteFileId: null, sortOrder, createdAt: now, updatedAt: now, syncState: "local", isConflict: false, icon: input.icon ?? null,
    };
  },

  /** 新建 group：父节点必须存在（且非回收站），名称校验共享 treeRules。 */
  async createGroup(parentId: string, title: string): Promise<import("../lib/types").TreeNode> {
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
    return {
      id, workspaceId: "mobile", parentId, nodeType: "group", title: trimmed,
      noteFileId: null, sortOrder, createdAt: now, updatedAt: now, syncState: "local", isConflict: false, icon: null,
    };
  },

  async renameTreeNode(id: string, title: string): Promise<import("../lib/types").TreeNode> {
    const trimmed = assertTreeNodeTitle(title);
    const d = await ensureDb();
    const now = new Date().toISOString();
    const changed = d.prepare("UPDATE folders SET title=?, updated_at=?, sync_state='local' WHERE id=?").run(trimmed, now, id).changes;
    if (!changed) throw new Error("节点不存在: " + id);
    await saveSnapshot(d.exportBytes());
    const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
    return {
      id, workspaceId: "mobile", parentId: row.parent_id ? String(row.parent_id) : null,
      nodeType: String(row.node_type) as import("../lib/types").TreeNodeType, title: trimmed,
      noteFileId: null, sortOrder: Number(row.sort_order), createdAt: String(row.updated_at), updatedAt: now,
      syncState: "local", isConflict: false, icon: row.icon ? String(row.icon) : null,
    };
  },

  async setNodeIcon(id: string, icon: string | null): Promise<import("../lib/types").TreeNode> {
    assertNodeIcon(icon);
    const d = await ensureDb();
    const now = new Date().toISOString();
    const changed = d.prepare("UPDATE folders SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id).changes;
    if (!changed) throw new Error("节点不存在: " + id);
    await saveSnapshot(d.exportBytes());
    const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
    return {
      id, workspaceId: "mobile", parentId: row.parent_id ? String(row.parent_id) : null,
      nodeType: String(row.node_type) as import("../lib/types").TreeNodeType, title: String(row.title),
      noteFileId: null, sortOrder: Number(row.sort_order), createdAt: String(row.updated_at), updatedAt: now,
      syncState: "local", isConflict: false, icon,
    };
  },

  async moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<import("../lib/types").TreeNode> {
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
    return {
      id, workspaceId: "mobile", parentId, nodeType: String(row.node_type) as import("../lib/types").TreeNodeType, title: String(row.title),
      noteFileId: null, sortOrder: Number(row.sort_order), createdAt: String(row.updated_at), updatedAt: now,
      syncState: "local", isConflict: false, icon: row.icon ? String(row.icon) : null,
    };
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

  /** Phase 0B-5：搜索 fallback（sql.js 无 FTS5 → LIKE；标题+正文，参数化 + ESCAPE）。 */
  async searchNotes(query: string): Promise<import("../core/searchRepository.js").SearchResult[]> {
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
    const rows = d.prepare("SELECT id, preview_text, image_count, updated_at FROM quick_notes WHERE restore_pending_at IS NULL ORDER BY updated_at DESC").all() as Array<{ id: string; preview_text: string; image_count: number; updated_at: string }>;
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
    const d = await ensureDb();
    const now = new Date().toISOString();
    const content = normalizeQuickNoteContent(text, images);
    const serialized = serializeQuickNoteContent(content);
    const contentHash = sha256Sync(new TextEncoder().encode(serialized));
    const preview = previewQuickNote(text, images.length);
    d.prepare(
      `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict)
       VALUES (?,?,?,?,?,?,?,'local',0)
       ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state='local'`
    ).run(id, now, now, preview, images.length, contentHash, serialized);
    await saveSnapshot(d.exportBytes());
    return id;
  },

  async createQuickNote(text: string): Promise<string> {
    const id = crypto.randomUUID();
    await bridge.saveQuickNote(id, text, []);
    return id;
  },

  /** 本地删除小记：直接 DELETE（对齐桌面小记语义：随手记，删除即隐没；同步后置阶段不做墓碑传播）。 */
  async deleteQuickNote(id: string): Promise<void> {
    const d = await ensureDb();
    d.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
    await saveSnapshot(d.exportBytes());
  },

  async saveNote(id: string, title: string, content: string, parentId: string | null = null): Promise<void> {
    const d = await ensureDb();
    const now = new Date().toISOString();
    // P1-9（GPT 审计）：文档标题不为空——空白回退"无标题文档"（对齐 createNote 默认语义，避免同步空标题）
    const safeTitle = title.trim() ? title.trim() : "无标题文档";
    // 本地编辑必须置 sync_state='local'（待上传），否则同步零变更早退会跳过本次修改
    // ON CONFLICT 不覆盖 parent_id：编辑后保留归属；新建时用传入 parentId
    d.prepare(
      `INSERT INTO notes (id, title, content, parent_id, updated_at, sync_state) VALUES (?,?,?,?,?,'local')
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, updated_at=excluded.updated_at, sync_state='local'`
    ).run(id, safeTitle, content, parentId, now);
    await saveSnapshot(d.exportBytes());
  },

  async createNote(title: string, parentId: string | null = null): Promise<POCNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await bridge.saveNote(id, title, INITIAL_LAKE_CONTENT, parentId);
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
    const d = await ensureDb();
    if (kind === "note") { dbPort.localRestoreNote(id); }
    else {
      // P1-4（GPT 审计）：folder 恢复必须同事务恢复其下 notes（否则文档继续留在回收站）
      const tx = d.transaction(() => {
        // 收集整棵 folder 子树（含自己）→ 清 trashed_at
        const all = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
        const ids = new Set<string>([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const r2 of all) {
            if (r2.parent_id && ids.has(r2.parent_id) && !ids.has(r2.id)) { ids.add(r2.id); grew = true; }
          }
        }
        const now = new Date().toISOString();
        for (const fid of ids) {
          d.prepare("UPDATE folders SET trashed_at=NULL, updated_at=?, sync_state='local' WHERE id=?").run(now, fid);
        }
        // 恢复子树下被移入回收站的 notes：清 trashed + 置 restore_pending_at（同步 local-wins 上传）
        const noteRows = d.prepare("SELECT id FROM notes WHERE parent_id IN (" + Array.from(ids).map(() => "?").join(",") + ") AND trashed_at IS NOT NULL").all(...Array.from(ids)) as Array<{ id: string }>;
        for (const n of noteRows) {
          d.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local', updated_at=? WHERE id=?").run(now, now, n.id);
        }
      });
      tx();
    }
    await saveSnapshot(d.exportBytes());
  },

  /** B2：彻底删除回收站项（purge）。folder = 子树全部 purge；note = 单条 purge（同步发墓碑）。 */
  async purgeTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    const d = await ensureDb();
    if (kind === "note") {
      // purge 语义（对齐桌面 purgeTrashItem）：sync_state='purged' → 引擎发布时从 manifest 移除且不再上传
      const now = new Date().toISOString();
      d.prepare("UPDATE notes SET parent_id=?, trashed_at=COALESCE(trashed_at,?), deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id), updated_at=?, sync_state='purged', restore_pending_at=NULL WHERE id=?").run(TRASH_NOTEBOOK_ID, now, now, id);
    }
    else {
      // folder：收集子树（含自己）
      const all = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
      const ids = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r2 of all) {
          if (r2.parent_id && ids.has(r2.parent_id) && !ids.has(r2.id)) { ids.add(r2.id); grew = true; }
        }
      }
      const now = new Date().toISOString();
      for (const fid of ids) {
        d.prepare("UPDATE folders SET trashed_at=COALESCE(trashed_at,?), updated_at=?, sync_state='purged' WHERE id=?").run(now, now, fid);
      }
      // 子树下的文档也 purge
      const noteIds = d.prepare("SELECT id FROM notes WHERE parent_id IN (SELECT id FROM folders WHERE id IN (" + Array.from(ids).map(() => "?").join(",") + "))").all(...Array.from(ids)) as Array<{ id: string }>;
      const now2 = new Date().toISOString();
      for (const n of noteIds) {
        d.prepare("UPDATE notes SET parent_id=?, trashed_at=COALESCE(trashed_at,?), deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id), updated_at=?, sync_state='purged', restore_pending_at=NULL WHERE id=?").run(TRASH_NOTEBOOK_ID, now2, now2, n.id);
      }
    }
    await saveSnapshot(d.exportBytes());
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
    // secret 加密存 secretStore；其余字段存 localStorage（不回写明文 secret）
    await mobileSecretStore.write("s3.secretAccessKey", cfg.secretAccessKey).catch(() => undefined);
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

  /** D8+：图片上传（Lake 编辑器粘贴/插入图片调用）。本地存资产（供 blob 显示）+ 返回 canonical URL。 */
  async uploadResource(
    input: { bytes: number[]; filename: string },
    noteId: string
  ): Promise<{ url: string; resourceRef: string; filename: string; mimeType: string; size: number }> {
    const bytes = new Uint8Array(input.bytes);
    // 与桌面一致的资产文件名：13 位时间戳 + 8 hex + 扩展名（extractAssetRefs 正则匹配）
    const ext = (input.filename.split(".").pop() || "png").toLowerCase();
    const name = `${Date.now()}_${randomHex(4)}.${ext}`;
    // 本地存储（内存 + Filesystem 持久化，供 blob 注入读取）
    // P1-8（GPT 审计）：必须等待 Filesystem 落盘成功再返回，否则"正文保存成功但图片重启后丢失"
    const key = noteId + "/" + name;
    assets.set(key, bytes);
    try {
      await saveAssetBytesFs(key, bytes);
    } catch (e) {
      assets.delete(key);
      throw new Error("图片落盘失败: " + (e as Error).message);
    }
    const mimeType = mimeForExt(ext);
    const url = `http://127.0.0.1:19876/${noteId}/${name}`;
    return { url, resourceRef: url, filename: name, mimeType, size: bytes.length };
  },

  /** M1 同步：manifest v4 协议（拉取对账 + 上传发布），复用 src/core 决策纯函数 */
  async syncNow(): Promise<string> {
    const cfg = await bridge.getS3Settings();
    if (!cfg) return "未配置 S3";
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
    await saveSnapshot(d.exportBytes());
    return report.message;
  },
};


