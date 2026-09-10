import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sha256Sync } from "../core/sha256Sync.js";
import { applyMobileSchema } from "./schema.js";
import { SqlJsDb } from "./sqliteDb.js";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

describe("mobile schema", () => {
  it("backfills missing note content hashes", async () => {
    const db = await SqlJsDb.open();
    db.exec(`CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.prepare("INSERT INTO notes(id,title,content,updated_at) VALUES(?,?,?,?)")
      .run("note-1", "Title", "<p>body</p>", "2026-01-01T00:00:00.000Z");

    applyMobileSchema(db);

    const row = db.prepare("SELECT content_hash FROM notes WHERE id=?").get("note-1") as {
      content_hash: string;
    };
    expect(row.content_hash).toBe(sha256Sync(new TextEncoder().encode("<p>body</p>")));
  });

  it("does not revive a deleted seed notebook on reapplication", async () => {
    const db = await SqlJsDb.open();
    applyMobileSchema(db);
    db.prepare("DELETE FROM folders WHERE id=?").run("notebook-personal");

    applyMobileSchema(db);

    expect(db.prepare("SELECT 1 FROM folders WHERE id=?").get("notebook-personal")).toBeUndefined();
  });
});
