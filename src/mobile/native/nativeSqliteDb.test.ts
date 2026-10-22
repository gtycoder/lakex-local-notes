import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { NativeSqliteDb } from "./nativeSqliteDb.js";

vi.mock("@capacitor-community/sqlite", () => ({
  CapacitorSQLite: {
    createConnection: vi.fn(async () => undefined),
    closeConnection: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ values: [] })),
    run: vi.fn(async () => ({ changes: { changes: 1, lastId: 2 } })),
    execute: vi.fn(async () => ({ changes: { changes: 1 } })),
    beginTransaction: vi.fn(async () => ({ changes: { changes: 0 } })),
    commitTransaction: vi.fn(async () => ({ changes: { changes: 0 } })),
    rollbackTransaction: vi.fn(async () => ({ changes: { changes: 0 } })),
  },
}));

const plugin = vi.mocked(CapacitorSQLite);

describe("native SQLite database adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin.query.mockResolvedValue({ values: [] });
  });

  it("opens a connection and enables WAL through query", async () => {
    await NativeSqliteDb.open("local-lakex-notes-mobile");

    expect(plugin.createConnection).toHaveBeenCalledWith({
      database: "local-lakex-notes-mobile",
      encrypted: false,
      mode: "no-encryption",
      version: 1,
      readonly: false,
    });
    expect(plugin.open).toHaveBeenCalledWith({ database: "local-lakex-notes-mobile", readonly: false });
    expect(plugin.query).toHaveBeenCalledWith(
      expect.objectContaining({ statement: "PRAGMA journal_mode=WAL" }),
    );
  });

  it("reuses an existing connection without closing and recreating it", async () => {
    plugin.createConnection.mockRejectedValueOnce(
      new Error("Connection local-lakex-notes-mobile already exists"),
    );

    await NativeSqliteDb.open("local-lakex-notes-mobile");

    expect(plugin.createConnection).toHaveBeenCalledTimes(1);
    expect(plugin.closeConnection).not.toHaveBeenCalled();
    expect(plugin.open).toHaveBeenCalledWith({ database: "local-lakex-notes-mobile", readonly: false });
  });

  it("supports statement reads, writes, and row normalization", async () => {
    const db = await NativeSqliteDb.open("local-lakex-notes-mobile");
    plugin.query.mockResolvedValue({ values: [{ id: 1, title: "Lake" }] });
    plugin.run.mockResolvedValue({ changes: { changes: 3, lastId: 9 } });

    await expect(db.prepare("SELECT id FROM notes WHERE id=?").get("note-1")).resolves.toEqual({
      id: 1,
      title: "Lake",
    });
    await expect(db.prepare("SELECT id FROM notes").all()).resolves.toHaveLength(1);
    await expect(db.prepare("UPDATE notes SET title=?").run("Lake 2")).resolves.toEqual({
      changes: 3,
      lastInsertRowid: 9,
    });

    expect(plugin.run).toHaveBeenCalledWith(
      expect.objectContaining({ statement: "UPDATE notes SET title=?", transaction: false }),
    );
  });

  it("commits successful transactions and rolls back failures", async () => {
    const db = await NativeSqliteDb.open("local-lakex-notes-mobile");
    const order: string[] = [];
    plugin.beginTransaction.mockImplementation(async () => {
      order.push("begin");
      return { changes: { changes: 0 } };
    });
    plugin.commitTransaction.mockImplementation(async () => {
      order.push("commit");
      return { changes: { changes: 0 } };
    });
    plugin.rollbackTransaction.mockImplementation(async () => {
      order.push("rollback");
      return { changes: { changes: 0 } };
    });

    await db.transaction(async () => {
      order.push("work");
    });
    await expect(db.transaction(async () => {
      throw new Error("disk full");
    })).rejects.toThrow("disk full");

    expect(order).toEqual(["begin", "work", "commit", "begin", "rollback"]);
  });

  it("routes PRAGMA through query and DDL through execute", async () => {
    const db = await NativeSqliteDb.open("local-lakex-notes-mobile");

    await db.exec("PRAGMA foreign_keys=ON");
    await db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY)");

    expect(plugin.query).toHaveBeenCalledWith(
      expect.objectContaining({ statement: "PRAGMA foreign_keys=ON" }),
    );
    expect(plugin.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        statements: "CREATE TABLE notes (id TEXT PRIMARY KEY)",
        transaction: true,
      }),
    );
  });

  it("computes database size from SQLite page pragmas", async () => {
    const db = await NativeSqliteDb.open("local-lakex-notes-mobile");
    plugin.query.mockImplementation(async ({ statement }) => ({
      values:
        statement === "PRAGMA page_count"
          ? [{ page_count: 12 }]
          : statement === "PRAGMA page_size"
            ? [{ page_size: 4096 }]
            : [],
    }));

    await expect(db.databaseSizeBytes()).resolves.toBe(49152);
  });
});
