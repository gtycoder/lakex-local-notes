import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { bytesToBase64 } from "./assetFs";
import { loadSnapshot } from "../data/persistence";

export interface NativeSqliteMigrationResult {
  status: "already-native" | "no-snapshot" | "migrated";
  databaseName: string;
  integrityCheck?: string;
  noteCount?: number;
  folderCount?: number;
  quickNoteCount?: number;
}

export const DEFAULT_MOBILE_DATABASE = "lake-notes-mobile";

function firstRow(rows: unknown[]): Record<string, unknown> {
  return (rows[0] ?? {}) as Record<string, unknown>;
}

async function query(database: string, statement: string): Promise<unknown[]> {
  const result = await CapacitorSQLite.query({
    database,
    statement,
    values: [],
    readonly: false,
  });
  return result.values ?? [];
}

async function countRows(database: string, table: string): Promise<number> {
  const row = firstRow(await query(database, `SELECT COUNT(*) AS count FROM ${table}`));
  return Number(row.count ?? 0);
}

export async function migrateSnapshotToNativeSqlite(
  database = DEFAULT_MOBILE_DATABASE,
): Promise<NativeSqliteMigrationResult> {
  const nativeExists = await CapacitorSQLite.isDatabase({ database });
  if (nativeExists.result) {
    return { status: "already-native", databaseName: database };
  }

  const snapshot = await loadSnapshot();
  if (!snapshot) {
    return { status: "no-snapshot", databaseName: database };
  }

  const temporaryPath = `${database}.db`;
  await Filesystem.writeFile({
    path: temporaryPath,
    data: bytesToBase64(snapshot),
    directory: Directory.Data,
    recursive: true,
  });
  await CapacitorSQLite.moveDatabasesAndAddSuffix({
    folderPath: "files",
    dbNameList: [temporaryPath],
  });

  await CapacitorSQLite.createConnection({
    database,
    encrypted: false,
    mode: "no-encryption",
    version: 1,
    readonly: false,
  });
  await CapacitorSQLite.open({ database });

  try {
    const integrityRow = firstRow(await query(database, "PRAGMA integrity_check"));
    const integrityCheck = String(integrityRow.integrity_check ?? "");
    if (integrityCheck !== "ok") {
      throw new Error(`SQLite integrity check failed: ${integrityCheck || "unknown"}`);
    }

    const result: NativeSqliteMigrationResult = {
      status: "migrated",
      databaseName: database,
      integrityCheck,
      noteCount: await countRows(database, "notes"),
      folderCount: await countRows(database, "folders"),
      quickNoteCount: await countRows(database, "quick_notes"),
    };

    await CapacitorSQLite.run({
      database,
      statement: `INSERT INTO device_state(key,value) VALUES('native_sqlite_migrated_at',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      values: [new Date().toISOString()],
      transaction: true,
      readonly: false,
    });

    return result;
  } catch (error) {
    // 半迁移库不可信；删除后下次可从仍在的 IndexedDB 快照重试。
    await CapacitorSQLite.deleteDatabase({ database });
    throw error;
  } finally {
    await CapacitorSQLite.close({ database });
    await CapacitorSQLite.closeConnection({ database });
  }
}
