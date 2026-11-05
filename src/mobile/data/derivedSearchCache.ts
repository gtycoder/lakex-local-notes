/**
 * 移动端派生搜索缓存（261105）：清空 FTS + 搜索账本，可重建；**不动正文/元数据/历史/附件**。
 *
 * 为什么需要它：`native/cachePort.ts` 的「清理缓存」此前恒返回「清 0 项」= 假动作
 * （261105 容错审计 Top10 #3）。真实可清、且清掉不丢数据的只有派生索引用这一块：
 *  - FTS 表：notes_fts / quick_notes_fts（可由正文重建）；
 *  - 账本表：search_index / quick_notes_search_index（记录 fts_rowid 与内容 hash，可重建）。
 * 重建由调用方在后台跑 reconcileIndex（不在清缓存里同步等待，避免大库卡住点击）。
 *
 * 明确不清：notes/quick_notes 行、正文文件、历史快照、回收站、已下载附件、tag 目录/关联。
 * 表可能不存在（老库/初始化失败）⇒ 跳过，不抛。
 */
import type { MobileDb } from "./sqliteDb.js";
import {
  NOTES_FTS_TABLE,
  NOTES_SEARCH_LEDGER_TABLE,
  QUICK_NOTES_FTS_TABLE,
  QUICK_NOTES_SEARCH_LEDGER_TABLE,
} from "../../core/search/schema.js";

async function hasTable(d: MobileDb, name: string): Promise<boolean> {
  const row = await d.prepare("SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name=?").get(name) as unknown;
  return Boolean(row);
}

async function countRows(d: MobileDb, table: string): Promise<number> {
  try {
    const row = await d.prepare("SELECT COUNT(*) AS n FROM " + table).get() as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

export interface ClearedSearchDerived {
  notes: number;
  quickNotes: number;
}

/** 清空派生搜索缓存（单事务）；返回清掉的行数（账本+FTS 估算，用于 UI 文案）。 */
export async function clearSearchDerivedCache(d: MobileDb): Promise<ClearedSearchDerived> {
  const tables = [NOTES_FTS_TABLE, NOTES_SEARCH_LEDGER_TABLE, QUICK_NOTES_FTS_TABLE, QUICK_NOTES_SEARCH_LEDGER_TABLE];
  const present: string[] = [];
  for (const table of tables) if (await hasTable(d, table)) present.push(table);
  if (present.length === 0) return { notes: 0, quickNotes: 0 };
  const noteRows = await countRows(d, NOTES_SEARCH_LEDGER_TABLE);
  const quickRows = await countRows(d, QUICK_NOTES_SEARCH_LEDGER_TABLE);
  await d.transaction(async () => {
    for (const table of present) await d.prepare("DELETE FROM " + table).run();
  });
  return { notes: noteRows, quickNotes: quickRows };
}
