/**
 * 261105 标签「删除 = 缺席」移动端落地：
 * - 删除 = 物理删行 + 清关联/版本 + 记本机待删（**不写 `deleted_at` 墓碑**）；
 * - 删除后同名重建必须成功（旧行已物理删除，不会撞主键）；
 * - 新库 tags 表**无墓碑列**（旧「deleted_at 墓碑」一次性迁移已删，261125 裁决）。
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
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDbWeb.js";
import { applyMobileSchema } from "./schema.js";
import { quickNoteTagId } from "../../core/quickNoteTags.js";
import {
  PENDING_TAG_DELETES_KEY,
  addPendingTagDeletes,
  createQuickNoteTag,
  ensureQuickNoteTag,
  listPendingTagDeletes,
  listQuickNoteTags,
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

/** 造一行同 id 的残留目录行（只用于「同名重建不撞主键」用例；正常路径由 ensure 自己写入）。 */
async function insertTagRow(db: SqlJsAsyncDb, id: string, name: string, at: string) {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at) VALUES (?,?,0,?,?)")
    .run(id, name, T1, at);
}

describe("标签删除 = 缺席（移动端）", () => {
  it("新库 tags 无墓碑列（deleted_at 一次性迁移已删，261125 裁决）", async () => {
    const db = await freshDb();
    try {
      const cols = await db.prepare("PRAGMA table_info(tags)").all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === "deleted_at")).toBe(false);
    } finally { await db.close(); }
  });

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
      expect(await db.prepare("SELECT name FROM tags WHERE id=?").get(first.id)).toMatchObject({ name: "工作" });
    } finally { await db.close(); }
  });

  it("同 id 残留行同名重建不撞主键（upsert 就地更新）", async () => {
    const db = await freshDb();
    try {
      const id = quickNoteTagId("工作");
      await insertTagRow(db, id, "残留", T2);
      const tag = await ensureQuickNoteTag(db, "工作", T2);
      expect(tag.id).toBe(id);
      expect(await db.prepare("SELECT name FROM tags WHERE id=?").get(id)).toMatchObject({ name: "工作" });
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
