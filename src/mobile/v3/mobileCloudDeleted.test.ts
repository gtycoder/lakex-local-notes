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
import { createNote } from "../data/noteRepository.js";
import { writeQuickNoteBody } from "../data/noteBodies.js";
import { listQuickNoteTrash } from "../data/quickNotesRepository.js";
import { listTrashTree } from "../data/trashRepository.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { S3v3SyncEngine } from "../../core/s3v3Engine.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";

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

// 用真实时间起点：createNote 写的是真实 now；若用固定过去时间，purgedAt 会早于 remote.updatedAt，
// 引擎按「他端显式恢复」让位删除意图（产品语义），本文件测的就不是 purge 传播了。
let clock = Date.now();
const stamp = () => new Date((clock += 1000)).toISOString();

async function seedQuickNote(d: { db: SqlJsAsyncDb }, id: string, body: string) {
  const ts = stamp();
  const hash = sha256Sync(new TextEncoder().encode(body));
  await d.db.prepare(
    "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'预览',0,?,1,0)",
  ).run(id, ts, ts, hash);
  await writeQuickNoteBody(id, body);
}

/** 本地彻底删除（文档）：与 bridge.purgeTreeItem 的落盘语义一致（删除行 + purge 墓碑 + 删正文）。 */
async function purgeNoteLocal(d: { db: SqlJsAsyncDb }, id: string) {
  const row = await d.db.prepare("SELECT title, parent_id, sort_order, updated_at FROM notes WHERE id=?").get(id) as { title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
  const now = stamp();
  await d.db.prepare(
    "INSERT INTO deleted_notes (id,title,parent_id,sort_order,updated_at,deleted_at,node_type,purged_at) VALUES (?,?,?,?,?,?,'note',?) ON CONFLICT(id) DO UPDATE SET purged_at=excluded.purged_at",
  ).run(id, row?.title ?? "", row?.parent_id ?? null, row?.sort_order ?? 0, row?.updated_at ?? now, now, now);
  await d.db.prepare("DELETE FROM notes WHERE id=?").run(id);
  // 正文文件：测试里 BodyStore 是模块级共享实现（两台设备共享同一份正文），删了 A 的正文等于删 B 的。
  // 这里只做「行 + 墓碑」的 purge（正文删除另有仓储测试覆盖），以保证 B 侧「保留副本正文」可断言。
}

/** 本地彻底删除（小记）：与 quickNotesRepository.purgeQuickNote 一致（墓碑 + 删行 + 删正文）。 */
async function purgeQuickNoteLocal(d: { db: SqlJsAsyncDb }, id: string) {
  const now = stamp();
  await d.db.prepare(
    "INSERT OR REPLACE INTO quick_note_deleted (id,created_at,updated_at,deleted_at,purged_at) SELECT id,created_at,updated_at,COALESCE(deleted_at,?),? FROM quick_notes WHERE id=?",
  ).run(now, now, id);
  await d.db.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
}

async function cloudDeletedQuickIds(d: { db: SqlJsAsyncDb }): Promise<string[]> {
  const rows = await d.db.prepare("SELECT id FROM quick_notes WHERE cloud_deleted=1 ORDER BY id").all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

describe("移动端「云端已删除 · 仅本地」（261026）", () => {
  it("远端彻底删除 → 本地回收站保留副本并打标；恢复上传后清除标记", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    await createNote(a.db, "d1", "Doc1", "body-d1", null, new Map());
    await seedQuickNote(a, "q1", "quick-body-q1");
    const eA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const eB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await eA.sync({ onEmptyCloud: "upload" });
    await eB.sync();
    expect((await b.db.prepare("SELECT title FROM notes WHERE id='d1'").get() as { title: string }).title).toBe("Doc1");

    // A 本地彻底删除文档 + 小记 → 远端索引里缺席（文档）/ 带 purge 墓碑（小记）
    await purgeNoteLocal(a, "d1");
    await purgeQuickNoteLocal(a, "q1");
    await eA.sync();
    await eB.sync();

    // 文档：保留在本机回收站，正文仍在，只打标
    const doc = await b.db.prepare("SELECT trashed_at, cloud_deleted FROM notes WHERE id='d1'").get() as { trashed_at: string | null; cloud_deleted: number };
    expect(doc.trashed_at).toBeTruthy();
    expect(doc.cloud_deleted).toBe(1);
    expect(new TextDecoder().decode((await b.store.readBody("d1"))!)).toBe("body-d1");
    // 小记：保留在 quick 回收站（不物理删），正文仍在，只打标
    const quick = await b.db.prepare("SELECT deleted_at, cloud_deleted FROM quick_notes WHERE id='q1'").get() as { deleted_at: string | null; cloud_deleted: number };
    expect(quick.deleted_at).toBeTruthy();
    expect(quick.cloud_deleted).toBe(1);
    expect(new TextDecoder().decode((await b.store.readQuickBody("q1"))!)).toBe("quick-body-q1");
    // state 契约：标记持久化，且小记副本仍作为 state 条目存在（引擎据此跨轮保留）
    const stateB = await b.store.loadState();
    expect(stateB!.remotePurged).toContain("d1");
    expect(stateB!.remotePurged).toContain("q1");
    expect(stateB!.quickNotes.items.map((q) => q.id)).toContain("q1");
    // 回收站 UI 数据源都带标记
    expect((await listTrashTree(b.db)).find((r) => r.id === "d1")?.cloudDeleted).toBe(true);
    expect((await listQuickNoteTrash(b.db)).find((r) => r.id === "q1")?.cloudDeleted).toBe(true);

    // 多轮同步不得复活、不得把标记冲掉
    await eB.sync();
    const docAgain = await b.db.prepare("SELECT trashed_at, cloud_deleted FROM notes WHERE id='d1'").get() as { trashed_at: string | null; cloud_deleted: number };
    expect(docAgain.trashed_at).toBeTruthy();
    expect(docAgain.cloud_deleted).toBe(1);
    expect(await cloudDeletedQuickIds(b)).toEqual(["q1"]);

    // 显式恢复：restore_pending_at 让标记让位 → 重新上传成功 → 标记清除
    const now = stamp();
    await b.db.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=? WHERE id='d1'").run(now, now);
    await b.db.prepare("UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=? WHERE id='q1'").run(now, now);
    const beforeSync = await b.store.loadState();
    expect(beforeSync!.restorePending).toContain("d1");
    expect(beforeSync!.restorePending).toContain("q1");
    expect(beforeSync!.remotePurged).not.toContain("d1");
    expect(beforeSync!.remotePurged).not.toContain("q1");
    await eB.sync();
    const restoredDoc = await b.db.prepare("SELECT trashed_at, cloud_deleted FROM notes WHERE id='d1'").get() as { trashed_at: string | null; cloud_deleted: number };
    expect(restoredDoc.trashed_at).toBeNull();
    expect(restoredDoc.cloud_deleted).toBe(0);
    // 第三台设备能拉到恢复后的文档（证明真的重新上传了）
    const c = await freshDevice();
    const eC = new S3v3SyncEngine({ remote, device: c.store, deviceId: "C" });
    await eC.sync();
    expect(await c.db.prepare("SELECT 1 FROM notes WHERE id='d1' AND trashed_at IS NULL").get()).toBeTruthy();
    // 小记恢复：本机侧标记已清除；「恢复后重新上传」被远端 purge 墓碑挡住（core 现把 purgedIds 判在
    // restorePending 之前，见 src/core/s3v3Merge.ts:174），需要 core 侧让 restorePending 优先。移动端
    // 适配器只能保留副本、不能改远端索引 → 单独 skip 记录，不把错误语义固化成断言。
    expect(await b.db.prepare("SELECT 1 FROM quick_notes WHERE id='q1'").get()).toBeTruthy();
    await a.db.close(); await b.db.close(); await c.db.close();
  }, 90_000);

  it("本地彻底删除「云端已删除」副本后：标记清除，且多轮同步不复活、不上传", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    await createNote(a.db, "d2", "Doc2", "body-d2", null, new Map());
    const eA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const eB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await eA.sync({ onEmptyCloud: "upload" });
    await eB.sync();
    await purgeNoteLocal(a, "d2");
    await eA.sync();
    await eB.sync();
    const marked = await b.db.prepare("SELECT trashed_at, cloud_deleted FROM notes WHERE id='d2'").get() as { trashed_at: string | null; cloud_deleted: number };
    expect(marked.trashed_at).toBeTruthy();
    expect(marked.cloud_deleted).toBe(1);

    // B 把这份「仅本地」副本彻底删除（本地主动 purge）
    await purgeNoteLocal(b, "d2");
    await eB.sync();
    await eB.sync();
    expect(await b.db.prepare("SELECT 1 FROM notes WHERE id='d2'").get()).toBeUndefined();
    const stateB = await b.store.loadState();
    expect(stateB!.remotePurged).not.toContain("d2");
    expect(await b.db.prepare("SELECT id FROM notes WHERE id='d2' AND cloud_deleted=1").get()).toBeUndefined();
    // 远端没有该条目被重新创建/上传（新设备拉取也拿不到）
    const c = await freshDevice();
    await new S3v3SyncEngine({ remote, device: c.store, deviceId: "C" }).sync();
    expect(await c.db.prepare("SELECT 1 FROM notes WHERE id='d2'").get()).toBeUndefined();
    await a.db.close(); await b.db.close(); await c.db.close();
  }, 90_000);

  it("小记：A 彻底删除 → B 保留「云端已删除」回收站副本 → B 恢复并重传 → C 拉回", async () => {
    const remote = new MemoryRemote();
    const a = await freshDevice();
    const b = await freshDevice();
    await seedQuickNote(a, "q3", "quick-body-q3");
    const eA = new S3v3SyncEngine({ remote, device: a.store, deviceId: "A" });
    const eB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    // A 上传 → B 拉取
    await eA.sync({ onEmptyCloud: "upload" });
    await eB.sync();
    expect(new TextDecoder().decode((await b.store.readQuickBody("q3"))!)).toBe("quick-body-q3");

    // A 本地彻底删除 q3 → 远端索引出现 purged 墓碑、条目缺席
    await purgeQuickNoteLocal(a, "q3");
    await eA.sync();
    expect(await a.db.prepare("SELECT 1 FROM quick_notes WHERE id='q3'").get()).toBeUndefined();

    // B 同步：远端 purge → 不物理删，保留 quick 回收站副本 + cloud_deleted
    await eB.sync();
    const trashed = await b.db.prepare("SELECT deleted_at, cloud_deleted FROM quick_notes WHERE id='q3'").get() as { deleted_at: string | null; cloud_deleted: number };
    expect(trashed.deleted_at).toBeTruthy();
    expect(trashed.cloud_deleted).toBe(1);
    expect(new TextDecoder().decode((await b.store.readQuickBody("q3"))!)).toBe("quick-body-q3");
    expect((await b.store.loadState())!.remotePurged).toContain("q3");

    // B 显式恢复（与 bridge.restoreQuickNote 同语义：清 deleted_at、写 restore_pending_at、bump updatedAt）
    const now = stamp();
    await b.db.prepare("UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=? WHERE id='q3'").run(now, now);
    expect((await b.store.loadState())!.restorePending).toContain("q3");
    await eB.sync();

    // B：标记清除、条目回到活跃列表，远端重新上传成功（purged 墓碑里不再有 q3）
    const bRow = await b.db.prepare("SELECT deleted_at, cloud_deleted FROM quick_notes WHERE id='q3'").get() as { deleted_at: string | null; cloud_deleted: number };
    expect(bRow.deleted_at).toBeNull();
    expect(bRow.cloud_deleted).toBe(0);
    const stateB = await b.store.loadState();
    expect(stateB!.remotePurged).not.toContain("q3");
    expect(stateB!.quickPurges).not.toContain("q3");
    // 恢复标记由 saveBaseline 清理（DB 列），保证下一轮不会再被当成「待恢复上传」。
    const bFlag = await b.db.prepare("SELECT restore_pending_at FROM quick_notes WHERE id='q3'").get() as { restore_pending_at: string | null };
    expect(bFlag.restore_pending_at).toBeNull();

    // C（全新设备）拉回恢复后的 q3，正文一致
    const c = await freshDevice();
    const eC = new S3v3SyncEngine({ remote, device: c.store, deviceId: "C" });
    await eC.sync();
    const cRow = await c.db.prepare("SELECT deleted_at, cloud_deleted FROM quick_notes WHERE id='q3'").get() as { deleted_at: string | null; cloud_deleted: number } | undefined;
    expect(cRow).toBeTruthy();
    expect(cRow!.deleted_at).toBeNull();
    expect(Number(cRow!.cloud_deleted)).toBe(0);
    expect(new TextDecoder().decode((await c.store.readQuickBody("q3"))!)).toBe("quick-body-q3");

    // A（删除方）再同步：2026-10-26 用户定稿——别的端恢复之后就是正常小记，删除方也跟随恢复。
    // 远端 active q3 出现即让位本地 purged 墓碑，A 把 q3 作为普通小记拉回；本地墓碑清除。
    await eA.sync();
    const aRow = await a.db.prepare("SELECT deleted_at, cloud_deleted FROM quick_notes WHERE id='q3'").get() as { deleted_at: string | null; cloud_deleted: number } | undefined;
    expect(aRow).toBeTruthy();
    expect(aRow!.deleted_at).toBeNull();
    expect(Number(aRow!.cloud_deleted)).toBe(0);
    expect(new TextDecoder().decode((await a.store.readQuickBody("q3"))!)).toBe("quick-body-q3");
    const stateA = (await a.store.loadState())!;
    expect(stateA.quickPurges).not.toContain("q3");
    expect(stateA.remotePurged).not.toContain("q3");
    await a.db.close(); await b.db.close(); await c.db.close();
  }, 90_000);

  it("loadState：软删墓碑进 quickDeletes、本地 purge 墓碑才进 quickPurges（quick_note_deleted 双语义）", async () => {
    const dev = await freshDevice();
    const ts = stamp();
    // 软删/远端学习墓碑（purged_at 为空）→ quickDeletes，可恢复语义
    await dev.db.prepare("INSERT INTO quick_note_deleted (id,created_at,updated_at,deleted_at,purged_at) VALUES ('qs1',?,?,?,NULL)").run(ts, ts, ts);
    // 本地彻底删除墓碑（purged_at 非空）→ quickPurges
    await dev.db.prepare("INSERT INTO quick_note_deleted (id,created_at,updated_at,deleted_at,purged_at) VALUES ('qp1',?,?,?,?)").run(ts, ts, ts, ts);
    const state = await dev.store.loadState();
    expect(state!.quickDeletes).toContain("qs1");
    expect(state!.quickDeletes).not.toContain("qp1");
    expect(state!.quickPurges).toEqual(["qp1"]);
    await dev.db.close();
  }, 30_000);

  it("loadState：从 DB 派生 restorePending / intents / quickPurges，并把它们从 remotePurged 剔除", async () => {
    const dev = await freshDevice();
    const ts = stamp();
    await dev.db.prepare("INSERT INTO notes (id,title,parent_id,updated_at,content_hash,is_dirty,trashed_at,restore_pending_at) VALUES ('r1','Restored',NULL,?,?,1,NULL,?)").run(ts, sha256Sync(new TextEncoder().encode("r")), ts);
    await writeNoteBodyForTest("r1", "r");
    await dev.db.prepare("INSERT INTO deleted_notes (id,title,parent_id,sort_order,updated_at,deleted_at,node_type,purged_at) VALUES ('p1','Purged',NULL,0,?,?,'note',?)").run(ts, ts, ts);
    await dev.db.prepare("INSERT INTO quick_note_deleted (id,created_at,updated_at,deleted_at,purged_at) VALUES ('qp1',?,?,?,?)").run(ts, ts, ts, ts);
    // 先人为给这三条都留下「云端已删除」标记，loadState 必须按上面的判据剔除
    await dev.db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id IN ('r1')").run();
    await dev.db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,deleted_at,cloud_deleted) VALUES ('qp1',?,?,'',0,?,0,0,?,1)").run(ts, ts, sha256Sync(new TextEncoder().encode("x")), ts);
    const state = await dev.store.loadState();
    expect(state!.restorePending).toContain("r1");
    expect(state!.intents.map((i) => i.noteId)).toContain("p1");
    expect(state!.quickPurges).toContain("qp1");
    expect(state!.remotePurged).not.toContain("r1");
    expect(state!.remotePurged).not.toContain("qp1");
    expect(state!.remotePurged).not.toContain("p1");
    await dev.db.close();
  }, 30_000);
});

/** 测试里直接落正文文件（noteBodies 的 writeNoteBody 需要 kind 参数，默认 doc）。 */
async function writeNoteBodyForTest(id: string, body: string) {
  const { writeNoteBody } = await import("../data/noteBodies.js");
  await writeNoteBody("doc", id, body);
}
