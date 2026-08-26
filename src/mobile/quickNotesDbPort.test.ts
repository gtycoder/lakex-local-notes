/**
 * 移动端 Quick Notes 同步端口集成测试（P2/P3）：
 * - 用真实 sql.js（node 直载 WASM）实现 DbLike，驱动共享引擎 syncQuickNotesViaEngine；
 * - 验证移动端端口 + 引擎的跨端语义：上传/下载、删除墓碑传播、恢复 LWW、冲突归档；
 * - 验证线上格式 = 共享序列化（serializeQuickNoteContent），两端哈希一致。
 */
import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import path from "node:path";
import crypto from "node:crypto";
import type { DbLike } from "./sqliteDb.js";
import type { S3Store, SyncConfig } from "../core/syncEngine.js";
import type { ManifestItem } from "../core/manifestTypes.js";
import { syncQuickNotesViaEngine } from "../core/quickNotesSyncEngine.js";
import { normalizeQuickNoteContent, previewQuickNote, serializeQuickNoteContent } from "../core/quickNoteModel.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { applyQuickNotesSyncSchema, createQuickNotesSyncDbPort } from "./quickNotesDbPort.js";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

/** 把原生 sql.js Database 包成 DbLike（sqliteDb.ts 同款接口形态）。 */
function toDbLike(db: Database): DbLike {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        get(...params: unknown[]): Record<string, unknown> | undefined {
          stmt.bind(params as never);
          if (!stmt.step()) return undefined;
          return stmt.getAsObject() as Record<string, unknown>;
        },
        all(...params: unknown[]): Record<string, unknown>[] {
          stmt.bind(params as never);
          const out: Record<string, unknown>[] = [];
          while (stmt.step()) out.push(stmt.getAsObject() as Record<string, unknown>);
          return out;
        },
        run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
          stmt.run(params as never);
          return { changes: db.getRowsModified(), lastInsertRowid: 0 };
        },
      };
    },
    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: unknown[]) => {
        db.exec("BEGIN");
        try {
          const result = fn(...(args as never[]));
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }) as unknown as T;
    },
    pragma() { return undefined; },
    exec(sql: string) { db.exec(sql); },
    close() { db.close(); },
  };
}

