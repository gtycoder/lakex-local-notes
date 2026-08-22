/**
 * 移动端 SQLite（M0 POC）：sql.js（WASM，同步 API）实现 DbLike 兼容数据层。
 *
 * - 与 lake-core `src/core/dbLike.ts`（V5 Phase 2）的接口形态对齐：
 *   prepare / exec / transaction 全同步（better-sqlite3 风格）。
 * - 持久化：db.export() 快照 → IndexedDB（POC 阶段）；M1 迁移到 Filesystem/正式方案。
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

let SQL: SqlJsStatic | null = null;

async function initSqlJsModule(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return SQL;
}

class SqlJsStatement implements DbLikeStatement {
  constructor(private readonly stmt: Statement) {}

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

  /** sql.js 无 statement 级 changes/rowid；POC 写操作走 db.exec/db.run（changes 另计） */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    this.runWith(params);
    this.stmt.step();
    return { changes: 0, lastInsertRowid: 0 };
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
    return new SqlJsStatement(this.db.prepare(sql));
  }

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
}
