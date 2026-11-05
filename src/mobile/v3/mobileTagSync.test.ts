/**
 * 移动端标签同步端口：**删除 = 缺席（261105 定稿）**。
 * - `listQuickTags` 只给 active 行（不含顺序、不含墓碑字段）；旧库残留的 `deleted_at` 行不得上云；
 * - `mergeQuickTags(tags, removedIds)`：upsert active + 对 removedIds **物理删行并清关联/版本**；
 * - `pendingTagDeletes`（device_state `tag_deleted`）：本机待删集合的读、追加（幂等）、结算（移除已确认缺席），供核心抑制远端重发；
 * - `applyQuickNoteTagLinks`：关系顺序是本机视图（远端新增插最前）+ `tagsUpdatedAt` LWW。
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
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { PENDING_TAG_DELETES_KEY } from "../data/quickNoteTagsRepository.js";
import { createMobilePlatformPort } from "./mobilePlatformPort.js";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";

async function freshPort() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return { db, port: createMobilePlatformPort(db) };
}

/** 只给"旧库残留墓碑行"用例用：正常路径不再产生 `deleted_at`。 */
async function insertLegacyTombstone(db: SqlJsAsyncDb, id: string, name: string, at: string) {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,0,?,?,?)")
    .run(id, name, T1, at, at);
}

async function insertTag(db: SqlJsAsyncDb, id: string, name: string, updatedAt: string, sortOrder = 0) {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,NULL)")
    .run(id, name, sortOrder, T1, updatedAt);
}

async function tagRow(db: SqlJsAsyncDb, id: string) {
  return await db.prepare("SELECT id,name,sort_order,updated_at FROM tags WHERE id=?").get(id) as
    { id: string; name: string; sort_order: number; updated_at: string } | undefined;
}

async function insertQuickNote(db: SqlJsAsyncDb, id: string) {
  await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,?,0,0)")
    .run(id, T1, T1, "hash-" + id);
}

