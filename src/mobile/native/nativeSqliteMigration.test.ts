import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlite = vi.hoisted(() => ({
  calls: [] as string[],
  isDatabase: vi.fn(async () => {
    sqlite.calls.push("isDatabase");
    return { result: false };
  }),
  moveDatabasesAndAddSuffix: vi.fn(async () => {
    sqlite.calls.push("moveDatabasesAndAddSuffix");
  }),
  createConnection: vi.fn(async () => {
    sqlite.calls.push("createConnection");
  }),
  open: vi.fn(async () => {
    sqlite.calls.push("open");
  }),
  query: vi.fn(async ({ statement }: { statement: string }) => {
    sqlite.calls.push(`query:${statement}`);
    if (statement === "PRAGMA integrity_check") return { values: [{ integrity_check: "ok" }] };
    if (statement.includes("FROM notes")) return { values: [{ count: 3 }] };
    if (statement.includes("FROM folders")) return { values: [{ count: 2 }] };
    if (statement.includes("FROM quick_notes")) return { values: [{ count: 1 }] };
    return { values: [] };
  }),
  run: vi.fn(async () => {
    sqlite.calls.push("run");
    return { changes: { changes: 1 } };
  }),
  deleteDatabase: vi.fn(async () => {
    sqlite.calls.push("deleteDatabase");
  }),
  close: vi.fn(async () => {
    sqlite.calls.push("close");
  }),
  closeConnection: vi.fn(async () => {
    sqlite.calls.push("closeConnection");
  }),
}));

const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(async () => {
    sqlite.calls.push("writeFile");
  }),
}));

vi.mock("@capacitor-community/sqlite", () => ({
  CapacitorSQLite: sqlite,
}));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Data: "DATA" },
}));
vi.mock("../data/persistence", () => ({
  loadSnapshot: vi.fn(),
}));
vi.mock("./assetFs", () => ({
  bytesToBase64: vi.fn(() => "c3FsaXRlLXNuYXBzaG90"),
}));

import { migrateSnapshotToNativeSqlite } from "./nativeSqliteMigration.js";
import { loadSnapshot } from "../data/persistence";

describe("native SQLite migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlite.calls.length = 0;
  });

  it("does nothing when the native database already exists", async () => {
    sqlite.isDatabase.mockResolvedValueOnce({ result: true });

    await expect(migrateSnapshotToNativeSqlite("lake-notes-mobile")).resolves.toEqual({
      status: "already-native",
      databaseName: "lake-notes-mobile",
    });

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    expect(sqlite.moveDatabasesAndAddSuffix).not.toHaveBeenCalled();
  });

  it("does not create a native database when no snapshot exists", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce(null);

    await expect(migrateSnapshotToNativeSqlite()).resolves.toEqual({
      status: "no-snapshot",
      databaseName: "lake-notes-mobile",
    });

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    expect(sqlite.open).not.toHaveBeenCalled();
  });

  it("moves the IndexedDB snapshot, validates it, and records migration metadata", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    const result = await migrateSnapshotToNativeSqlite("lake-notes-mobile");

    expect(result).toEqual({
      status: "migrated",
      databaseName: "lake-notes-mobile",
      integrityCheck: "ok",
      noteCount: 3,
      folderCount: 2,
      quickNoteCount: 1,
    });
    expect(filesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "lake-notes-mobile.db",
        data: "c3FsaXRlLXNuYXBzaG90",
        directory: "DATA",
      }),
    );
    expect(sqlite.moveDatabasesAndAddSuffix).toHaveBeenCalledWith({
      folderPath: "files",
      dbNameList: ["lake-notes-mobile.db"],
    });
    expect(sqlite.calls).toEqual([
      "isDatabase",
      "writeFile",
      "moveDatabasesAndAddSuffix",
      "createConnection",
      "open",
      "query:PRAGMA integrity_check",
      "query:SELECT COUNT(*) AS count FROM notes",
      "query:SELECT COUNT(*) AS count FROM folders",
      "query:SELECT COUNT(*) AS count FROM quick_notes",
      "run",
      "close",
      "closeConnection",
    ]);
  });

  it("deletes an untrusted half-migrated database and keeps the source snapshot", async () => {
    vi.mocked(loadSnapshot).mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    sqlite.query.mockImplementationOnce(async () => ({
      values: [{ integrity_check: "corrupt" }],
    }));

    await expect(migrateSnapshotToNativeSqlite()).rejects.toThrow("SQLite integrity check failed: corrupt");

    expect(sqlite.deleteDatabase).toHaveBeenCalledWith({ database: "lake-notes-mobile" });
    expect(sqlite.close).toHaveBeenCalled();
    expect(sqlite.closeConnection).toHaveBeenCalled();
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
  });
});
