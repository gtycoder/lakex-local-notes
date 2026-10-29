import { describe, expect, it, vi } from "vitest";
import type { MobileDb } from "./sqliteDb";
import { purgeQuickNote } from "./quickNotesRepository";

/**
 * 最小 MobileDb 桩：只提供 purgeQuickNote 走到的语句入口。
 * 不用 sql.js 门面：它的 transaction 不支持嵌套（native 实现支持，见 NativeSqliteDb.txDepth），
 * 而 purgeQuickNote 内部 removeQuickNoteLinks 会再开一次事务 ⇒ 门面差异会把用例拦在无关的地方。
 */
function stubDb(): { db: MobileDb; statements: string[] } {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        async get() { return undefined; },
        async all() { return []; },
        async run() { return { changes: 1, lastInsertRowid: 1 }; },
      };
    },
    async transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>> {
      return (await fn()) as Awaited<ReturnType<T>>;
    },
    async pragma() { return undefined; },
    async exec() { /* no-op */ },
    async databaseSizeBytes() { return 0; },
    async close() { /* no-op */ },
  } satisfies MobileDb;
  return { db, statements };
}

/**
 * MOB-06（261027 审计）：彻底删除小记必须连图片目录一起清。
 * 旧实现按正文里引用到的文件名逐个删 ⇒ 正文缺失/解析失败（「缺正文小记」既有场景）时整目录残留，
 * 且即使删空也会留下空目录；现在交给调用方整份删掉（assetFs.removeQuickNoteAssetsDirFs）。
 */
describe("mobile 小记彻底删除清图片目录（MOB-06）", () => {
  it("purge 后调用方收到该小记 id（正文缺失也要清）", async () => {
    const { db, statements } = stubDb();
    const removeAssetsDir = vi.fn(async (_quickNoteId: string) => {});
    await purgeQuickNote(db, "qn-purge-assets", removeAssetsDir);

    expect(removeAssetsDir).toHaveBeenCalledWith("qn-purge-assets");
    // 墓碑与行删除照旧（文件删除不改变"已彻底删除"的 DB 判定）
    const sql = statements.join("\n");
    expect(sql).toMatch(/INSERT OR REPLACE INTO quick_note_deleted/);
    expect(sql).toMatch(/DELETE FROM quick_notes/);
  });

  it("图片目录删除失败只告警，不阻断墓碑/行删除", async () => {
    const { db, statements } = stubDb();
    const removeAssetsDir = vi.fn(async () => { throw new Error("EACCES"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(purgeQuickNote(db, "qn-purge-fail", removeAssetsDir)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      expect(statements.join("\n")).toMatch(/INSERT OR REPLACE INTO quick_note_deleted/);
    } finally { warn.mockRestore(); }
  });
});
