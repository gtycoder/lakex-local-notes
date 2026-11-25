/**
 * 移动 DB 端口类型 + 批量执行纯工具（M-01 拆分）：**零重依赖** —— 生产数据层/桥/v3 端口只 import 本文件。
 *
 * 背景（审计 03-mobile M-01）：原 data/sqliteDb.ts 把「接口与小工具」和「sql.js 测试后端」混在一起，
 * 生产文件取类型/executeBatch 时连带把 sql.js + 685KB wasm 打进首屏 chunk 与 APK。拆分后：
 *  - 本文件 = DbLike/MobileDb 接口 + executeBatch*（同步/异步两端都要用的批量语义）；
 *  - data/sqliteDbWeb.ts = SqlJsDb/SqlJsAsyncDb（仅测试 mock 与浏览器兜底，动态 import sql.js）。
 *
 * 与桌面 `electron/dbLike.ts`（V5 Phase 2）的接口形态对齐：prepare / exec / transaction 全同步
 * （better-sqlite3 风格）；生产 Android 端是原生 SQLite（nativeSqliteDb.ts）。
 */
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
  /**
   * 可选：N 条语句一次下发（原生一次桥往返）。默认由原生包一层事务；
   * **已在事务内**时调用方必须传 `{ transaction: false }`（否则原生会重复 BEGIN）。
   */
  executeSet?(set: Array<{ statement: string; values: unknown[] }>, options?: { transaction?: boolean }): Promise<void>;
  transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>>;
  pragma(source: string): Promise<unknown>;
  exec(sql: string): Promise<void>;
  databaseSizeBytes(): Promise<number>;
  close(): Promise<void>;
}

export interface MobileBatchStatement {
  statement: string;
  values: unknown[];
}

/** 一个用户动作 = 一个事务/一次桥往返；executeSet 失败直接抛，不逐条重放造成部分成功。 */
export async function executeBatch(d: MobileDb, statements: MobileBatchStatement[]): Promise<void> {
  if (statements.length === 0) return;
  if (d.executeSet) {
    await d.executeSet(statements);
    return;
  }
  await d.transaction(async () => executeBatchInTransaction(d, statements));
}

/** 已在事务内时使用：有 executeSet 走单次下发，否则逐条执行（绝不再开嵌套事务）。 */
export async function executeBatchInTransaction(d: MobileDb, statements: MobileBatchStatement[]): Promise<void> {
  if (statements.length === 0) return;
  if (d.executeSet) {
    // 已经在外层事务里：不能再让原生开一次事务（否则 "Already in transaction"）。
    await d.executeSet(statements, { transaction: false });
    return;
  }
  for (const item of statements) await d.prepare(item.statement).run(...item.values);
}
