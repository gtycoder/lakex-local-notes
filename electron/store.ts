import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_NOTEBOOK_ID = "notebook-personal";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

export class Store {
  private db: Database.Database;
  private root: string;

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
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
      const note = this.createNote("欢迎来到 Lake Notes");
      this.saveNote(note.id, note.title,
        `<h1 id="welcome" class="ne-h1">欢迎来到 Lake Notes</h1><p id="welcome-body" class="ne-p">这是一个基于 Lake 编辑器的本地优先笔记应用（Electron 桌面端）。</p>`);
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
    const now = nowIso();
    const ids = this.descendantIds(id);
    const tx = this.db.transaction(() => {
      const stmt = this.db.prepare("UPDATE tree_nodes SET deleted_at=?,sync_state='local' WHERE id=?");
      const noteStmt = this.db.prepare("UPDATE notes SET deleted_at=?,sync_state='local' WHERE id=?");
      for (const nid of ids) {
        stmt.run(now, nid);
        const node = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?").get(nid) as { note_file_id: string | null } | undefined;
        if (node?.note_file_id) noteStmt.run(now, node.note_file_id);
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

  uploadResource(input: { bytes: number[]; filename: string }): ResourceUploadOutput {
    const bytes = Buffer.from(input.bytes);
    return imageOutput(bytes, input.filename);
  }

  async downloadRemoteResource(url: string): Promise<ResourceUploadOutput> {
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AppError("InvalidInput", "图片地址仅支持 HTTP 或 HTTPS");
    }
    const res = await fetch(normalized, { headers: { "User-Agent": "LakeNotes/1.0" } });
    if (!res.ok) throw new AppError("Internal", `下载失败: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return imageOutput(buf, path.basename(parsed.pathname) || "image");
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

function imageOutput(bytes: Buffer, requestedFilename: string): ResourceUploadOutput {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new AppError("InvalidInput", "图片为空或超过 25 MiB");
  }
  const format = sniffImageFormat(bytes);
  if (!format) throw new AppError("InvalidInput", "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
  const stem = path.parse(requestedFilename).name || "image";
  const filename = `${stem}.${format.extension}`;
  const url = `data:${format.mimeType};base64,${bytes.toString("base64")}`;
  return { resourceRef: url, url, filename, mimeType: format.mimeType, size: bytes.length };
}
