/**
 * 移动端日记 ensure 的**单事务**复核（261109，片D 独立验证；docs/DIARY.md 硬规则 4 的移动侧）。
 *
 * 桌面侧回滚已由 electron/diaryStore.test.ts 覆盖（注入 DbLike 让 notes 写入抛错）；
 * 移动端没有主进程、ensure 直接跑在 data 层，这里用 **SQLite TRIGGER 注入失败**（不改生产代码）：
 *  - 建组失败（月分组 INSERT 被 RAISE 打断）⇒ 笔记本 + 年组一起回滚，无半成品；
 *  - 建文档失败（notes INSERT 被 RAISE 打断）⇒ 之前建的笔记本/年/月组一起回滚；
 *  - 失败后重试仍能建全（不残留挡路状态）。
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

import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { ensureDiaryNote } from "./diaryRepository.js";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function scalar(db: SqlJsAsyncDb, sql: string): Promise<number> {
  const row = await db.prepare(sql).get() as { c: number };
  return row.c;
}

const COUNTS = async (db: SqlJsAsyncDb) => ({
  folders: await scalar(db, "SELECT COUNT(*) AS c FROM folders"),
  notebooks: await scalar(db, "SELECT COUNT(*) AS c FROM folders WHERE node_type='notebook'"),
  groups: await scalar(db, "SELECT COUNT(*) AS c FROM folders WHERE node_type='group'"),
  notes: await scalar(db, "SELECT COUNT(*) AS c FROM notes"),
});

describe("ensureDiaryNote 单事务（失败不留半成品）", () => {
  it("建组失败（月分组 INSERT 被注入失败）⇒ 笔记本/年组一起回滚，无任何行", async () => {
    const db = await freshDb();
    await db.exec(
      "CREATE TRIGGER inject_month_failure BEFORE INSERT ON folders " +
      "WHEN NEW.title = '11' AND NEW.node_type = 'group' " +
      "BEGIN SELECT RAISE(ABORT, '注入失败：月分组'); END;",
    );
    await expect(ensureDiaryNote(db, "2026-11-09")).rejects.toThrow(/注入失败/);
    expect(await COUNTS(db)).toEqual({ folders: 0, notebooks: 0, groups: 0, notes: 0 });
    await db.close();
  });

  it("建文档失败（notes INSERT 被注入失败）⇒ 已建的笔记本/年组/月组也整体回滚", async () => {
    const db = await freshDb();
    await db.exec(
      "CREATE TRIGGER inject_note_failure BEFORE INSERT ON notes " +
      "WHEN NEW.title = '2026-11-09' " +
      "BEGIN SELECT RAISE(ABORT, '注入失败：正文行'); END;",
    );
    await expect(ensureDiaryNote(db, "2026-11-09")).rejects.toThrow(/注入失败/);
    // 目录行与文档行必须同生共死（不能只回滚 notes、留下空的年/月分组）
    expect(await COUNTS(db)).toEqual({ folders: 0, notebooks: 0, groups: 0, notes: 0 });
    await db.close();
  });

  it("回滚后重试成功：删掉注入触发器再打开同一天，层级完整且只有一篇", async () => {
    const db = await freshDb();
    await db.exec(
      "CREATE TRIGGER inject_month_failure BEFORE INSERT ON folders " +
      "WHEN NEW.title = '11' AND NEW.node_type = 'group' " +
      "BEGIN SELECT RAISE(ABORT, '注入失败：月分组'); END;",
    );
    await expect(ensureDiaryNote(db, "2026-11-09")).rejects.toThrow(/注入失败/);
    await db.exec("DROP TRIGGER inject_month_failure;");

    const result = await ensureDiaryNote(db, "2026-11-09");
    expect(result.created).toBe(true);
    expect(await COUNTS(db)).toEqual({ folders: 3, notebooks: 1, groups: 2, notes: 1 });

    // 再点一次仍是同一篇（幂等不受回滚影响）
    const again = await ensureDiaryNote(db, "2026-11-09");
    expect(again.created).toBe(false);
    expect(again.noteId).toBe(result.noteId);
    expect(await COUNTS(db)).toEqual({ folders: 3, notebooks: 1, groups: 2, notes: 1 });
    await db.close();
  });
});
