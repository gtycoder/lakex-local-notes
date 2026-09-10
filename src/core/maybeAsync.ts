/**
 * Transitional storage-contract result. Desktop adapters still return sync
 * values, while the mobile native SQLite adapter will return Promises. Remove
 * this alias after all storage ports are fully Promise-based.
 */
export type MaybeAsync<T> = T | Promise<T>;
