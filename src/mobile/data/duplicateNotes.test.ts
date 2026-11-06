/**
 * 移动端「创建副本」数据层（261106 task-6）——真 sql.js 库 + 内存资源替身：
 * · 新 id / 走 createNote 管线 / 标题 = 原名称 + " 副本 " + 本地时间（core 单一来源）；
 * · 同父级紧邻源之后（sort_order = 源 + 1，其后同级整体 +1，notes 与 folders 两张表）；
 * · 正文资源 URL 里的原 noteId 重写成新 id；note-assets/{源}/* 全量复制且源不被改动；
 * · 标签关系复制且**写新版本**；历史/锁定/回收站状态不复制；
 * · 条目级拒绝 reason（not-found / unsupported / already-trashed / body-missing）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

/** 内存资源替身：键 = "{noteId}/{filename}"（App 私有目录路径契约 note-assets/{noteId}/{filename} 由 assetFs 内部拼接）。 */
const assetStore = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), failSaveKey: null as string | null }));
const nativeCopy = vi.hoisted(() => ({ result: null as number | null }));
vi.mock("../native/assetFs", () => ({
  copyNoteAssetsDirNativeFs: async () => nativeCopy.result,
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => {
    if (assetStore.failSaveKey && key.includes(assetStore.failSaveKey)) throw new Error("磁盘写入失败: " + key);
    assetStore.files.set(key, new Uint8Array(bytes));
  },
  loadAssetBytesFs: async (key: string) => assetStore.files.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetStore.files.delete(key); },
  listNoteAssetKeysFs: async (noteId: string) => [...assetStore.files.keys()].filter((key) => key.startsWith(noteId + "/")),
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  statNoteAssetSizesFs: async () => null,
  removeNoteAssetsDirFs: async (noteId: string) => {
    for (const key of [...assetStore.files.keys()]) if (key.startsWith(noteId + "/")) assetStore.files.delete(key);
  },
  removeQuickNoteAssetsDirFs: async () => {},
}));

import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { createNote, readNote } from "./noteRepository.js";
import { deleteNoteBodies } from "./noteBodies.js";
import { listNoteTagIds, noteTagsUpdatedAt, setNoteTags } from "./noteTagLinksRepository.js";
import { DuplicateNoteError, duplicateNote } from "./duplicateNotes";

const T = "2026-11-01T00:00:00.000Z";
const NOW = new Date(2026, 10, 6, 9, 8, 7); // 2026-11-06 09:08:07（本地时间，标题口径）
const TAG1 = "t_0000000000000001";
const TAG2 = "t_0000000000000002";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertFolder(db: SqlJsAsyncDb, id: string, sortOrder: number, parentId: string | null = null): Promise<void> {
  await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,updated_at) VALUES (?,?,?,?,?,?)")
    .run(id, id, parentId, sortOrder, "group", T);
}
async function insertRawNote(db: SqlJsAsyncDb, id: string, sortOrder: number, opts: { parentId?: string | null; trashed?: boolean } = {}): Promise<void> {
  await db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,content_hash,is_dirty,is_purged,trashed_at) VALUES (?,?,?,?,?,?,0,0,?)")
    .run(id, id, opts.parentId ?? null, sortOrder, T, "h", opts.trashed ? T : null);
}
async function insertQuickNote(db: SqlJsAsyncDb, id: string): Promise<void> {
  await db.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES (?,?,?,'',0,'h',0,0)")
    .run(id, T, T);
}
async function insertTag(db: SqlJsAsyncDb, id: string, name: string): Promise<void> {
  await db.prepare("INSERT INTO tags (id,name,sort_order,created_at,updated_at) VALUES (?,?,0,?,?)").run(id, name, T, T);
}
async function sortOrderOf(db: SqlJsAsyncDb, id: string): Promise<number> {
  const row = await db.prepare("SELECT sort_order FROM notes WHERE id=?").get(id) as { sort_order: number } | undefined;
  return Number(row?.sort_order);
}
async function folderSortOrderOf(db: SqlJsAsyncDb, id: string): Promise<number> {
  const row = await db.prepare("SELECT sort_order FROM folders WHERE id=?").get(id) as { sort_order: number } | undefined;
  return Number(row?.sort_order);
}
async function newIdCount(db: SqlJsAsyncDb, exclude: readonly string[]): Promise<number> {
  const rows = await db.prepare("SELECT id FROM notes").all() as Array<{ id: string }>;
  return rows.filter((row) => !exclude.includes(String(row.id))).length;
}

