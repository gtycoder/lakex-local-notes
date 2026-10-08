import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { downloadNoteAssets, syncNow, type S3Store, type SyncDbPort, type LocalNoteRow, type SyncReport } from "./syncEngine.js";
import { sha256Sync } from "./sha256Sync.js";
import { isGzip } from "./syncUtils.js";
import { TRASH_NOTEBOOK_ID } from "./syncDecisions.js";

const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

/** 内存 S3Store：模拟端口职责——getObject 返回**已解压**字节（gzip 魔数识别），putObject 按 opts.gzip 压缩。 */
class MemS3 implements S3Store {
  map = new Map<string, Uint8Array>();
  getLog: string[] = [];
  async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
    this.getLog.push(key);
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
  async log(msg: string): Promise<void> { this.logs.push(msg); }
async getNote(id: string) { return this.notes.get(id) ?? null; }
async getAllNotes() { return [...this.notes.values()]; }
syncBaseCalls = 0;
async getSyncBase(id: string) { this.syncBaseCalls += 1; return this.bases.get(id) ?? null; }
async getAllSyncBases() { return new Map(this.bases); }
async applyRemoteNote(note: any, content: string) {
    this.notes.set(note.id, {
      id: note.id, title: note.title, content, contentHash: note.contentHash, updatedAt: note.updatedAt, syncState: "synced",
      trashedAt: note.trashedAt ?? null, restorePendingAt: null, parentId: note.parentId ?? null, sortOrder: note.sortOrder ?? 0,
      isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, isConflict: !!note.isConflict,
      deletedFromParentId: note.deletedFromParentId ?? null,
    });
  }
async applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, _dfp: string | null, _pid: string | null, _so: number) {
    this.notes.set(id, { id, title, content, updatedAt: trashedAt, syncState: "synced", trashedAt, restorePendingAt: null, parentId: null, sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false });
  }
async localTrashNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = new Date().toISOString(); n.syncState = "local"; } }
async localRestoreNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = null; n.restorePendingAt = new Date().toISOString(); n.syncState = "local"; } }
  deletedNotes = new Set<string>();
async applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) { n.syncState = "purged"; n.parentId = TRASH_NOTEBOOK_ID; n.trashedAt = new Date().toISOString(); } }
async rememberDeleted(note: any, deletedAt: string) { this.deletedNotes.add(note.id); this.deletedAtMap.set(note.id, deletedAt); }
  deletedAtMap = new Map<string, string>();
  publishedTombstones: string[] = [];
async listDeletedNotesForSync() {
    // v5：note 墓碑 + folder 墓碑（含 title/parentId/sortOrder，发布侧构建 folder 墓碑条目用）
    return [
      ...[...this.deletedAtMap.entries()].map(([id, deletedAt]) => ({ id, deletedAt, nodeType: "note" })),
      ...[...this.folderTombstones.entries()].map(([id, t]) => ({
        id, deletedAt: t.deletedAt, nodeType: "folder",
        title: t.folder.title, parentId: t.folder.parentId ?? null, sortOrder: t.folder.sortOrder ?? 0, updatedAt: t.folder.updatedAt,
      })),
    ];
  }
async markTombstonesPublished(ids: string[]) { this.publishedTombstones.push(...ids); }
async revokeLocalDeletion(id: string) { this.deletedNotes.delete(id); this.deletedAtMap.delete(id); this.folderTombstones.delete(id); this.purgedFolders.delete(id); }
async markFolderSynced() { return true; }
async applyRemoteNoteMeta(note: any) {
    const n = this.notes.get(note.id);
    if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = !!note.isConflict; n.icon = note.icon ?? null; n.isLocked = !!note.isLocked; n.lockedAt = note.lockedAt ?? null; }
  }
async applyRemoteLock(id: string, locked: boolean, lockedAt: string | null) { const n = this.notes.get(id); if (n) { n.isLocked = locked; n.lockedAt = lockedAt; } }
async markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null) {
    const n = this.notes.get(id); if (n) n.syncState = "synced";
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string) {
    const n = this.notes.get(id); if (!n) return;
    const current = sha256Sync(new TextEncoder().encode(n.content));
    if (current !== expectedContentHash) return; // B2：同步中编辑 → 不标
    n.syncState = "synced";
    this.bases.set(id, { contentHash: expectedContentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null) {
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  folders = new Map<string, any>();
  purgedFolders = new Set<string>();
  /** v5：本地 folder 墓碑（deleted_notes node_type='folder'）——发布进 manifest.folders。 */
  folderTombstones = new Map<string, { folder: any; deletedAt: string }>();
  /** v5：applyRemoteFolderDelete 调用记录（学习端应用远端 folder 墓碑）。 */
  folderDeleteCalls: string[] = [];
async defaultNotebookId() { return "notebook-personal"; }
async importRemoteFolder(folder: any) { this.folders.set(folder.id, { syncState: "synced", ...folder }); }
  async isFolderPurged(id: string) { return this.purgedFolders.has(id) || this.folderTombstones.has(id); }
  async rememberFolderDeleted(folder: any, deletedAt: string) {
    this.folderTombstones.set(folder.id, { folder, deletedAt });
    this.purgedFolders.add(folder.id);
  }
  async applyRemoteFolderDelete(id: string, deletedAt: string) {
    // 子树 = folder 自身 + parent 链后代（含 notes.parent 命中的子文档）
    const subtree = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [fid, f] of this.folders) {
        if (f.parentId != null && subtree.has(f.parentId) && !subtree.has(fid)) { subtree.add(fid); grew = true; }
      }
    }
    this.folderDeleteCalls.push(id);
    for (const fid of subtree) {
      const f = this.folders.get(fid);
      if (f) { f.syncState = "purged"; f.trashedAt = f.trashedAt ?? deletedAt; }
    }
    for (const n of this.notes.values()) {
      if (n.parentId != null && subtree.has(n.parentId)) {
        n.syncState = "purged"; n.trashedAt = n.trashedAt ?? deletedAt; n.parentId = TRASH_NOTEBOOK_ID; n.restorePendingAt = null;
      }
    }
  }
async listFoldersForSync() {
    // v5：purged 行不发布（学习端不回填）
    return [...this.folders.values()].filter((f) => f.syncState !== "purged").map((f) => ({
      id: f.id, title: f.title, parentId: f.parentId ?? null, sortOrder: f.sortOrder ?? 0,
      nodeType: f.nodeType ?? "group", icon: f.icon ?? null, updatedAt: f.updatedAt ?? "2026-01-01T00:00:00.000Z",
    }));
  }
  history: Array<{ noteId: string; content: string; meta: any }> = [];
async createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number }) {
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
  declaredAssets = new Map<string, Array<{ filename: string; size: number; hash: string }>>();
async recordDeclaredAssets(noteId: string, assets: Array<{ filename: string; size: number; hash: string }>) { this.declaredAssets.set(noteId, assets); }
async listDeclaredAssets(noteId: string) { return this.declaredAssets.get(noteId) ?? []; }
  lastSeenCommitId: string | null = null;
  lastTombstoneSig = "";
async getLastSeenCommitId() { return this.lastSeenCommitId; }
async setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
async getLastTombstoneSig() { return this.lastTombstoneSig; }
async setLastTombstoneSig(sig: string) { this.lastTombstoneSig = sig; }
async tombstoneSignature() { return `${this.deletedNotes.size + this.folderTombstones.size}:${[...this.deletedAtMap.values(), ...[...this.folderTombstones.values()].map((t) => t.deletedAt)].sort().at(-1) ?? ""}`; }
async hasLocalPendingNotes() { return [...this.notes.values()].some((n) => n.syncState !== "synced" && n.syncState !== "purged") || [...this.folders.values()].some((f) => f.syncState !== "synced" && f.syncState !== "purged"); }
}

