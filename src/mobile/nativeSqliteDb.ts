import { CapacitorSQLite } from "@capacitor-community/sqlite";
import type { MobileDb, MobileDbStatement } from "./sqliteDb.js";

type MobileRow = Record<string, unknown>;

function normalizeRows(values: unknown[]): MobileRow[] {
  return values.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Native SQLite returned an unexpected row shape");
    }
    return value as MobileRow;
  });
}

function isConnectionExistsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already exists");
}

function isPragmaStatement(sql: string): boolean {
  return /^\s*PRAGMA\s+/i.test(sql);
}

export class NativeSqliteDb implements MobileDb {
  private constructor(private readonly database: string) {}

  static async open(database = "lake-notes-mobile"): Promise<NativeSqliteDb> {
    const connection = {
      database,
      encrypted: false,
      mode: "no-encryption",
      version: 1,
      readonly: false,
    };
    try {
      await CapacitorSQLite.createConnection(connection);
    } catch (error) {
      // Android reports an already-registered connection as an error. It is
      // still usable, and open() re-opens it safely when needed.
      if (!isConnectionExistsError(error)) throw error;
    }
    await CapacitorSQLite.open({ database, readonly: false });

    const db = new NativeSqliteDb(database);
    // Android's plugin rejects PRAGMA through execute(); query() is the supported path.
    await db.pragma("PRAGMA journal_mode=WAL");
    return db;
  }

  private async query(statement: string, values: unknown[] = []): Promise<MobileRow[]> {
    const result = await CapacitorSQLite.query({
      database: this.database,
      statement,
      values,
      readonly: false,
    });
    return normalizeRows(result.values ?? []);
  }

  prepare(sql: string): MobileDbStatement {
    return {
      get: async (...params: unknown[]) => {
        const rows = await this.query(sql, params);
        return rows[0];
      },
      all: async (...params: unknown[]) => this.query(sql, params),
      run: async (...params: unknown[]) => {
        const result = await CapacitorSQLite.run({
          database: this.database,
          statement: sql,
          values: params,
          transaction: false,
          readonly: false,
        });
        return {
          changes: Number(result.changes?.changes ?? 0),
          lastInsertRowid: Number(result.changes?.lastId ?? 0),
        };
      },
    };
  }

  async transaction<T extends (...args: never[]) => Promise<unknown>>(
    fn: T,
  ): Promise<Awaited<ReturnType<T>>> {
    await CapacitorSQLite.beginTransaction({ database: this.database, readonly: false });
    try {
      const result = await fn();
      await CapacitorSQLite.commitTransaction({ database: this.database, readonly: false });
      return result as Awaited<ReturnType<T>>;
    } catch (error) {
      await CapacitorSQLite.rollbackTransaction({ database: this.database, readonly: false });
      throw error;
    }
  }

  async pragma(source: string): Promise<unknown> {
    return this.query(source);
  }

  async exec(sql: string): Promise<void> {
    if (isPragmaStatement(sql)) {
      await this.query(sql);
      return;
    }
    await CapacitorSQLite.execute({
      database: this.database,
      statements: sql,
      transaction: true,
      readonly: false,
    });
  }

  async databaseSizeBytes(): Promise<number> {
    const pageCount = (await this.query("PRAGMA page_count"))[0]?.page_count;
    const pageSize = (await this.query("PRAGMA page_size"))[0]?.page_size;
    return Number(pageCount ?? 0) * Number(pageSize ?? 0);
  }

  async close(): Promise<void> {
    await CapacitorSQLite.close({ database: this.database, readonly: false });
    await CapacitorSQLite.closeConnection({ database: this.database, readonly: false });
  }
}
