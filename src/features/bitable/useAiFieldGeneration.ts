/**
 * AI 字段生成控制器（261003）：单格生成 + 整列批量生成（并发 2–3、可取消、失败可重试）。
 *
 * 约束（见 docs/BITABLE-OPTIMIZATION-HANDOFF.md §7 批次 G）：
 * - 生成 = **显式用户命令**（不自动重跑）；请求组装走 core 的 buildAiFieldMessages 单一来源；
 * - 写入走 setBitableCellValue 唯一闸口；整列生成用 beginGesture/endGesture 包住 ⇒ **一次撤销**；
 * - 只读 / 字段被删 / 取消 → 未开始的格不再发请求，已完成的保留（与附件回填同一契约：结果只写原目标）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildAiFieldMessages, type BitableDoc } from "../../core/bitableDoc.js";
import { setBitableCellValue } from "../../core/bitableMutations.js";
import { cancelAiChat, newAiRequestId, runAiChat } from "../../lib/ai";

/** 批量生成的渲染层并发（主进程无并发上限，这里自限，避免把用户账号打到限流）。 */
export const AI_GENERATE_CONCURRENCY = 3;

export interface AiCellRunState {
  status: "running" | "failed";
  error?: string;
}

export interface AiBatchState {
  tableId: string;
  fieldId: string;
  total: number;
  done: number;
  failed: number;
  failedRecordIds: string[];
  running: boolean;
  /** 用户点了「取消生成」：已完成的结果保留，未开始的格不再发请求。 */
  cancelled: boolean;
}

interface GenerateOneResult { ok: boolean; cancelled?: boolean; error?: string }

/** 单元格运行态的 key（宿主组件与 hook 共用，避免两处各拼一遍）。 */
export const aiCellKey = (fieldId: string, recordId: string) => fieldId + ":" + recordId;

/** 并发池（纯函数，可直接单测）：最多 limit 个 worker 并行；worker 内部自吞错误。 */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export function useAiFieldGeneration(options: {
  docRef: { current: BitableDoc };
  /** 当前文档 id（字段开启附件内容时用于资产寻址）。 */
  noteId: string;
  updateDoc: (update: (doc: BitableDoc) => BitableDoc) => void;
  beginGesture: () => void;
  endGesture: () => void;
  isReadOnly: () => boolean;
}) {
  const [cellStates, setCellStates] = useState<Record<string, AiCellRunState>>({});
  const [batch, setBatch] = useState<AiBatchState | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const inflightRef = useRef(new Set<string>());
  const cancelledRef = useRef(false);
  const batchRef = useRef<AiBatchState | null>(null);

  const setCellState = useCallback((key: string, state: AiCellRunState | null) => {
    setCellStates((prev) => {
      if (state) return { ...prev, [key]: state };
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** 生成一格：成功即写入（单一闸口）；失败 / 取消由调用方决定展示。 */
  const generateOne = useCallback(async (tableId: string, recordId: string, fieldId: string): Promise<GenerateOneResult> => {
    const key = aiCellKey(fieldId, recordId);
    const built = buildAiFieldMessages(latest.current.docRef.current, tableId, recordId, fieldId, { noteId: latest.current.noteId });
    if (!built.ok) return { ok: false, error: built.error };
    const requestId = newAiRequestId();
    inflightRef.current.add(requestId);
    setCellState(key, { status: "running" });
    try {
      const result = await runAiChat(requestId, built.messages);
      if (cancelledRef.current) { setCellState(key, null); return { ok: false, cancelled: true }; }
      const text = result.ok && typeof result.text === "string" ? result.text.trim() : "";
      if (!text) return { ok: false, error: result.error ?? "生成结果为空" };
      if (latest.current.isReadOnly()) { setCellState(key, null); return { ok: false, cancelled: true }; }
      latest.current.updateDoc((prev) => setBitableCellValue(prev, tableId, recordId, fieldId, text));
      setCellState(key, null);
      return { ok: true };
    } catch (error) {
      if (cancelledRef.current) { setCellState(key, null); return { ok: false, cancelled: true }; }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      inflightRef.current.delete(requestId);
    }
  }, [setCellState]);

  /** 单格生成 / 重新生成。 */
  const generateCell = useCallback(async (tableId: string, recordId: string, fieldId: string) => {
    if (latest.current.isReadOnly()) return;
    cancelledRef.current = false;
    const result = await generateOne(tableId, recordId, fieldId);
    if (!result.ok && !result.cancelled) setCellState(aiCellKey(fieldId, recordId), { status: "failed", error: result.error });
  }, [generateOne, setCellState]);

  /** 整列批量生成：包在 gesture 里 ⇒ 整批一次撤销。 */
  const runBatch = useCallback(async (tableId: string, fieldId: string, recordIds: readonly string[]) => {
    if (latest.current.isReadOnly() || recordIds.length === 0) return;
    cancelledRef.current = false;
    latest.current.beginGesture();
    const state: AiBatchState = { tableId, fieldId, total: recordIds.length, done: 0, failed: 0, failedRecordIds: [], running: true, cancelled: false };
    batchRef.current = state;
    setBatch({ ...state });
    try {
      await runPool(recordIds, AI_GENERATE_CONCURRENCY, async (recordId) => {
        if (cancelledRef.current) return;
        const current = latest.current.docRef.current;
        const table = current.tables.find((t) => t.id === tableId);
        if (!table || !table.fields.some((f) => f.id === fieldId) || latest.current.isReadOnly()) { cancelledRef.current = true; return; }
        const result = await generateOne(tableId, recordId, fieldId);
        if (!result.ok && !result.cancelled) {
          setCellState(aiCellKey(fieldId, recordId), { status: "failed", error: result.error });
          state.failed += 1;
          state.failedRecordIds.push(recordId);
        }
        state.done += 1;
        setBatch({ ...state });
      });
    } finally {
      latest.current.endGesture();
      const finished: AiBatchState = { ...state, running: false, cancelled: cancelledRef.current };
      batchRef.current = finished;
      setBatch(finished);
    }
  }, [generateOne, setCellState]);

  /** 取消：中止上游请求；未开始的格不再发请求，已完成的保留。 */
  const cancelBatch = useCallback(() => {
    cancelledRef.current = true;
    for (const requestId of inflightRef.current) void cancelAiChat(requestId);
  }, []);

  /** 重试上一批失败项（重新走整批一次撤销）。 */
  const retryFailed = useCallback(() => {
    const last = batchRef.current;
    if (!last || last.running || last.failedRecordIds.length === 0) return;
    void runBatch(last.tableId, last.fieldId, [...last.failedRecordIds]);
  }, [runBatch]);

  const clearBatch = useCallback(() => {
    if (batchRef.current?.running) return;
    batchRef.current = null;
    setBatch(null);
  }, []);

  // 卸载：中止上游请求（已完成的写入保留）。
  useEffect(() => () => {
    cancelledRef.current = true;
    for (const requestId of inflightRef.current) void cancelAiChat(requestId);
  }, []);

  return { cellStates, batch, generateCell, runBatch, cancelBatch, retryFailed, clearBatch };
}