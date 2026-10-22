import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MOBILE_SCHEMA_VERSION, applyMobileSchema, readMobileSchemaVersion } from "./schema.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

describe("mobile schema", () => {
  it("新 schema 为文件正文结构，不再有 content 列", async () => {
    const db = await SqlJsDb.open();
    const mobile = new SqlJsAsyncDb(db);
    await applyMobileSchema(mobile);

    const columns = db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("content");
    expect(await readMobileSchemaVersion(mobile)).toBe(MOBILE_SCHEMA_VERSION);
  });

  it("261021：版本已到 ⇒ 第二次应用整体跳过（冷启动省 ~2.4s 的建表往返）", async () => {
    const db = await SqlJsDb.open();
    const mobile = new SqlJsAsyncDb(db);
    await applyMobileSchema(mobile);
    expect(await readMobileSchemaVersion(mobile)).toBe(MOBILE_SCHEMA_VERSION);
    // 人为删掉一张表：若第二次仍会执行 DDL，它会被重建；跳过则保持缺失。
    db.exec("DROP TABLE orphan_assets");
    await applyMobileSchema(mobile);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orphan_assets'").get()).toBeUndefined();
  });

  it("261021：首次应用把 28 条 DDL 批量成两次 executeSet 桥往返（原生端语义）", async () => {
    // 模拟原生端的"桥"：记录 executeSet / exec 调用次数，读路径返回空行（=空库）。
    const sets: Array<Array<{ statement: string; values: unknown[] }>> = [];
    const execStatements: string[] = [];
    const empty = async (): Promise<Record<string, unknown>[]> => [];
    const fake = {
      prepare: () => ({ get: async () => undefined, all: empty, run: async () => ({ changes: 0, lastInsertRowid: 0 }) }),
      pragma: async () => [{ user_version: 0 }],
      exec: async (sql: string) => { execStatements.push(sql); },
      executeSet: async (set: Array<{ statement: string; values: unknown[] }>) => { sets.push(set); },
      transaction: async <T,>(fn: T) => fn,
      databaseSizeBytes: async () => 0,
      close: async () => undefined,
    };
    await applyMobileSchema(fake as never);
    expect(sets).toHaveLength(2); // 底表一批 + 条件语句一批
    const ddlCount = sets.reduce((sum, set) => sum + set.length, 0);
    expect(ddlCount).toBeGreaterThan(20); // 28 条 DDL 都在批里
    // exec 只剩版本号写入（DDL 不再逐条桥往返）。
    expect(execStatements).toHaveLength(1);
    expect(execStatements[0]).toContain("user_version");
    // 条件加列在第二阶段（底表先建，再读 table_info）。
    const allStatements = sets.flat().map((item) => item.statement);
    expect(allStatements.some((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS notes"))).toBe(true);
    expect(allStatements.some((sql) => sql.includes("ALTER TABLE notes ADD COLUMN text_cache"))).toBe(true);
    expect(allStatements).toContain("ALTER TABLE quick_notes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
    expect(allStatements.some((sql) => sql.includes("INSERT OR IGNORE INTO folders"))).toBe(true);
    expect(allStatements).toContain("CREATE INDEX IF NOT EXISTS idx_notes_active_parent_sort ON notes(parent_id, sort_order) WHERE trashed_at IS NULL");
    expect(allStatements).toContain("CREATE INDEX IF NOT EXISTS idx_quick_notes_active_updated ON quick_notes(updated_at DESC, id DESC) WHERE deleted_at IS NULL");
  });

  it("does not revive a deleted seed notebook on reapplication", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(new SqlJsAsyncDb(db));
    db.prepare("DELETE FROM folders WHERE id=?").run("notebook-personal");

    await applyMobileSchema(new SqlJsAsyncDb(db));

    expect(db.prepare("SELECT 1 FROM folders WHERE id=?").get("notebook-personal")).toBeUndefined();
  });
});
