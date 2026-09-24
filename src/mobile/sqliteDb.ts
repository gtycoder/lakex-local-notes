/**
 * 测试专用移动 SQLite（M0 POC）：sql.js（WASM，同步 API）。
 *
 * - 与桌面 `electron/dbLike.ts`（V5 Phase 2）的接口形态对齐：
 *   prepare / exec / transaction 全同步（better-sqlite3 风格）。
 * - 历史遗留 POC 持久化已移除；现在只保留同步 API 形态供测试和一次性迁移验证使用。
 * - POC 结论（见 docs/MOBILE-TECH-STACK.md §9.3）：
 *   wa-sqlite 官方包 JS 层硬编码 Asyncify（async=true），无法直接同步调用；
 *   sql.js 提供现成同步 API，作为 WASM 路线的 DbLike 实现。
 */
import initSqlJs, { type Database, type Statement, type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";

export interface DbLikeStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface DbLike {
  prepare(sql: string): DbLikeStatement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  pragma(source: string, options?: unknown): unknown;
  exec(sql: string): void;
  close(): void;
}

export interface MobileDbStatement {
  get(...params: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(...params: unknown[]): Promise<Record<string, unknown>[]>;
  run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
}

export interface MobileDb {
  prepare(sql: string): MobileDbStatement;
  /** 可选：N 条语句一次下发（原生一次桥往返 + 单事务）；缺省实现退回逐条。 */
  executeSet?(set: Array<{ statement: string; values: unknown[] }>): Promise<void>;
  transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>>;
  pragma(source: string): Promise<unknown>;
  exec(sql: string): Promise<void>;
  databaseSizeBytes(): Promise<number>;
  close(): Promise<void>;
}

let SQL: SqlJsStatic | null = null;

async function initSqlJsModule(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return SQL;
}

class SqlJsStatement implements DbLikeStatement {
  constructor(
    private readonly db: Database,
    private readonly stmt: Statement,
  ) {}

  private runWith(params: unknown[]): void {
    this.stmt.reset();
    if (params.length) this.stmt.bind(params as never);
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    this.runWith(params);
    return this.stmt.step() ? (this.stmt.getAsObject() as Record<string, unknown>) : undefined;
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    this.runWith(params);
    const rows: Record<string, unknown>[] = [];
    while (this.stmt.step()) rows.push(this.stmt.getAsObject() as Record<string, unknown>);
    return rows;
  }

  /** sql.js 的变更数在 Database 上；rowid 需在同一连接上查询。 */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    this.runWith(params);
    this.stmt.step();

    const changes = this.db.getRowsModified();
    const rowidResult = this.db.exec("SELECT last_insert_rowid() AS rowid");
    const rowid = rowidResult[0]?.values[0]?.[0] ?? 0;

    return {
      changes,
      lastInsertRowid: typeof rowid === "bigint" ? rowid : Number(rowid),
    };
  }
}

export class SqlJsDb implements DbLike {
  private constructor(private readonly db: Database) {}

  static async open(): Promise<SqlJsDb> {
    const S = await initSqlJsModule();
    return new SqlJsDb(new S.Database());
  }

  /** 从快照恢复（POC 持久化：IndexedDB 存的 db.export() 字节） */
  static async openFrom(bytes: Uint8Array): Promise<SqlJsDb> {
    const S = await initSqlJsModule();
    return new SqlJsDb(new S.Database(bytes));
  }

  prepare(sql: string): DbLikeStatement {
    return new SqlJsStatement(this.db, this.db.prepare(sql));
  }

  /**
   * 事务：BEGIN → fn → COMMIT，出错 → ROLLBACK。
   * 禁止在事务内再开事务：SQLite 不支持嵌套 BEGIN（会抛 "cannot start a transaction within
   * a transaction"），且嵌套出错时外层事务可能停在半开状态。所有调用链必须保持单层事务；
   * 若未来确有嵌套需求，改用 SAVEPOINT（SAVEPOINT sp / ROLLBACK TO sp / RELEASE sp）实现，
   * 不要直接嵌套本方法。
   */
  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    const wrapped = ((...args: unknown[]) => {
      this.db.run("BEGIN");
      try {
        const result = fn(...(args as never[]));
        this.db.run("COMMIT");
        return result;
      } catch (e) {
        this.db.run("ROLLBACK");
        throw e;
      }
    }) as unknown as T;
    return wrapped;
  }

  pragma(source: string): unknown {
    return this.db.exec(source);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  /** 导出全库快照字节（POC 持久化用） */
  exportBytes(): Uint8Array {
    return this.db.export();
  }

  /** 数据库逻辑大小：page_count * page_size；诊断统计禁止为此导出全库。 */
  databaseSizeBytes(): number {
    const readPragma = (name: "page_count" | "page_size"): number => {
      const row = this.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
      return Number(row?.[name] ?? 0);
    };
    return readPragma("page_count") * readPragma("page_size");
  }
}

/** Test-only async facade over sql.js; production uses NativeSqliteDb. */
export class SqlJsAsyncDb implements MobileDb {
  constructor(
    private readonly db: DbLike & { databaseSizeBytes?: () => number },
  ) {}

  prepare(sql: string): MobileDbStatement {
    const statement = this.db.prepare(sql);
    return {
      async get(...params: unknown[]) {
        return statement.get(...params);
      },
      async all(...params: unknown[]) {
        return statement.all(...params);
      },
      async run(...params: unknown[]) {
        return statement.run(...params);
      },
    };
  }

  async transaction<T extends (...args: never[]) => Promise<unknown>>(
    fn: T,
  ): Promise<Awaited<ReturnType<T>>> {
    this.db.exec("BEGIN");
    try {
      const result = await fn();
      this.db.exec("COMMIT");
      return result as Awaited<ReturnType<T>>;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async pragma(source: string): Promise<unknown> {
    return this.db.pragma(source);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async databaseSizeBytes(): Promise<number> {
    if (!this.db.databaseSizeBytes) throw new Error("Database size is unavailable");
    return this.db.databaseSizeBytes();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
