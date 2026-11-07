/**
 * 批量操作结果 → 一句可读汇总（261106 task-82）。
 * 261107：reason 文案单一来源 = core/batchNotesReport；移动端只保留自己的汇总格式（动词由调用方给）。
 */
import type { BatchNotesReason, BatchNotesResult } from "../../core/batchNotes";
import { BATCH_NOTES_REASON_TEXT, batchNotesReasonText } from "../../core/batchNotesReport";

export function batchReasonLabel(reason: BatchNotesReason | undefined): string {
  return reason ? BATCH_NOTES_REASON_TEXT[reason] ?? batchNotesReasonText(reason) : "";
}

/**
 * 汇总文案：
 * - 全部成功 → "<verb> N 项"；
 * - 部分/全部失败 → "成功 N，失败 M（原因1、原因2…）"（去重、最多 3 种原因）。
 */
export function summarizeBatchResult(result: BatchNotesResult, verb: string): string {
  const { done, failed } = result.summary;
  if (failed === 0 && done > 0) return verb + " " + done + " 项";
  const reasons: string[] = [];
  for (const item of result.results) {
    if (item.ok) continue;
    const label = batchReasonLabel(item.reason);
    if (label && !reasons.includes(label)) reasons.push(label);
    if (reasons.length >= 3) break;
  }
  const detail = reasons.length > 0 ? "（" + reasons.join("、") + "）" : result.message ? "（" + result.message + "）" : "";
  if (done === 0 && failed === 0) return verb + "失败" + detail;
  return "成功 " + done + "，失败 " + failed + detail;
}
