import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyMobileSchema, hasLegacyBodySchema } from "./schema.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

describe("mobile schema", () => {
  it("261019：旧库（正文在 SQLite）识别后整库重置，新 schema 不再有 content 列", async () => {
    const db = await SqlJsDb.open();
    db.exec(`CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.prepare("INSERT INTO notes(id,title,content,updated_at) VALUES(?,?,?,?)")
      .run("note-1", "Title", "<p>body</p>", "2026-01-01T00:00:00.000Z");
    const mobile = new SqlJsAsyncDb(db);
    expect(await hasLegacyBodySchema(mobile)).toBe(true);

    await applyMobileSchema(mobile);

    const columns = db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("content");
    // 开发阶段数据可丢（用户定稿）：旧正文不迁移。
    expect(db.prepare("SELECT 1 FROM notes WHERE id=?").get("note-1")).toBeUndefined();
    expect(await hasLegacyBodySchema(mobile)).toBe(false);
  });

  it("does not revive a deleted seed notebook on reapplication", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(new SqlJsAsyncDb(db));
    db.prepare("DELETE FROM folders WHERE id=?").run("notebook-personal");

    await applyMobileSchema(new SqlJsAsyncDb(db));

    expect(db.prepare("SELECT 1 FROM folders WHERE id=?").get("notebook-personal")).toBeUndefined();
  });
});
