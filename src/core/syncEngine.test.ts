import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { syncNow, type S3Store, type SyncDbPort, type LocalNoteRow } from "./syncEngine.js";
import { sha256Sync } from "./sha256Sync.js";
import { isGzip } from "./syncUtils.js";
import { TRASH_NOTEBOOK_ID } from "./syncDecisions.js";

const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

/** 内存 S3Store：模拟端口职责——getObject 返回**已解压**字节（gzip 魔数识别），putObject 按 opts.gzip 压缩。 */
class MemS3 implements S3Store {
  map = new Map<string, Uint8Array>();
  async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
    const b = this.map.get(key);
    if (!b) return null;
    const bytes = isGzip(b) ? gunzipSync(b) : b;
    if (opts?.maxBytes != null && bytes.length > opts.maxBytes) {
      throw new Error(`对象过大（${bytes.length} 字节 > ${opts.maxBytes}）`);
    }
    return bytes;
  }
  async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    let bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    if (opts?.gzip) bytes = gzipSync(bytes);
    this.map.set(key, bytes);
  }
}

class MemDb implements SyncDbPort {
  notes = new Map<string, LocalNoteRow>();
  bases = new Map<string, { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null }>();
  logs: string[] = [];
  log(msg: string): void { this.logs.push(msg); }
  getNote(id: string) { return this.notes.get(id) ?? null; }
  getAllNotes() { return [...this.notes.values()]; }
  getSyncBase(id: string) { return this.bases.get(id) ?? null; }
  applyRemoteNote(note: any, content: string) {
    this.notes.set(note.id, {
      id: note.id, title: note.title, content, updatedAt: note.updatedAt, syncState: "synced",
      trashedAt: note.trashedAt ?? null, restorePendingAt: null, parentId: note.parentId ?? null, sortOrder: note.sortOrder ?? 0,
      isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, isConflict: !!note.isConflict,
    });
  }
  applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, _dfp: string | null, _pid: string | null, _so: number) {
    this.notes.set(id, { id, title, content, updatedAt: trashedAt, syncState: "synced", trashedAt, restorePendingAt: null, parentId: null, sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false });
  }
  localTrashNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = new Date().toISOString(); n.syncState = "local"; } }
  localRestoreNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = null; n.restorePendingAt = new Date().toISOString(); n.syncState = "local"; } }
  deletedNotes = new Set<string>();
  applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) { n.syncState = "purged"; n.parentId = TRASH_NOTEBOOK_ID; n.trashedAt = new Date().toISOString(); } }
  rememberDeleted(note: any, deletedAt: string) { this.deletedNotes.add(note.id); this.deletedAtMap.set(note.id, deletedAt); }
  deletedAtMap = new Map<string, string>();
  publishedTombstones: string[] = [];
  listDeletedNotesForSync() { return [...this.deletedAtMap.entries()].map(([id, deletedAt]) => ({ id, deletedAt })); }
  markTombstonesPublished(ids: string[]) { this.publishedTombstones.push(...ids); }
  revokeLocalDeletion(id: string) { this.deletedNotes.delete(id); this.deletedAtMap.delete(id); }
  markFolderSynced() { return true; }
  applyRemoteNoteMeta(note: any) {
    const n = this.notes.get(note.id);
    if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = !!note.isConflict; n.icon = note.icon ?? null; n.isLocked = !!note.isLocked; n.lockedAt = note.lockedAt ?? null; }
  }
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null) { const n = this.notes.get(id); if (n) { n.isLocked = locked; n.lockedAt = lockedAt; } }
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null) {
    const n = this.notes.get(id); if (n) n.syncState = "synced";
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string) {
    const n = this.notes.get(id); if (!n) return;
    const current = sha256Sync(new TextEncoder().encode(n.content));
    if (current !== expectedContentHash) return; // B2：同步中编辑 → 不标
    n.syncState = "synced";
    this.bases.set(id, { contentHash: expectedContentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null) {
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  folders = new Map<string, any>();
  purgedFolders = new Set<string>();
  defaultNotebookId() { return "notebook-personal"; }
  importRemoteFolder(folder: any) { this.folders.set(folder.id, folder); }
  isFolderPurged(id: string): boolean { return this.purgedFolders.has(id); }
  listFoldersForSync() {
    return [...this.folders.values()].map((f) => ({
      id: f.id, title: f.title, parentId: f.parentId ?? null, sortOrder: f.sortOrder ?? 0,
      nodeType: f.nodeType ?? "group", icon: f.icon ?? null, updatedAt: f.updatedAt ?? "2026-01-01T00:00:00.000Z",
    }));
  }
  history: Array<{ noteId: string; content: string; meta: any }> = [];
  createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number }) {
    this.history.push({ noteId, content, meta });
  }
  assets = new Map<string, Uint8Array>();
  async saveAsset(noteId: string, filename: string, bytes: Uint8Array) { this.assets.set(noteId + "/" + filename, bytes); }
  async listLocalAssets(noteId: string) {
    const out: Array<{ filename: string; size: number; hash: string }> = [];
    const prefix = noteId + "/";
    for (const [key, bytes] of this.assets) {
      if (!key.startsWith(prefix)) continue;
      out.push({ filename: key.slice(prefix.length), size: bytes.length, hash: sha256Sync(bytes) });
    }
    return out;
  }
  async readLocalAsset(noteId: string, filename: string) {
    return this.assets.get(noteId + "/" + filename) ?? null;
  }
  lastSeenCommitId: string | null = null;
  lastTombstoneSig = "";
  getLastSeenCommitId() { return this.lastSeenCommitId; }
  setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
  getLastTombstoneSig() { return this.lastTombstoneSig; }
  setLastTombstoneSig(sig: string) { this.lastTombstoneSig = sig; }
  tombstoneSignature() { return `${this.deletedNotes.size}:${[...this.deletedNotes].sort().at(-1) ?? ""}`; }
  hasLocalPendingNotes() { return [...this.notes.values()].some((n) => n.syncState !== "synced"); }
}