function promisifyDb(db: MemDb): SyncDbPort {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) =>
        await (value as (...args: unknown[]) => unknown).apply(target, args);
    },
  }) as SyncDbPort;
}

const CFG = { endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "p" };
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));
const row = (over: Partial<LocalNoteRow> & { id: string }): LocalNoteRow => ({
  id: over.id, title: over.title ?? "笔记", content: over.content ?? "<p>hi</p>", updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z", syncState: over.syncState ?? "local",
  trashedAt: over.trashedAt ?? null, restorePendingAt: over.restorePendingAt ?? null, parentId: over.parentId ?? null, sortOrder: over.sortOrder ?? 0,
  isLocked: over.isLocked ?? false, lockedAt: over.lockedAt ?? null, icon: over.icon ?? null, isConflict: over.isConflict ?? false,
  kind: over.kind,
});

describe("syncEngine（共享编排）", () => {
  it("全异步 SyncDbPort：可完整走上传、发布、记账与下一轮零变更早退", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1" }));

    const first = await syncNow(CFG, s3, promisifyDb(db));
    expect(first.published).toBe(true);
    expect(first.uploaded).toBe(1);
    expect(db.notes.get("n1")!.syncState).toBe("synced");
    expect(db.bases.get("n1")!.lastUploadedHash).toBe(hashOf("<p>hi</p>"));

    const second = await syncNow(CFG, s3, promisifyDb(db));
    expect(second.message).toContain("零变更跳过");
    expect(second.uploaded).toBe(0);
    expect(second.published).toBe(false);
  });

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
    expect(manifest.version).toBe(1);   // 260928：协议重置为 V1，内容 schema 不变
    expect(manifest.notes[0].id).toBe("n1");
    expect(db.notes.get("n1")!.syncState).toBe("synced");
  });

  // 260925 多端实测回归：上传条目手工枚举字段时漏了 kind ⇒ manifest 不含 kind ⇒
  // 他端把 usheet/bitable/board 当 doc 导入（正文落到 notes/*.lake，打开即毁）。这里卡住上传侧透传。
  it("kind 透传：非 doc（usheet/bitable/board）上传条目带 kind", async () => {
    for (const kind of ["usheet", "bitable", "board"] as const) {
      const s3 = new MemS3();
      const db = new MemDb();
      db.notes.set("n1", row({ id: "n1", kind }));
      await syncNow(CFG, s3, db);
      const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
      expect(manifest.notes.find((n: any) => n.id === "n1")?.kind, kind).toBe(kind);
    }
  });

  it("kind 透传：软删（回收站）条目也带 kind", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n2", row({ id: "n2", kind: "usheet", trashedAt: "2026-01-02T00:00:00.000Z", syncState: "local" }));
    await syncNow(CFG, s3, db);
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    expect(manifest.notes.find((n: any) => n.id === "n2")?.kind).toBe("usheet");
  });

  // 260925 下载并发预取回归：首同步每篇正文只取一次（预取，不再逐条串行重复取）；稳态零正文 GET。
  it("下载预取：首同步每篇正文取一次、稳态零次", async () => {
    const N = 20;
    const s3 = new MemS3();
    const a = new MemDb();
    for (let i = 0; i < N; i += 1) a.notes.set("n" + i, row({ id: "n" + i, content: "<p>c" + i + "</p>" }));
    await syncNow(CFG, s3, promisifyDb(a));
    const b = new MemDb();
    await syncNow(CFG, s3, promisifyDb(b));
    const firstBodyGets = s3.getLog.filter((k) => k.includes("/objects/")).length;
    expect(firstBodyGets).toBe(N);
    s3.getLog.length = 0;
    await syncNow(CFG, s3, promisifyDb(b));
    expect(s3.getLog.filter((k) => k.includes("/objects/")).length).toBe(0);
  });

  // 260925 性能回归：hash 账本批量预载后，下载/上传环不再逐条 getSyncBase（移动端省原生往返）。
  it("hash 账本批量预载：不再逐条 getSyncBase", async () => {
    const N = 20;
    const s3 = new MemS3();
    const a = new MemDb();
    for (let i = 0; i < N; i += 1) a.notes.set("n" + i, row({ id: "n" + i, content: "<p>c" + i + "</p>" }));
    await syncNow(CFG, s3, promisifyDb(a));
    const b = new MemDb();
    await syncNow(CFG, s3, promisifyDb(b));
    expect(b.notes.size).toBe(N);
    expect(b.syncBaseCalls).toBe(0);
  });

  it("A：manifest 声明正文引用但本地缺失、已记录元数据的资源（备份不丢引用）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const assetName = "1234567890123_a1b2c3d4.png";
    db.notes.set("n1", row({ id: "n1", content: `<p>see ${assetName}</p>`, syncState: "local" }));
    // 本地无该资源文件，但 manifest 声明过其元数据（方案 A 下载时记录）
    db.recordDeclaredAssets("n1", [{ filename: assetName, size: 200, hash: "aabbccdd" }]);
    const r = await syncNow(CFG, s3, db);
    expect(r.uploaded).toBe(1);
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    const entry = manifest.notes.find((n: any) => n.id === "n1");
    const a = (entry.assets ?? []).find((x: any) => x.filename === assetName);
    expect(a).toMatchObject({ filename: assetName, size: 200, hash: "aabbccdd" });
  });

  it("A：本地缺文件 + 编辑删除该引用 → manifest 不再含它（防删除引用挂回）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const assetName = "1234567890123_a1b2c3d4.png";
    db.notes.set("n1", row({ id: "n1", content: `<p>see ${assetName}</p>`, syncState: "local" }));
    db.recordDeclaredAssets("n1", [{ filename: assetName, size: 200, hash: "ab".repeat(32) }]);
    await syncNow(CFG, s3, db);
    let manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    let entry = manifest.notes.find((n: any) => n.id === "n1");
    expect((entry.assets ?? []).some((x: any) => x.filename === assetName)).toBe(true);

    // 编辑：删除该引用 → 再同步，manifest 不应再挂回该资源
    const prev = db.notes.get("n1")!;
    db.notes.set("n1", { ...prev, content: "<p>removed ref</p>", syncState: "local" });
    await syncNow(CFG, s3, db);
    manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    entry = manifest.notes.find((n: any) => n.id === "n1");
    expect((entry.assets ?? []).some((x: any) => x.filename === assetName)).toBe(false);
  });

  it("S3 差集上传：仅元数据变更重传时，远端清单已声明的资产不重复上传也不探测，清单仍全量声明（回归：稳态空转）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const fn = "1787733338672_a1b2c3d4.png";
    const body = "<p>hi</p>";
    const h = hashOf(body);
    const assetBytes = new TextEncoder().encode("img");
    // 云端已有正文对象 + 资产对象；远端清单声明了该资产（= 对象此刻被引用、未被 GC → 存在）
    s3.map.set("p/objects/n1-" + h + ".lake", new TextEncoder().encode(body));
    s3.map.set("p/assets/n1/" + fn, assetBytes);
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "旧标题", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [{ filename: fn, size: assetBytes.length, hash: "a".repeat(64) }] }],
      folders: [],
    })));
    // 本地：正文不变、仅改标题 → sync_state=local（元数据变更触发重传）；本地存在该资产文件
    db.notes.set("n1", row({ id: "n1", content: body, title: "新标题", syncState: "local", updatedAt: "2026-01-02T00:00:00.000Z" }));
    db.assets.set("n1/" + fn, assetBytes);
    const puts: string[] = [];
    const origPut = s3.putObject.bind(s3);
    s3.putObject = async (k: string, b: any, o?: any) => { puts.push(k); return origPut(k, b, o); };
    const r = await syncNow(CFG, s3, db);
    expect(r.uploaded).toBe(1);                                              // 正文（含新标题）仍发布
    expect(puts.some((k) => k.startsWith("p/assets/"))).toBe(false);         // 资产既不重复 PUT 也不 GET 探测
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    const entry = manifest.notes.find((n: any) => n.id === "n1");
    expect((entry.assets ?? []).some((x: any) => x.filename === fn)).toBe(true); // 清单仍全量声明（GC 红线：不得裁剪声明）
  });

  it("S3 差集上传：新增资产上传、已声明旧资产跳过", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const old = "1_a.png", added = "2_b.png";
    const body = "<p>hi</p>";
    const h = hashOf(body);
    s3.map.set("p/objects/n1-" + h + ".lake", new TextEncoder().encode(body));
    s3.map.set("p/assets/n1/" + old, new TextEncoder().encode("A"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "T", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [{ filename: old, size: 1, hash: "c".repeat(64) }] }],
      folders: [],
    })));
    db.notes.set("n1", row({ id: "n1", content: body, syncState: "local", updatedAt: "2026-01-02T00:00:00.000Z" }));
    db.assets.set("n1/" + old, new TextEncoder().encode("A"));
    db.assets.set("n1/" + added, new TextEncoder().encode("B"));
    const puts: string[] = [];
    const origPut = s3.putObject.bind(s3);
    s3.putObject = async (k: string, b: any, o?: any) => { puts.push(k); return origPut(k, b, o); };
    await syncNow(CFG, s3, db);
    expect(puts).toContain("p/assets/n1/" + added);   // 新增资产上传
    expect(puts).not.toContain("p/assets/n1/" + old); // 已声明资产走差集跳过（无 PUT、无探测）
  });

  it("并发上传正文对象失败 → 整轮同步抛错且不发布 manifest（并发 worker 首错上报、无 unhandledRejection）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1", content: "<p>a1</p>", syncState: "local" }));
    db.notes.set("n2", row({ id: "n2", content: "<p>a2</p>", syncState: "local" }));
    const origPut = s3.putObject.bind(s3);
    let manifestWritten = false;
    s3.putObject = async (key: string, body: any, opts?: any) => {
      if (key.endsWith("manifests/latest.json")) manifestWritten = true;
      if (key.includes("/objects/n1-")) throw new Error("boom-n1-upload");
      return origPut(key, body, opts);
    };
    await expect(syncNow(CFG, s3, db)).rejects.toThrow("boom-n1-upload");
    expect(manifestWritten).toBe(false);   // 上传失败即中止，未发布引用未落盘正文的 manifest
  });

  it("回归：幂等跳过分支（正文一致·远端父非法·元数据不更新）不得解析兜底笔记本（点#1 残留幽灵路径）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    let defaultCalled = 0;
    db.defaultNotebookId = async () => { defaultCalled++; return "notebook-uncategorized"; };
    const H = hashOf("<p>x</p>");
    // 本地：该笔记正文 H、父指向一个已消失的笔记本（悬空），已同步，元数据基线较新
    db.notes.set("n1", row({ id: "n1", content: "<p>x</p>", parentId: "dead-notebook", syncState: "synced", updatedAt: "2026-06-01T00:00:00.000Z" }));
    db.bases.set("n1", { contentHash: H, lastUploadedHash: null, lastSyncedMetaAt: "2026-06-01T00:00:00.000Z" });
    // 远端：同正文、父目录缺失、updatedAt 更旧（元数据不更新 → decideMetaApply=false）；folders 空 → 本地无笔记本
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "N", parentId: "folder-missing", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: H, isConflict: false, assets: [] }],
      folders: [],
    })));
    await syncNow(CFG, s3, db);
    expect(defaultCalled).toBe(0);                                   // 关键：为"探测/跳过"绝不创建"未分类"
    expect(db.notes.get("n1")!.parentId).toBe("dead-notebook");      // 未应用远端 → 本地父不变
  });

  it("P1：资产扫描失败→正文照常发布但该篇不 markSynced（留待下轮重扫，防声明被清空→GC 误删）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const content = "<p>x</p>";
    const h = hashOf(content);
    db.notes.set("n1", row({ id: "n1", content, syncState: "local" }));
    db.assets.set("n1/photo.png", new TextEncoder().encode("img"));   // 本地一张待传资产
    const origPut = s3.putObject.bind(s3);
    s3.putObject = async (k: string, b: any, o?: any) => {
      if (k.startsWith("p/assets/")) throw new Error("asset put boom");   // 仅资产上传失败
      return origPut(k, b, o);
    };
    const r = await syncNow(CFG, s3, db);
    expect(s3.map.has("p/objects/n1-" + h + ".lake")).toBe(true);   // 正文不被资产失败阻断
    expect(r.published).toBe(true);
    expect(db.notes.get("n1")!.syncState).toBe("local");            // 关键：资产未齐 → 不 markSynced，下轮重扫重传
  });

  it("下载侧差集：本地已持同 size/hash 资产 → remote-wins 重下正文但零重下资产（对齐上传侧/dejavu）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const img1 = new TextEncoder().encode("AAAA");
    const img2 = new TextEncoder().encode("BBBB");
    const hI1 = sha256Sync(img1), hI2 = sha256Sync(img2);
    const old = "<p>old</p>", neu = "<p>new</p>";
    const hOld = hashOf(old), hNew = hashOf(neu);
    // 本地已有该笔记（synced，正文 old）+ 两张未变资产（size/hash 与远端声明一致）
    db.notes.set("n1", row({ id: "n1", content: old, syncState: "synced" }));
    db.bases.set("n1", { contentHash: hOld, lastUploadedHash: hOld, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    db.assets.set("n1/a.png", img1);
    db.assets.set("n1/b.png", img2);
    // 远端：正文改为 new（触发 remote-wins），资产仍是同样这两张
    s3.map.set("p/objects/n1-" + hNew + ".lake", new TextEncoder().encode(neu));
    s3.map.set("p/assets/n1/a.png", img1);
    s3.map.set("p/assets/n1/b.png", img2);
    s3.map.set("p/manifests/latest.json", gzipSync(new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "N", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-02-01T00:00:00.000Z", contentHash: hNew, isConflict: false, assets: [{ filename: "a.png", size: 4, hash: hI1 }, { filename: "b.png", size: 4, hash: hI2 }] }],
      folders: [],
    }))));
    const assetGets: string[] = [];
    const origGet = s3.getObject.bind(s3);
    s3.getObject = async (k: string, o?: { maxBytes?: number }) => { if (k.startsWith("p/assets/")) assetGets.push(k); return origGet(k, o); };
    await syncNow(CFG, s3, db);
    expect(assetGets).toEqual([]);                                  // 关键：未变资产零重下（旧实现会 2 次 GET）
    expect(db.notes.get("n1")!.content).toBe(neu);                  // 正文照常应用
  });

  it("下载侧差集：本地缺该资产（未下载过）→ 仍照常 GET 下载（差集不误跳过缺失）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const img1 = new TextEncoder().encode("AAAA");
    const hI1 = sha256Sync(img1);
    const neu = "<p>new</p>"; const hNew = hashOf(neu);
    db.notes.set("n1", row({ id: "n1", content: "<p>old</p>", syncState: "synced" }));
    db.bases.set("n1", { contentHash: hashOf("<p>old</p>"), lastUploadedHash: hashOf("<p>old</p>"), lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    s3.map.set("p/objects/n1-" + hNew + ".lake", new TextEncoder().encode(neu));
    s3.map.set("p/assets/n1/a.png", img1);   // 云端有，本地无
    s3.map.set("p/manifests/latest.json", gzipSync(new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "N", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-02-01T00:00:00.000Z", contentHash: hNew, isConflict: false, assets: [{ filename: "a.png", size: 4, hash: hI1 }] }],
      folders: [],
    }))));
    await syncNow(CFG, s3, db);
    expect(db.assets.get("n1/a.png") ? Array.from(db.assets.get("n1/a.png")!) : []).toEqual(Array.from(img1)); // 缺失的仍下载落盘
  });

  it("缺口2：active→trash 且正文 hash 相同 → 跟随删除不重下正文（用本地内容入回收站）", async () => {
    const s3 = new MemS3(); const db = new MemDb();
    const content = "<p>keep me</p>"; const h = hashOf(content);
    db.notes.set("n1", row({ id: "n1", content, syncState: "synced" }));
    db.notes.get("n1")!.contentHash = h;                                   // 本地已持该 hash 正文
    db.bases.set("n1", { contentHash: h, lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    // 远端软删进回收站，正文 hash 不变（删除不改内容）；故意【不放正文对象】——若走 GET 必 MISS → 不会入回收站
    s3.map.set("p/manifests/latest.json", gzipSync(new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "N", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-02-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], trashedAt: "2026-02-01T00:00:00.000Z", deletedFromParentId: "notebook-personal" }],
      folders: [],
    }))));
    const objGets: string[] = []; const orig = s3.getObject.bind(s3);
    s3.getObject = async (k: string, o?: { maxBytes?: number }) => { if (k.startsWith("p/objects/")) objGets.push(k); return orig(k, o); };
    await syncNow(CFG, s3, db);
    expect(objGets).toEqual([]);                                          // 关键：正文 hash 相等 → 未 GET
    expect(db.notes.get("n1")!.trashedAt).toBeTruthy();                  // 仍正确跟随入回收站
    expect(db.notes.get("n1")!.content).toBe(content);                   // 内容用本地（等价）
  });

  it("缺口2：hash 不同（删除方改过正文）→ 仍拉删除方权威内容入回收站（捷径只走 hash 相等）", async () => {
    const s3 = new MemS3(); const db = new MemDb();
    const local = "<p>stale</p>"; const tomb = "<p>deleted-side</p>"; const hT = hashOf(tomb);
    db.notes.set("n1", row({ id: "n1", content: local, syncState: "synced" }));
    db.notes.get("n1")!.contentHash = hashOf(local);
    db.bases.set("n1", { contentHash: hashOf(local), lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    s3.map.set("p/objects/n1-" + hT + ".lake", new TextEncoder().encode(tomb));   // 删除方携带的删除前内容
    s3.map.set("p/manifests/latest.json", gzipSync(new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "N", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-02-01T00:00:00.000Z", contentHash: hT, isConflict: false, assets: [], trashedAt: "2026-02-01T00:00:00.000Z", deletedFromParentId: "notebook-personal" }],
      folders: [],
    }))));
    await syncNow(CFG, s3, db);
    expect(db.notes.get("n1")!.trashedAt).toBeTruthy();
    expect(db.notes.get("n1")!.content).toBe(tomb);                      // hash 不同 → 用删除方权威内容（非本地）
  });

  it("缺口2加固：缓存 hash 谎报相等但本地正文缺失/损坏 → 仍 GET 权威内容自愈（不写空进回收站）", async () => {
    const s3 = new MemS3(); const db = new MemDb();
    const body = "<p>authoritative-from-cloud</p>"; const h = hashOf(body);
    // 模拟桌面：getAllNotes 给 contentHash=缓存 baseHash（不读文件），row.content="" 且 getNote 也读不到正文（文件被外部删/坏）
    const r = row({ id: "n1", content: body, syncState: "synced" });
    r.content = "";            // 本地 .lake 实际缺失（按需读盘返回空）
    r.contentHash = h;         // 但缓存 hash 仍等于远端墓碑正文 hash（陈旧/说谎）
    db.notes.set("n1", r);
    db.bases.set("n1", { contentHash: h, lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    s3.map.set("p/objects/n1-" + h + ".lake", new TextEncoder().encode(body));   // 云端权威正文在
    s3.map.set("p/manifests/latest.json", gzipSync(new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "N", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-02-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], trashedAt: "2026-02-01T00:00:00.000Z", deletedFromParentId: "notebook-personal" }],
      folders: [],
    }))));
    await syncNow(CFG, s3, db);
    expect(db.notes.get("n1")!.trashedAt).toBeTruthy();
    expect(db.notes.get("n1")!.content).toBe(body);     // 关键：实读不符 → 回退 GET 权威内容（旧实现会把空写进回收站）
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
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null,
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

  it("下载：远端正文 hash 与清单不符 → 跳过 + warning（不应用损坏内容）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>remote</p>");
    // 对象内容与清单声明的 contentHash 不符（模拟损坏/篡改）
    s3.map.set("p/objects/n2-" + h + ".lake", new TextEncoder().encode("<p>TAMPERED</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n2", title: "远端", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(0);
    expect(db.notes.has("n2")).toBe(false);
    expect(r.warnings.some((w) => w.kind === "remote_incomplete" && w.noteId === "n2" && w.message.includes("正文哈希不符"))).toBe(true);
  });

  it("D2：远端 manifest 是非法 JSON → 整轮中止报错，不覆盖本地", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1", syncState: "synced" }));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode("not-json"));
    // 审计 260918 F2：清单拉取失败不得降级成"同步完成、0/0"——必须抛出，让两端 UI 都报失败。
    await expect(syncNow(CFG, s3, db)).rejects.toThrow(/拉取同步清单失败/);
    expect(db.notes.get("n1")!.syncState).toBe("synced");   // 本地未被改动
    expect(s3.map.has("p/manifests/latest.json")).toBe(true); // 未覆盖坏清单
  });

  it("审计 260918 D1：留档失败 → 整轮中止抛出，本地编辑不被覆盖（不谎报 superseded）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1", content: "<p>local-edit</p>", title: "本地", syncState: "synced" }));
    db.bases.set("n1", { contentHash: hashOf("<p>base</p>"), lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    const H = hashOf("<p>remote-final</p>");
    s3.map.set("p/objects/n1-" + H + ".lake", new TextEncoder().encode("<p>remote-final</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "远端", parentId: null, sortOrder: 0, updatedAt: "2026-01-03T00:00:00.000Z", contentHash: H, isConflict: false, assets: [], trashedAt: "2026-01-03T00:00:00.000Z", deletedFromParentId: null }],
      folders: [],
    })));
    db.createHistorySnapshot = async () => { throw new Error("磁盘满"); };
    await expect(syncNow(CFG, s3, db)).rejects.toThrow(/磁盘满/);
    // 覆盖没发生：本地仍是自己的编辑，且没有"已存历史"的假提示
    expect(db.notes.get("n1")!.content).toBe("<p>local-edit</p>");
    expect(db.notes.get("n1")!.trashedAt).toBeNull();
    expect(db.history.length).toBe(0);
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

  it("B4（收敛）：远端已带同 id 墓碑 + 本地行保留 purged → 不重发布（purge 幂等，防每轮空转重写 manifest）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>内容</p>");
    // 本地有副本（applyRemotePurge → 标 purged 保留；移动端 purge 表示）
    db.notes.set("n1", row({ id: "n1", content: "<p>内容</p>", syncState: "purged" }));
    // 远端 manifest：n1 deleted:true（他端 purge 墓碑已在云端）
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "被删", parentId: null, sortOrder: 0, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    // 墓碑已在 manifest → 无发布理由（否则每轮重写 manifest，四端 commitId 永不稳定）
    expect(r.published).toBe(false);
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    const entry = manifest.notes.find((n: any) => n.id === "n1");
    expect(entry.deleted).toBe(true);
  });

  it("B4（回归）：本地 purged 副本因其他变更触发发布时，墓碑保留 deleted:true（不吞掉，防离线端复活）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>内容</p>");
    // 本地：n1 purged 保留副本 + n2 本地编辑（真实上传理由 → 触发发布）
    db.notes.set("n1", row({ id: "n1", content: "<p>内容</p>", syncState: "purged" }));
    db.notes.set("n2", row({ id: "n2", content: "<p>新笔记</p>", syncState: "local" }));
    // 远端 manifest：n1 deleted:true（他端 purge 墓碑）
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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

  // ===== v5：folder 墓碑（删除传播） =====

  const mkFolderTomb = (id: string, title: string, deletedAt: string) => ({
    id, title, parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: deletedAt, deleted: true as const, deletedAt,
  });

  it("v5 发布：本地 folder 墓碑上云（manifest.folders 带 deleted:true，版本 5）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 发起端 purge：行已物理删 + deleted_notes 写 folder 墓碑
    db.folderTombstones.set("nb1", { folder: { id: "nb1", title: "已删笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-02T00:00:00.000Z" }, deletedAt: "2026-01-02T00:00:00.000Z" });
    db.purgedFolders.add("nb1");
    const r = await syncNow(CFG, s3, db);
    expect(r.published).toBe(true);
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    expect(manifest.version).toBe(1);
    const entry = manifest.folders.find((f: any) => f.id === "nb1");
    expect(entry).toBeDefined();
    expect(entry.deleted).toBe(true);
    expect(entry.deletedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("v5 发布幂等：远端已带同 id folder 墓碑 → 不重发布（防每轮空转重写 manifest）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.folderTombstones.set("nb1", { folder: { id: "nb1", title: "已删笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-02T00:00:00.000Z" }, deletedAt: "2026-01-02T00:00:00.000Z" });
    db.purgedFolders.add("nb1");
    // 第一轮：发布墓碑上云
    await syncNow(CFG, s3, db);
    // 第二轮：远端已带墓碑 + 本地无其他变更 → 不发布（commitId 稳定，四端可早退）
    const r2 = await syncNow(CFG, s3, db);
    expect(r2.published).toBe(false);
    // 墓碑条目仍在（不因不发布而丢失）
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    expect(manifest.folders.find((f: any) => f.id === "nb1")?.deleted).toBe(true);
  });

  it("v5 下载 apply：远端 folder 墓碑 + 本地有活跃副本 → applyRemoteFolderDelete（folder 行与子 notes 移入回收站标 purged）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.folders.set("nb1", { id: "nb1", title: "本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-01T00:00:00.000Z", syncState: "synced" });
    db.notes.set("n1", row({ id: "n1", parentId: "nb1", syncState: "synced" }));
    const h = hashOf("<p>内容</p>");
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "子文档", parentId: "nb1", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" }],
      folders: [mkFolderTomb("nb1", "本", "2026-01-02T00:00:00.000Z")],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(db.folderDeleteCalls).toContain("nb1");
    // folder 行保留标 purged（可恢复、不上传）
    expect(db.folders.get("nb1").syncState).toBe("purged");
    // 子 notes 对齐 applyRemotePurge 语义（先由 folder 子树标注；note 环 skip-already-purged 幂等）
    expect(db.notes.get("n1")!.syncState).toBe("purged");
    expect(db.notes.get("n1")!.trashedAt).not.toBeNull();
    expect(r.uploaded).toBe(0); // 学习端不回传
  });

  it("v5 下载 remember：远端 folder 墓碑 + 本地无副本 → 记 folder 墓碑防复活（空库/新设备）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [],
      folders: [mkFolderTomb("nb1", "从未见过的本", "2026-01-02T00:00:00.000Z")],
    })));
    await syncNow(CFG, s3, db);
    expect(db.folderTombstones.has("nb1")).toBe(true);
    // 第二轮幂等：已有墓碑 → skip-already-purged，不重复 remember/apply
    const callsBefore = db.folderDeleteCalls.length;
    await syncNow(CFG, s3, db);
    expect(db.folderDeleteCalls.length).toBe(callsBefore);
  });

  it("v5 下载恢复 yield：远端活跃 folder updatedAt 新于本地 folder 墓碑 → 撤销墓碑跟随恢复", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 本地：folder 墓碑（2026-01-02 删除）
    db.folderTombstones.set("nb1", { folder: { id: "nb1", title: "被删的本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-02T00:00:00.000Z" }, deletedAt: "2026-01-02T00:00:00.000Z" });
    db.purgedFolders.add("nb1");
    // 远端：活跃条目（2026-01-03 恢复，晚于墓碑）→ 恢复胜出
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [],
      folders: [{ id: "nb1", title: "被删的本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-03T00:00:00.000Z" }],
    })));
    await syncNow(CFG, s3, db);
    // 墓碑已撤销 + folder 重新导入为活跃
    expect(db.folderTombstones.has("nb1")).toBe(false);
    expect(db.folders.get("nb1")).toBeDefined();
  });

  it("v5 学习端不回填：收到 folder 墓碑后行标 purged → 下一轮发布不含活跃条目（manifest 稳定）", async () => {
    const s3 = new MemS3();
    const dbA = new MemDb();
    // A：本地有 folder + 子文档，先同步上云（活跃）
    dbA.folders.set("nb1", { id: "nb1", title: "本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-01T00:00:00.000Z", syncState: "local" });
    dbA.notes.set("n1", row({ id: "n1", parentId: "nb1" }));
    await syncNow(CFG, s3, dbA);
    const manifest1 = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    expect(manifest1.folders.find((f: any) => f.id === "nb1").deleted).toBeUndefined();

    // A：purge folder（行删 + 写墓碑）→ 同步发布墓碑
    dbA.folders.delete("nb1");
    dbA.folderTombstones.set("nb1", { folder: { id: "nb1", title: "本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-02T00:00:00.000Z" }, deletedAt: "2026-01-02T00:00:00.000Z" });
    dbA.purgedFolders.add("nb1");
    dbA.notes.get("n1")!.syncState = "synced"; // 简化：子文档已同步（purge 场景由发起端墓碑覆盖）
    await syncNow(CFG, s3, dbA);
    const manifest2 = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    expect(manifest2.folders.find((f: any) => f.id === "nb1")?.deleted).toBe(true);

    // B（学习端）：本地有活跃副本 → 应用删除
    const dbB = new MemDb();
    dbB.folders.set("nb1", { id: "nb1", title: "本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-01T00:00:00.000Z", syncState: "synced" });
    dbB.notes.set("n1", row({ id: "n1", parentId: "nb1", syncState: "synced", content: "<p>内容</p>" }));
    await syncNow(CFG, s3, dbB);
    expect(dbB.folders.get("nb1").syncState).toBe("purged");
    // B 再同步：不把 purged 行当活跃条目回填（manifest 中该 folder 保持墓碑）
    const rB2 = await syncNow(CFG, s3, dbB);
    const manifest3 = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    const entry = manifest3.folders.find((f: any) => f.id === "nb1");
    expect(entry?.deleted).toBe(true);
    // B 第二轮无新发布理由（收敛；A/B 终态一致）
    expect(rB2.published).toBe(false);
  });

  it("v5 强写收窄：远端墓碑条目 + 本地 isFolderPurged → 不触发 foldersChanged（防 commitId 震荡，260910 实测回归）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 本地：folder 已 purge（墓碑在）
    db.folderTombstones.set("nb1", { folder: { id: "nb1", title: "本", parentId: null, sortOrder: 0, nodeType: "notebook", updatedAt: "2026-01-02T00:00:00.000Z" }, deletedAt: "2026-01-02T00:00:00.000Z" });
    db.purgedFolders.add("nb1");
    // 远端：同 id 墓碑（v5 已传播）
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [],
      folders: [mkFolderTomb("nb1", "本", "2026-01-02T00:00:00.000Z")],
    })));
    // 第一轮：无发布理由（旧版会因强写重写 manifest → 每轮 commitId 变化）
    const r1 = await syncNow(CFG, s3, db);
    expect(r1.published).toBe(false);
    // 第二轮：零变更跳过（彻底收敛）
    const r2 = await syncNow(CFG, s3, db);
    expect(r2.message).toContain("零变更跳过");
  });

  it("V1 清单：folder 墓碑字段缺省为活跃目录，不影响读取", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", row({ id: "n1", syncState: "synced", content: "<p>内容</p>" }));
    db.bases.set("n1", { contentHash: hashOf("<p>内容</p>"), lastUploadedHash: hashOf("<p>内容</p>"), lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "笔记", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf("<p>内容</p>"), isConflict: false, assets: [] }],
      folders: [{ id: "nb1", title: "本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.message).not.toContain("版本不兼容");
    // V1 活跃 folder 正常导入
    expect(db.folders.get("nb1")).toBeDefined();
  });

  it("W-1：远端 purge 覆盖本地未同步编辑 → 强制留档历史快照 + 报 superseded（与软删分支对称）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 本地持有未同步编辑：内容 ≠ 基线 hash（基线 = 上次同步的远端版本）
    db.notes.set("n1", row({ id: "n1", content: "<p>本地未同步编辑</p>", syncState: "local" }));
    db.bases.set("n1", { contentHash: hashOf("<p>旧版</p>"), lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [
        { id: "n1", title: "被永久删除", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf("<p>旧版</p>"), isConflict: false, assets: [], deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" },
        { id: "n2", title: "纯跟随", parentId: null, sortOrder: 1, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf("<p>n2</p>"), isConflict: false, assets: [], deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" },
      ],
      folders: [],
    })));
    // n2：从未编辑/上传（基线一致、非作者）→ 纯跟随删除，不留档
    db.notes.set("n2", row({ id: "n2", content: "<p>n2</p>", syncState: "synced" }));
    db.bases.set("n2", { contentHash: hashOf("<p>n2</p>"), lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });

    const r = await syncNow(CFG, s3, db);
    expect(db.notes.get("n1")!.syncState).toBe("purged");
    expect(db.notes.get("n2")!.syncState).toBe("purged");
    // 仅 n1 留档（本地编辑成果）；n2 纯跟随不产生快照
    expect(db.history).toHaveLength(1);
    expect(db.history[0].noteId).toBe("n1");
    expect(db.history[0].content).toBe("<p>本地未同步编辑</p>");
    expect(r.supersededNotes.map((s) => s.id)).toEqual(["n1"]);
  });

  it("B3：正文相同但远端元数据较新 → 应用远端标题/图标/锁（meta LWW，不重复下载正文）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>same</p>");
    db.notes.set("n1", row({ id: "n1", content: "<p>same</p>", title: "本地旧标题", syncState: "synced" }));
    db.bases.set("n1", { contentHash: h, lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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
    db.defaultNotebookId = async () => "notebook-uncategorized";
    const h1 = hashOf("<p>a</p>");
    s3.map.set("p/objects/n1-" + h1 + ".lake", new TextEncoder().encode("<p>a</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [],
      folders: [{ id: "nb-1", title: "笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }],
    })));
    expect(await db.isFolderPurged("nb-1")).toBe(true); // 前置：purged 标记已设
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
    const H0 = hashOf("<p>base</p>"), H2 = hashOf("<p>remote</p>");
    // 本地 n1：相对基线已编辑（localChanged），sync_state=local
    db.notes.set("n1", row({ id: "n1", content: "<p>local</p>", title: "本地标题", syncState: "local" }));
    db.bases.set("n1", { contentHash: H0, lastUploadedHash: null, lastSyncedMetaAt: "2026-01-01T00:00:00.000Z" });
    // 远端 n1：更新版（remoteChanged），首对象存在
    s3.map.set("p/objects/n1-" + H2 + ".lake", new TextEncoder().encode("<p>remote</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n9", title: "N", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [{ filename: "photo.png", size: 8, hash: imgHash }] }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);
    expect(db.assets.has("n9/photo.png")).toBe(true);          // D8 资产已落盘
    expect(new TextDecoder().decode(db.assets.get("n9/photo.png")!)).toBe("imgbytes");
    expect(r.warnings.length).toBe(0);                        // 校验通过无警告
  });

  it("D8：附件下载使用附件协议上限而非图片上限", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const bytes = new Uint8Array(26 * 1024 * 1024);
    const report: SyncReport = {
      pulled: false,
      appliedRemote: 0,
      uploaded: 0,
      published: false,
      message: "",
      warnings: [],
      supersededNotes: [],
      foldersUploaded: 0,
      trashedDown: 0,
      trashedUp: 0,
      foldersDownloaded: 0,
      uploadedBytes: 0,
      downloadedBytes: 0,
    };
    s3.map.set("p/assets/n-large/large.bin", bytes);

    await downloadNoteAssets(CFG, s3, db, "n-large", [
      { filename: "large.bin", size: bytes.length, hash: sha256Sync(bytes) },
    ], report, false);

    expect(db.assets.get("n-large/large.bin")).toBe(bytes);
    expect(report.downloadedBytes).toBe(bytes.length);
  });

  const makeReport = (): SyncReport => ({
    pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "", warnings: [],
    supersededNotes: [], foldersUploaded: 0, trashedDown: 0, trashedUp: 0, foldersDownloaded: 0,
    uploadedBytes: 0, downloadedBytes: 0,
  });

  /** 端口提供 getObjectToFile + assetFilePath 时，下载走文件路径：core 不再 saveAsset、字节不进 JS。 */
  class FileS3 extends MemS3 {
    fileCalls: Array<{ key: string; dest: string; expectedSha256?: string }> = [];
    async getObjectToFile(key: string, destPath: string, opts?: { maxBytes?: number; expectedSize?: number; expectedSha256?: string }) {
      this.fileCalls.push({ key, dest: destPath, expectedSha256: opts?.expectedSha256 });
      const b = this.map.get(key);
      if (!b) return null;
      return { status: "ok" as const, size: b.length, sha256: opts?.expectedSha256 ?? sha256Sync(b) };
    }
  }
  class FileDb extends MemDb {
    assetFilePath(noteId: string, filename: string) { return noteId + "/" + filename; }
  }

  it("资产文件下载端口：走 getObjectToFile + assetFilePath，不再 saveAsset；无该端口自动回退字节路径", async () => {
    const bytes = new TextEncoder().encode("native-bytes");
    const hash = sha256Sync(bytes);
    const s3 = new FileS3();
    const db = new FileDb();
    s3.map.set("p/assets/n1/photo.png", bytes);
    const report = makeReport();
    await downloadNoteAssets(CFG, s3, db, "n1", [{ filename: "photo.png", size: bytes.length, hash }], report, false);
    expect(s3.fileCalls).toEqual([{ key: "p/assets/n1/photo.png", dest: "n1/photo.png", expectedSha256: hash }]);
    expect(db.assets.size).toBe(0);                 // 文件已由端口落盘，core 不再走字节 saveAsset
    expect(report.downloadedBytes).toBe(bytes.length);
    expect(report.warnings).toEqual([]);

    // 普通端口（无 getObjectToFile）→ 仍走字节路径
    const s3b = new MemS3();
    const dbb = new MemDb();
    s3b.map.set("p/assets/n1/photo.png", bytes);
    const rb = makeReport();
    await downloadNoteAssets(CFG, s3b, dbb, "n1", [{ filename: "photo.png", size: bytes.length, hash }], rb, false);
    expect(dbb.assets.get("n1/photo.png")).toEqual(bytes);
    expect(rb.downloadedBytes).toBe(bytes.length);
  });

  it("资产文件下载端口：corrupt / 缺失在非严格模式记 warning 且不记账", async () => {
    class CorruptS3 extends MemS3 {
      async getObjectToFile() { return { status: "corrupt" as const, size: 1, sha256: "deadbeef" }; }
    }
    const s3 = new CorruptS3();
    const db = new FileDb();
    const report = makeReport();
    await downloadNoteAssets(CFG, s3, db, "n1", [{ filename: "x.png", size: 5, hash: "abc" }], report, false);
    expect(report.warnings.length).toBe(1);
    expect(report.downloadedBytes).toBe(0);
    expect(db.assets.size).toBe(0);

    class MissingS3 extends MemS3 {
      async getObjectToFile() { return null; }
    }
    const s3m = new MissingS3();
    const dbm = new FileDb();
    const rm = makeReport();
    await downloadNoteAssets(CFG, s3m, dbm, "n1", [{ filename: "x.png", size: 5, hash: "abc" }], rm, false);
    expect(rm.warnings.length).toBe(1);
    expect(rm.downloadedBytes).toBe(0);
  });

  it("回收站惰性下载：远端墓碑（软删）只记录声明资产元数据、不下载资源文件", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>trash</p>");
    const imgHash = sha256Sync(new TextEncoder().encode("imgbytes"));
    s3.map.set("p/objects/nt-" + h + ".lake", new TextEncoder().encode("<p>trash</p>"));
    s3.map.set("p/assets/nt/photo.png", new TextEncoder().encode("imgbytes"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "nt", title: "T", parentId: null, sortOrder: 0, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, isConflict: false, assets: [{ filename: "photo.png", size: 8, hash: imgHash }], trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: null }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);
    expect((await db.getNote("nt"))!.trashedAt).not.toBeNull(); // 已入回收站
    expect(db.assets.has("nt/photo.png")).toBe(false);  // 惰性：资源文件不下载
    expect(await db.listDeclaredAssets("nt")).toEqual([{ filename: "photo.png", size: 8, hash: imgHash }]); // 但声明元数据已记录
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
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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
        version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "恢复", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-05T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] }],
      folders: [],
    })));
    const r1 = await syncNow(CFG, s3, db);
    // 墓碑被撤销 + 笔记恢复
    expect(db.deletedNotes.has("n1")).toBe(false);
    expect(db.notes.get("n1")!.content).toBe("<p>restored</p>");
    expect(r1.appliedRemote).toBe(1);
  });

  it("恢复传播（LWW >= 回归）：本地在回收站 + 远端 active updatedAt==trashedAt（恢复方未 bump）→ 跟随恢复出回收站", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>内容</p>");
    // A 端：行在回收站（trashedAt=T1，已同步）；B 端恢复但未 bump updated_at（历史移动端 bug）→ 上传条目 updatedAt=T1
    db.notes.set("n1", row({ id: "n1", content: "<p>内容</p>", syncState: "synced", trashedAt: "2026-01-02T00:00:00.000Z" }));
    db.bases.set("n1", { contentHash: h, lastUploadedHash: null, lastSyncedMetaAt: "2026-01-02T00:00:00.000Z" });
    s3.map.set("p/objects/n1-" + h + ".lake", new TextEncoder().encode("<p>内容</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "已恢复", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    // 严格相等判恢复胜 → A 出回收站（否则 A 保留删除并压回 B 的恢复，恢复不传播）
    expect(r.appliedRemote).toBe(1);
    const n = db.notes.get("n1")!;
    expect(n.trashedAt).toBeNull();
    expect(n.syncState).toBe("synced");
  });

  it("删除压旧 active：本地在回收站（trashedAt 较新）+ 远端 active updatedAt 较旧 → 保留删除并重发墓碑", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const hOld = hashOf("<p>旧版</p>");
    // A 端：刚删除（syncState=local，尚未上传）；远端是 B 端离线期的旧 active（updatedAt 早于删除时刻）
    db.notes.set("n1", row({ id: "n1", content: "<p>旧版</p>", syncState: "local", trashedAt: "2026-01-05T00:00:00.000Z" }));
    s3.map.set("p/objects/n1-" + hOld + ".lake", new TextEncoder().encode("<p>旧版</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "旧 active", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hOld, isConflict: false, assets: [] }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    // 下载侧：保留删除（不应用远端）
    expect(r.appliedRemote).toBe(0);
    expect(db.notes.get("n1")!.trashedAt).toBe("2026-01-05T00:00:00.000Z");
    // 上传侧：墓碑重发（trashedAt 条目覆盖远端 active，删除不被旧 active 吞掉）
    expect(r.published).toBe(true);
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    expect(manifest.notes.find((n: any) => n.id === "n1")?.trashedAt).toBe("2026-01-05T00:00:00.000Z");
  });

  it("全新导入回收站条目携带 dfp（恢复原父依赖）：本地从未持有 + 远端 trashed 条目带 deletedFromParentId → 端口收到 dfp", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>内容</p>");
    // 本地无副本（全新设备）；远端是他端已软删的条目，dfp=原父
    s3.map.set("p/objects/n1-" + h + ".lake", new TextEncoder().encode("<p>内容</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "他端已删", parentId: "notebook-trash", sortOrder: 0, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, isConflict: false, assets: [], trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: "nb-origin" }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.trashedDown).toBe(1);
    // 端口必须收到 dfp（移动端 SQL 曾硬编码 NULL → 恢复后 parent 卡 TRASH 容器，260910 实测）
    expect(db.notes.get("n1")!.deletedFromParentId).toBe("nb-origin");
    expect(db.notes.get("n1")!.parentId).toBe(TRASH_NOTEBOOK_ID);
  });

  it("回归：空库同步+无可下载内容（全部本地删除较新跳过）→ 不得急切创建兜底'未分类'（凭空笔记本 bug）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    let defaultCalled = 0;
    db.defaultNotebookId = async () => { defaultCalled++; return "notebook-uncategorized"; };
    const h = hashOf("<p>old</p>");
    // 本地无任何笔记本 + 本地删除墓碑较新；远端唯一笔记父目录也缺失（若能落地本会回退兜底）
    db.deletedNotes.add("n1");
    db.deletedAtMap.set("n1", "2026-01-05T00:00:00.000Z");
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n1", title: "旧", parentId: "folder-missing", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] }],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(0);
    expect(db.notes.has("n1")).toBe(false);   // 墓碑较新 → 跳过下载
    expect(defaultCalled).toBe(0);            // 关键：没有笔记需要安家 → 兜底"未分类"从不创建
  });

  it("兜底'未分类'惰性且缓存：多篇笔记都需兜底父 → defaultNotebookId 本轮只解析一次", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    let defaultCalled = 0;
    db.defaultNotebookId = async () => { defaultCalled++; return "notebook-uncategorized"; };
    const h1 = hashOf("<p>a</p>"), h2 = hashOf("<p>b</p>");
    s3.map.set("p/objects/n1-" + h1 + ".lake", new TextEncoder().encode("<p>a</p>"));
    s3.map.set("p/objects/n2-" + h2 + ".lake", new TextEncoder().encode("<p>b</p>"));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: [
        { id: "n1", title: "A", parentId: "folder-missing", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h1, isConflict: false, assets: [] },
        { id: "n2", title: "B", parentId: "folder-missing", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h2, isConflict: false, assets: [] },
      ],
      folders: [],
    })));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(2);
    expect(db.notes.get("n1")!.parentId).toBe("notebook-uncategorized");
    expect(db.notes.get("n2")!.parentId).toBe("notebook-uncategorized");
    expect(defaultCalled).toBe(1);            // 缓存：至多建一个"未分类"
  });

  it("墓碑保留：本地删除较新 + 远端恢复较旧 → keep-local-delete（不上传覆盖）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    const h = hashOf("<p>old</p>");
    db.deletedNotes.add("n1");
    db.deletedAtMap.set("n1", "2026-01-05T00:00:00.000Z"); // 本地删除较新
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
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

  it("v5：folder 墓碑发布进 manifest.folders（deleted:true）、不进 manifest.notes", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.deletedNotes.add("folder1");
    db.deletedAtMap.set("folder1", "2026-01-02T00:00:00.000Z");
    (db as any).listDeletedNotesForSync = () => [{ id: "folder1", deletedAt: "2026-01-02T00:00:00.000Z", nodeType: "folder" }];
    const r = await syncNow(CFG, s3, db);
    expect(r.published).toBe(true);          // folder 墓碑是发布理由（v5 删除传播）
    const manifest = JSON.parse(decode((await s3.getObject("p/manifests/latest.json"))!));
    expect(manifest.folders.find((f: any) => f.id === "folder1")?.deleted).toBe(true);
    expect(manifest.notes.some((n: any) => n.id === "folder1")).toBe(false); // 不污染 notes
    expect(db.publishedTombstones).toContain("folder1");
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

  it("A2 云端恢复语义：空本地 + 远端已有 manifest → 全量下载、零上传（只拉不打）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 远端：一篇 active 笔记（含内容对象）+ 目录树
    const remoteContent = "<p>云端内容</p>";
    const H = hashOf(remoteContent);
    s3.map.set("p/objects/n1-" + H + ".lake", new TextEncoder().encode(remoteContent));
    s3.map.set("p/manifests/latest.json", new TextEncoder().encode(JSON.stringify({
      version: 1, workspaceId: "default", commitId: "c-remote", prevCommitId: null, createdAt: "2026-02-01T00:00:00.000Z",
      folders: [{ id: "nb1", title: "笔记本", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-02-01T00:00:00.000Z" }],
      notes: [{ id: "n1", title: "云端笔记", parentId: "nb1", sortOrder: 0, updatedAt: "2026-02-01T00:00:00.000Z", contentHash: H, isConflict: false, assets: [] }],
    })));
    // 空本地（恢复后全新空库）→ 同步
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);      // 全量下载远端笔记
    expect(r.uploaded).toBe(0);           // 只拉不打：零上传
    expect(r.published).toBe(false);      // 无本地变更，不发布新 manifest
    expect(db.notes.get("n1")).toBeTruthy();
    expect(db.notes.get("n1")!.content).toBe(remoteContent);
    expect(db.notes.get("n1")!.syncState).toBe("synced");
    expect(db.folders.has("nb1")).toBe(true); // 远端目录树导入
  });
});
