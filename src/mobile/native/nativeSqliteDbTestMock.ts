import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";

/** Bridge tests use the production MobileDb shape without the Android plugin. */
export async function createNativeSqliteDbMockModule() {
  return {
    NativeSqliteDb: class {
      static async open() {
        return new SqlJsAsyncDb(await SqlJsDb.open());
      }
    },
  };
}
