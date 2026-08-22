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
  async getObject(key: string): Promise<Uint8Array | null> {
    const b = this.map.get(key);
    if (!b) return null;
    return isGzip(b) ? gunzipSync(b) : b;
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
  rememberDeleted(note: any, _deletedAt: string) { this.deletedNotes.add(note.id); }
  applyRemoteNoteMeta(note: any) {
    const n = this.notes.get(note.id);
    if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = !!note.isConflict; n.icon = note.icon ?? null; n.isLocked = !!note.isLocked; n.lockedAt = note.lockedAt ?? null; }
  }
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null) { const n = this.notes.get(id); if (n) { n.isLocked = locked; n.lockedAt = lockedAt; } }
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string) {
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
  defaultNotebookId() { return "notebook-personal"; }
  importRemoteFolder(folder: any) { this.folders.set(folder.id, folder); }
  history: Array<{ noteId: string; content: string; meta: any }> = [];
  createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number }) {
    this.history.push({ noteId, content, meta });
  }
  assets = new Map<string, Uint8Array>();
  async saveAsset(noteId: string, filename: string, bytes: Uint8Array) { this.assets.set(noteId + "/" + filename, bytes); }
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
});
