/**
 * 移动端日记 ensure（261109 v1）：
 *  · 幂等：同日连点两次只产生一篇（幂等判据来自 core/diary.planDiaryOpen）；
 *  · 层级：日记本(space=diary) → 年组 → 月组 → 文档（标题即日期），parent 链正确；
 *  · 日期键严格：非法日期拒绝并明确报错（不落任何行）；
 *  · schema 版本门：folders.space 由 MOBILE_SCHEMA_VERSION 12 的 ALTER 补上（老库升级可用）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {},
  loadAssetBytesFs: async () => null,
  removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  statNoteAssetSizesFs: async () => null,
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));

// 告警可观测（261110 wave2）：数据层把「多个日记本」交给本机环形缓冲。这里只锁“真的被调用”；
// 缓冲上限 / 坏数据 / 隐私边界（正文与 Key 不落盘）在 src/mobile/lib/diaryWarnLog.test.ts 单测。
const diaryWarn = vi.hoisted(() => ({ reportDiaryWarning: vi.fn() }));
vi.mock("../lib/diaryWarnLog.js", () => diaryWarn);

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema, MOBILE_SCHEMA_VERSION, readMobileSchemaVersion } from "../data/schema.js";
import { ensureDiaryNote, DIARY_NOTEBOOK_TITLE } from "./diaryRepository.js";
import { readNote } from "../data/noteRepository.js";
import { emptyLakeBody } from "../../core/lakeDocForm.js";

const T = "2026-11-09T00:00:00.000Z";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function folderRows(db: SqlJsAsyncDb): Promise<Array<{ id: string; title: string; parent_id: string | null; node_type: string; space: string | null }>> {
  return await db.prepare("SELECT id,title,parent_id,node_type,space FROM folders ORDER BY title").all() as Array<
    { id: string; title: string; parent_id: string | null; node_type: string; space: string | null }
  >;
}

describe("ensureDiaryNote（幂等打开某天）", () => {
  it("首次：建日记本(space=diary) → 年 → 月 → 文档，层级与标题正确", async () => {
    const db = await freshDb();
    const opened = await ensureDiaryNote(db, "2026-11-09");
    expect(opened.created).toBe(true);
    expect(opened.duplicates).toEqual([]);

    const folders = await folderRows(db);
    const notebook = folders.find((row) => row.id === opened.notebookId)!;
    expect(notebook.node_type).toBe("notebook");
    expect(notebook.title).toBe(DIARY_NOTEBOOK_TITLE);
    expect(notebook.space).toBe("diary");

    const year = folders.find((row) => row.title === "2026")!;
    expect(year.node_type).toBe("group");
    expect(year.parent_id).toBe(opened.notebookId);
    expect(year.space).toBeNull();
    const month = folders.find((row) => row.title === "11")!;
    expect(month.node_type).toBe("group");
    expect(month.parent_id).toBe(year.id);
    expect(month.space).toBeNull();

    const note = await readNote(db, opened.noteId);
    expect(note!.title).toBe("2026-11-09");
    expect(note!.parentId).toBe(month.id);
    // 正文 = core 的空 Lake 文档单一来源（无媒体、打开即空白页）
    expect(note!.content).toBe(emptyLakeBody(opened.noteId));
    await db.close();
  });

  it("同一天连点两次：只有一篇（created=false，id 相同，行数不涨）", async () => {
    const db = await freshDb();
    const first = await ensureDiaryNote(db, "2026-11-09");
    const second = await ensureDiaryNote(db, "2026-11-09");
    expect(second.created).toBe(false);
    expect(second.noteId).toBe(first.noteId);
    expect(second.notebookId).toBe(first.notebookId);
    const count = await db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(count.c).toBe(1);
    expect((await folderRows(db)).length).toBe(3); // 本 + 年 + 月
    await db.close();
  });

  it("换月/换年复用已存在的年月分组，只补缺的那一级", async () => {
    const db = await freshDb();
    const today = await ensureDiaryNote(db, "2026-11-09");
    const otherDay = await ensureDiaryNote(db, "2026-11-10");
    expect(otherDay.created).toBe(true);
    expect(otherDay.notebookId).toBe(today.notebookId);
    const nextYear = await ensureDiaryNote(db, "2027-01-02");
    const folders = await folderRows(db);
    expect(folders.filter((row) => row.node_type === "group").map((row) => row.title).sort()).toEqual(["01", "11", "2026", "2027"]);
    const january = folders.find((row) => row.title === "01")!;
    const y2027 = folders.find((row) => row.title === "2027")!;
    expect(january.parent_id).toBe(y2027.id);
    expect(y2027.parent_id).toBe(nextYear.notebookId);
    await db.close();
  });

  it("非法日期键：拒绝并明确报错，且不留下任何行", async () => {
    const db = await freshDb();
    await expect(ensureDiaryNote(db, "2026-13-01")).rejects.toThrow("日期键非法");
    await expect(ensureDiaryNote(db, "不是日期")).rejects.toThrow("日期键非法");
    await expect(ensureDiaryNote(db, "2026-02-30")).rejects.toThrow("日期键非法");
    const folders = await folderRows(db);
    expect(folders).toEqual([]);
    const notes = await db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(notes.c).toBe(0);
    await db.close();
  });

  it("已有同名重复文档：只返回告警清单（取最新一篇），不删不改", async () => {
    const db = await freshDb();
    const opened = await ensureDiaryNote(db, "2026-11-09");
    await db.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,content_hash,is_dirty,is_purged,trashed_at,doc_kind) VALUES (?,?,?,?,?,?,0,0,NULL,?)")
      .run("dup-old", "2026-11-09", (await readNote(db, opened.noteId))!.parentId, 9, T, "h", "doc");
    const again = await ensureDiaryNote(db, "2026-11-09");
    expect(again.created).toBe(false);
    expect(again.duplicates).toContain("dup-old");
    const count = await db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(count.c).toBe(2);
    await db.close();
  });
});

describe("ensureDiaryNote（261110：mode='new' 永远新建，一天允许多篇）", () => {
  it("同一天两次 new：两篇独立文档，标题相同、同一个月分组，行数各 +1", async () => {
    const db = await freshDb();
    const first = await ensureDiaryNote(db, "2026-11-09", "new");
    const second = await ensureDiaryNote(db, "2026-11-09", "new");
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.noteId).not.toBe(first.noteId);
    expect(second.notebookId).toBe(first.notebookId);
    // 当天其它条目是正常数据（同日多篇）⇒ 不再当"重复文档"告警（与桌面 openDate({mode:'new'}) 同口径）。
    expect(first.duplicates).toEqual([]);
    expect(second.duplicates).toEqual([]);
    const notes = await db.prepare("SELECT id,title,parent_id FROM notes ORDER BY sort_order").all() as Array<{ id: string; title: string; parent_id: string }>;
    expect(notes.length).toBe(2);
    expect(notes.map((row) => row.title)).toEqual(["2026-11-09", "2026-11-09"]);
    expect(notes[0].parent_id).toBe(notes[1].parent_id);
    // 容器仍只有一份：日记本 + 年 + 月（new 不重复建本/建组）。
    expect((await folderRows(db)).length).toBe(3);
    await db.close();
  });

  it("全新库直接 new：照样补齐 日记本(space=diary) → 年 → 月 → 文档", async () => {
    const db = await freshDb();
    const created = await ensureDiaryNote(db, "2026-11-09", "new");
    const folders = await folderRows(db);
    const notebook = folders.find((row) => row.id === created.notebookId)!;
    expect(notebook.space).toBe("diary");
    const year = folders.find((row) => row.title === "2026")!;
    const month = folders.find((row) => row.title === "11")!;
    expect(year.parent_id).toBe(created.notebookId);
    expect(month.parent_id).toBe(year.id);
    const note = await readNote(db, created.noteId);
    expect(note!.title).toBe("2026-11-09");
    expect(note!.parentId).toBe(month.id);
    await db.close();
  });

  it("open 仍幂等（打开最新一篇）：new 之后再 open 不会新增，且命中 new 建的那篇", async () => {
    const db = await freshDb();
    const created = await ensureDiaryNote(db, "2026-11-09", "new");
    const opened = await ensureDiaryNote(db, "2026-11-09");
    expect(opened.created).toBe(false);
    expect(opened.noteId).toBe(created.noteId);
    const count = await db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(count.c).toBe(1);
    await db.close();
  });

  it("createNote 写真实 created_at；之后编辑只动 updated_at（261110 排序稳定）", async () => {
    const db = await freshDb();
    const opened = await ensureDiaryNote(db, "2026-11-10", "new");
    const first = await db.prepare("SELECT created_at, updated_at FROM notes WHERE id=?").get(opened.noteId) as { created_at: string; updated_at: string };
    expect(first.created_at).toBeTruthy();
    expect(first.created_at).toBe(first.updated_at);
    await db.prepare("UPDATE notes SET updated_at=? WHERE id=?").run("2026-11-11T00:00:00.000Z", opened.noteId);
    const after = await db.prepare("SELECT created_at, updated_at FROM notes WHERE id=?").get(opened.noteId) as { created_at: string; updated_at: string };
    expect(after.created_at).toBe(first.created_at);
    expect(after.updated_at).toBe("2026-11-11T00:00:00.000Z");
    await db.close();
  });

  it("非法日期键：new 与 open 一样拒绝并明确报错，不留任何行", async () => {
    const db = await freshDb();
    await expect(ensureDiaryNote(db, "2026-02-30", "new")).rejects.toThrow("日期键非法");
    expect(await folderRows(db)).toEqual([]);
    const notes = await db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    expect(notes.c).toBe(0);
    await db.close();
  });
});

describe("移动端 schema 版本门（日记 space 列）", () => {
  it("全新库：版本写到位，folders 有 space 列", async () => {
    const db = await freshDb();
    expect(MOBILE_SCHEMA_VERSION).toBeGreaterThanOrEqual(12);
    expect(await readMobileSchemaVersion(db)).toBe(MOBILE_SCHEMA_VERSION);
    const columns = (await db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain("space");
    await db.close();
  });

  it("旧库（user_version=11、folders 无 space）：升级时补列，不重建数据", async () => {
    const raw = await SqlJsDb.open();
    // v11 的真实 folders 形状（只缺 space 列）。
    raw.exec("CREATE TABLE folders (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT, sort_order INTEGER NOT NULL, node_type TEXT NOT NULL, icon TEXT, updated_at TEXT NOT NULL, trashed_at TEXT, deleted_from_parent_id TEXT, is_dirty INTEGER NOT NULL DEFAULT 0, is_purged INTEGER NOT NULL DEFAULT 0, cloud_deleted INTEGER NOT NULL DEFAULT 0);");
    raw.exec("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at) VALUES ('nb-old','老笔记本',NULL,0,'notebook',NULL,'2026-01-01T00:00:00.000Z');");
    raw.exec("PRAGMA user_version = 11;");
    const db = new SqlJsAsyncDb(raw);
    await applyMobileSchema(db);
    const columns = (await db.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain("space");
    const row = await db.prepare("SELECT title, space FROM folders WHERE id=?").get("nb-old") as { title: string; space: string | null };
    expect(row.title).toBe("老笔记本");
    expect(row.space).toBeNull();
    await db.close();
  });
});

describe("日记告警可观测（261110 wave2：console.warn → 设备本地可复制）", () => {
  it("存在多个 space='diary' 的笔记本：取第一个为准并记录一条告警（不自动修复）", async () => {
    const db = await freshDb();
    const opened = await ensureDiaryNote(db, "2026-11-09");
    await db.prepare(
      "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty,space) VALUES (?,?,NULL,?,?,NULL,?,1,?)",
    ).run("nb-diary-2", "日记 2", 99, "notebook", T, "diary");
    diaryWarn.reportDiaryWarning.mockClear();

    const again = await ensureDiaryNote(db, "2026-11-09");
    expect(again.notebookId).toBe(opened.notebookId); // 取第一个为准
    expect(diaryWarn.reportDiaryWarning).toHaveBeenCalledTimes(1);
    expect(diaryWarn.reportDiaryWarning).toHaveBeenCalledWith("multiple-notebooks");
    await db.close();
  });

  it("只有一本日记本：不产生告警（正常路径零噪音）", async () => {
    const db = await freshDb();
    diaryWarn.reportDiaryWarning.mockClear();
    await ensureDiaryNote(db, "2026-11-09");
    expect(diaryWarn.reportDiaryWarning).not.toHaveBeenCalled();
    await db.close();
  });
});