const BODY = [
  '<p>正文</p>',
  '<img src="http://127.0.0.1:19876/src1/a.png">',
  '<img src="lake-asset://src1/b.png">',
  '<a href="/note-assets/src1/c.png">附件</a>',
  // 百分号编码形态（Lake 图片/文件卡 value = data: 套 JSON 再整体编码）：副本必须一起重写。
  "<i>%2Fsrc1%2Fa.png</i>",
].join("");

function prepareAssetStore(): void {
  assetStore.files.clear();
  assetStore.failSaveKey = null;
  nativeCopy.result = null;
  assetStore.files.set("src1/a.png", new Uint8Array([1, 2, 3]));
  assetStore.files.set("src1/b.png", new Uint8Array([4, 5]));
  assetStore.files.set("src1/tmp.png.tmp", new Uint8Array([9]));
}

describe("duplicateNote（移动端数据层）", () => {
  it("新建副本：新 id、同父级紧邻源之后、标题带本地时间、正文 URL 重写、资源全量复制", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", 0);
      await createNote(db, "src1", "周报", BODY, "nb1", new Map());
      await db.prepare("UPDATE notes SET sort_order=2 WHERE id=?").run("src1");
      await insertRawNote(db, "n2", 4, { parentId: "nb1" });
      await insertFolder(db, "g1", 3, "nb1");
      prepareAssetStore();

      const created = await duplicateNote(db, "src1", { now: NOW });

      // 新 id + 标题（core 单一来源，本地时间 YYYY-MM-DD HH:mm:ss）
      expect(created.id).not.toBe("src1");
      const copy = await readNote(db, created.id);
      expect(copy).not.toBeNull();
      expect(copy!.title).toBe("周报 副本 2026-11-06 09:08:07");
      expect(copy!.parentId).toBe("nb1");
      // 紧邻源之后：整组同级按显示顺序重编号 0..n-1（源(2) → g1(3) → n2(4) 的相对顺序不变）
      expect(await sortOrderOf(db, created.id)).toBe(1);
      expect(await sortOrderOf(db, "src1")).toBe(0);
      expect(await folderSortOrderOf(db, "g1")).toBe(2);
      expect(await sortOrderOf(db, "n2")).toBe(3);
      // 正文 URL 里的原 noteId 段 → 新 id；源正文不动
      expect(copy!.content).toContain("http://127.0.0.1:19876/" + created.id + "/a.png");
      expect(copy!.content).toContain("lake-asset://" + created.id + "/b.png");
      expect(copy!.content).toContain("/note-assets/" + created.id + "/c.png");
      expect(copy!.content).toContain("%2F" + created.id + "%2F");
      expect(copy!.content).not.toContain("src1");
      expect((await readNote(db, "src1"))!.content).toBe(BODY);
      // 资源全量复制到 note-assets/{新}/（同文件名、同字节）；.tmp 不复制；源资源不受影响
      expect([...assetStore.files.get(created.id + "/a.png")!]).toEqual([1, 2, 3]);
      expect([...assetStore.files.get(created.id + "/b.png")!]).toEqual([4, 5]);
      expect(assetStore.files.has(created.id + "/tmp.png.tmp")).toBe(false);
      expect(assetStore.files.has("src1/a.png")).toBe(true);
    } finally { await db.close(); }
  });

  it("原生目录拷贝可用 ⇒ 一次调用直接完成（字节不过桥，不走 JS 逐文件）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", 0);
      await createNote(db, "src1", "图文", "<p>x</p>", "nb1", new Map());
      prepareAssetStore();
      nativeCopy.result = 2; // 模拟 AssetSyncPlugin.copyAssetDir 返回
      const created = await duplicateNote(db, "src1", { now: NOW });
      expect(created.id).not.toBe("src1");
      // 原生路径不会写 JS 侧 assetStore（证明没有 load/save 字节过桥）
      expect(assetStore.files.has(created.id + "/a.png")).toBe(false);
      expect(assetStore.files.has(created.id + "/b.png")).toBe(false);
      expect(assetStore.files.has("src1/a.png")).toBe(true);
    } finally { nativeCopy.result = null; await db.close(); }
  });

  it("不复制历史 / 锁定 / 回收站状态；标签关系复制到新笔记且写新版本", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", 0);
      await createNote(db, "src1", "周报", "<p>v1</p>", "nb1", new Map());
      await db.prepare("UPDATE notes SET is_locked=1, locked_at=?, is_dirty=0 WHERE id=?").run(T, "src1");
      await db.prepare("INSERT INTO note_history (note_id,file_path,content_hash,title,created_at) VALUES (?,?,?,?,?)")
        .run("src1", "history/src1/1.body.gz", "hash", "周报", T);
      await insertTag(db, TAG1, "工作");
      await insertTag(db, TAG2, "灵感");
      await setNoteTags(db, "src1", [TAG1, TAG2], "2026-01-01T00:00:00.000Z");

      const created = await duplicateNote(db, "src1", { now: NOW });

      const copyRow = await db.prepare("SELECT is_locked, locked_at, trashed_at, is_dirty FROM notes WHERE id=?").get(created.id) as
        { is_locked: number; locked_at: string | null; trashed_at: string | null; is_dirty: number };
      expect(Number(copyRow.is_locked)).toBe(0);
      expect(copyRow.locked_at).toBeNull();
      expect(copyRow.trashed_at).toBeNull();
      expect(Number(copyRow.is_dirty)).toBe(1); // 新建管线标脏 ⇒ 下次同步作为新对象上传
      const history = await db.prepare("SELECT COUNT(*) AS c FROM note_history WHERE note_id=?").get(created.id) as { c: number };
      expect(Number(history.c)).toBe(0);
      // 标签集合相同、顺序相同；版本是**新写的一份**（不照搬源版本）
      expect(await listNoteTagIds(db, created.id)).toEqual([TAG1, TAG2]);
      expect(await noteTagsUpdatedAt(db, created.id)).not.toBe("2026-01-01T00:00:00.000Z");
      expect(await noteTagsUpdatedAt(db, created.id)).not.toBe("");
    } finally { await db.close(); }
  });

  it("kind=doc：块 id 全量重映射（D 方案，副本与源同时挂载不串台）；非 doc 不重映射", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", 0);
      const blockBody = '<p id="u11111111">甲</p><p id="u22222222">乙</p>';
      await createNote(db, "src1", "块文档", blockBody, "nb1", new Map());
      const created = await duplicateNote(db, "src1", { now: NOW });
      const copy = await readNote(db, created.id);
      expect(copy).not.toBeNull();
      // 副本：旧块 id 一个不剩，仍保留同样数量的块 id 属性（结构不变）
      expect(copy!.content).not.toContain("u11111111");
      expect(copy!.content).not.toContain("u22222222");
      expect(copy!.content.match(/id="u[0-9a-f]{8}"/g) ?? []).toHaveLength(2);
      expect(copy!.content).toContain("甲");
      expect(copy!.content).toContain("乙");
      // 源正文逐字节不变
      expect((await readNote(db, "src1"))!.content).toBe(blockBody);

      // usheet 的正文是 JSON：不参与块 id 重映射（JSON 里 id 属性不会被改写）
      const sheetBody = '{"sheets":{"s1":{"name":"表","id":"u11111111"}}}';
      await createNote(db, "src2", "表格", sheetBody, "nb1", new Map(), undefined, "usheet");
      const sheetCopy = await duplicateNote(db, "src2", { now: NOW });
      expect((await readNote(db, sheetCopy.id))!.content).toBe(sheetBody);
    } finally { await db.close(); }
  });

  it("kind 沿源（usheet）复制：正文按 JSON 原样复制并重写资源 URL", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", 0);
      const sheetBody = '{"sheets":{"s1":{"name":"表"}},"logo":"/src1/logo.png"}';
      await createNote(db, "src1", "表格", sheetBody, "nb1", new Map(), undefined, "usheet");
      const created = await duplicateNote(db, "src1", { now: NOW });
      const copy = await readNote(db, created.id);
      expect(copy!.kind).toBe("usheet");
      expect(copy!.content).toContain(created.id + "/logo.png");
      const row = await db.prepare("SELECT doc_kind FROM notes WHERE id=?").get(created.id) as { doc_kind: string };
      expect(row.doc_kind).toBe("usheet");
    } finally { await db.close(); }
  });

  it("根层（parent_id IS NULL）也能插到源之后；回收站的同级条目不被移位", async () => {
    const db = await freshDb();
    try {
      await createNote(db, "src1", "根文档", "<p>x</p>", null, new Map());
      await db.prepare("UPDATE notes SET sort_order=1 WHERE id=?").run("src1");
      await insertRawNote(db, "after", 2, { parentId: null });
      await insertRawNote(db, "trashed", 3, { parentId: null, trashed: true });

      const created = await duplicateNote(db, "src1", { now: NOW });
      expect(await sortOrderOf(db, "src1")).toBe(0);
      expect(await sortOrderOf(db, created.id)).toBe(1);
      expect(await sortOrderOf(db, "after")).toBe(2);
      expect(await sortOrderOf(db, "trashed")).toBe(3); // 回收站条目不在目录顺序里，保持原位
    } finally { await db.close(); }
  });

  it("同级 sort_order 全是 0（移动端 createNote 不写 sort_order）时，副本仍紧邻源之后", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", 0);
      // 设备实测场景：源(0)、图片文档(0)、另一篇(0) —— 显示顺序只有标题 zh 排序，没有可用间隔。
      await createNote(db, "src1", "B 文档", "<p>b</p>", "nb1", new Map());
      await createNote(db, "img", "A 图片文档", "<p>a</p>", "nb1", new Map());
      await createNote(db, "last", "C 文档", "<p>c</p>", "nb1", new Map());
      for (const id of ["src1", "img", "last"]) {
        await db.prepare("UPDATE notes SET sort_order=0 WHERE id=?").run(id);
      }
      // 显示顺序 = sort_order(全 0) → 标题 zh：A 图片文档(img), B 文档(src1), C 文档(last)
      const created = await duplicateNote(db, "src1", { now: NOW });

      const rows = await db.prepare(
        "SELECT id, title, sort_order FROM notes WHERE parent_id=? AND trashed_at IS NULL ORDER BY sort_order, title",
      ).all("nb1") as Array<{ id: string; title: string; sort_order: number }>;
      const order = rows.map((row) => row.id);
      expect(order.indexOf(created.id)).toBe(order.indexOf("src1") + 1); // 副本紧邻源（不是排到所有 0 之后）
      expect(rows.map((row) => row.sort_order)).toEqual([0, 1, 2, 3]);   // 整组归一化 0..n-1
      expect(order).toEqual(["img", "src1", created.id, "last"]);        // 其余条目相对顺序不变
    } finally { await db.close(); }
  });

  it("逐条拒绝：not-found / unsupported（分组、小记）/ already-trashed / body-missing", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "g1", 0);
      await insertQuickNote(db, "q1");
      await createNote(db, "trashed", "回收站", "<p>x</p>", null, new Map());
      await db.prepare("UPDATE notes SET trashed_at=? WHERE id=?").run(T, "trashed");
      await createNote(db, "nobody", "缺正文", "<p>x</p>", null, new Map());
      await deleteNoteBodies("nobody");

      const cases: Array<[string, string]> = [
        ["missing", "not-found"],
        ["g1", "unsupported"],
        ["q1", "unsupported"],
        ["trashed", "already-trashed"],
        ["nobody", "body-missing"],
      ];
      for (const [id, reason] of cases) {
        const attempt = duplicateNote(db, id, { now: NOW });
        await expect(attempt).rejects.toBeInstanceOf(DuplicateNoteError);
        await expect(attempt).rejects.toMatchObject({ duplicateReason: reason });
      }
      // 失败不产生任何副本行
      expect(await newIdCount(db, ["trashed", "nobody"])).toBe(0);
    } finally { await db.close(); }
  });

  it("资源复制失败 ⇒ 整条失败、不落库（不留下有元数据没资源的副本）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", 0);
      await createNote(db, "src1", "周报", "<p>x</p>", "nb1", new Map());
      prepareAssetStore();
      assetStore.failSaveKey = "/boom.png";
      assetStore.files.set("src1/boom.png", new Uint8Array([7]));
      await expect(duplicateNote(db, "src1", { now: NOW })).rejects.toThrow("磁盘写入失败");
      const rows = await db.prepare("SELECT id FROM notes WHERE parent_id=?").all("nb1") as Array<{ id: string }>;
      expect(rows.map((row) => row.id)).toEqual(["src1"]);
      // 已复制成功的资源目录被回收（失败条目不留半成品）
      const leftovers = [...assetStore.files.keys()].filter((key) => !key.startsWith("src1/"));
      expect(leftovers).toEqual([]);
    } finally { await db.close(); }
  });
});
