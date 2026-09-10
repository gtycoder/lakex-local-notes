import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

import { SQL_PARAMETER_BATCH_SIZE } from "../core/sqlParameterBatch.js";
import {
  addS3GcPending,
  listS3GcPending,
  recordS3GcLog,
  removeS3GcPending,
} from "./gcRepository.js";
import { applyMobileSchema } from "./schema.js";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";

async function createDb(): Promise<SqlJsAsyncDb> {
  const db = await SqlJsDb.open();
  await applyMobileSchema(db);
  return new SqlJsAsyncDb(db);
}

describe("mobile GC repository", () => {
  it("adds and removes pending keys across parameter batches", async () => {
    const db = await createDb();
    const keys = Array.from(
      { length: SQL_PARAMETER_BATCH_SIZE + 1 },
      (_, index) => `gc-key-${index}`,
    );
    for (const key of keys) await addS3GcPending(db, key);

    await expect(listS3GcPending(db)).resolves.toHaveLength(keys.length);

    await removeS3GcPending(db, keys);

    await expect(listS3GcPending(db)).resolves.toEqual([]);
  });

  it("records deletion results for audit", async () => {
    const db = await createDb();

    await recordS3GcLog(db, "delete", "objects/note-1", "deep-clean", true);

    const row = await db.prepare("SELECT action,key,reason,ok FROM s3_gc_log").get() as {
      action: string;
      key: string;
      reason: string;
      ok: number;
    };
    expect(row).toEqual({ action: "delete", key: "objects/note-1", reason: "deep-clean", ok: 1 });
  });
});
