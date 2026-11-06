/**
 * 移动端「创建副本」桥（261106 task-6）：**与桌面 IPC `duplicate_notes` 同一套 core 契约、同形结果**。
 *
 * 分工（与 electron/ipc/registerDuplicateNotes.ts 一一对应）：
 * - 输入清洗/命名/URL 重写/结果汇总在 `src/core/duplicateNotes`（纯逻辑，两端共用）；
 * - 这里只做：逐条调用 `data/duplicateNotes.duplicateNote`（移动端新建管线 + 资源复制 + 同父级下方插入）、
 *   把条目级异常映射成 reason、按源 `sort_order` 降序处理（连续插入不会互相移位）、条与条之间让出事件循环。
 *
 * 与 batchNotes 的差异（有意）：batch 是「先全部校验 → 单事务」，任一不合法整批不执行；
 * 创建副本是**逐条独立**（一条失败不影响其它条），因为每条都会产生一份新正文 + 新资源目录，
 * 整批回滚代价高且没必要。请求级不合法（空/超限/非法 id）仍然整批拒绝。
 *
 * 互斥域：写域（`core/maintenancePolicy.WRITE_OPS` 已登记 "duplicateNotes"；纯本地写、不出网）。
 */
import type { DuplicateNotesRequestShape, DuplicateNotesResultShape, DuplicateNotesReasonShape } from "../../lib/types";
import {
  duplicateReasonOf,
  normalizeDuplicateIds,
  summarizeDuplicateResults,
  type DuplicateNotesItemResult,
} from "../../core/duplicateNotes";
import type { MobileDb } from "../data/sqliteDb";
import { duplicateNote } from "../data/duplicateNotes";
import { ensureDb, runWrite } from "./context";

/** IN (...) 参数分批（SQLite 变量上限 999；单批 ≤500 已经够，这里仍分批防御）。 */
const SQL_CHUNK = 400;
/** 条与条之间让出事件循环的批次（移动端默认每条都让：批量复制是 UI 当场动作，不能卡住主线程）。 */
export const DUPLICATE_YIELD_EVERY = 1;

const placeholders = (count: number): string => Array.from({ length: count }, () => "?").join(",");

function chunk<T>(items: readonly T[], size = SQL_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const reasonOf = duplicateReasonOf;

/**
 * 处理顺序 = 源 sort_order **降序**：副本插到源下方（其后同级 +1），先处理靠后的源，
 * 前面源的位置就不会被同批的插入挤动（避免连续插入互相移位）。
 * 不存在 / 分组 / 小记的 id 没有 notes 行 ⇒ 排到最后（它们反正会逐条失败）。
 */
async function orderIdsForDuplication(d: MobileDb, ids: readonly string[]): Promise<string[]> {
  const sortOrder = new Map<string, number>();
  for (const part of chunk([...new Set(ids)])) {
    if (part.length === 0) continue;
    const rows = await d.prepare(
      "SELECT id, sort_order FROM notes WHERE id IN (" + placeholders(part.length) + ")",
    ).all(...part) as Array<{ id: string; sort_order: number }>;
    for (const row of rows) sortOrder.set(String(row.id), Number(row.sort_order ?? 0));
  }
  return [...ids].sort((a, b) => {
    const diff = (sortOrder.get(b) ?? Number.NEGATIVE_INFINITY) - (sortOrder.get(a) ?? Number.NEGATIVE_INFINITY);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

export interface RunMobileDuplicateNotesOptions {
  /** 测试注入：覆盖单条复制实现（默认 data/duplicateNotes.duplicateNote）。 */
  duplicateOne?: (sourceId: string) => Promise<{ id: string }> | { id: string };
  /** 每 N 条让出一次事件循环（默认 1）。 */
  yieldEvery?: number;
  /** 测试注入时钟（副本标题）。 */
  now?: Date;
  /** 测试注入让出实现（默认 setTimeout(0)）。 */
  yieldNow?: () => Promise<void>;
}

/**
 * 跑一批（bridge 与测试共用入口）。
 * 请求级不合法 ⇒ 整批不执行（results 为空，reason/message 说明原因）；
 * 条目级异常 ⇒ 逐条 reason，**不回滚其它条**（部分成功是允许的）。
 */
export async function runMobileDuplicateNotes(
  d: MobileDb,
  raw: unknown,
  options: RunMobileDuplicateNotesOptions = {},
): Promise<DuplicateNotesResultShape> {
  const payload = (raw ?? {}) as Partial<DuplicateNotesRequestShape>;
  const normalized = normalizeDuplicateIds(payload.ids);
  if (!normalized.ok) {
    return {
      ok: false,
      results: [],
      summary: { total: 0, done: 0, failed: 0 },
      reason: normalized.reason as DuplicateNotesReasonShape,
      message: normalized.message,
    };
  }
  const ordered = await orderIdsForDuplication(d, normalized.ids);
  const yieldNow = options.yieldNow ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const yieldEvery = Math.max(1, options.yieldEvery ?? DUPLICATE_YIELD_EVERY);
  const results: DuplicateNotesItemResult[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const id = ordered[index];
    try {
      const created = options.duplicateOne
        ? await options.duplicateOne(id)
        : await duplicateNote(d, id, { now: options.now });
      results.push({ id, ok: true, newId: created.id });
    } catch (error) {
      results.push({ id, ok: false, reason: reasonOf(error) });
    }
    // 条与条之间让出事件循环：单批最多 500 条，整段同步跑会卡住 WebView 主线程。
    if ((index + 1) % yieldEvery === 0) await yieldNow();
  }
  const summary = summarizeDuplicateResults(results);
  return { ok: summary.failed === 0, results, summary };
}

export const duplicateNotesDomain = {
  /** 创建副本（移动端唯一入口；写域：纯本地写、不出网）。 */
  async duplicateNotes(payload: DuplicateNotesRequestShape): Promise<DuplicateNotesResultShape> {
    return runWrite("duplicateNotes", async () => {
      const d = await ensureDb();
      return await runMobileDuplicateNotes(d, payload);
    });
  },
};