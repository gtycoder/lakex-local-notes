import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { net, safeStorage } from "electron";
import { ASSET_PORT } from "./assetServer.js";
import { assertSafeRemoteHost, SsrfError } from "./ssrf.js";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_NOTEBOOK_ID = "notebook-personal";
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

  /** 审计 #9：树结构不变量——notebook 只能位于根层；note 不能有子节点；
   * 只有 notebook/group 能作为 note/group 的父节点。 */
  private assertParentCompatible(parentId: string | null, childType: string): void {
    if (parentId === null) {
      if (childType !== "notebook") throw new AppError("InvalidInput", "note/group 必须位于目录节点下");
      return;
    }
    if (childType === "notebook") throw new AppError("InvalidInput", "笔记本只能位于根层");
    const parent = this.db.prepare("SELECT node_type FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(parentId) as { node_type: string } | undefined;
    if (!parent) throw new AppError("NotFound", `父节点不存在: ${parentId}`);
    if (parent.node_type === "note") throw new AppError("InvalidInput", "笔记不能作为父节点");
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
    this.assertParentCompatible(parent, "note");
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
    // 审计 #22：孤儿检测是后置维护任务，失败不应让已成功保存的笔记显示"保存失败"
    try {
      this.detectOrphans(id, content);
    } catch (error) {
      console.warn("[store] 孤儿资源检测失败（不影响保存）:", error);
    }
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
    // 笔记同时删除 .lake 文件、整个 note-assets/{noteId}/ 目录与孤儿记录。
    // 审计 #10：DB 事务先提交、文件后删——DB 失败可安全回滚（无引用失效）；
    // 文件删除失败只留孤儿文件（孤儿清理可回收），绝不"DB 引用已删文件"或不可恢复丢失
    const now = nowIso();
    const ids = this.descendantIds(id);
    const filesToRemove: Array<{ path: string; recursive: boolean }> = [];
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
          filesToRemove.push({ path: this.notePath(node.note_file_id), recursive: false });
          filesToRemove.push({ path: path.join(this.noteAssetsDir, node.note_file_id), recursive: true });
          delOrphans.run(node.note_file_id);
          delNote.run(node.note_file_id);
        }
        delNode.run(nid);
      }
    });
    tx();
    for (const f of filesToRemove) {
      try {
        fs.rmSync(f.path, { force: true, recursive: f.recursive });
      } catch (error) {
        console.warn("[store] 删除笔记后清理文件失败，文件可能残留:", f.path, error);
      }
    }
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
    this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL")
      .run(parentId, sortOrder, now, id);
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
      orderedIds.forEach((id, index) => stmt.run(index, now, id));
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

  markSynced(id: string): void {
    this.db.prepare("UPDATE notes SET sync_state='synced' WHERE id=?").run(id);
  }

  markSyncComplete(at: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(at);
  }

  recordSyncResult(json: string): void {
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_sync_result',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json);
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

  listNotesForSync(): SyncNote[] {
    return this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,is_conflict FROM notes WHERE deleted_at IS NULL ORDER BY sort_order"
    ).all().map((r: any) => ({
      id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order,
      updatedAt: r.updated_at, isConflict: !!r.is_conflict,
    }));
  }

  /** 记录"从云端学到的删除"（本设备从未持有该笔记）：与本地删除同语义，
   * 防止 manifest 的 deleted 标记因设备清空/换机而丢失（审计 #2）。 */
  rememberDeleted(note: SyncNote, deletedAt: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at) VALUES(?,?,?,?,?,?)"
    ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, deletedAt);
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
  importRemoteNote(note: SyncNote, content: Buffer, assets: Array<{ filename: string; bytes: Buffer }>): void {
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
  }

  uploadResource(input: { bytes: number[]; filename: string }, noteId: string): ResourceUploadOutput {
    const bytes = Buffer.from(input.bytes);
    return imageOutput(bytes, input.filename, this.noteAssetsDirFor(noteId), this.assetUrl.bind(this, noteId));
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
          return imageOutput(buf, path.basename(new URL(normalized).pathname) || "image", assetsDir, this.assetUrl.bind(this, noteId));
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

/** 安全单路径段校验：拒绝空、./..，以及含 / 或 \\ 的字符串（防目录穿越，审计 #3/#17） */
function isSafePathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}
