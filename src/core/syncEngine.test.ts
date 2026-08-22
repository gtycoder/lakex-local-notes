import { describe, expect, it } from "vitest";
import { syncNow, type S3Store, type SyncDbPort, type LocalNoteRow } from "./syncEngine.js";
import { sha256Sync } from "./sha256Sync.js";

/** 内存 S3Store（测试用，不做 gzip——syncEngine 当前按明文 manifest 设计） */
class MemS3 implements S3Store {
  map = new Map<string, string>();
  async getObject(key: string): Promise<string | null> { return this.map.get(key) ?? null; }
  async putObject(key: string, body: string | Uint8Array): Promise<void> {
    this.map.set(key, typeof body === "string" ? body : new TextDecoder().decode(body));
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
    });
  }
  applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, _dfp: string | null, _pid: string | null, _so: number) {
    this.notes.set(id, { id, title, content, updatedAt: trashedAt, syncState: "synced", trashedAt, restorePendingAt: null, parentId: null, sortOrder: 0 });
  }
  localTrashNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = new Date().toISOString(); n.syncState = "local"; } }
  localRestoreNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = null; n.restorePendingAt = new Date().toISOString(); n.syncState = "local"; } }
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string) {
    const n = this.notes.get(id); if (n) n.syncState = "synced";
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
  setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null) {
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
}

const CFG = { endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "p" };
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));

describe("syncEngine（共享编排）", () => {
  it("首次同步：上传本地笔记 + 写 manifest", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", { id: "n1", title: "笔记", content: "<p>hi</p>", updatedAt: "2026-01-01T00:00:00.000Z", syncState: "local", trashedAt: null, restorePendingAt: null, parentId: null, sortOrder: 0 });
    const r = await syncNow(CFG, s3, db);
    expect(r.uploaded).toBe(1);
    expect(r.published).toBe(true);
    const obj = s3.map.get(`p/objects/n1-${hashOf("<p>hi</p>")}.lake`);
    expect(obj).toBe("<p>hi</p>");
    const manifest = JSON.parse(s3.map.get("p/manifests/latest.json")!);
    expect(manifest.notes[0].id).toBe("n1");
    expect(db.notes.get("n1")!.syncState).toBe("synced");
  });

  it("二次同步：无变更不重传（skip-fast）", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    db.notes.set("n1", { id: "n1", title: "笔记", content: "<p>hi</p>", updatedAt: "2026-01-01T00:00:00.000Z", syncState: "local", trashedAt: null, restorePendingAt: null, parentId: null, sortOrder: 0 });
    await syncNow(CFG, s3, db);
    const keysBefore = s3.map.size;
    const r2 = await syncNow(CFG, s3, db);
    expect(r2.uploaded).toBe(0);
    expect(s3.map.size).toBe(keysBefore); // 无新对象/manifest 写入
  });

  it("下载：远端新笔记拉到本地", async () => {
    const s3 = new MemS3();
    const db = new MemDb();
    // 远端已有 n2
    const h = hashOf("<p>remote</p>");
    s3.map.set(`p/objects/n2-${h}.lake`, "<p>remote</p>");
    s3.map.set("p/manifests/latest.json", JSON.stringify({
      version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      notes: [{ id: "n2", title: "远端", parentId: null, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h, isConflict: false, assets: [] }],
      folders: [],
    }));
    const r = await syncNow(CFG, s3, db);
    expect(r.appliedRemote).toBe(1);
    expect(db.notes.get("n2")!.content).toBe("<p>remote</p>");
  });
});
