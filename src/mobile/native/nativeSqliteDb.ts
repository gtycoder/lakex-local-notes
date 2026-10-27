import { CapacitorSQLite } from "@capacitor-community/sqlite";
import type { MobileDb, MobileDbStatement } from "../data/sqliteDb.js";

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

  /**
   * 数据库级串行锁（261026 真机发现）：CapacitorSQLite 的**事务状态是连接级的**，
   * JS 侧 transaction() 中间有 await，别的异步任务（后台 FTS reconcile、用户写操作）可以插进来，
   * 造成嵌套 BEGIN / COMMIT 无事务（真机报 "CommitTransaction: no current transaction"）。
   * 这里把「事务整体」与「单条语句」放到同一把串行锁上；事务内（txDepth>0）不再抢锁，避免自锁。
   */
  private lock: Promise<unknown> = Promise.resolve();
  private txDepth = 0;

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 事务内直接执行（外层已持锁）；否则排队。 */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    return this.txDepth > 0 ? fn() : this.withLock(fn);
  }

  static async open(database = "local-lakex-notes-mobile"): Promise<NativeSqliteDb> {
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
    // 260925：WAL 下用 NORMAL——提交不逐次 fsync、仅 checkpoint 落盘，是逐条导入的性能关键；
    // 断电可能丢最近几次提交（不损坏），靠重同步自愈。
    await db.pragma("PRAGMA synchronous=NORMAL");
    return db;
  }

  private async query(statement: string, values: unknown[] = []): Promise<MobileRow[]> {
    return await this.locked(async () => {
      const result = await CapacitorSQLite.query({
        database: this.database,
        statement,
        values,
        readonly: false,
      });
      return normalizeRows(result.values ?? []);
    });
  }

  prepare(sql: string): MobileDbStatement {
    return {
      get: async (...params: unknown[]) => {
        const rows = await this.query(sql, params);
        return rows[0];
      },
      all: async (...params: unknown[]) => this.query(sql, params),
      run: async (...params: unknown[]) => await this.locked(async () => {
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
      }),
    };
  }

  async transaction<T extends (...args: never[]) => Promise<unknown>>(
    fn: T,
  ): Promise<Awaited<ReturnType<T>>> {
    // 嵌套事务：外层已持锁且有事务，直接执行（由最外层统一 commit/rollback）。
    if (this.txDepth > 0) return (await fn()) as Awaited<ReturnType<T>>;
    return await this.withLock(async () => {
      await CapacitorSQLite.beginTransaction({ database: this.database, readonly: false });
      this.txDepth += 1;
      try {
        const result = await fn();
        await CapacitorSQLite.commitTransaction({ database: this.database, readonly: false });
        return result as Awaited<ReturnType<T>>;
      } catch (error) {
        try { await CapacitorSQLite.rollbackTransaction({ database: this.database, readonly: false }); } catch { /* 已无事务 */ }
        throw error;
      } finally {
        this.txDepth -= 1;
      }
    });
  }

  async pragma(source: string): Promise<unknown> {
    return this.query(source);
  }

  async exec(sql: string): Promise<void> {
    if (isPragmaStatement(sql)) {
      await this.query(sql);
      return;
    }
    await this.locked(async () => {
      await CapacitorSQLite.execute({
        database: this.database,
        statements: sql,
        // 事务内不能再开事务；外层事务已保证原子性。
        transaction: this.txDepth === 0,
        readonly: false,
      });
    });
  }

  async executeSet(set: Array<{ statement: string; values: unknown[] }>, options?: { transaction?: boolean }): Promise<void> {
    // 一次桥往返执行整批；默认由插件开单事务，**已在事务内**时调用方传 transaction:false。
    // 整批必须在锁内执行：否则别的任务可能在批内插入语句/事务（真机 CommitTransaction 报错的根因）。
    await this.locked(async () => {
      await CapacitorSQLite.executeSet({
        database: this.database,
        set: set.map((s) => ({ statement: s.statement, values: s.values })),
        transaction: this.txDepth === 0 ? (options?.transaction ?? true) : false,
        readonly: false,
      });
    });
  }

  async databaseSizeBytes(): Promise<number> {
    const pageCount = (await this.query("PRAGMA page_count"))[0]?.page_count;
    const pageSize = (await this.query("PRAGMA page_size"))[0]?.page_size;
    return Number(pageCount ?? 0) * Number(pageSize ?? 0);
  }

  async close(): Promise<void> {
    await this.withLock(async () => {
      await CapacitorSQLite.close({ database: this.database, readonly: false });
      await CapacitorSQLite.closeConnection({ database: this.database, readonly: false });
    });
  }
}
