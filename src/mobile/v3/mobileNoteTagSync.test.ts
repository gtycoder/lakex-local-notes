/**
 * 261105 P1：移动端文档标签字段搬运（关键，防清空）。
 * - listNotesSyncMeta 必须带 tagIds/tagsUpdatedAt（否则移动端发布 lake 索引会清空文档标签）；
 * - applyNoteTagLinks：关系版本 LWW + 保留本机顺序、远端新增插最前；旧版本/缺省不覆盖；
 * - 删除/合并标签与孤儿清理：文档关系与目录同库，一并收敛。
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
import { ensureV3StateTable } from "../data/v3StateRepository.js";
import { createMobilePlatformPort } from "./mobilePlatformPort.js";
import { mobileQuickNoteTags } from "../data/quickNoteTagService.js";
import { cleanupOrphanNoteTagLinks, listNoteTagIds } from "../data/noteTagLinksRepository.js";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const TA = "t_aaaaaaaaaaaaaaaa";
const TB = "t_bbbbbbbbbbbbbbbb";
const TC = "t_cccccccccccccccc";

async function freshPort() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  await ensureV3StateTable(db);
  await db.prepare("INSERT INTO notes (id,title,parent_id,updated_at,content_hash,is_dirty,trashed_at,restore_pending_at) VALUES ('n1','Doc',NULL,?,?,0,NULL,NULL)")
    .run(T1, "hash-n1");
  return { db, port: createMobilePlatformPort(db) };
}

async function insertTag(db: SqlJsAsyncDb, id: string, name: string) {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at,deleted_at) VALUES (?,?,0,?,?,NULL)").run(id, name, T1, T1);
}

async function setNoteTagsRow(db: SqlJsAsyncDb, tagIds: string[], at: string, order?: string[]) {
  const finalOrder = order ?? tagIds;
  await db.prepare("DELETE FROM tag_links WHERE target_kind='note' AND target_id='n1'").run();
  for (let index = 0; index < finalOrder.length; index += 1) {
    await db.prepare("INSERT INTO tag_links(target_kind,target_id,tag_id,position) VALUES('note','n1',?,?)").run(finalOrder[index], index);
  }
  await db.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES('note','n1',?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(at);
}

describe("移动端文档标签同步端口（261105 P1）", () => {
  it("listNotesSyncMeta 搬运 tagIds（本机顺序）+ tagsUpdatedAt（否则发布 lake 索引会清空文档标签）", async () => {
    const { db, port } = await freshPort();
    try {
      await setNoteTagsRow(db, [TA, TB], T2);
      const rows = await port.listNotesSyncMeta();
      const row = rows.find((item) => item.id === "n1")!;
      expect(row.tagIds).toEqual([TA, TB]);
      expect(row.tagsUpdatedAt).toBe(T2);
    } finally { await db.close(); }
  });

  it("applyNoteTagLinks：版本 LWW + 保留本机顺序、远端新增插最前；旧版本不清空", async () => {
    const { db, port } = await freshPort();
    try {
      await setNoteTagsRow(db, [TB], T1);
      // 旧版本：不动（缺省/旧索引不清空）
      await port.applyNoteTagLinks!("n1", [TC], T1);
      expect(await listNoteTagIds(db, "n1")).toEqual([TB]);
      // 新版本：本机 TB 保留、远端新增 TC 插最前
      await port.applyNoteTagLinks!("n1", [TC, TB], T2);
      expect(await listNoteTagIds(db, "n1")).toEqual([TC, TB]);
    } finally { await db.close(); }
  });

  it("删除/合并标签：文档关系同库一并收敛（删除清关系、合并改指向）", async () => {
    const { db } = await freshPort();
    try {
      await insertTag(db, TA, "A");
      await insertTag(db, TB, "B");
      await setNoteTagsRow(db, [TA, TB], T1);
      await mobileQuickNoteTags.merge(db, TA, TB);
      expect(await listNoteTagIds(db, "n1")).toEqual([TB]);
      await mobileQuickNoteTags.delete(db, TB);
      expect(await listNoteTagIds(db, "n1")).toEqual([]);
    } finally { await db.close(); }
  });

  it("孤儿清理：关系指向目录不存在的标签 ⇒ 删除并推进关系版本", async () => {
    const { db } = await freshPort();
    try {
      await insertTag(db, TA, "A");
      await setNoteTagsRow(db, [TA, TB], T1);
      const cleaned = await cleanupOrphanNoteTagLinks(db, new Set([TA]), T2);
      expect(cleaned).toBe(1);
      expect(await listNoteTagIds(db, "n1")).toEqual([TA]);
      const version = await db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind='note' AND target_id='n1'").get() as { links_updated_at: string };
      expect(version.links_updated_at).toBe(T2);
    } finally { await db.close(); }
  });
});
