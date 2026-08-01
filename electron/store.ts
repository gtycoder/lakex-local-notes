import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { net as electronNet } from "electron";
import { ASSET_PORT } from "./assetServer.js";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_NOTEBOOK_ID = "notebook-personal";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
// 下载外部图片的超时与请求头（移植自 Tauri 版 Rust 后端，见 lake-notes-tauri-poc/src-tauri/src/store.rs）
const DOWNLOAD_TIMEOUT_MS = 30_000;
// 知乎等 CDN 的防盗链 403 有波动性，重试可显著提高成功率
const DOWNLOAD_MAX_ATTEMPTS = 3;
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
}
interface NoteDocument extends NoteSummary { content: string; }
interface TreeNode {
  id: string; workspaceId: string; parentId: string | null; nodeType: string;
  title: string; noteFileId: string | null; sortOrder: number; createdAt: string;
  updatedAt: string; syncState: string; isConflict: boolean;
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
interface SyncNote {
  id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; isConflict: boolean;
}
interface RemoteAsset {
  filename: string; size: number; hash: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uuid(): string {
  return crypto.randomUUID();
}

export class Store {
  private db: Database.Database;
  private root: string;
  private noteAssetsDir: string;

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
    `);
    const now = nowIso();
    this.db.prepare(`INSERT OR IGNORE INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
      VALUES(?,?,?,?,?,NULL,0,?,?,NULL,'local',0)`).run(DEFAULT_NOTEBOOK_ID, DEFAULT_WORKSPACE_ID, null, "notebook", "个人笔记", now, now);
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

  private mapSummary(row: any): NoteSummary {
    return { id: row.id, title: row.title, parentId: row.parent_id, sortOrder: row.sort_order,
      updatedAt: row.updated_at, syncState: row.sync_state, isConflict: !!row.is_conflict };
  }

  private mapTreeNode(row: any): TreeNode {
    return { id: row.id, workspaceId: row.workspace_id, parentId: row.parent_id, nodeType: row.node_type,
      title: row.title, noteFileId: row.note_file_id, sortOrder: row.sort_order, createdAt: row.created_at,
      updatedAt: row.updated_at, syncState: row.sync_state, isConflict: !!row.is_conflict };
  }

  bootstrap() {
    const notes = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict FROM notes WHERE deleted_at IS NULL ORDER BY sort_order"
    ).all().map((r) => this.mapSummary(r));
    const last = this.db.prepare("SELECT value FROM device_state WHERE key='last_opened_note_id'").get() as { value: string } | undefined;
    return {
      workspaceId: DEFAULT_WORKSPACE_ID,
      workspaceName: "Lake Notes 本地仓库",
      notes,
      lastOpenedNoteId: last?.value ?? null,
      sync: { phase: "idle", message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 },
    };
  }

  listTreeNodes(): TreeNode[] {
    return this.db.prepare(
      "SELECT * FROM tree_nodes WHERE workspace_id=? AND deleted_at IS NULL ORDER BY sort_order"
    ).all(DEFAULT_WORKSPACE_ID).map((r) => this.mapTreeNode(r));
  }

  private readTreeNode(id: string): TreeNode {
    const row = this.db.prepare("SELECT * FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(id);
    if (!row) throw new AppError("NotFound", `节点不存在: ${id}`);
    return this.mapTreeNode(row);
  }

  readNote(id: string): NoteDocument {
    const row = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,sync_state,is_conflict FROM notes WHERE id=? AND deleted_at IS NULL"
    ).get(id);
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const content = fs.readFileSync(this.notePath(id), "utf8");
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_opened_note_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);
    return { ...this.mapSummary(row), content };
  }

  createNote(title: string): NoteDocument {
    return this.createNoteIn(DEFAULT_NOTEBOOK_ID, title);
  }

  createNoteIn(parentId: string | null, title: string): NoteDocument {
    const parent = parentId ?? DEFAULT_NOTEBOOK_ID;
    this.ensureParent(parent);
    const id = uuid();
    const updatedAt = nowIso();
    const sortOrder = this.nextSortOrder(parent);
    const content = `<p id="${id}-body" class="ne-p"><br></p>`;
    const tx = this.db.transaction(() => {
      this.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state) VALUES(?,?,?,?,?,'local')")
        .run(id, title, parent, sortOrder, updatedAt);
      this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,sync_state,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,'local',0)")
        .run(id, DEFAULT_WORKSPACE_ID, parent, title, id, sortOrder, updatedAt, updatedAt);
      this.atomicWrite(this.notePath(id), content);
    });
    tx();
    return { id, title, parentId: parent, sortOrder, updatedAt, syncState: "local", isConflict: false, content };
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
    });
    tx();
    return this.readTreeNode(id);
  }

  saveNote(id: string, title: string, content: string): NoteDocument {
    const p = this.notePath(id);
    if (!fs.existsSync(p)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const updatedAt = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE notes SET title=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL").run(title, updatedAt, id);
      this.db.prepare("UPDATE tree_nodes SET title=?,updated_at=?,sync_state='local' WHERE note_file_id=? AND deleted_at IS NULL").run(title, updatedAt, id);
      this.atomicWrite(p, content);
    });
    tx();
    this.detectOrphans(id, content);
    return this.readNote(id);
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

  deleteTreeNode(id: string) {
    // 硬删除（当前版本无回收站）：节点及其子节点从 DB 移除，
    // 笔记同时删除 .lake 文件、整个 note-assets/{noteId}/ 目录与孤儿记录
    const now = nowIso();
    const ids = this.descendantIds(id);
    const tx = this.db.transaction(() => {
      const nodeStmt = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?");
      const delNote = this.db.prepare("DELETE FROM notes WHERE id=?");
      const delNode = this.db.prepare("DELETE FROM tree_nodes WHERE id=?");
      const delOrphans = this.db.prepare("DELETE FROM orphan_assets WHERE note_id=?");
      const tombstone = this.db.prepare(
        "INSERT OR REPLACE INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at) VALUES(?,?,?,?,?,?)"
      );
      const noteMeta = this.db.prepare("SELECT id,title,parent_id,sort_order,updated_at FROM notes WHERE id=?");
      for (const nid of ids) {
        const node = nodeStmt.get(nid) as { note_file_id: string | null } | undefined;
        if (node?.note_file_id) {
          // 记录墓碑（同步用：防止云端把已删除笔记重新拉回来）
          const meta = noteMeta.get(node.note_file_id) as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
          if (meta) tombstone.run(meta.id, meta.title, meta.parent_id, meta.sort_order, meta.updated_at, now);
          fs.rmSync(this.notePath(node.note_file_id), { force: true });
          fs.rmSync(path.join(this.noteAssetsDir, node.note_file_id), { recursive: true, force: true });
          delOrphans.run(node.note_file_id);
          delNote.run(node.note_file_id);
        }
        delNode.run(nid);
      }
    });
    tx();
  }

  moveTreeNode(id: string, parentId: string | null, sortOrder: number): TreeNode {
    if (parentId) {
      if (parentId === id) throw new AppError("InvalidInput", "不能移动到自身");
      const descendants = new Set(this.descendantIds(id));
      if (descendants.has(parentId)) throw new AppError("InvalidInput", "不能移动到子节点");
      this.ensureParent(parentId);
    }
    const now = nowIso();
    this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
      .run(parentId, sortOrder, now, id);
    return this.readTreeNode(id);
  }

  reorderTreeNodes(parentId: string | null, orderedIds: string[]) {
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare("UPDATE tree_nodes SET sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL");
      orderedIds.forEach((id, index) => stmt.run(index, now, id));
    });
    tx();
  }

  private noteAssetsDirFor(noteId: string): string {
    if (!noteId || noteId === "." || noteId === ".." || noteId.includes("/") || noteId.includes("\\")) {
      throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    }
    return path.join(this.noteAssetsDir, noteId);
  }

  private assetUrl(noteId: string, filename: string): string {
    return `http://127.0.0.1:${ASSET_PORT}/${noteId}/${filename}`;
  }