describe("移动端标签同步端口（删除 = 缺席）", () => {
  it("listQuickTags：只返回 active 行（旧库残留墓碑不上云、不带顺序字段）", async () => {
    const { db, port } = await freshPort();
    try {
      await insertTag(db, "t_a", "A", T1);
      await insertLegacyTombstone(db, "t_del", "D", T2);
      const rows = await port.listQuickTags();
      expect(rows.map((row) => row.id)).toEqual(["t_a"]);
      const [first] = rows;
      expect("deletedAt" in first).toBe(false);
      expect("sortOrder" in first).toBe(false);
      expect("pinned" in first).toBe(false);
    } finally { await db.close(); }
  });

  it("mergeQuickTags：远端改名生效、新标签追加末尾、不动已有行本机 sort_order", async () => {
    const { db, port } = await freshPort();
    try {
      await insertTag(db, "t_a", "旧名", T1, 0);
      await insertTag(db, "t_b", "B", T1, 1);
      await port.mergeQuickTags([
        { id: "t_a", name: "新名", createdAt: T1, updatedAt: T2 },
        { id: "t_new", name: "新标签", createdAt: T2, updatedAt: T2 },
      ]);
      expect(await tagRow(db, "t_a")).toMatchObject({ name: "新名", sort_order: 0 });
      expect(await tagRow(db, "t_b")).toMatchObject({ name: "B", sort_order: 1 });
      expect((await tagRow(db, "t_new"))?.sort_order).toBe(2);
    } finally { await db.close(); }
  });

  it("mergeQuickTags(removedIds)：物理删行 + 清关联/版本；不存在的 id 是 no-op", async () => {
    const { db, port } = await freshPort();
    try {
      const delId = "t_0000000000000009";
      await insertQuickNote(db, "q3");
      await insertTag(db, delId, "D", T1);
      await db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q3',?,0)").run(delId);
      await port.mergeQuickTags([], [delId, "t_00000000000000ff"]);
      expect(await tagRow(db, delId)).toBeUndefined();
      expect(await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id='q3'").all()).toEqual([]);
      const version = await db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind='quickNote' AND target_id='q3'").get() as { links_updated_at?: string } | undefined;
      expect(version?.links_updated_at).toBeTruthy();
      // 幂等：重复删除不再报错
      await port.mergeQuickTags([], [delId]);
    } finally { await db.close(); }
  });

  it("pendingTagDeletes：**追加**幂等（不清空既有集合，同步期间新删的不会被抹掉）", async () => {
    const { db, port } = await freshPort();
    try {
      expect(await port.listPendingTagDeletes!()).toEqual([]);
      // 追加：去重 + 排序；重复追加不产生重复项，也不会覆盖掉已有项
      await port.addPendingTagDeletes!(["t_b", "t_a", "t_a"]);
      expect(await port.listPendingTagDeletes!()).toEqual(["t_a", "t_b"]);
      await port.addPendingTagDeletes!(["t_c"]);
      expect(await port.listPendingTagDeletes!()).toEqual(["t_a", "t_b", "t_c"]);
      await port.addPendingTagDeletes!(["t_b"]);
      expect(await port.listPendingTagDeletes!()).toEqual(["t_a", "t_b", "t_c"]);
      await port.addPendingTagDeletes!([]);
      expect(await port.listPendingTagDeletes!()).toEqual(["t_a", "t_b", "t_c"]);
      // 坏 JSON 当空集合（不抛错）
      await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(PENDING_TAG_DELETES_KEY, "{bad");
      expect(await port.listPendingTagDeletes!()).toEqual([]);
    } finally { await db.close(); }
  });

  it("pendingTagDeletes：**结算**只移除指定项，清空后删掉 device_state 行", async () => {
    const { db, port } = await freshPort();
    try {
      await port.addPendingTagDeletes!(["t_a", "t_b", "t_c"]);
      await port.settlePendingTagDeletes!(["t_b"]);
      expect(await port.listPendingTagDeletes!()).toEqual(["t_a", "t_c"]);
      // 结算不存在的 id 是 no-op；空数组不做事
      await port.settlePendingTagDeletes!(["t_zzz"]);
      expect(await port.listPendingTagDeletes!()).toEqual(["t_a", "t_c"]);
      await port.settlePendingTagDeletes!([]);
      expect(await port.listPendingTagDeletes!()).toEqual(["t_a", "t_c"]);
      await port.settlePendingTagDeletes!(["t_a", "t_c"]);
      expect(await db.prepare("SELECT value FROM device_state WHERE key=?").get(PENDING_TAG_DELETES_KEY)).toBeUndefined();
      expect(await port.listPendingTagDeletes!()).toEqual([]);
    } finally { await db.close(); }
  });

  it("applyQuickNoteTagLinks：关系顺序本机保留，远端新增插到最前", async () => {
    const { db, port } = await freshPort();
    try {
      await insertQuickNote(db, "q2");
      await insertTag(db, "t_000000000000000a", "A", T1);
      await insertTag(db, "t_000000000000000b", "B", T1);
      await db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q2','t_000000000000000b',0)").run();
      await db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q2','t_000000000000000a',1)").run();
      await port.applyQuickNoteTagLinks("q2", ["t_000000000000000a", "t_000000000000000b", "t_000000000000000c"], T2);
      const links = await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id='q2' ORDER BY position").all() as Array<{ tag_id: string }>;
      expect(links.map((row) => row.tag_id)).toEqual(["t_000000000000000c", "t_000000000000000b", "t_000000000000000a"]);
    } finally { await db.close(); }
  });

  it("applyQuickNoteTagLinks：过滤旧库墓碑/非法 ID/超上限，按 tagsUpdatedAt LWW 落库", async () => {
    const { db, port } = await freshPort();
    try {
      await insertQuickNote(db, "q1");
      const okId = "t_0000000000000001";
      const delId = "t_0000000000000002";
      await insertTag(db, okId, "OK", T1);
      // 迁移未跑完的旧库：目录里可能还留着墓碑行，关系应用时不得写入。
      await insertLegacyTombstone(db, delId, "D", T2);
      const many = Array.from({ length: 25 }, (_, index) => "t_" + "0123456789abcdef".slice(0, 12) + index.toString(16).padStart(4, "0"));
      const valid = many.filter((id) => /^t_[a-f0-9]{16}$/.test(id));
      // 旧版本/旧索引可能存在非 t_ 形态的 ID：**保留**（按正则过滤会静默丢关联）；只过滤空串/墓碑/重复并截断。
      await port.applyQuickNoteTagLinks("q1", [okId, delId, "legacy-id", "", ...valid], T2);
      const links = await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind=? AND target_id=? ORDER BY position").all("quickNote", "q1") as Array<{ tag_id: string }>;
      expect(links.map((row) => row.tag_id)).toEqual([okId, "legacy-id", ...valid].slice(0, 20));
      const version = await db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind=? AND target_id=?").get("quickNote", "q1") as { links_updated_at: string };
      expect(version.links_updated_at).toBe(T2);
      // 远端更旧的版本不得覆盖（LWW）
      await port.applyQuickNoteTagLinks("q1", [delId], T1);
      const after = await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind=? AND target_id=?").all("quickNote", "q1") as Array<{ tag_id: string }>;
      expect(after.map((row) => row.tag_id)).toContain(okId);
    } finally { await db.close(); }
  });
});
