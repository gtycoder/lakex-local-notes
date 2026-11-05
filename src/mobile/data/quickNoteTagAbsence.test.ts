/**
 * 261105 标签「删除 = 缺席」移动端落地：
 * - 删除 = 物理删行 + 清关联/版本 + 记本机待删（**不再写 `deleted_at` 墓碑**）；
 * - 删除后同名重建必须成功（旧墓碑行不能撞主键）；
 * - 旧库一次性迁移：`deleted_at` 墓碑 → 物理删 + 并入待删 + 置 `tag_absent_migrated`。
 *
 * ⚠️ 这份用例里的 `deleted_at` 只模拟「迁移之前的历史行」，正常路径不再产生该字段。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

const indexSpy = vi.hoisted(() => vi.fn(async (_db: unknown, _id: string, _force?: boolean) => undefined));
vi.mock("./quickNotesSearch.js", () => ({ indexQuickNote: indexSpy }));
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
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { quickNoteTagId } from "../../core/quickNoteTags.js";
import {
  PENDING_TAG_DELETES_KEY,
  TAG_ABSENCE_MIGRATED_KEY,
  addPendingTagDeletes,
  createQuickNoteTag,
  ensureQuickNoteTag,
  listPendingTagDeletes,
  listQuickNoteTags,
  migrateTagAbsence,
  settlePendingTagDeletes,
} from "./quickNoteTagsRepository.js";
import { mobileQuickNoteTags } from "./quickNoteTagService.js";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertQuickNote(db: SqlJsAsyncDb, id: string) {
  await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,?,0,0)")
    .run(id, T1, T1, "hash-" + id);
}

/** 只用于模拟「迁移前」的历史墓碑行。 */
async function insertLegacyTombstone(db: SqlJsAsyncDb, id: string, name: string, at: string) {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,0,?,?,?)")
    .run(id, name, T1, at, at);
}