  private referencedFilenames(noteId: string, content: string): Set<string> {
    // Lake 序列化图片时会把整条 URL 百分号编码后嵌进 data: URL（如
    // value="data:%7B%22src%22%3A%22http%3A%2F%2F127.0.0.1%3A19876%2F...%22..."），
    // 但文件名 {timestamp}_{random8}.ext 只含字母数字/下划线/点，编码后原样保留。
    // 直接按文件名模式扫描：文件名全局唯一（时间戳+8位随机），且孤儿检测按笔记目录
    // 隔离，因此匹配到的文件名即为该笔记被引用的资源。
    const referenced = new Set<string>();
    const re = /\d{13}_[0-9a-f]{8}\.(?:png|jpg|jpeg|gif|webp|avif)/g;
    for (const m of content.matchAll(re)) referenced.add(m[0]);
    return referenced;
  }

  private detectOrphans(noteId: string, content: string): void {
    const dir = this.noteAssetsDirFor(noteId);
    if (!fs.existsSync(dir)) return;
    const diskSet = new Set(fs.readdirSync(dir));
    const referencedSet = this.referencedFilenames(noteId, content);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO orphan_assets(note_id, filename, file_path, size, mime_type)
       VALUES(?,?,?,?,?)`
    );
    const unorphan = this.db.prepare("DELETE FROM orphan_assets WHERE note_id=? AND filename=?");
    const tx = this.db.transaction(() => {
      for (const filename of diskSet) {
        if (referencedSet.has(filename)) {
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
    const rows = this.db.prepare("SELECT * FROM orphan_assets").all() as any[];
    let count = 0;
    let freedBytes = 0;
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const fullPath = path.join(this.root, row.file_path);
        try {
          if (fs.existsSync(fullPath)) {
            freedBytes += fs.statSync(fullPath).size;
            fs.unlinkSync(fullPath);
          }
        } catch (error) {
          console.warn("[store] 清理孤儿资源失败，跳过:", fullPath, error);
        }
        this.db.prepare("DELETE FROM orphan_assets WHERE id=?").run(row.id);
        count++;
      }
    });
    tx();
    return { count, freedBytes };
  }

  // ===== S3 同步支持 =====

  getS3Settings(): S3Settings | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='s3_settings'").get() as { value: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value);
      if (!parsed || typeof parsed.endpoint !== "string") return null;
      return parsed as S3Settings;
    } catch {
      return null;
    }
  }

  saveS3Settings(settings: S3Settings): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('s3_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
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

  markSynced(id: string): void {
    this.db.prepare("UPDATE notes SET sync_state='synced' WHERE id=?").run(id);
  }

  markSyncComplete(at: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(at);
  }

  recordSyncResult(json: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_sync_result',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json);
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

  listNotesForSync(): SyncNote[] {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,is_conflict FROM notes WHERE deleted_at IS NULL ORDER BY sort_order"
    ).all().map((r: any) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
      updatedAt: r.updated_at, isConflict: !!r.is_conflict,
    }));
  }

  listDeletedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string }> {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,deleted_at FROM deleted_notes ORDER BY deleted_at"
    ).all().map((r: any) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
      updatedAt: r.updated_at, deletedAt: r.deleted_at,
    }));
  }

  /** 导入远程笔记：写 .lake + note-assets 资源 + upsert DB 记录 */
  importRemoteNote(note: SyncNote & { contentHash: string }, content: Buffer, assets: Array<{ filename: string; bytes: Buffer }>): void {
    const tx = this.db.transaction(() => {
      // 写 .lake
      fs.writeFileSync(this.notePath(note.id), content, "utf8");
      // 写资源
      if (assets.length > 0) {
        const dir = this.noteAssetsDirFor(note.id);
        fs.mkdirSync(dir, { recursive: true });
        for (const asset of assets) {
          fs.writeFileSync(path.join(dir, asset.filename), asset.bytes);
        }
      }
      // upsert notes
      this.db.prepare(
        `INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,deleted_at)
         VALUES(?,?,?,?,?,'synced',?,NULL)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title,parent_id=excluded.parent_id,
           sort_order=excluded.sort_order,updated_at=excluded.updated_at,
           sync_state='synced',is_conflict=excluded.is_conflict,deleted_at=NULL`
      ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, note.isConflict ? 1 : 0);
      // upsert tree_nodes（note 节点）
      this.db.prepare(
        `INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict)
         VALUES(?,?,?,'note',?,?,?,?,?,NULL,'synced',?)
         ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,
           sort_order=excluded.sort_order,updated_at=excluded.updated_at,
           deleted_at=NULL,sync_state='synced',is_conflict=excluded.is_conflict`
      ).run(note.id, DEFAULT_WORKSPACE_ID, note.parentId, note.title, note.id, note.sortOrder, note.updatedAt, note.updatedAt, note.isConflict ? 1 : 0);
    });
    tx();
    void note.contentHash;
  }

  uploadResource(input: { bytes: number[]; filename: string }, noteId: string): ResourceUploadOutput {
    const bytes = Buffer.from(input.bytes);
    return imageOutput(bytes, input.filename, this.noteAssetsDirFor(noteId), this.assetUrl.bind(this, noteId));
  }

  async downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput> {
    // 先校验 noteId 再做网络请求
    const assetsDir = this.noteAssetsDirFor(noteId);
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AppError("InvalidInput", "图片地址仅支持 HTTP 或 HTTPS");
    }
    // SSRF 防护（移植 Rust 版 validate_remote_image_url）：拒绝本机与私网地址
    if (isBlockedHost(parsed.hostname)) {
      throw new AppError("InvalidInput", "不允许下载本机或私网地址");
    }
    // 下载头（移植 Rust 版）：Referer 设为图片 URL 自身 + 浏览器 UA，绕过常见防盗链
    // 403/网络错误带重试，应对图床 CDN 的波动性拒绝
    let res: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        // 用 Electron net.fetch（Chromium 网络栈）：与 Chrome 相同的 TLS 指纹，
        // 可绕过知乎等 CDN 的 TLS 指纹检测（参照思源 createCustomTLSConfig 的思路）
        res = await electronNet.fetch(normalized, {
          headers: {
            "User-Agent": DOWNLOAD_USER_AGENT,
            "Referer": normalized,
          },
          redirect: "follow",
          signal: controller.signal,
        });
        if (res.ok) break;
        lastError = new AppError("Internal", `下载失败: ${res.status}`);
        await res.body?.cancel().catch(() => undefined);
      } catch (error) {
        lastError = error instanceof Error && error.name === "AbortError"
          ? new AppError("Internal", `下载超时（${DOWNLOAD_TIMEOUT_MS / 1000}s）`)
          : new AppError("Internal", `网络错误: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
      if (attempt < DOWNLOAD_MAX_ATTEMPTS) await sleep(attempt * 500);
    }
    if (!res || !res.ok) {
      throw lastError instanceof AppError ? lastError : new AppError("Internal", `下载失败: ${String(lastError)}`);
    }
    // content-length 预检查 + 流式读取限量（防大响应撑爆内存）
    const declaredLength = res.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > MAX_IMAGE_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw new AppError("InvalidInput", "图片超过 25 MiB");
    }
    const reader = res.body?.getReader();
    if (!reader) throw new AppError("Internal", "响应无内容");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AppError("InvalidInput", "图片超过 25 MiB");
      }
      chunks.push(Buffer.from(value));
    }
    const buf = Buffer.concat(chunks);
    return imageOutput(buf, path.basename(parsed.pathname) || "image", assetsDir, this.assetUrl.bind(this, noteId));
  }
}

/** SSRF 防护：判断 host 是否为本机/私网地址（移植 Rust 版 validate_remote_image_url） */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const ipVersion = net.isIP(h);
  if (ipVersion === 4) return isBlockedIPv4(h);
  if (ipVersion === 6) return isBlockedIPv6(h);
  return false; // 域名不做解析（避免异步 DNS 与误伤），仅拦截直接 IP
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;                       // 0/8 未指定、10/8、127/8 回环
  if (a === 169 && b === 254) return true;                                 // 169.254/16 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true;                        // 172.16/12 私网
  if (a === 192 && b === 168) return true;                                 // 192.168/16 私网
  if (a >= 224) return true;                                               // 组播/保留
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return true;                              // 未指定/回环
  if (h.startsWith("fc") || h.startsWith("fd")) return true;               // fc00::/7 唯一本地
  if (/^fe[89ab]/.test(h)) return true;                                    // fe80::/10 链路本地
  return false;
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
