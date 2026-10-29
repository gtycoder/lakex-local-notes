/**
 * E2-4 phase C-3b-2：移动写侧端口 + 批量窗口钩子的**桥往返/落库形状**护栏。
 *
 * 判据（与迁移前 saveState 同口径）：
 * - 批量阶段（文档行）只允许**一次** executeSet 提交（原生一次桥往返），语句数 ≈ 文档数（每篇一条 INSERT）；
 * - staging 正文先搬文件、后提交行（崩溃最多留「有文件没行」）；
 * - 回收站时间戳落 state 的远端 trashedAt（不是本地 now）；
 * - 「云端已删除·仅本地」投影 = 引擎 remotePurged ∪ 本轮新打标小记副本，且投影后清空本轮集合。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
const assetStore = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetStore.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetStore.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetStore.delete(key); },
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));
import { SqlJsAsyncDb, SqlJsDb, type MobileDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import type { DeviceState } from "../../core/s3v3DeviceStore.js";

/** 给 sql.js 测试库补一个「原生式」executeSet（一次调用 = 一次桥往返），用于数桥次数。 */
function attachExecuteSet(db: MobileDb): { statements: number[] } {
  const statements: number[] = [];
  db.executeSet = async (set) => {
    statements.push(set.length);
    for (const s of set) await db.prepare(s.statement).run(...s.values);
  };
  return { statements };
}

const bodyOf = (id: string) => "<p>body " + id + "</p>";
const hashOf = (text: string) => sha256Sync(new TextEncoder().encode(text));

function stateFor(ids: string[]): DeviceState {
  return {
    lake: { v: 3, space: "lake", notes: ids.map((id) => ({
      id, title: "T " + id, parentId: null, sortOrder: 0, updatedAt: "2026-10-29T00:00:00.000Z", contentHash: hashOf(bodyOf(id)),
    })), folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
    folders: [], intents: [], pending: [], remotePurged: [], restorePending: [],
    quickPurges: [], quickPurgeTimes: {}, quickDeletes: [],
  };
}

async function freshStore() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const counter = attachExecuteSet(db);
  const store = new MobileDeviceStore(db);
  await store.init();
  return { db, store, counter };
}

describe("移动写侧批量窗口（E2-4 phase C-3b-2）", () => {
  it("500 篇首拉：一次 executeSet 提交、语句数 ≈ 文档数，正文先搬文件后出行", async () => {
    const { db, store, counter } = await freshStore();
    const ids = Array.from({ length: 500 }, (_, i) => "b" + i);
    for (const id of ids) await store.writeBody(id, new TextEncoder().encode(bodyOf(id)));
    await store.saveState(stateFor(ids));
    expect(counter.statements.length).toBe(1); // 批量窗口 = 一次桥往返
    expect(counter.statements[0]).toBe(500);   // 每篇一条 INSERT（默认 icon/lock/sort 不额外发 UPDATE）
    const rows = (await db.prepare("SELECT COUNT(*) AS c FROM notes").get()) as { c: number };
    expect(rows.c).toBe(500);
    // staging 已搬到最终正文路径，且行内容 hash 与 state 一致
    expect(new TextDecoder().decode((await store.readBody("b0"))!)).toBe(bodyOf("b0"));
    const row = (await db.prepare("SELECT content_hash, is_dirty FROM notes WHERE id=?").get("b0")) as { content_hash: string; is_dirty: number };
    expect(row.content_hash).toBe(hashOf(bodyOf("b0")));
    await db.close();
  }, 120_000);

  it("增量：改 1 篇 + 远端回收站 1 篇 → 仍只一次 executeSet；trashed_at 落远端时间戳", async () => {
    const { db, store, counter } = await freshStore();
    const ids = ["i0", "i1", "i2"];
    for (const id of ids) await store.writeBody(id, new TextEncoder().encode(bodyOf(id)));
    await store.saveState(stateFor(ids));
    const callsAfterFirst = counter.statements.length;
    // 改 i0 正文（staged）+ i1 远端墓碑
    await store.writeBody("i0", new TextEncoder().encode(bodyOf("i0") + "-v2"));
    const next = stateFor(ids);
    next.lake.notes = next.lake.notes.map((n) => n.id === "i0"
      ? { ...n, updatedAt: "2026-10-29T00:10:00.000Z", contentHash: hashOf(bodyOf("i0") + "-v2") }
      : n.id === "i1" ? { ...n, trashedAt: "2026-10-29T00:11:00.000Z" } : n);
    await store.saveState(next);
    expect(counter.statements.length).toBe(callsAfterFirst + 1);
    const trashed = (await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get("i1")) as { trashed_at?: string | null };
    expect(trashed.trashed_at).toBe("2026-10-29T00:11:00.000Z");
    expect(new TextDecoder().decode((await store.readBody("i0"))!)).toBe(bodyOf("i0") + "-v2");
    await db.close();
  }, 120_000);

  it("投影：remotePurged 置位/清除不残留（文档 + 行仍在的小记副本）", async () => {
    const { db, store } = await freshStore();
    const ids = ["n1", "q1"];
    await store.writeBody("n1", new TextEncoder().encode(bodyOf("n1")));
    await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,?,0,0)").run("q1", "2026-10-29T00:00:00.000Z", "2026-10-29T00:00:00.000Z", hashOf("qb"));
    // 世界投影里仍有这两行（否则会被判成「本地缺失」→ purge，语义不同）；标记只来自 remotePurged。
    const marked = stateFor(ids);
    marked.remotePurged = ["n1", "q1"];
    marked.quickNotes.items = [{ id: "q1", createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z", contentHash: hashOf("qb") }];
    await store.saveState(marked);
    expect(((await db.prepare("SELECT cloud_deleted FROM notes WHERE id=?").get("n1")) as { cloud_deleted: number }).cloud_deleted).toBe(1);
    expect(((await db.prepare("SELECT cloud_deleted FROM quick_notes WHERE id=?").get("q1")) as { cloud_deleted: number }).cloud_deleted).toBe(1);
    // 下一轮：不在集合里 ⇒ 标记清掉（恢复/远端复活后标记失效，旧实现同口径）
    const cleared = stateFor(ids);
    cleared.quickNotes.items = [{ id: "q1", createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z", contentHash: hashOf("qb") }];
    await store.saveState(cleared);
    expect(((await db.prepare("SELECT cloud_deleted FROM notes WHERE id=?").get("n1")) as { cloud_deleted: number }).cloud_deleted).toBe(0);
    expect(((await db.prepare("SELECT cloud_deleted FROM quick_notes WHERE id=?").get("q1")) as { cloud_deleted: number }).cloud_deleted).toBe(0);
    await db.close();
  }, 120_000);
});
