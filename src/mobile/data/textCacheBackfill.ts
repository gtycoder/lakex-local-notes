/**
 * text_cache 后台补齐（261027 真机量化后优化）。
 *
 * 背景：导入时把整篇纯文本（text_cache）随 INSERT 一起过 CapacitorSQLite 桥，真机实测
 * 每 100 篇 ~4.8MB、sqlMs 800–900ms —— 这是首拉正文阶段的大头之一。
 * 现在导入只写 NULL，同步结束后台分批「读正文文件 → 生成纯文本 → 批量 UPDATE」。
 * 好处：同步关键路径不再搬 92MB 文本；列表预览/搜索在后台补齐前暂为空（可接受）。
 * 补齐按 text_cache IS NULL 幂等续跑：进程被杀下次继续。
 */
import { normalizeNoteKind } from "../../core/noteKind.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import { readNoteBodiesBatch } from "./noteBodies.js";
import { executeBatch, type MobileDb } from "./sqliteDb.js";

export async function backfillTextCache(db: MobileDb, batchSize = 50): Promise<{ filled: number; batches: number }> {
  const size = Number.isSafeInteger(batchSize) && batchSize > 0 ? batchSize : 50;
  let filled = 0;
  let batches = 0;
  for (;;) {
    const rows = await db.prepare(
      "SELECT id, doc_kind FROM notes WHERE text_cache IS NULL AND trashed_at IS NULL ORDER BY id LIMIT ?"
    ).all(size) as Array<{ id: string; doc_kind: string | null }>;
    if (rows.length === 0) break;
    const bodies = await readNoteBodiesBatch(rows.map((r) => ({ kind: normalizeNoteKind(r.doc_kind), id: r.id })));
    const statements: Array<{ statement: string; values: unknown[] }> = [];
    rows.forEach((row, index) => {
      const text = bodies[index];
      // 读不到正文（异常/缺失）也写空串，避免死循环；正文恢复后由保存/重拉路径重新写 cache。
      const plain = text == null ? "" : (searchTextForKind(normalizeNoteKind(row.doc_kind), text).plain ?? "");
      statements.push({ statement: "UPDATE notes SET text_cache=? WHERE id=?", values: [plain, row.id] });
    });
    await executeBatch(db, statements);
    filled += statements.length;
    batches += 1;
  }
  return { filled, batches };
}
