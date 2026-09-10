/**
 * 数据库注入点（lake-core，V5 Phase 2）：DbLike 接口先行。
 * 桌面默认 = better-sqlite3 的 Database（结构兼容，无需包装类）；
 * 移动端可提供 AsyncDb / WASM 实现。事务边界不动（调用方仍用 db.transaction(fn)）。
 */

export interface DbLikeStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  iterate?(...params: unknown[]): IterableIterator<unknown>;
}

/**
 * better-sqlite3 风格事务。返回类型用 any 的原因（已实测，勿轻易改动）：
 * - better-sqlite3 的 transaction 类型为 <T>(fn: T) => Transaction<T>（Transaction<T> = T & 扩展）；
 * - TS 泛型函数赋值对返回类型做「T & 扩展 <: T」检查时触发方差限制
 *   （Transaction<T> is assignable to the constraint of type T, but T could be
 *   instantiated with a different subtype）——泛型属性/方法语法均无法通过；
 * - 非泛型版本（返回 ((...args)=>unknown) & 扩展）会把调用方 tx() 的返回类型降为 unknown，
 *   破坏 store.ts 中 return this.db.transaction(() => ...)() 的布尔返回模式；
 * - 因此保留 any：桌面实现结构兼容、调用方类型不被破坏，移动端可宽松实现。
 */
export type DbLikeTransaction = (fn: (...args: never[]) => unknown) => any;

export interface DbLike {
  prepare(sql: string): DbLikeStatement;
  transaction: DbLikeTransaction;
  pragma(source: string, options?: unknown): unknown;
  exec(sql: string): void;
  close(): void;
}