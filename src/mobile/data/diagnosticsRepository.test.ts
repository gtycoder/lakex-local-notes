import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

import { getDiagnostics } from "./diagnosticsRepository.js";
import { applyMobileSchema } from "./schema.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";

async function createDb(): Promise<{ db: SqlJsDb; mobileDb: SqlJsAsyncDb }> {
  const db = await SqlJsDb.open();
  await applyMobileSchema(new SqlJsAsyncDb(db));
  for (const table of ["notes", "folders", "quick_notes", "orphan_assets", "s3_gc_pending", "note_history"]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  return { db, mobileDb: new SqlJsAsyncDb(db) };
}

describe("mobile diagnostics repository", () => {
  it("counts only active notes and folders", async () => {
    const { db, mobileDb } = await createDb();
    const note = db.prepare("INSERT INTO notes(id,title,updated_at,trashed_at,deleted_at) VALUES(?,?,?,?,?)");
    note.run("active", "Active", "2026-01-01T00:00:00Z", null, null);
    note.run("trashed", "Trashed", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", null);
    note.run("deleted", "Deleted", "2026-01-01T00:00:00Z", null, "2026-01-03T00:00:00Z");
    const folder = db.prepare("INSERT INTO folders(id,title,node_type,sort_order,updated_at,trashed_at) VALUES(?,?,?,?,?,?)");
    folder.run("active-folder", "Active", "notebook", 0, "2026-01-01T00:00:00Z", null);
    folder.run("trashed-folder", "Trashed", "notebook", 1, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z");
    db.prepare("INSERT INTO quick_notes(id,created_at,updated_at,preview_text,content_hash) VALUES(?,?,?,?,?)")
      .run("quick", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "text", "hash");

    const diagnostics = await getDiagnostics(mobileDb, {
      listAssetKeys: async () => ["a", "b", "c"],
      getDatabaseSizeBytes: () => mobileDb.databaseSizeBytes(),
    });

    expect(diagnostics.noteCount).toBe(1);
    expect(diagnostics.folderCount).toBe(1);
    expect(diagnostics.quickNoteCount).toBe(1);
    expect(diagnostics.resourceCount).toBe(3);
  });

  it("computes database size without exporting the database", async () => {
    const { db, mobileDb } = await createDb();
    const exportBytes = vi.spyOn(db, "exportBytes");

    const diagnostics = await getDiagnostics(mobileDb, {
      listAssetKeys: async () => [],
      getDatabaseSizeBytes: () => mobileDb.databaseSizeBytes(),
    });

    expect(diagnostics.dbBytes).toBeGreaterThan(0);
    expect(exportBytes).not.toHaveBeenCalled();
  });
});
