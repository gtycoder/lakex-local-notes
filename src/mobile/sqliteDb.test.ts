import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

import { SqlJsDb } from "./sqliteDb.js";

describe("SqlJsDb statement run result", () => {
  it("returns real change count and insert rowid", async () => {
    const db = await SqlJsDb.open();
    db.exec("CREATE TABLE audit_nodes(id TEXT PRIMARY KEY, title TEXT)");

    const inserted = db
      .prepare("INSERT INTO audit_nodes(id, title) VALUES(?, ?)")
      .run("node-1", "old");
    expect(inserted.changes).toBe(1);
    expect(inserted.lastInsertRowid).toBe(1);

    const updated = db
      .prepare("UPDATE audit_nodes SET title=? WHERE id=?")
      .run("new", "node-1");
    expect(updated.changes).toBe(1);

    const missing = db
      .prepare("UPDATE audit_nodes SET title=? WHERE id=?")
      .run("ignored", "missing");
    expect(missing.changes).toBe(0);
  });
});
