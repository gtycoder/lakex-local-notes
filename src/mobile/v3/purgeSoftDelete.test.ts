/**
 * 移动端「远端 purge → 保留云端已删除（仅本地）副本」（261112 task-74 移动侧回归）。
 *
 * 背景：core 在「本机有、本轮状态没有」的收敛路径调用端口可选能力 purgeLocalNote。
 * 旧移动实现把它当成本机显式 purge：写 deleted_notes 墓碑 + 物理删行/正文 ⇒ 仅本地副本被抹掉，
 * 违反 AGENTS §3#5（被他端判定缺失的副本必须保留在回收站、可恢复、不参与 S3）。
 * 契约（移动侧，不改 core/桌面）：
 *  ① purgeLocalNote = **软删保副本**：trashed_at 置位、cloud_deleted=1、deleted_from_parent_id=原父、
 *     正文文件仍在、不写 deleted_notes 墓碑；
 *  ② 显式恢复（回收站「恢复」）清 trashed_at + cloud_deleted + deleted_from_parent_id，父级归位；
 *  ③ 正文全程可读（副本可恢复）。
 */
import { describe, expect, it, vi } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote } from "../data/noteRepository.js";
import { listTrashed } from "../data/noteRepository.js";
import { readNoteBody } from "../data/noteBodies.js";
import { restoreTreeItem } from "../data/trashRepository.js";
import { createMobilePlatformPort } from "./mobilePlatformPort.js";

// port 模块会 import 原生资产端口：测试里给最小桩（本用例不触碰资产）。
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {},
  loadAssetBytesFs: async () => null,
  listAssetKeysFs: async () => [],
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  removeAssetBytesFs: async () => {},
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

const rowOf = async (db: SqlJsAsyncDb, id: string) =>
  await db.prepare("SELECT parent_id, trashed_at, deleted_from_parent_id, cloud_deleted, is_dirty, restore_pending_at FROM notes WHERE id=?").get(id) as
    | { parent_id: string | null; trashed_at: string | null; deleted_from_parent_id: string | null; cloud_deleted: number; is_dirty: number; restore_pending_at: string | null }
    | undefined;

describe("task-74：远端 purge 的收敛删除 = 保留仅本地回收站副本（移动侧）", () => {
  it("purgeLocalNote：软删进回收站 + cloud_deleted + 保留正文/父级；不写墓碑", async () => {
    const db = await freshDb();
    try {
      await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,updated_at,is_dirty) VALUES ('nb1','本子',NULL,0,'notebook','2026-11-12T00:00:00.000Z',1)").run();
      await createNote(db, "n1", "文档一", "<p>正文一</p>", "nb1", new Map());
      const port = createMobilePlatformPort(db);
      await port.purgeLocalNote!("n1");
      const row = (await rowOf(db, "n1"))!;
      expect(row.trashed_at).not.toBeNull();
      expect(row.cloud_deleted).toBe(1);
      expect(row.deleted_from_parent_id).toBe("nb1");
      expect(row.is_dirty).toBe(0);
      expect(row.restore_pending_at).toBeNull();
      // 副本正文可读（未被物理删）
      expect(await readNoteBody("doc", "n1")).toBe("<p>正文一</p>");
      // 不写 deleted_notes 墓碑（草稿副本 ≠ 不可恢复删除）
      const tomb = await db.prepare("SELECT COUNT(*) AS c FROM deleted_notes WHERE id='n1'").get() as { c: number } | undefined;
      expect(tomb?.c ?? 0).toBe(0);
      // 回收站列表可见（仅本地副本）
      expect((await listTrashed(db)).some((n) => n.id === "n1")).toBe(true);
    } finally { await db.close(); }
  });

  it("显式恢复：清 trashed_at/cloud_deleted/deleted_from_parent_id，父级归位，正文仍可读", async () => {
    const db = await freshDb();
    try {
      await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,updated_at,is_dirty) VALUES ('nb1','本子',NULL,0,'notebook','2026-11-12T00:00:00.000Z',1)").run();
      await createNote(db, "n1", "文档一", "<p>正文一</p>", "nb1", new Map());
      const port = createMobilePlatformPort(db);
      await port.purgeLocalNote!("n1");
      await restoreTreeItem(db, "n1", "note", async () => {});
      const row = (await rowOf(db, "n1"))!;
      expect(row.trashed_at).toBeNull();
      expect(row.cloud_deleted).toBe(0);
      expect(row.deleted_from_parent_id).toBeNull();
      expect(row.parent_id).toBe("nb1");
      expect(row.restore_pending_at).not.toBeNull(); // 恢复 = local-wins 重传的显式例外
      expect(await readNoteBody("doc", "n1")).toBe("<p>正文一</p>");
    } finally { await db.close(); }
  });
});
