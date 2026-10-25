import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
const assetStore = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetStore.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetStore.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetStore.delete(key); },
  listNoteAssetKeysFs: async (noteId: string) => [...assetStore.keys()].filter((k) => k.startsWith(noteId + "/")),
  listQuickNoteAssetKeysFs: async (id: string) => [...assetStore.keys()].filter((k) => k.startsWith("quick-notes/" + id + "/")),
  listAssetKeysFs: async () => [...assetStore.keys()],
}));
import { gunzipSync, gzipSync } from "node:zlib";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, saveNote } from "../data/noteRepository.js";
import { writeQuickNoteBody } from "../data/noteBodies.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { S3v3SyncEngine } from "../../core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

async function freshDevice() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const store = new MobileDeviceStore(db);
  await store.init();
  return { db, store };
}

describe("MobileDeviceStore ↔ core v3 引擎（双移动端，假 S3）", () => {
  it("初始化上传 / 对端拉取 / 增量 / 远端墓碑→本机回收站", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    await createNote(a.db, "m1", "Mobile Doc", "hello-mobile", null, new Map());
    const engineA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    const r1 = await engineA.sync({ onEmptyCloud: "upload" });
    expect(r1.uploadedNotes).toBeGreaterThanOrEqual(1);
    const r2 = await engineB.sync();
    expect(r2.downloadedNotes).toBe(1);
    const bodyB = await b.store.readBody("m1");
    expect(new TextDecoder().decode(bodyB!)).toBe("hello-mobile");

    await saveNote(a.db, "m1", "Mobile Doc", "hello-mobile-v2", null, new Map());
    await engineA.sync();
    await engineB.sync();
    expect(new TextDecoder().decode((await b.store.readBody("m1"))!)).toBe("hello-mobile-v2");

    // B 删除 → 远端墓碑 → A 应用后进入回收站
    await b.db.prepare("UPDATE notes SET trashed_at=?, updated_at=?, sync_state='local' WHERE id=?").run(new Date().toISOString(), new Date(Date.now() + 2000).toISOString(), "m1");
    await engineB.sync();
    await engineA.sync();
    const row = await a.db.prepare("SELECT trashed_at FROM notes WHERE id=?").get("m1") as { trashed_at: string | null };
    expect(row.trashed_at).toBeTruthy();
    await a.db.close(); await b.db.close();
  }, 60_000);

  it("附件：A 上传资源 → B 拉取（声明 + 对象）", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    await createNote(a.db, "m2", "With Asset", "body", null, new Map());
    assetStore.set("m2/pic.png", new TextEncoder().encode("PNG-BYTES"));
    const engineA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineA.sync({ onEmptyCloud: "upload" });
    expect((await remote.list("assets/m2/")).length).toBe(1);
    expect((await remote.list("meta/assets/m2/")).length).toBe(1);
    await engineB.sync();
    expect(new TextDecoder().decode((await b.store.readAsset("m2", "pic.png"))!)).toBe("PNG-BYTES");
    expect(await b.store.listAssets("m2")).toContain("pic.png");
    await a.db.close(); await b.db.close();
  }, 60_000);

  it("目录：A 笔记本 + 文档 → B 拉取目录与归属", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    await a.db.prepare(
      "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,sync_state) VALUES ('nb1','Notebook',NULL,0,'notebook',NULL,?,NULL,NULL,'local')"
    ).run(new Date().toISOString());
    await createNote(a.db, "m4", "In Notebook", "folder-body", "nb1", new Map());
    const engineA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineA.sync({ onEmptyCloud: "upload" });
    await engineB.sync();
    const folder = await b.db.prepare("SELECT title,node_type FROM folders WHERE id='nb1'").get() as { title: string; node_type: string };
    expect(folder.title).toBe("Notebook");
    expect(folder.node_type).toBe("notebook");
    const note = await b.db.prepare("SELECT parent_id FROM notes WHERE id='m4'").get() as { parent_id: string | null };
    expect(note.parent_id).toBe("nb1");
    await a.db.close(); await b.db.close();
  }, 60_000);

  it("小记：正文/标签/图片双端同步", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    const body = "quick-body";
    const hash = sha256Sync(new TextEncoder().encode(body));
    await a.db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,sync_state,is_conflict) VALUES ('q1','2026-10-25T00:00:00.000Z','2026-10-25T00:00:00.000Z','',0,?,'local',0)").run(hash);
    await a.db.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES ('quickNote','q1','2026-10-25T00:00:01.000Z')").run();
    await writeQuickNoteBody("q1", body);
    await a.db.prepare("INSERT INTO tags (id,name,sort_order,pinned,created_at,updated_at) VALUES ('t1','Tag',0,0,'2026-10-25T00:00:00.000Z','2026-10-25T00:00:00.000Z')").run();
    await a.db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q1','t1',0)").run();
    assetStore.set("quick-notes/q1/pic.png", new TextEncoder().encode("Q-IMG"));
    const engineA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineA.sync({ onEmptyCloud: "upload" });
    expect((await remote.list("quick-notes/objects/")).length).toBe(1);
    await engineB.sync();
    const row = await b.db.prepare("SELECT content_hash FROM quick_notes WHERE id='q1'").get() as { content_hash: string };
    expect(row.content_hash).toBe(hash);
    expect(new TextDecoder().decode((await b.store.readQuickBody("q1"))!)).toBe(body);
    const link = await b.db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id='q1'").get() as { tag_id: string };
    expect(link.tag_id).toBe("t1");
    expect(new TextDecoder().decode((await b.store.readQuickAsset("q1", "pic.png"))!)).toBe("Q-IMG");
    await a.db.close(); await b.db.close();
  }, 60_000);
});
