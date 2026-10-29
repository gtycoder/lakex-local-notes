import { describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  calls: [] as string[],
  createConnection: vi.fn(async () => {
    plugin.calls.push("createConnection");
  }),
  open: vi.fn(async () => {
    plugin.calls.push("open");
  }),
  execute: vi.fn(async () => {
    plugin.calls.push("execute");
    return { changes: { changes: 0 } };
  }),
  executeSet: vi.fn(async (_options: { set?: unknown[] }) => {
    plugin.calls.push("executeSet");
    return { changes: { changes: 100 } };
  }),
  beginTransaction: vi.fn(async () => {
    plugin.calls.push("beginTransaction");
    return { changes: { changes: 0 } };
  }),
  run: vi.fn(async () => {
    plugin.calls.push("run");
    return { changes: { changes: 1 } };
  }),
  rollbackTransaction: vi.fn(async () => {
    plugin.calls.push("rollbackTransaction");
    return { changes: { changes: 0 } };
  }),
  query: vi.fn(async ({ statement }: { statement: string }) => {
    plugin.calls.push(`query:${statement}`);
    if (statement === "PRAGMA journal_mode=WAL") return { values: [{ journal_mode: "wal" }] };
    if (statement === "PRAGMA page_count") return { values: [{ page_count: 2 }] };
    if (statement === "PRAGMA page_size") return { values: [{ page_size: 4096 }] };
    if (statement.includes("text_value='rolled-back'")) return { values: [{ count: 0 }] };
    return { values: [{ count: 100 }] };
  }),
  close: vi.fn(async () => {
    plugin.calls.push("close");
  }),
  closeConnection: vi.fn(async () => {
    plugin.calls.push("closeConnection");
  }),
  getDatabaseList: vi.fn(async () => ({
    values: ["lakex-local-notes-mobile-spikeSQLite.db"],
  })),
}));

vi.mock("@capacitor-community/sqlite", () => ({
  CapacitorSQLite: plugin,
}));

import { runNativeSqliteSpike } from "./nativeSqlite.js";

describe("native SQLite spike", () => {
  it("verifies WAL, batching, rollback, reopen, and file naming", async () => {
    const result = await runNativeSqliteSpike("lakex-local-notes-mobile-spike");

    expect(result).toEqual({
      databaseName: "lakex-local-notes-mobile-spike",
      journalMode: "wal",
      rowCount: 100,
      reopenedRowCount: 100,
      rolledBackRowCount: 0,
      pageBytes: 8192,
      databaseList: ["lakex-local-notes-mobile-spikeSQLite.db"],
    });
    expect(plugin.executeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        database: "lakex-local-notes-mobile-spike",
        transaction: true,
      }),
    );
    expect(plugin.executeSet.mock.calls[0]?.[0]?.set).toHaveLength(100);
    expect(plugin.calls).toEqual([
      "createConnection",
      "open",
      "query:PRAGMA journal_mode=WAL",
      "execute",
      "executeSet",
      "beginTransaction",
      "run",
      "rollbackTransaction",
      "query:PRAGMA page_count",
      "query:PRAGMA page_size",
      "query:SELECT COUNT(*) AS count FROM spike_rows",
      "query:SELECT COUNT(*) AS count FROM spike_rows WHERE text_value='rolled-back'",
      "close",
      "open",
      "query:SELECT COUNT(*) AS count FROM spike_rows",
      "close",
      "closeConnection",
    ]);
  });

  it("closes the native connection when the spike fails", async () => {
    vi.clearAllMocks();
    plugin.calls.length = 0;
    plugin.execute.mockRejectedValueOnce(new Error("native execute failed"));

    await expect(runNativeSqliteSpike()).rejects.toThrow("native execute failed");

    expect(plugin.close).toHaveBeenCalled();
    expect(plugin.closeConnection).toHaveBeenCalled();
  });

  it("can verify persisted rows without resetting the spike table", async () => {
    vi.clearAllMocks();
    plugin.calls.length = 0;

    const result = await runNativeSqliteSpike("persisted-db", false);

    expect(result.rowCount).toBe(100);
    expect(plugin.execute).not.toHaveBeenCalled();
    expect(plugin.executeSet).not.toHaveBeenCalled();
    expect(plugin.calls).toContain("query:SELECT COUNT(*) AS count FROM spike_rows");
  });
});
