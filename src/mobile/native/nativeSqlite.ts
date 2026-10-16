import { CapacitorSQLite } from "@capacitor-community/sqlite";

export interface NativeSqliteSpikeResult {
  databaseName: string;
  journalMode: string;
  rowCount: number;
  reopenedRowCount: number;
  rolledBackRowCount: number;
  pageBytes: number;
  databaseList: string[];
}

function firstValue(rows: unknown[], key: string): string {
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? String(row[key]) : "";
}

async function query(database: string, statement: string): Promise<unknown[]> {
  const result = await CapacitorSQLite.query({ database, statement, values: [], readonly: false });
  return result.values ?? [];
}

/** Android 原生 SQLite spike：不接主路径，只验证插件行为和文件库语义。 */
export async function runNativeSqliteSpike(
  database = "lake-notes-mobile-spike",
  reset = true,
): Promise<NativeSqliteSpikeResult> {
  await CapacitorSQLite.createConnection({
    database,
    encrypted: false,
    mode: "no-encryption",
    version: 1,
    readonly: false,
  });
  await CapacitorSQLite.open({ database });

  try {
    // Android 原生层把 PRAGMA 视为查询；用 query 才能同时设置并读取 journal_mode。
    const journalRows = await query(database, "PRAGMA journal_mode=WAL");
    if (reset) {
      await CapacitorSQLite.execute({
        database,
        statements: `
          DROP TABLE IF EXISTS spike_rows;
          CREATE TABLE spike_rows (
            id INTEGER PRIMARY KEY,
            text_value TEXT,
            integer_value INTEGER,
            null_value BLOB
          );
        `,
        transaction: true,
        readonly: false,
      });

      const rows = Array.from({ length: 100 }, (_, index) => ({
        statement: "INSERT INTO spike_rows(text_value, integer_value, null_value) VALUES(?,?,?)",
        values: [`row-${index}`, index, null],
      }));
      await CapacitorSQLite.executeSet({
        database,
        set: rows,
        transaction: true,
        readonly: false,
      });
    }

    // 事务回滚必须保持原子性：写入后回滚，不能留下半批数据。
    await CapacitorSQLite.beginTransaction({ database });
    await CapacitorSQLite.run({
      database,
      statement: "INSERT INTO spike_rows(text_value, integer_value, null_value) VALUES(?,?,?)",
      values: ["rolled-back", -1, null],
      transaction: false,
      readonly: false,
    });
    await CapacitorSQLite.rollbackTransaction({ database });

    const pageCount = Number(firstValue(await query(database, "PRAGMA page_count"), "page_count"));
    const pageSize = Number(firstValue(await query(database, "PRAGMA page_size"), "page_size"));
    const rowCount = Number(firstValue(await query(database, "SELECT COUNT(*) AS count FROM spike_rows"), "count"));
    const rolledBackRowCount = Number(
      firstValue(
        await query(database, "SELECT COUNT(*) AS count FROM spike_rows WHERE text_value='rolled-back'"),
        "count",
      ),
    );

    // 关闭后重新打开，验证文件库状态与 WAL 配置能够恢复。
    await CapacitorSQLite.close({ database });
    await CapacitorSQLite.open({ database });
    const reopenedRowCount = Number(
      firstValue(await query(database, "SELECT COUNT(*) AS count FROM spike_rows"), "count"),
    );
    const databaseListResult = await CapacitorSQLite.getDatabaseList();
    const databaseList = (databaseListResult.values ?? []).map((name) => String(name));

    return {
      databaseName: database,
      journalMode: firstValue(journalRows, "journal_mode"),
      rowCount,
      reopenedRowCount,
      rolledBackRowCount,
      pageBytes: pageCount * pageSize,
      databaseList,
    };
  } finally {
    await CapacitorSQLite.close({ database });
    await CapacitorSQLite.closeConnection({ database });
  }
}
