/**
 * 移动端「创建副本」桥（261106 task-6）——与桌面 IPC duplicate_notes 同契约：
 * · 请求级清洗（invalid-input / empty-ids / too-many-ids / invalid-id）整批不执行、results 为空；
 * · 条目级失败逐条给 reason，**部分失败不回滚其它条**；
 * · 处理顺序 = 源 sort_order 降序（连续插入不会互相移位）；条与条之间让出事件循环。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

const assetStore = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("../native/assetFs", () => ({
  copyNoteAssetsDirNativeFs: async () => null,
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { assetStore.set(key, new Uint8Array(bytes)); },
  loadAssetBytesFs: async (key: string) => assetStore.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { assetStore.delete(key); },
  listNoteAssetKeysFs: async (noteId: string) => [...assetStore.keys()].filter((key) => key.startsWith(noteId + "/")),
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  statNoteAssetSizesFs: async () => null,
  removeNoteAssetsDirFs: async (noteId: string) => {
    for (const key of [...assetStore.keys()]) if (key.startsWith(noteId + "/")) assetStore.delete(key);
  },
  removeQuickNoteAssetsDirFs: async () => {},
}));

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, readNote } from "../data/noteRepository.js";
import { runMobileDuplicateNotes } from "./duplicateNotes";

const T = "2026-11-01T00:00:00.000Z";
const NOW = new Date(2026, 10, 6, 9, 8, 7);

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}
async function insertFolder(db: SqlJsAsyncDb, id: string): Promise<void> {
  await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,updated_at) VALUES (?,?,NULL,0,?,?)").run(id, id, "notebook", T);
}
async function insertRawNote(db: SqlJsAsyncDb, id: string, sortOrder: number, parentId: string | null): Promise<void> {
  await db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,content_hash,is_dirty,is_purged) VALUES (?,?,?,?,?,?,0,0)")
    .run(id, id, parentId, sortOrder, T, "h");
}
async function ids(db: SqlJsAsyncDb): Promise<string[]> {
  const rows = await db.prepare("SELECT id FROM notes ORDER BY id").all() as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

describe("bridge.duplicateNotes（移动端创建副本）", () => {
  it("请求级拒绝：ids 非数组 / 空 / 超 500 / 非法 id ⇒ 整批不执行，results 为空", async () => {
    const db = await freshDb();
    try {
      const cases: Array<[unknown, string]> = [
        ["nope", "invalid-input"],
        [[], "empty-ids"],
        [Array.from({ length: 501 }, (_, i) => "n" + i), "too-many-ids"],
        [["../evil"], "invalid-id"],
      ];
      for (const [payload, reason] of cases) {
        const result = await runMobileDuplicateNotes(db, { ids: payload }, { now: NOW });
        expect(result.ok).toBe(false);
        expect(result.results).toEqual([]);
        expect(result.summary).toEqual({ total: 0, done: 0, failed: 0 });
        expect(result.reason).toBe(reason);
        expect(result.message).toBeTruthy();
      }
    } finally { await db.close(); }
  });

  it("处理顺序 = 源 sort_order 降序；条与条之间让出事件循环", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1");
      await insertRawNote(db, "n5", 5, "nb1");
      await insertRawNote(db, "n1", 1, "nb1");
      await insertRawNote(db, "n3", 3, "nb1");
      const order: string[] = [];
      const yieldNow = vi.fn(async () => { order.push("yield"); });
      const result = await runMobileDuplicateNotes(db, { ids: ["n1", "n3", "n5"] }, {
        now: NOW,
        yieldNow,
        duplicateOne: (id: string) => { order.push(id); return { id: id + "-copy" }; },
      });
      expect(result.ok).toBe(true);
      expect(order.filter((entry) => entry !== "yield")).toEqual(["n5", "n3", "n1"]);
      // 默认每条之后让一次（yieldEvery = 1）
      expect(yieldNow).toHaveBeenCalledTimes(3);
      expect(result.results.map((item) => item.newId)).toEqual(["n5-copy", "n3-copy", "n1-copy"]);
    } finally { await db.close(); }
  });

  it("真实复制两条同级文档：都在源下方、正文 URL 重写、summary 正确", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1");
      await createNote(db, "a", "A", '<p>a</p><img src="/note-assets/a/x.png">', "nb1", new Map());
      await createNote(db, "b", "B", '<p>b</p><img src="/note-assets/b/y.png">', "nb1", new Map());
      await db.prepare("UPDATE notes SET sort_order=1 WHERE id=?").run("a");
      await db.prepare("UPDATE notes SET sort_order=2 WHERE id=?").run("b");
      assetStore.set("a/x.png", new Uint8Array([1]));
      assetStore.set("b/y.png", new Uint8Array([2]));

      const result = await runMobileDuplicateNotes(db, { ids: ["a", "b"] }, { now: NOW });
      expect(result.ok).toBe(true);
      expect(result.summary).toEqual({ total: 2, done: 2, failed: 0 });
      const copyA = result.results.find((item) => item.id === "a")!;
      const copyB = result.results.find((item) => item.id === "b")!;
      expect(copyA.ok && copyB.ok).toBe(true);
      expect(await ids(db)).toContain(copyA.newId!);
      expect(await ids(db)).toContain(copyB.newId!);
      expect((await readNote(db, copyA.newId!))!.content).toContain("/note-assets/" + copyA.newId + "/x.png");
      expect((await readNote(db, copyB.newId!))!.content).toContain("/note-assets/" + copyB.newId + "/y.png");
      // 源仍在原位；副本紧邻各自源之后（降序处理 ⇒ a 的副本在 a 与 b 之间、b 的副本在 b 之后）
      const rows = await db.prepare("SELECT id, sort_order FROM notes WHERE parent_id=? ORDER BY sort_order").all("nb1") as Array<{ id: string; sort_order: number }>;
      const order = rows.map((row) => row.id);
      expect(order.indexOf(copyA.newId!)).toBe(order.indexOf("a") + 1);
      expect(order.indexOf(copyB.newId!)).toBe(order.indexOf("b") + 1);
      expect(assetStore.has(copyA.newId + "/x.png")).toBe(true);
    } finally { await db.close(); }
  });

  it("部分失败：逐条 reason、其它条照常落库（不回滚）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1");
      await createNote(db, "ok1", "可复制", "<p>x</p>", "nb1", new Map());
      const result = await runMobileDuplicateNotes(db, { ids: ["ok1", "missing", "nb1"] }, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.summary).toEqual({ total: 3, done: 1, failed: 2 });
      expect(result.results.find((item) => item.id === "ok1")!.ok).toBe(true);
      expect(result.results.find((item) => item.id === "missing")).toMatchObject({ ok: false, reason: "not-found" });
      expect(result.results.find((item) => item.id === "nb1")).toMatchObject({ ok: false, reason: "unsupported" });
      // 成功的那条真的落库了（部分失败不回滚其它条）
      const copy = result.results.find((item) => item.id === "ok1")!.newId!;
      expect(await readNote(db, copy)).not.toBeNull();
    } finally { await db.close(); }
  });

  it("yieldEvery 可调（默认 1；设 2 时每两条让一次）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1");
      await insertRawNote(db, "n1", 1, "nb1");
      await insertRawNote(db, "n2", 2, "nb1");
      await insertRawNote(db, "n3", 3, "nb1");
      const yieldNow = vi.fn(async () => {});
      await runMobileDuplicateNotes(db, { ids: ["n1", "n2", "n3"] }, {
        yieldEvery: 2,
        yieldNow,
        duplicateOne: (id: string) => ({ id: id + "-copy" }),
      });
      expect(yieldNow).toHaveBeenCalledTimes(1);
    } finally { await db.close(); }
  });
});
