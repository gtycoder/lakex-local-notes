/**
 * 261105 审计修复：移动端标签同步端口的三处语义（旧实现与桌面不一致）。
 * - `listQuickTags` 必须带 `pinned` 与墓碑（旧实现 `WHERE deleted_at IS NULL` + `pinned:false`）；
 * - `mergeQuickTags` 必须走 LWW（旧实现固定 `pinned=0`、`deleted_at=NULL` ⇒ 置顶清零 + 墓碑复活）；
 * - `applyQuickNoteTagLinks` 必须过滤墓碑/非法 ID/超上限，并按 `tagsUpdatedAt` LWW 落库。
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
import { createMobilePlatformPort } from "./mobilePlatformPort.js";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";

async function freshPort() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return { db, port: createMobilePlatformPort(db) };
}

async function insertTag(db: SqlJsAsyncDb, id: string, name: string, sortOrder: number, pinned: boolean, updatedAt: string, deletedAt: string | null = null) {
  await db.prepare("INSERT INTO tags (id,name,sort_order,pinned,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, name, sortOrder, pinned ? 1 : 0, T1, updatedAt, deletedAt);
}

async function tagRow(db: SqlJsAsyncDb, id: string) {
  return await db.prepare("SELECT id,name,sort_order,pinned,updated_at,deleted_at FROM tags WHERE id=?").get(id) as
    { id: string; name: string; sort_order: number; pinned: number; updated_at: string; deleted_at: string | null } | undefined;
}

describe("移动端标签同步端口（261105 审计修复）", () => {
  it("listQuickTags 带 pinned 与墓碑（旧实现过滤墓碑且 pinned 恒 false）", async () => {
    const { db, port } = await freshPort();
    try {
      await insertTag(db, "t_a", "A", 0, true, T1);
      await insertTag(db, "t_del", "D", 1, false, T2, T2);
      const rows = await port.listQuickTags();
      const byId = new Map(rows.map((row) => [row.id, row] as const));
      expect(byId.get("t_a")).toMatchObject({ pinned: true });
      expect(byId.get("t_del")?.deletedAt).toBe(T2);
    } finally { await db.close(); }
  });

  it("mergeQuickTags：远端改名/置顶生效、墓碑不复活、旧版本不覆盖新版本", async () => {
    const { db, port } = await freshPort();
    try {
      await insertTag(db, "t_a", "旧名", 0, false, T1);
      await insertTag(db, "t_del", "待删", 1, false, T1);
      await port.mergeQuickTags([
        { id: "t_a", name: "新名", sortOrder: 0, pinned: true, createdAt: T1, updatedAt: T2 },
        { id: "t_del", name: "待删", sortOrder: 1, pinned: false, createdAt: T1, updatedAt: T2, deletedAt: T2 },
        { id: "t_new", name: "新标签", sortOrder: 2, pinned: false, createdAt: T1, updatedAt: T1 },
      ]);
      expect(await tagRow(db, "t_a")).toMatchObject({ name: "新名", pinned: 1 });
      expect((await tagRow(db, "t_del"))?.deleted_at).toBe(T2);
      expect(await tagRow(db, "t_new")).toBeTruthy();
      // 反向：远端旧版本（active）不得复活本地墓碑（LWW 旧数据不覆盖新数据）
      await port.mergeQuickTags([{ id: "t_del", name: "待删", sortOrder: 1, pinned: false, createdAt: T1, updatedAt: T1, deletedAt: null }]);
      expect((await tagRow(db, "t_del"))?.deleted_at).toBe(T2);
    } finally { await db.close(); }
  });

  it("applyQuickNoteTagLinks：过滤墓碑/非法 ID/超上限，按 tagsUpdatedAt LWW 落库", async () => {
    const { db, port } = await freshPort();
    try {
      await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,?,0,0)")
        .run("q1", T1, T1, "hash-q1");
      const okId = "t_0000000000000001";
      const delId = "t_0000000000000002";
      await insertTag(db, okId, "OK", 0, false, T1);
      await insertTag(db, delId, "D", 1, false, T2, T2);
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
