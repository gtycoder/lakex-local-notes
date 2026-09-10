import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

import { applyMobileSchema } from "./schema.js";
import {
  cleanOrphanAssets,
  deleteOrphanAsset,
  listOrphanAssets,
} from "./orphanAssetRepository.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";

async function createDbWithOrphans(): Promise<SqlJsAsyncDb> {
  const db = await SqlJsDb.open();
  await applyMobileSchema(db);
  const insert = db.prepare(
    "INSERT INTO orphan_assets(note_id,filename,file_path,size,mime_type) VALUES(?,?,?,?,?)",
  );
  await insert.run("note-1", "old.png", "note-assets/note-1/old.png", 10, "image/png");
  await insert.run("note-2", "unused.png", "note-assets/note-2/unused.png", 20, "image/png");
  return new SqlJsAsyncDb(db);
}

describe("mobile orphan asset repository", () => {
  it("keeps the DB row when file removal fails", async () => {
    const db = await createDbWithOrphans();
    const assets = new Map([["note-1/old.png", new Uint8Array([1])]]);
    const removeAssetFile = vi.fn(async () => {
      throw new Error("remove failed");
    });

    await expect(deleteOrphanAsset(db, 1, { assets, removeAssetFile })).rejects.toThrow("remove failed");

    expect(removeAssetFile).toHaveBeenCalledWith("note-1/old.png");
    expect(assets.has("note-1/old.png")).toBe(true);
    await expect(listOrphanAssets(db)).resolves.toHaveLength(2);
  });

  it("cleans files, memory cache, and DB rows together", async () => {
    const db = await createDbWithOrphans();
    const assets = new Map([
      ["note-1/old.png", new Uint8Array([1])],
      ["note-2/unused.png", new Uint8Array([2])],
    ]);
    const removedKeys: string[] = [];

    await cleanOrphanAssets(db, {
      assets,
      removeAssetFile: async (key) => {
        removedKeys.push(key);
      },
    });

    expect(removedKeys).toEqual(["note-1/old.png", "note-2/unused.png"]);
    expect(assets.size).toBe(0);
    await expect(listOrphanAssets(db)).resolves.toEqual([]);
  });
});
