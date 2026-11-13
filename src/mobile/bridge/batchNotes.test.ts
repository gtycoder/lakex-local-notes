/**
 * 移动端批量操作桥（261106 task-82）——DB 级用例：
 * · 复用 core/batchNotes 编排（校验 + 结果契约），移动端只注入快照 executor + 单事务落地；
 * · trash 只做软删（文档进文档回收站 / 小记进小记回收站），行仍在（**无物理删除**）；
 * · tag-add = append（不覆盖已有顺序）、tag-remove = 只移除指定；
 * · 笔记本一律 notebook-not-batchable（防御）；非法 id 整批不执行。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

const indexSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../data/quickNotesSearch.js", () => ({ indexQuickNote: indexSpy }));
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
import { setNoteTags, listNoteTagIds } from "../data/noteTagLinksRepository.js";
import { listQuickNoteTagIds, setQuickNoteTags } from "../data/quickNoteTagLinksRepository.js";
import { runMobileBatchNotes } from "./batchNotes";

const T = "2026-11-01T00:00:00.000Z";
const TAG1 = "t_0000000000000001";
const TAG2 = "t_0000000000000002";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}
async function insertFolder(db: SqlJsAsyncDb, id: string, kind: "notebook" | "group", parentId: string | null = null): Promise<void> {
  await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,updated_at) VALUES (?,?,?,0,?,?)")
    .run(id, id, parentId, kind, T);
}
async function insertNote(db: SqlJsAsyncDb, id: string, parentId: string | null): Promise<void> {
  await db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,content_hash,is_dirty,is_purged,is_conflict) VALUES (?,?,?,0,?,'h',0,0,0)")
    .run(id, id, parentId, T);
}
async function insertQuick(db: SqlJsAsyncDb, id: string): Promise<void> {
  await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,'h',0,0)")
    .run(id, T, T);
}
async function insertTag(db: SqlJsAsyncDb, id: string, name: string): Promise<void> {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at) VALUES (?,?,0,?,?)").run(id, name, T, T);
}

describe("bridge.batchNotes（移动端批量：软删 + 标签 append/remove + 移动）", () => {
  it("trash(lake)：文档软删进回收站（行还在、deleted_at 有值、无物理删除）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook");
      await insertNote(db, "n1", "nb1");
      const result = await runMobileBatchNotes(db, { action: "trash", ids: ["n1"], space: "lake" });
      expect(result.ok).toBe(true);
      expect(result.summary).toEqual({ total: 1, done: 1, failed: 0 });
      // 文档的软删标记 = trashed_at（与单条 trashNote 同一列；行仍在，没有物理删除）
      const row = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get("n1") as { trashed_at: string | null } | undefined;
      expect(row).toBeTruthy();
      expect(row!.trashed_at).not.toBeNull();
    } finally { await db.close(); }
  });

  it("trash(lake)「父 + 子」同时选：返回整棵级联 ids（关标签用），顺序无关、恢复根回原父", async () => {
    for (const ids of [["p", "c"], ["c", "p"]] as const) {
      const db = await freshDb();
      try {
        await insertFolder(db, "nb1", "notebook");
        await insertNote(db, "p", "nb1");
        await insertNote(db, "c", "p");
        await insertNote(db, "gc", "c");
        await insertNote(db, "sib", "nb1");
        const result = await runMobileBatchNotes(db, { action: "trash", ids: [...ids], space: "lake" });
        expect(result.ok).toBe(true);
        // 结果是**本次真正被软删的整棵子树 ids**（含孙文档），与选择顺序无关；去重后集合一致。
        expect(new Set(result.trashedNoteIds)).toEqual(new Set(["p", "c", "gc"]));
        for (const id of ["p", "c", "gc"]) {
          const row = await db.prepare("SELECT trashed_at, parent_id FROM notes WHERE id=?").get(id) as { trashed_at: string | null; parent_id: string | null };
          expect(row.trashed_at).toBeTruthy();
        }
        expect((await db.prepare("SELECT trashed_at FROM notes WHERE id='sib'").get() as { trashed_at: string | null }).trashed_at).toBeNull();
        expect((await db.prepare("SELECT parent_id FROM notes WHERE id='c'").get() as { parent_id: string }).parent_id).toBe("p");
      } finally { await db.close(); }
    }
  });

  it("trash 校验失败（混入不存在 id）：整批不执行、trashedNoteIds 为空（不假装成功）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook");
      await insertNote(db, "n1", "nb1");
      const result = await runMobileBatchNotes(db, { action: "trash", ids: ["n1", "missing"], space: "lake" });
      expect(result.ok).toBe(false);
      expect(result.trashedNoteIds).toEqual([]);
      const row = await db.prepare("SELECT trashed_at FROM notes WHERE id='n1'").get() as { trashed_at: string | null };
      expect(row.trashed_at).toBeNull();
    } finally { await db.close(); }
  });

  it("trash(quickNotes)：小记软删进小记回收站（quick_notes.deleted_at，行还在），trashedNoteIds 为空（无文档标签）", async () => {
    const db = await freshDb();
    try {
      await insertQuick(db, "q1");
      const result = await runMobileBatchNotes(db, { action: "trash", ids: ["q1"], space: "quickNotes" });
      expect(result.ok).toBe(true);
      const row = await db.prepare("SELECT deleted_at FROM quick_notes WHERE id=?").get("q1") as { deleted_at: string | null };
      expect(row).toBeTruthy();
      expect(row.deleted_at).not.toBeNull();
      expect(result.trashedNoteIds).toEqual([]);
    } finally { await db.close(); }
  });

  it("tag-add(lake)：append 合并（保留已有顺序，不覆盖）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook");
      await insertNote(db, "n1", "nb1");
      await insertTag(db, TAG1, "工作");
      await insertTag(db, TAG2, "灵感");
      await setNoteTags(db, "n1", [TAG1]);
      const result = await runMobileBatchNotes(db, { action: "tag-add", ids: ["n1"], space: "lake", tagIds: [TAG2] });
      expect(result.ok).toBe(true);
      expect(await listNoteTagIds(db, "n1")).toEqual([TAG1, TAG2]);
      // 幂等：再加一次不变
      await runMobileBatchNotes(db, { action: "tag-add", ids: ["n1"], space: "lake", tagIds: [TAG2] });
      expect(await listNoteTagIds(db, "n1")).toEqual([TAG1, TAG2]);
    } finally { await db.close(); }
  });

  it("tag-remove(quickNotes)：只移除指定标签，其余保留", async () => {
    const db = await freshDb();
    try {
      await insertQuick(db, "q1");
      await insertTag(db, TAG1, "工作");
      await insertTag(db, TAG2, "灵感");
      await setQuickNoteTags(db, "q1", [TAG2, TAG1]);
      const result = await runMobileBatchNotes(db, { action: "tag-remove", ids: ["q1"], space: "quickNotes", tagIds: [TAG1] });
      expect(result.ok).toBe(true);
      expect(await listQuickNoteTagIds(db, "q1")).toEqual([TAG2]);
    } finally { await db.close(); }
  });

  it("笔记本不可批处理；不存在的 id 整批不执行（结果逐条给 reason）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook");
      await insertNote(db, "n1", "nb1");
      const notebook = await runMobileBatchNotes(db, { action: "trash", ids: ["nb1"], space: "lake" });
      expect(notebook.ok).toBe(false);
      expect(notebook.results[0]).toMatchObject({ id: "nb1", ok: false, reason: "notebook-not-batchable" });

      const mixed = await runMobileBatchNotes(db, { action: "trash", ids: ["n1", "missing"], space: "lake" });
      expect(mixed.ok).toBe(false);
      expect(mixed.results.find((r) => r.id === "missing")).toMatchObject({ ok: false, reason: "not-found" });
      // 整批未执行：n1 仍在正常目录
      const row = await db.prepare("SELECT trashed_at FROM notes WHERE id=?").get("n1") as { trashed_at: string | null } | undefined;
      expect(row!.trashed_at).toBeNull();
    } finally { await db.close(); }
  });

  it("move(lake)：改父级并追加到目标末尾；超过上限 / 非法输入给契约 reason", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook");
      await insertFolder(db, "g1", "group", "nb1");
      await insertNote(db, "n1", "nb1");
      const moved = await runMobileBatchNotes(db, { action: "move", ids: ["n1"], space: "lake", parentId: "g1" });
      expect(moved.ok).toBe(true);
      const row = await db.prepare("SELECT parent_id FROM notes WHERE id=?").get("n1") as { parent_id: string };
      expect(row.parent_id).toBe("g1");

      const tooMany = await runMobileBatchNotes(db, { action: "trash", ids: Array.from({ length: 501 }, (_, i) => "n" + i), space: "lake" });
      expect(tooMany.ok).toBe(false);
      expect(tooMany.reason).toBe("too-many-ids");

      const bad = await runMobileBatchNotes(db, { action: "trash", ids: "nope" as never, space: "lake" });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe("invalid-input");
    } finally { await db.close(); }
  });
});
