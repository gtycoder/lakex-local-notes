import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

import { applyMobileSchema } from "./schema.js";
import {
  DEFAULT_HISTORY_SETTINGS,
  createHistorySnapshot,
  getHistorySettings,
} from "./historyRepository.js";
import { SqlJsDb } from "./sqliteDb.js";

describe("mobile history repository", () => {
  it("deduplicates identical snapshots within 24 hours", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(db);
    const meta = { title: "Title", parentId: null, sortOrder: 0 };

    await createHistorySnapshot(db, "note-1", "<p>same</p>", meta);
    await createHistorySnapshot(db, "note-1", "<p>same</p>", meta);

    const count = db.prepare("SELECT COUNT(*) AS count FROM note_history WHERE note_id=?")
      .get("note-1") as { count: number };
    expect(count.count).toBe(1);
  });

  it("falls back to default settings when stored JSON is invalid", async () => {
    const db = await SqlJsDb.open();
    await applyMobileSchema(db);
    db.prepare("INSERT INTO device_state(key,value) VALUES('history_settings',?)")
      .run("{invalid-json");

    await expect(getHistorySettings(db)).resolves.toEqual(DEFAULT_HISTORY_SETTINGS);
  });
});