const CFG = { endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "p" };
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));
const row = (over: Partial<LocalNoteRow> & { id: string }): LocalNoteRow => ({
  id: over.id, title: over.title ?? "笔记", content: over.content ?? "<p>hi</p>", updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z", syncState: over.syncState ?? "local",
  trashedAt: over.trashedAt ?? null, restorePendingAt: over.restorePendingAt ?? null, parentId: over.parentId ?? null, sortOrder: over.sortOrder ?? 0,
  isLocked: over.isLocked ?? false, lockedAt: over.lockedAt ?? null, icon: over.icon ?? null, isConflict: over.isConflict ?? false,
});

describe("syncEngine（共享编排）", () => {
  it("首次同步：上传本地笔记 + 写 gzip manifest（D1/D2）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1" }));
    const r = await syncNow(CFG, s3, db);
    expect(r.uploaded).toBe(1);
    expect(r.published).toBe(true);
    const objBytes = await s3.getObject("p/objects/n1-" + hashOf("<p>hi</p>") + ".lake");
    expect(objBytes).not.toBeNull();
    expect(decode(objBytes!)).toBe("<p>hi</p>");
    const manifestBytes = await s3.getObject("p/manifests/latest.json");
    expect(manifestBytes).not.toBeNull();
    const manifest = JSON.parse(decode(manifestBytes!));
    expect(manifest.version).toBe(4);
    expect(manifest.notes[0].id).toBe("n1");
    expect(db.notes.get("n1")!.syncState).toBe("synced");
  });

  it("二次同步：无变更不重传（skip-fast）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1" }));
    await syncNow(CFG, s3, db);
    const keysBefore = s3.map.size;
    const r2 = await syncNow(CFG, s3, db);
    expect(r2.uploaded).toBe(0);
    expect(s3.map.size).toBe(keysBefore);
  });

  it("下载：远端新笔记拉到本地（D9 字段透传）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>remote</p>");
    s3.map.set("p/objects/n2-" + h + ".lake", new TextEncoder().encode("<p>remote</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n2", title: "远端", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], isLocked: true, lockedAt: "2026-01-02T00:00:00.000Z", icon: "star" }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);
    expect(db.notes.get("n2")!.content).toBe("<p>remote</p>");
    expect(db.notes.get("n2")!.isLocked).toBe(true);
    expect(db.notes.get("n2")!.lockedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(db.notes.get("n2")!.icon).toBe("star");
  });

  it("D2：远端 manifest 是非法 JSON → 整轮中止报错，不覆盖本地", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode("not-json"));
    const r = await syncNow(CFG, s3, db);
    expect(r.pulled).toBe(false);
    expect(r.message).toContain("拉取 manifest 失败");
    expect(r.published).toBe(false);
  });

  it("B1：本地软删（回收站）上传条目用 buildUploadEntry——parentId=TRASH + trashedAt，无 deleted:true", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1", trashedAt: "2026-01-01T00:00:00.000Z", syncState: "local", isLocked: true, icon: "star" }));
    const r = await syncNow(CFG, s3, db);
    expect(r.uploaded).toBe(1);
    const manifestBytes = await s3.getObject("p/manifests/latest.json");
    const manifest = JSON.parse(decode(manifestBytes!));
    const n = manifest.notes[0];
    // B1：软删绝不是 deleted:true（否则桌面当永久删除）
    expect(n.deleted).toBeUndefined();
    expect(n.trashedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(n.parentId).toBe(TRASH_NOTEBOOK_ID);
    expect(n.isLocked).toBe(true);
    expect(n.icon).toBe("star");
  });

  it("B4（回归）：收到他端 purge 的设备发布时保留 deleted:true 墓碑（不吞掉，防离线端复活）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>内容</p>");
    // 本地有副本（applyRemotePurge → 标 purged 保留）
    db.notes.set("n1", row({ id: "n1", content: "<p>内容</p>", syncState: "purged" }));
    // 远端 manifest：n1 deleted:true（他端 purge 墓碑）
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "被删", parentId: null, sortOrder: 0, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.published).toBe(true);
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    const entry = manifest.notes.find((n: any) => n.id === "n1");
    // 墓碑必须保留（此前 B4 filter 把 purged 条目从 manifest 移除 → 离线端可复活）
    expect(entry).toBeDefined();
    expect(entry.deleted).toBe(true);
  });

  it("B4：远端 purge（deleted:true）——本地有副本→标 purged 不上传；无副本→记住删除", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1" }));
    const h = hashOf("<p>x</p>");
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [
        { id: "n1", title: "x", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" },
        { id: "n2", title: "y", parentId: null, sortOrder: 1, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" },
      ],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1); // 仅 n1（有本地副本）→ apply-purge；n2（无）→ remember
    expect(db.notes.get("n1")!.syncState).toBe("purged");
    expect(db.notes.has("n2")).toBe(false);
    expect(db.deletedNotes.has("n2")).toBe(true);
    expect(r.uploaded).toBe(0); // purged 不上传
  });

  it("B3：正文相同但远端元数据较新 → 应用远端标题/图标/锁（meta LWW，不重复下载正文）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>same</p>");
    db.notes.set("n1", row({ id: "n1", content: "<p>same</p>", title: "本地旧标题", syncState: "synced" }));
    db.bases.set("n1", { contentHash: h, lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "远端新标题", parentId: null, sortOrder: 0, updatedAt: "2026-01-03T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], isLocked: true, lockedAt: "2026-01-03T00:00:00.000Z", icon: "star" }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(0); // 幂等：正文相同不下载
    expect(db.notes.get("n1")!.title).toBe("远端新标题"); // B3 元数据 LWW
    expect(db.notes.get("n1")!.icon).toBe("star");
    expect(db.notes.get("n1")!.isLocked).toBe(true);
  });

  it("B2：markSyncedIfUnchanged 快照保护——同步中内容变化则不误标 synced", async () => {
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1", content: "<p>v1</p>", syncState: "local" }));
    // 期望 hash 与当前内容不符（模拟同步期间被编辑）→ 不标
    db.markSyncedIfUnchanged("n1", hashOf("<p>v2</p>"), "2026-01-01T00:00:00.000Z", hashOf("<p>v2</p>"));
    expect(db.notes.get("n1")!.syncState).toBe("local");
    // 期望 hash 与当前内容一致 → 标 synced
    db.markSyncedIfUnchanged("n1", hashOf("<p>v1</p>"), "2026-01-01T00:00:00.000Z", hashOf("<p>v1</p>"));
    expect(db.notes.get("n1")!.syncState).toBe("synced");
  });

  it("D4：导入远端 folders + effectiveParent——父目录有效则保留，无效/缺失回退默认笔记本", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h1 = hashOf("<p>a</p>"), h2 = hashOf("<p>b</p>"), h3 = hashOf("<p>c</p>");
    s3.map.set("p/objects/n1-" + h1 + ".lake", new TextEncoder().encode("<p>a</p>"));
    s3.map.set("p/objects/n2-" + h2 + ".lake", new TextEncoder().encode("<p>b</p>"));
    s3.map.set("p/objects/n3-" + h3 + ".lake", new TextEncoder().encode("<p>c</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [
        // n1 挂在存在的 folder-f1 → 保留父目录
        { id: "n1", title: "A", parentId: "folder-f1", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h1, isConflict: false, assets: [] },
        // n2 挂在未知的 folder-missing → 回退默认笔记本
        { id: "n2", title: "B", parentId: "folder-missing", sortOrder: 1, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h2, isConflict: false, assets: [] },
        // n3 无父 → 回退默认笔记本
        { id: "n3", title: "C", parentId: null, sortOrder: 2, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h3, isConflict: false, assets: [] },
      ],
      folders: [{ id: "folder-f1", title: "分组1", parentId: null, sortOrder: 0, nodeType: "group", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(3);
    expect(db.folders.has("folder-f1")).toBe(true);            // D4 导入远端 folder
    expect(db.notes.get("n1")!.parentId).toBe("folder-f1");    // 有效父目录保留
    expect(db.notes.get("n2")!.parentId).toBe("notebook-personal"); // 无效父目录回退默认
    expect(db.notes.get("n3")!.parentId).toBe("notebook-personal"); // 无父回退默认
  });

  it("D4b：无默认笔记本（系统里没有默认概念）——effectiveParent 回退到 defaultNotebookId 返回值（自动建的'未分类'）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 模拟本地无任何笔记本：defaultNotebookId 返回自动创建的普通笔记本"未分类"（随机 ID，非固定 notebook-personal）
    db.defaultNotebookId = () => "notebook-uncategorized";
    const h1 = hashOf("<p>a</p>");
    s3.map.set("p/objects/n1-" + h1 + ".lake", new TextEncoder().encode("<p>a</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [
        { id: "n1", title: "A", parentId: "folder-missing", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h1, isConflict: false, assets: [] },
      ],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);
    // 父缺失 → 回退到兜底父笔记本（defaultNotebookId 返回值），而不是任何固定 ID
    expect(db.notes.get("n1")!.parentId).toBe("notebook-uncategorized");
  });

  it("B5（回归）：本地已 purge 的 folder 不随下载复活，且强制发布重写 manifest 移除云端残留", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 场景：笔记本 nb-1 曾同步到云端，本地已删除并清空回收站（purge）→ deleted_notes 带 purged_at
    db.purgedFolders.add("nb-1");
    // 远端 manifest.folders 仍含 nb-1（purge 前的残留）
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [],
      folders: [{ id: "nb-1", title: "笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }],
    })));
    expect(db.isFolderPurged("nb-1")).toBe(true); // 前置：purged 标记已设
    const r = await syncNow(CFG, s3, db);
    // 1) 下载不复活：nb-1 不被导入本地 folders
    // eslint-disable-next-line no-console
    console.log("LOGS:", JSON.stringify(db.logs), "FOLDERS:", JSON.stringify([...db.folders.keys()]));
    expect(db.logs.some((l) => l.includes("locally purged, skip import"))).toBe(true); // 过滤日志
    expect(db.folders.has("nb-1")).toBe(false);
    // 2) 发布重写：manifest.folders 移除 nb-1（云端残留清理，下轮不再尝试导入）
    const manifestBytes = await s3.getObject("p/manifests/latest.json");
    const next = JSON.parse(new TextDecoder().decode(manifestBytes!)) as { folders: Array<{ id: string }> };
    expect(next.folders.some((f) => f.id === "nb-1")).toBe(false);
    expect(r.published).toBe(true);
  });

  it("D5：本机编辑成果被远端覆盖 → 先留档再接受远端（协议 §4.2）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const H0 = hashOf("<p>base</p>"), H1 = hashOf("<p>local</p>"), H2 = hashOf("<p>remote</p>");
    // 本地 n1：相对基线已编辑（localChanged），sync_state=local
    db.notes.set("n1", row({ id: "n1", content: "<p>local</p>", title: "本地标题", syncState: "local" }));
    db.bases.set("n1", { contentHash: H0, lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    // 远端 n1：更新版（remoteChanged），首对象存在
    s3.map.set("p/objects/n1-" + H2 + ".lake", new TextEncoder().encode("<p>remote</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "远端标题", parentId: null, sortOrder: 0, updatedAt: "2026-01-03T00:00:00.000Z", contentHash: H2, isConflict: false, assets: [] }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);
    expect(db.history.length).toBe(1);                       // D5 覆盖前留档
    expect(db.history[0].noteId).toBe("n1");
    expect(db.history[0].content).toBe("<p>local</p>");      // 留存的是被覆盖的本地版本
    expect(db.notes.get("n1")!.content).toBe("<p>remote</p>"); // 已接受远端
  });

  it("D8：应用远端笔记时下载关联资产并校验（size/sha256）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>n</p>");
    const imgHash = sha256Sync(new TextEncoder().encode("imgbytes"));
    s3.map.set("p/objects/n9-" + h + ".lake", new TextEncoder().encode("<p>n</p>"));
    s3.map.set("p/assets/n9/photo.png", new TextEncoder().encode("imgbytes"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n9", title: "N", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [{ filename: "photo.png", size: 8, hash: imgHash }] }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);
    expect(db.assets.has("n9/photo.png")).toBe(true);          // D8 资产已落盘
    expect(new TextDecoder().decode(db.assets.get("n9/photo.png")!)).toBe("imgbytes");
    expect(r.warnings.length).toBe(0);                        // 校验通过无警告
  });
  it("零变更早退：无变化二次同步整轮跳过（记账基线生效）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1" }));
    await syncNow(CFG, s3, db);
    // 首次同步已记账 lastSeenCommitId + tombstone sig
    expect(db.lastSeenCommitId).not.toBeNull();
    const keysAfterFirst = s3.map.size;
    const r2 = await syncNow(CFG, s3, db);
    // 早退：不重写 manifest、不上传对象（连 s3 对象数都不变）
    expect(r2.uploaded).toBe(0);
    expect(r2.published).toBe(false);
    expect(s3.map.size).toBe(keysAfterFirst);
    expect(db.logs.some((l) => l.includes("zero-change sync skipped"))).toBe(true);
  });

  it("结构环检测：本地移动与远端已提交移动互成父子 → 强制跟随远端打破环（先提交先确认）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>same</p>");
    // 本地：888 在 999 下、999 在根（B 的移动），正文与远端一致（移动不改正文）
    db.notes.set("n888", row({ id: "n888", content: "<p>same</p>", parentId: "n999", syncState: "synced" }));
    db.notes.set("n999", row({ id: "n999", content: "<p>same</p>", parentId: null, syncState: "synced" }));
    // 远端：999 已提交在 888 下（A 先提交）→ 本地保留 888→999 会成环
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [
        { id: "n888", title: "888", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] },
        { id: "n999", title: "999", parentId: "n888", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] },
      ],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    // 环冲突 → 应用远端 meta：888 不再挂本地移动的 999 下（对齐桌面：null 父回退默认笔记本），
    // 999 仍挂 888 下（远端已提交的移动保留）——本地 888→999 移动被强制覆盖打破环。
    expect(db.notes.get("n888")!.parentId).not.toBe("n999");
    expect(db.notes.get("n999")!.parentId).toBe("n888");
    expect(r.appliedRemote).toBe(0); // 幂等：正文相同不下载
  });


  it("H5：远端墓碑压本地编辑（trash-cross）→ 先留档 + superseded；纯跟随删除不留档", async () => {
    const mk = (localContent: string, localBaseHash: string | null, lastUploaded: string | null) => {
      const s3 = new MemS3();
      const db = new MemDb();
      db.notes.set("n1", row({ id: "n1", content: localContent, title: "本地", syncState: localBaseHash ? "synced" : "local" }));
      if (localBaseHash) db.bases.set("n1", { contentHash: localBaseHash, lastUploadedHash: lastUploaded, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
      // 远端墓碑：n1 deleted（远端删除方最新版内容）
      const H = hashOf("<p>remote-final</p>");
      s3.map.set("p/objects/n1-" + H + ".lake", new TextEncoder().encode("<p>remote-final</p>"));
      s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
        version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
        notes: [{ id: "n1", title: "远端", parentId: null, sortOrder: 0, updatedAt: "2026-01-03T00:00:00.000Z", contentHash: H, isConflict: false, assets: [], trashedAt: "2026-01-03T00:00:00.000Z", deletedFromParentId: null }],
        folders: [],
      })));
      return { s3, db };
    };
    // 场景 A：本地编辑（hash 与基线不同）→ 留档 + superseded
    {
      const { s3, db } = mk("<p>local-edit</p>", hashOf("<p>base</p>"), null);
      const r = await syncNow(CFG, s3, db);
      expect(db.history.length).toBe(1);
      expect(db.history[0].noteId).toBe("n1");
      expect(db.history[0].content).toBe("<p>local-edit</p>");
      expect(r.supersededNotes).toEqual([{ id: "n1", title: "远端" }]); // 标题取远端（对齐桌面 pushSuperseded(rn.title)）
      expect(db.notes.get("n1")!.trashedAt).not.toBeNull(); // 跟随删除（移入回收站）
    }
    // 场景 B：本机上传过当前版本（本机是作者）→ 留档
    {
      const { s3, db } = mk("<p>v2</p>", hashOf("<p>v2</p>"), hashOf("<p>v2</p>"));
      const r = await syncNow(CFG, s3, db);
      expect(db.history.length).toBe(1);
      expect(r.supersededNotes).toEqual([{ id: "n1", title: "远端" }]);
    }
    // 场景 C：纯跟随（本地从未编辑/上传，与基线一致）→ 不留档不报
    {
      const { s3, db } = mk("<p>base</p>", hashOf("<p>base</p>"), null);
      const r = await syncNow(CFG, s3, db);
      expect(db.history.length).toBe(0);
      expect(r.supersededNotes).toEqual([]);
    }
  });


  it("M6：发布时 notes 按 sortOrder 排序 + folders 从本地发布", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1", sortOrder: 10 }));
    db.notes.set("n2", row({ id: "n2", sortOrder: 0 }));
    db.importRemoteFolder({ id: "folder-a", title: "分组A", parentId: null, sortOrder: 0, nodeType: "group", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const r = await syncNow(CFG, s3, db);
    expect(r.uploaded).toBe(2);
    const manifestBytes = await s3.getObject("p/manifests/latest.json");
    const manifest = JSON.parse(decode(manifestBytes!));
    // notes 按 sortOrder 升序
    expect(manifest.notes.map((n: any) => n.id)).toEqual(["n2", "n1"]);
    // folders 从本地发布（不是远端透传空）
    expect(manifest.folders).toHaveLength(1);
    expect(manifest.folders[0]).toMatchObject({ id: "folder-a", title: "分组A", nodeType: "group" });
  });


  it("墓碑撤销：本地 deleted_notes 墓碑 + 远端恢复（updatedAt 新）→ revoke + 跟随恢复", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>restored</p>");
    // 本地删除墓碑（本设备从未持有或已彻底删除）
    db.deletedNotes.add("n1");
    db.deletedAtMap.set("n1", "2026-01-01T00:00:00.000Z");
    // 远端 n1 active 且更新（恢复）
    s3.map.set("p/objects/n1-" + h + ".lake", new TextEncoder().encode("<p>restored</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "恢复", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-05T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] }],
      folders: [],
    })));
    const r1 = await syncNow(CFG, s3, db);
    // 墓碑被撤销 + 笔记恢复
    expect(db.deletedNotes.has("n1")).toBe(false);
    expect(db.notes.get("n1")!.content).toBe("<p>restored</p>");
    expect(r1.appliedRemote).toBe(1);
  });

  it("墓碑保留：本地删除较新 + 远端恢复较旧 → keep-local-delete（不上传覆盖）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>old</p>");
    db.deletedNotes.add("n1");
    db.deletedAtMap.set("n1", "2026-01-05T00:00:00.000Z"); // 本地删除较新
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "旧", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] }],
      folders: [],
    })));
    await syncNow(CFG, s3, db);
    expect(db.deletedNotes.has("n1")).toBe(true); // 墓碑保留
    expect(db.notes.has("n1")).toBe(false);       // 未下载
  });

  it("墓碑上传携带删除前内容：manifest contentHash=真实 hash + S3 内容对象可下载（迁移回归修复）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.deletedNotes.add("dead1");
    db.deletedAtMap.set("dead1", "2026-01-01T00:00:00.000Z");
    (db as any).readDeletedContent = async () => "<p>删除前内容</p>";
    const r = await syncNow(CFG, s3, db);
    const H = hashOf("<p>删除前内容</p>");
    const manifestBytes = await s3.getObject("p/manifests/latest.json");
    const manifest = JSON.parse(decode(manifestBytes!));
    const tomb = manifest.notes.find((n: any) => n.id === "dead1");
    expect(tomb).toBeDefined();
    expect(tomb.contentHash).toBe(H);                          // 非 sha256("") 占位
    expect(s3.map.has("p/objects/dead1-" + H + ".lake")).toBe(true); // 删除前内容对象已上传
    expect(decode(s3.map.get("p/objects/dead1-" + H + ".lake")!)).toBe("<p>删除前内容</p>");
    expect(r.uploaded).toBe(1);
  });

  it("墓碑占位符发布（迁移回归修复）：purge 后内容缺失（readDeletedContent→null）→ 占位符 id 照常发布 deleted:true，不传空对象，且标记已发布", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.deletedNotes.add("dead2");
    db.deletedAtMap.set("dead2", "2026-01-02T00:00:00.000Z");
    (db as any).readDeletedContent = async () => null; // 内容已物理删除
    const r = await syncNow(CFG, s3, db);
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    const tomb = manifest.notes.find((n: any) => n.id === "dead2");
    expect(tomb).toBeDefined();
    expect(tomb.deleted).toBe(true);
    expect(tomb.contentHash).toBe("dead2");                     // 占位符 id，非 sha256("")
    expect([...s3.map.keys()].some((k) => k.includes("dead2-"))).toBe(false); // 未上传空对象
    expect(r.uploaded).toBe(0);                                 // 占位符不计入上传
    expect(r.published).toBe(true);
    expect(db.publishedTombstones).toContain("dead2");          // 已标记发布
  });

  it("folder 墓碑不进 manifest.notes（nodeType=folder 仅本地下载过滤，发布方向跳过，不触发发布）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.deletedNotes.add("folder1");
    db.deletedAtMap.set("folder1", "2026-01-02T00:00:00.000Z");
    (db as any).listDeletedNotesForSync = () => [{ id: "folder1", deletedAt: "2026-01-02T00:00:00.000Z", nodeType: "folder" }];
    const r = await syncNow(CFG, s3, db);
    expect(r.published).toBe(false);          // 无任何上传/目录变更 → 不发布
    expect(await s3.getObject("p/manifests/latest.json")).toBeNull();
    expect(db.publishedTombstones).not.toContain("folder1");
  });

  it("H3：上传时本地资产进 manifest.assets（扫描→上传 S3→填入条目）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1" }));
    // 本地资产：photo.png（字节 imgbytes）
    const imgBytes = new TextEncoder().encode("imgbytes");
    await db.saveAsset("n1", "photo.png", imgBytes);
    const r = await syncNow(CFG, s3, db);
    expect(r.uploaded).toBe(1);
    // 资产已上传到 S3（内容寻址 assets/{noteId}/{filename}）
    const assetObj = await s3.getObject("p/assets/n1/photo.png");
    expect(assetObj).not.toBeNull();
    expect(decode(assetObj!)).toBe("imgbytes");
    // manifest.assets 含该资产（filename/size/hash）
    const manifestBytes = await s3.getObject("p/manifests/latest.json");
    const manifest = JSON.parse(decode(manifestBytes!));
    const n = manifest.notes.find((x: any) => x.id === "n1");
    expect(n.assets).toHaveLength(1);
    expect(n.assets[0]).toMatchObject({ filename: "photo.png", size: imgBytes.length });
    expect(n.assets[0].hash).toBe(sha256Sync(imgBytes));
  });
});