describe("标签删除 = 缺席（移动端）", () => {
  it("删除后同名重建成功（物理删行，不会撞主键）", async () => {
    const db = await freshDb();
    try {
      const first = await createQuickNoteTag(db, "工作");
      await mobileQuickNoteTags.delete(db, first.id);
      expect(await db.prepare("SELECT 1 FROM tags WHERE id=?").get(first.id)).toBeUndefined();
      // 删除后同名再建：必须成功（旧实现写墓碑 + 再 INSERT 会 UNIQUE constraint failed: tags.id）
      const again = await createQuickNoteTag(db, "工作");
      expect(again.id).toBe(first.id);
      expect((await listQuickNoteTags(db)).map((tag) => tag.name)).toEqual(["工作"]);
      expect(await db.prepare("SELECT deleted_at FROM tags WHERE id=?").get(first.id)).toMatchObject({ deleted_at: null });
    } finally { await db.close(); }
  });

  it("旧库残留墓碑行（迁移未跑）时同名重建不撞主键（upsert 复活）", async () => {
    const db = await freshDb();
    try {
      const id = quickNoteTagId("工作");
      await insertLegacyTombstone(db, id, "工作", T2);
      const tag = await ensureQuickNoteTag(db, "工作", T2);
      expect(tag.id).toBe(id);
      expect(await db.prepare("SELECT deleted_at FROM tags WHERE id=?").get(id)).toMatchObject({ deleted_at: null });
    } finally { await db.close(); }
  });

  it("删除：清关联/版本 + 记本机待删（pendingTagDeletes）", async () => {
    const db = await freshDb();
    try {
      await insertQuickNote(db, "q1");
      const tag = await createQuickNoteTag(db, "待办");
      await db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q1',?,0)").run(tag.id);
      indexSpy.mockClear();
      const result = await mobileQuickNoteTags.delete(db, tag.id);
      expect(result.updated).toBe(1);
      expect(await db.prepare("SELECT 1 FROM tags WHERE id=?").get(tag.id)).toBeUndefined();
      expect(await db.prepare("SELECT tag_id FROM tag_links WHERE tag_id=?").all(tag.id)).toEqual([]);
      const version = await db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind='quickNote' AND target_id='q1'").get() as { links_updated_at?: string } | undefined;
      expect(version?.links_updated_at).toBeTruthy();
      expect(await listPendingTagDeletes(db)).toEqual([tag.id]);
      expect(indexSpy.mock.calls.map((call) => call[1])).toEqual(["q1"]);
      // 删除不存在的标签：明确报错（不静默）
      await expect(mobileQuickNoteTags.delete(db, tag.id)).rejects.toThrow("标签不存在或已删除");
    } finally { await db.close(); }
  });

  it("合并：源标签物理消失并进本机待删，关联改指向目标", async () => {
    const db = await freshDb();
    try {
      await insertQuickNote(db, "q1");
      const source = await createQuickNoteTag(db, "旧");
      const target = await createQuickNoteTag(db, "新");
      await db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q1',?,0)").run(source.id);
      await mobileQuickNoteTags.merge(db, source.id, target.id);
      expect(await db.prepare("SELECT 1 FROM tags WHERE id=?").get(source.id)).toBeUndefined();
      const links = await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id='q1'").all() as Array<{ tag_id: string }>;
      expect(links.map((row) => row.tag_id)).toEqual([target.id]);
      expect(await listPendingTagDeletes(db)).toEqual([source.id]);
    } finally { await db.close(); }
  });

  it("一次性迁移：墓碑行 → 物理删 + 并入待删 + 清关联/版本 + 置标记（幂等）", async () => {
    const db = await freshDb();
    try {
      await insertQuickNote(db, "q1");
      const active = await createQuickNoteTag(db, "保留");
      const deadId = quickNoteTagId("已删");
      await insertLegacyTombstone(db, deadId, "已删", T2);
      await db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q1',?,0)").run(deadId);
      const result = await migrateTagAbsence(db);
      expect(result.migrated).toEqual([deadId]);
      expect(result.noteIds).toEqual(["q1"]);
      expect(await db.prepare("SELECT 1 FROM tags WHERE id=?").get(deadId)).toBeUndefined();
      expect((await listQuickNoteTags(db)).map((tag) => tag.id)).toEqual([active.id]);
      expect(await db.prepare("SELECT tag_id FROM tag_links WHERE tag_id=?").all(deadId)).toEqual([]);
      expect(await listPendingTagDeletes(db)).toEqual([deadId]);
      expect(await db.prepare("SELECT value FROM device_state WHERE key=?").get(TAG_ABSENCE_MIGRATED_KEY)).toMatchObject({ value: "1" });
      // 幂等：第二次不再迁移（即便又插了墓碑行也不动它 —— 标记已置位）
      expect(await migrateTagAbsence(db)).toEqual({ migrated: [], noteIds: [] });
    } finally { await db.close(); }
  });

  it("待删集合：追加幂等（不抹掉已有项）", async () => {
    const db = await freshDb();
    try {
      await expect(listPendingTagDeletes(db)).resolves.toEqual([]);
      await addPendingTagDeletes(db, ["t_b", "t_a", "t_a"]);
      await expect(listPendingTagDeletes(db)).resolves.toEqual(["t_a", "t_b"]);
      // 再追加一项：既有两项必须保留（覆盖写会丢掉它们）
      await addPendingTagDeletes(db, ["t_c"]);
      await expect(listPendingTagDeletes(db)).resolves.toEqual(["t_a", "t_b", "t_c"]);
      await addPendingTagDeletes(db, []);
      await expect(listPendingTagDeletes(db)).resolves.toEqual(["t_a", "t_b", "t_c"]);
      // 坏数据当空集合
      await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(PENDING_TAG_DELETES_KEY, "not-json");
      await expect(listPendingTagDeletes(db)).resolves.toEqual([]);
    } finally { await db.close(); }
  });

  it("待删结算：只移除已确认缺席的 id，清空后删掉 device_state 行", async () => {
    const db = await freshDb();
    try {
      await addPendingTagDeletes(db, ["t_a", "t_b"]);
      await settlePendingTagDeletes(db, ["t_a"]);
      await expect(listPendingTagDeletes(db)).resolves.toEqual(["t_b"]);
      await settlePendingTagDeletes(db, ["t_zzz"]);
      await expect(listPendingTagDeletes(db)).resolves.toEqual(["t_b"]);
      await settlePendingTagDeletes(db, ["t_b"]);
      expect(await db.prepare("SELECT value FROM device_state WHERE key=?").get(PENDING_TAG_DELETES_KEY)).toBeUndefined();
      await expect(listPendingTagDeletes(db)).resolves.toEqual([]);
    } finally { await db.close(); }
  });
});