function openQuickNotesDb(): { db: Database; d: DbLike } {
  const db = new SQL.Database();
  const d = toDbLike(db);
  d.exec(`CREATE TABLE quick_notes (
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
  applyQuickNotesSyncSchema(d);
  return { db, d };
}

function createQuickNote(d: DbLike, text: string): { id: string; contentHash: string } {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const serialized = serializeQuickNoteContent(normalizeQuickNoteContent(text, []));
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  d.prepare(
    `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict)
     VALUES (?,?,?,?,?,?,?,'local',0)`
  ).run(id, now, now, previewQuickNote(text, 0), 0, contentHash, serialized);
  return { id, contentHash };
}

function editQuickNote(d: DbLike, id: string, text: string): void {
  const now = new Date().toISOString();
  const serialized = serializeQuickNoteContent(normalizeQuickNoteContent(text, []));
  const contentHash = sha256Sync(new TextEncoder().encode(serialized));
  d.prepare("UPDATE quick_notes SET updated_at=?, preview_text=?, content_hash=?, content=?, sync_state='local' WHERE id=?").run(now, previewQuickNote(text, 0), contentHash, serialized, id);
}

function listActive(d: DbLike): Array<{ id: string; content: string }> {
  return (d.prepare("SELECT id, content FROM quick_notes WHERE deleted_at IS NULL").all() as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), content: String(r.content) }));
}

function textOf(d: DbLike, id: string): string | null {
  const row = d.prepare("SELECT content FROM quick_notes WHERE id=?").get(id) as { content: string } | undefined;
  if (!row) return null;
  return (JSON.parse(row.content) as { text: string }).text;
}

function createFakeS3(): S3Store & { bucket: Map<string, Uint8Array> } {
  const bucket = new Map<string, Uint8Array>();
  return {
    bucket,
    async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
      const bytes = bucket.get(key);
      if (!bytes) return null;
      if (opts?.maxBytes && bytes.length > opts.maxBytes) throw new Error(`对象超限: ${key}`);
      return bytes;
    },
    async putObject(key: string, body: string | Uint8Array): Promise<void> {
      bucket.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    },
  };
}

const cfg: SyncConfig = { endpoint: "https://s3.test", region: "test", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "lake" };

function readManifest(s3: ReturnType<typeof createFakeS3>): { items: Array<{ id: string; contentHash: string; updatedAt: string; deleted?: boolean; assets?: Array<{ filename: string; size: number; hash: string }> }> } {
  const bytes = s3.bucket.get("lake/quick-notes/manifests/latest.json");
  if (!bytes) throw new Error("manifest missing");
  return JSON.parse(new TextDecoder().decode(bytes));
}

beforeEach(async () => {
  if (!SQL) SQL = await initSqlJs({ locateFile: () => path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") });
});

describe("移动端 Quick Notes 同步端口 + 共享引擎", () => {
  it("双端往返：创建→同步→对端拉取；编辑传播；删除墓碑跨端", async () => {
    const { d: da } = openQuickNotesDb();
    const { d: db } = openQuickNotesDb();
    const s3 = createFakeS3();

    // A 创建并同步
    const created = createQuickNote(da, "手机小记");
    const r1 = await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    expect(r1.uploaded).toBe(1);
    // 线上格式 = 共享序列化（哈希与 content 一致；桌面 .qnote 同字节）
    const objBytes = s3.bucket.get(`lake/quick-notes/objects/${created.contentHash}.qnote`);
    expect(objBytes).toBeTruthy();
    expect(sha256Sync(objBytes!)).toBe(created.contentHash);
    expect(JSON.parse(new TextDecoder().decode(objBytes!)).text).toBe("手机小记");

    // B 同步 → 拉到
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    expect(textOf(db, created.id)).toBe("手机小记");
    // 清单时间戳保留（LWW 依据）：导入行的 updated_at = 清单 updatedAt（创建方时间），不是本机同步时间
    const m0 = readManifest(s3);
    const manifestUpdatedAt = m0.items.find((i) => i.id === created.id)!.updatedAt;
    const imported = db.prepare("SELECT created_at, updated_at FROM quick_notes WHERE id=?").get(created.id) as { created_at: string; updated_at: string };
    expect(imported.updated_at).toBe(manifestUpdatedAt);
    expect(imported.created_at).toBe(manifestUpdatedAt);

    // B 编辑并同步 → A 同步跟随
    editQuickNote(db, created.id, "B 编辑版");
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    expect(textOf(da, created.id)).toBe("B 编辑版");

    // B 删除并同步 → A 同步后跟随删除（墓碑权威）
    const bd = createQuickNotesSyncDbPort(db);
    bd.deleteLocalQuickNote(created.id);
    await syncQuickNotesViaEngine(cfg, s3, bd);
    const manifestAfterDelete = readManifest(s3);
    expect(manifestAfterDelete.items.find((i) => i.id === created.id)?.deleted).toBe(true);
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    expect(listActive(da).some((i) => i.id === created.id)).toBe(false);
    // A 的墓碑记录已记住（防复活）
    const tombRow = da.prepare("SELECT 1 FROM quick_notes WHERE id=? AND deleted_at IS NOT NULL").get(created.id);
    expect(tombRow).toBeTruthy();
  });

  it("端口合并本地与远端墓碑时按 id 去重", () => {
    const { d } = openQuickNotesDb();
    const created = createQuickNote(d, "待删除");
    const port = createQuickNotesSyncDbPort(d);
    port.deleteLocalQuickNote(created.id);
    port.rememberDeletedQuickNote({
      id: created.id,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: "2099-01-01T00:00:01.000Z",
    });
    const deleted = port.listDeletedQuickNotes();
    expect(deleted.filter((item) => item.id === created.id)).toHaveLength(1);
    expect(deleted[0].deletedAt).toBe("2099-01-01T00:00:01.000Z");
  });

  it("删除会取消尚未同步的恢复标记，并保留可同步墓碑", () => {
    const { d } = openQuickNotesDb();
    const created = createQuickNote(d, "恢复后又删除");
    d.prepare("UPDATE quick_notes SET restore_pending_at=? WHERE id=?").run("2099-01-01T00:00:00.000Z", created.id);
    createQuickNotesSyncDbPort(d).deleteLocalQuickNote(created.id);
    const row = d.prepare("SELECT deleted_at, restore_pending_at, sync_state, ready_to_sync FROM quick_notes WHERE id=?").get(created.id) as { deleted_at: string | null; restore_pending_at: string | null; sync_state: string; ready_to_sync: number };
    expect(row.deleted_at).toBeTruthy();
    expect(row.restore_pending_at).toBeNull();
    expect(row.sync_state).toBe("local");
    expect(row.ready_to_sync).toBe(1);
  });

  it("远端小记写入失败时端口事务回滚正文与图片", () => {
    const { d } = openQuickNotesDb();
    const created = createQuickNote(d, "本地正文");
    const content = serializeQuickNoteContent(normalizeQuickNoteContent("远端正文", [{
      id: "img-1", filename: "image.png", mimeType: "image/png", width: 1, height: 1, size: 1, hash: "b".repeat(64),
    }]));
    const bytes = new TextEncoder().encode(content);
    const item: ManifestItem = {
      id: created.id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z",
      contentHash: sha256Sync(bytes), isConflict: false, assets: [{
        id: "img-1", filename: "image.png", mimeType: "image/png", width: 1, height: 1, size: 1, hash: "b".repeat(64),
      }],
    };
    const port = createQuickNotesSyncDbPort(d);
    expect(() => port.applyRemoteQuickNote(item, bytes, [])).toThrow(/图片缺失/);
    expect(textOf(d, created.id)).toBe("本地正文");
    expect(d.prepare("SELECT COUNT(*) AS count FROM quick_note_assets WHERE quick_note_id=?").get(created.id)).toMatchObject({ count: 0 });
  });

  it("恢复 LWW：B 显式恢复（restore_pending）→ 回写 active 覆盖墓碑；A 跟随恢复且本地墓碑撤销", async () => {
    const { d: da } = openQuickNotesDb();
    const { d: db } = openQuickNotesDb();
    const s3 = createFakeS3();

    const created = createQuickNote(db, "原始");
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    // A 删除并同步 → 云端 deleted
    const ad = createQuickNotesSyncDbPort(da);
    ad.deleteLocalQuickNote(created.id);
    await syncQuickNotesViaEngine(cfg, s3, ad);
    // B 学到删除（墓碑权威）
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    expect(listActive(db).some((i) => i.id === created.id)).toBe(false);
    // B 恢复：恢复标记 + 内容回 active（模拟 restoreQuickNote：清 deleted_at、置 restore_pending_at、sync_state=local）
    await new Promise((r) => setTimeout(r, 10));
    db.prepare("UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=?, sync_state='local', updated_at=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), created.id);
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    // 云端墓碑被 active 覆盖
    const m = readManifest(s3);
    expect(m.items.find((i) => i.id === created.id)?.deleted).not.toBe(true);
    // A 再同步：跟随恢复 + 本地墓碑撤销
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    expect(textOf(da, created.id)).toBe("原始");
    const revoked = da.prepare("SELECT 1 FROM quick_notes WHERE id=? AND deleted_at IS NULL AND restore_pending_at IS NULL").get(created.id);
    expect(revoked).toBeTruthy();
    // B 的恢复标记已在 markSynced 清除（墓碑永胜不被破坏）
    const restoreLeft = db.prepare("SELECT restore_pending_at FROM quick_notes WHERE id=?").get(created.id) as { restore_pending_at: string | null };
    expect(restoreLeft.restore_pending_at).toBeNull();
  });

  it("带图小记跨端：A 创建带图 → B 下载 BLOB 落库 → 快路径零上传 → C 再拉取", async () => {
    const { d: da } = openQuickNotesDb();
    const { d: db } = openQuickNotesDb();
    const s3 = createFakeS3();
    // A 创建带图小记：content JSON 含图片元数据 + quick_note_assets BLOB（模拟移动端未来图片 UI 的产物）
    const imgBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const img = { id: "img-1", filename: "a.png", mimeType: "image/png", width: 10, height: 10, size: imgBytes.length, hash: sha256Sync(imgBytes) };
    const serialized = serializeQuickNoteContent({ version: 1, text: "带图", images: [img] });
    const hash = sha256Sync(new TextEncoder().encode(serialized));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    da.prepare("INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict) VALUES (?,?,?,?,?,?,?,'local',0)").run(id, now, now, "带图", 1, hash, serialized);
    da.prepare("INSERT INTO quick_note_assets (quick_note_id, id, filename, mime_type, width, height, size, content_hash, bytes) VALUES (?,?,?,?,?,?,?,?,?)").run(id, img.id, img.filename, img.mimeType, img.width, img.height, img.size, img.hash, imgBytes);
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    // 线上 manifest 含 assets（非空）
    const m = readManifest(s3);
    expect(m.items.find((i) => i.id === id)!.assets!.length).toBe(1);
    // B 下载：BLOB 落库，字节/大小/哈希与元数据一致
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    const stored = db.prepare("SELECT filename, size, content_hash, bytes FROM quick_note_assets WHERE quick_note_id=?").get(id) as { filename: string; size: number; content_hash: string; bytes: Uint8Array };
    expect(stored.filename).toBe("a.png");
    expect(stored.size).toBe(imgBytes.length);
    expect(stored.content_hash).toBe(img.hash);
    expect(Array.from(stored.bytes)).toEqual(Array.from(imgBytes));
    // B 重传：synced 快路径零上传
    const r = await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    expect(r.uploaded).toBe(0);
    // C 再拉取（第三端）：资产同样落库
    const { d: dc } = openQuickNotesDb();
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(dc));
    const cAsset = dc.prepare("SELECT size, content_hash FROM quick_note_assets WHERE quick_note_id=?").get(id) as { size: number; content_hash: string };
    expect(cAsset.size).toBe(imgBytes.length);
    expect(cAsset.content_hash).toBe(img.hash);
  });

  it("墓碑携带图片（A）：带图小记删除 → 墓碑带 assets；B 收到墓碑后软删行图片 BLOB 完整，可恢复", async () => {
    const { d: da } = openQuickNotesDb();
    const { d: db } = openQuickNotesDb();
    const s3 = createFakeS3();
    // A 创建带图小记（content 元数据 + BLOB 字节）
    const imgBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const img = { id: "img-t", filename: "t.png", mimeType: "image/png", width: 3, height: 3, size: imgBytes.length, hash: sha256Sync(imgBytes) };
    const serialized = serializeQuickNoteContent({ version: 1, text: "待删带图", images: [img] });
    const hash = sha256Sync(new TextEncoder().encode(serialized));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    da.prepare("INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict) VALUES (?,?,?,?,?,?,?,'local',0)").run(id, now, now, "待删带图", 1, hash, serialized);
    da.prepare("INSERT INTO quick_note_assets (quick_note_id, id, filename, mime_type, width, height, size, content_hash, bytes) VALUES (?,?,?,?,?,?,?,?,?)").run(id, img.id, img.filename, img.mimeType, img.width, img.height, img.size, img.hash, imgBytes);
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    // B 拉到带图小记
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    // A 删除并同步 → 墓碑带 assets + 图片对象
    createQuickNotesSyncDbPort(da).deleteLocalQuickNote(id);
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    const m = readManifest(s3);
    const tomb = m.items.find((i) => i.id === id)!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.assets!.length).toBe(1);
    // B 收到墓碑：软删 + 图片 BLOB 落地（恢复时图片完整）
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    expect(listActive(db).some((i) => i.id === id)).toBe(false);
    const stored = db.prepare("SELECT filename, size, content_hash, bytes FROM quick_note_assets WHERE quick_note_id=?").get(id) as { filename: string; size: number; content_hash: string; bytes: Uint8Array };
    expect(stored.filename).toBe("t.png");
    expect(Array.from(stored.bytes)).toEqual(Array.from(imgBytes));
  });

  it("冲突归档：双端编辑 → 远端覆盖本地，本地版本进回收站（新 id 软删），恢复即新小记", async () => {
    const { d: da } = openQuickNotesDb();
    const { d: db } = openQuickNotesDb();
    const s3 = createFakeS3();

    const created = createQuickNote(db, "v1");
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    // 双端各自编辑
    editQuickNote(da, created.id, "A 编辑");
    editQuickNote(db, created.id, "B 编辑");
    // B 先同步（云端 = B 版）；A 后同步 → A 版进回收站（新 id + deleted_at）
    await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(db));
    const r = await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    expect(r.conflicts).toBe(1);
    expect(textOf(da, created.id)).toBe("B 编辑");
    const archived = da.prepare("SELECT id, content FROM quick_notes WHERE deleted_at IS NOT NULL").all() as Array<{ id: string; content: string }>;
    expect(archived.length).toBe(1);
    expect(archived[0].id).not.toBe(created.id);
    expect((JSON.parse(archived[0].content) as { text: string }).text).toBe("A 编辑");
    // 归档新 id 不发布幽灵墓碑（ready_to_sync=0）：manifest 不得出现 archived id 的 deleted 记录
    const m = readManifest(s3);
    const archivedEntry = m.items.find((i) => i.id === archived[0].id);
    expect(archivedEntry).toBeUndefined();
    // A 再次同步：不重复冲突（已对齐）
    const r2 = await syncQuickNotesViaEngine(cfg, s3, createQuickNotesSyncDbPort(da));
    expect(r2.conflicts).toBe(0);
    expect(r2.uploaded).toBe(0);
  });
});
