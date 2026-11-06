/**
 * 批量操作结果 → 一句可读汇总（261106 task-82，两端同一套 reason 文案）。
 * 契约：{ ok, results:[{id,ok,reason?}], summary:{total,done,failed}, reason?, message? }
 */
import type { BatchNotesReason, BatchNotesResult } from "../../core/batchNotes";

const REASON_LABELS: Record<BatchNotesReason, string> = {
  "invalid-input": "参数无效",
  "invalid-action": "不支持的操作",
  "empty-ids": "没有选中条目",
  "too-many-ids": "一次选太多",
  "invalid-id": "条目 id 无效",
  "not-found": "条目已不存在",
  "notebook-not-batchable": "笔记本不支持批量",
  unsupported: "该类型不支持此操作",
  "already-trashed": "已在回收站",
  "parent-not-found": "目标位置不存在",
  "parent-not-a-container": "目标不是笔记本或分组",
  "parent-in-trash": "目标位置在回收站里",
  "parent-cycle": "不能移动到自己的子级",
  "tag-unavailable": "标签目录暂不可用",
  "tag-not-found": "标签不存在或已删除",
  failed: "执行失败",
};

export function batchReasonLabel(reason: BatchNotesReason | undefined): string {
  return reason ? REASON_LABELS[reason] ?? reason : "";
}

/**
 * 汇总文案：
 * - 全部成功 → "已完成 N 项"；
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
