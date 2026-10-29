/**
 * 搜索账本 / FTS 建表 DDL 的**字符串单一来源**（CORE-13）。
 *
 * 背景：同一句 `CREATE VIRTUAL TABLE ... tokenize='unicode61'` 与账本建表曾在 4 个文件各写一遍
 * （桌面 `electron/schemaInit.ts` / `electron/quickNotes.ts`、移动 `src/mobile/data/schema.ts`），
 * tokenize 这个**与 src/core/search 中文单字预分词强耦合**的参数更是连测试夹具一起手写 6 处
 * ⇒ 改一处漂五处（分词器与索引不一致 = 摘要/命中位置对不上，且不会报错）。
 *
 * 本模块只收「字符串」：表名 / 列片段 / 分词器参数 / 索引名 / 建表语句；执行与顺序归各端 DDL。
 * 账本列集两端不同（移动端多 title / raw_hash 供逐篇 hash 对账；桌面小记用 text_hash），
 * 所以列由调用方按 `SEARCH_LEDGER_COLUMN` 片段拼 —— 本模块不替任何一端固化列序。
 *
 * 当前接线：`src/mobile/data/schema.ts`（CORE-13 第一批）；桌面两处待接（同一批常量的后续）。
 */

/** 分词器参数（与 src/core/search/segment 的中文单字预分词强耦合：改它 = 两端索引必须重建）。 */
export const SEARCH_FTS_TOKENIZER = "unicode61";

/** 文档全文索引虚拟表（title + body）。 */
export const NOTES_FTS_TABLE = "notes_fts";
/** 文档搜索账本表。 */
export const NOTES_SEARCH_LEDGER_TABLE = "search_index";
/** 文档账本 fts_rowid 唯一索引。 */
export const NOTES_SEARCH_LEDGER_ROWID_INDEX = "idx_search_index_rowid";

/** 小记全文索引虚拟表（body + tags，独立于文档搜索）。 */
export const QUICK_NOTES_FTS_TABLE = "quick_notes_fts";
/** 小记搜索账本表。 */
export const QUICK_NOTES_SEARCH_LEDGER_TABLE = "quick_notes_search_index";
/** 小记账本 fts_rowid 唯一索引。 */
export const QUICK_NOTES_SEARCH_LEDGER_ROWID_INDEX = "idx_quick_notes_search_rowid";

/** 账本列片段（列名/类型不再在各端 DDL 里手写）。 */
export const SEARCH_LEDGER_COLUMN = {
  noteId: "note_id TEXT PRIMARY KEY",
  quickNoteId: "quick_note_id TEXT PRIMARY KEY",
  ftsRowid: "fts_rowid INTEGER NOT NULL",
  /** 移动端额外列：标题与原始正文 hash（增量对账用）。 */
  title: "title TEXT NOT NULL",
  rawHash: "raw_hash TEXT",
  titleHash: "title_hash TEXT NOT NULL",
  bodyHash: "body_hash TEXT NOT NULL",
  /** 桌面小记账本用 text_hash，移动端用 content_hash（同名不同列属历史现状，不下沉统一）。 */
  textHash: "text_hash TEXT NOT NULL",
  contentHash: "content_hash TEXT NOT NULL",
  textCache: "text_cache TEXT NOT NULL",
  tags: "tags TEXT NOT NULL",
  indexedAt: "indexed_at TEXT NOT NULL",
} as const;

/** 文档全文索引虚拟表 DDL。 */
export function notesFtsDDL(): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${NOTES_FTS_TABLE} USING fts5(title, body, tokenize='${SEARCH_FTS_TOKENIZER}')`;
}

/** 小记全文索引虚拟表 DDL。 */
export function quickNotesFtsDDL(): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${QUICK_NOTES_FTS_TABLE} USING fts5(body, tags, tokenize='${SEARCH_FTS_TOKENIZER}')`;
}

/** 账本表 DDL（列顺序 = 入参顺序，由各端按自己的列集拼）。 */
export function searchLedgerDDL(table: string, columns: readonly string[]): string {
  return `CREATE TABLE IF NOT EXISTS ${table} (${columns.join(", ")})`;
}

/** 账本 fts_rowid 唯一索引 DDL（索引名同样由常量给，不按表名拼）。 */
export function searchLedgerRowidIndexDDL(indexName: string, table: string): string {
  return `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table}(fts_rowid)`;
}
